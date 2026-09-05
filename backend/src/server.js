import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import express from 'express';
import { generateQuestion } from './ai/questionGenerator.js';
import { validateQuestion } from './ai/questionValidator.js';

dotenv.config();
const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://study:study@localhost:5432/study_ai' });
const PORT = Number(process.env.PORT || 4000);
const ML_URL = process.env.ML_URL || 'http://localhost:8000';
const USER_ID = 1;

app.use(cors());
app.use(express.json({limit:'1mb'}));

async function ensureConcept(topic, subject) {
  const r=await pool.query(`SELECT id,name,subject,parent_id FROM concepts WHERE name=$1 AND subject=$2 AND parent_id IS NULL LIMIT 1`,[topic,subject]);
  if(r.rows[0]) return r.rows[0];
  const inserted=await pool.query(`INSERT INTO concepts(name,subject,parent_id) VALUES($1,$2,NULL) RETURNING id,name,subject,parent_id`,[topic,subject]);
  return inserted.rows[0];
}

async function getTarget(targetId) {
  const r=await pool.query(`SELECT id,name,subject FROM learning_targets WHERE id=$1 AND user_id=$2`,[targetId,USER_ID]);
  return r.rows[0] || null;
}

async function getTargetTopics(targetId) {
  const r=await pool.query(`SELECT tt.id,tt.topic_name,tt.mastery,tt.concept_id,c.name AS concept_name FROM target_topics tt LEFT JOIN concepts c ON c.id=tt.concept_id WHERE tt.target_id=$1 ORDER BY tt.id`,[targetId]);
  return r.rows;
}

async function getSubtopics(conceptId) {
  const r=await pool.query(`SELECT id,name,subject,parent_id FROM concepts WHERE parent_id=$1 ORDER BY id`,[conceptId]);
  return r.rows;
}

async function getState(conceptId) {
  const r=await pool.query(`SELECT mastery,attempts,updated_at FROM knowledge_states WHERE user_id=$1 AND concept_id=$2`,[USER_ID,conceptId]);
  return r.rows[0] || {mastery:0,attempts:0,updated_at:null};
}

async function getRecentAttempts(conceptId, limit=12) {
  const r=await pool.query(`SELECT a.correct,a.time_seconds,a.created_at,q.text,q.difficulty FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.user_id=$1 AND q.concept_id=$2 ORDER BY a.created_at DESC LIMIT $3`,[USER_ID,conceptId,limit]);
  return r.rows;
}

async function getPreviousQuestions(conceptId, limit=12) {
  const r=await pool.query(`SELECT id,text FROM questions WHERE concept_id=$1 ORDER BY id DESC LIMIT $2`,[conceptId,limit]);
  return r.rows;
}

async function predictSuccess({mastery,difficulty,attempts,avgTimeRatio=1,recencyDays=0}) {
  try {
    const response=await fetch(`${ML_URL}/predict`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mastery,difficulty,attempts,avg_time_ratio:avgTimeRatio,recency_days:recencyDays})});
    if(!response.ok) throw new Error('ML prediction failed');
    return await response.json();
  } catch { return {success_probability:Math.max(0.05,Math.min(0.95,0.5+0.5*(mastery-difficulty)))}; }
}

function difficultyForMastery(mastery, mode='complete') {
  const base = mode==='complete' ? mastery + 0.05 : mastery + 0.02;
  return Math.max(0.15,Math.min(0.9,base));
}

async function chooseConcept(targetId, mode, topicConceptId=null, excluded=[]) {
  const topics=await getTargetTopics(targetId);
  if(mode==='topic') {
    const subs=await getSubtopics(topicConceptId);
    if(!subs.length) return {conceptId:topicConceptId,topic:topics.find(t=>t.concept_id===topicConceptId)?.topic_name || 'Topic',subtopic:null,mastery:(await getState(topicConceptId)).mastery};
    const candidates=[];
    for(const s of subs){
      if(excluded.includes(s.id)) continue;
      const state=await getState(s.id);
      const attempts=await getRecentAttempts(s.id,10);
      const avg=attempts.length?attempts.reduce((x,a)=>x+a.time_seconds,0)/attempts.length:60;
      const ratio=avg/60;
      const pred=await predictSuccess({mastery:Number(state.mastery),difficulty:difficultyForMastery(Number(state.mastery),'topic'),attempts:state.attempts,avgTimeRatio:ratio,recencyDays:state.updated_at?Math.max(0,(Date.now()-new Date(state.updated_at))/86400000):30});
      candidates.push({conceptId:s.id,subtopic:s.name,mastery:Number(state.mastery),score:1-Number(pred.success_probability ?? .5),prediction:pred});
    }
    candidates.sort((a,b)=>b.score-a.score);
    const c=candidates[0] || {conceptId:subs[0].id,subtopic:subs[0].name,mastery:0};
    return {conceptId:c.conceptId,topic:topics.find(t=>t.concept_id===topicConceptId)?.topic_name || 'Topic',subtopic:c.subtopic,mastery:c.mastery,prediction:c.prediction};
  }
  const candidates=[];
  for(const t of topics){
    if(!t.concept_id || excluded.includes(t.concept_id)) continue;
    const state=await getState(t.concept_id);
    const mastery=Math.min(Number(t.mastery),Number(state.mastery));
    const pred=await predictSuccess({mastery,difficulty:difficultyForMastery(mastery,'complete'),attempts:state.attempts});
    candidates.push({conceptId:t.concept_id,topic:t.topic_name,mastery,score:1-Number(pred.success_probability??.5),prediction:pred});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const c=candidates[0];
  if(!c) throw new Error('Target has no mapped topics');
  return {...c,subtopic:null};
}

async function generateAndStore({subject,topic,conceptId,subtopic,mastery,targetDifficulty,recentMistakes,previousQuestions}) {
  for(let attempt=0;attempt<3;attempt++){
    const generated=await generateQuestion({subject,topic,subtopic,mastery,targetDifficulty,recentMistakes,previousQuestions});
    const validation=validateQuestion(generated,previousQuestions);
    if(!validation.valid) continue;
    const saved=await pool.query(`INSERT INTO questions(concept_id,text,options,answer_index,difficulty,source,explanation) VALUES($1,$2,$3,$4,$5,'ai',$6) RETURNING id,concept_id,text,options,answer_index,difficulty,source,explanation`,[conceptId,generated.question,JSON.stringify(generated.options),generated.answer_index,generated.difficulty,generated.explanation]);
    return saved.rows[0];
  }
  throw new Error('Could not generate a valid unique question after retries');
}

app.get('/api/health', async (_req,res)=>{ try{await pool.query('SELECT 1');res.json({ok:true,service:'backend'});}catch(e){res.status(500).json({ok:false,error:e.message});} });

app.get('/api/targets', async (_req,res)=>{try{const r=await pool.query(`SELECT lt.id,lt.name,lt.subject,lt.created_at,COALESCE(json_agg(json_build_object('id',tt.id,'topic_name',tt.topic_name,'mastery',tt.mastery,'concept_id',tt.concept_id) ORDER BY tt.id) FILTER(WHERE tt.id IS NOT NULL),'[]') topics FROM learning_targets lt LEFT JOIN target_topics tt ON tt.target_id=lt.id WHERE lt.user_id=$1 GROUP BY lt.id ORDER BY lt.id DESC`,[USER_ID]);res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/targets', async (req,res)=>{
  const {name,subject,topics}=req.body;
  if(!name||!subject||!Array.isArray(topics)||!topics.length) return res.status(400).json({error:'name, subject and at least one topic are required'});
  const client=await pool.connect();
  try{await client.query('BEGIN');const target=(await client.query(`INSERT INTO learning_targets(user_id,name,subject) VALUES($1,$2,$3) RETURNING id,name,subject`,[USER_ID,name,subject])).rows[0];
    for(const raw of topics){const topic=String(raw).trim();if(!topic)continue;let c=(await client.query(`SELECT id FROM concepts WHERE name=$1 AND subject=$2 AND parent_id IS NULL`,[topic,subject])).rows[0];if(!c)c=(await client.query(`INSERT INTO concepts(name,subject,parent_id) VALUES($1,$2,NULL) RETURNING id`,[topic,subject])).rows[0];await client.query(`INSERT INTO target_topics(target_id,topic_name,mastery,concept_id) VALUES($1,$2,0,$3) ON CONFLICT(target_id,topic_name) DO UPDATE SET concept_id=EXCLUDED.concept_id`,[target.id,topic,c.id]);}
    await client.query('COMMIT');res.status(201).json({target});
  }catch(e){await client.query('ROLLBACK');res.status(500).json({error:e.message});}finally{client.release();}
});

app.get('/api/targets/:id/concepts',async(req,res)=>{try{const target=await getTarget(req.params.id);if(!target)return res.status(404).json({error:'Learning target not found'});const topics=await getTargetTopics(target.id);const out=[];for(const t of topics){const subs=t.concept_id?await getSubtopics(t.concept_id):[];out.push({id:t.id,name:t.topic_name,mastery:Number(t.mastery),concept_id:t.concept_id,subtopics:subs});}res.json({target,topics:out});}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/ai/generate-question',async(req,res)=>{try{const {subject,topic,subtopic,mastery=0,targetDifficulty=.5,recentMistakes=[],previousQuestions=[]}=req.body;if(!subject||!topic)return res.status(400).json({error:'subject and topic are required'});const conceptName=subtopic||topic;const r=await pool.query(`SELECT id,name,subject,parent_id FROM concepts WHERE name=$1 AND subject=$2 LIMIT 1`,[conceptName,subject]);if(!r.rows[0])return res.status(404).json({error:'Concept or subtopic not found'});const q=await generateAndStore({subject,topic,conceptId:r.rows[0].id,subtopic,mastery,targetDifficulty,recentMistakes,previousQuestions});res.status(201).json({question:q,concept:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:e.message});}});

app.post('/api/revision/start',async(req,res)=>{
  try{
    const {targetId,mode,topicConceptId}=req.body;const target=await getTarget(targetId);
    if(!target)return res.status(404).json({error:'Learning target not found'});
    if(!['complete','topic'].includes(mode))return res.status(400).json({error:'mode must be complete or topic'});
    if(mode==='topic'&&!topicConceptId)return res.status(400).json({error:'topicConceptId is required for topic mode'});
    const topics=await getTargetTopics(target.id);
    if(mode==='topic'&&!topics.some(t=>t.concept_id===Number(topicConceptId)))return res.status(400).json({error:'Topic does not belong to target'});
    const session=(await pool.query(`INSERT INTO revision_sessions(user_id,target_id,mode,topic_concept_id) VALUES($1,$2,$3,$4) RETURNING *`,[USER_ID,target.id,mode,mode==='topic'?topicConceptId:null])).rows[0];
    const selected=await chooseConcept(target.id,mode,mode==='topic'?Number(topicConceptId):null,[]);
    const state=await getState(selected.conceptId);const mistakes=(await getRecentAttempts(selected.conceptId,5)).filter(x=>!x.correct).map(x=>x.text);const previous=await getPreviousQuestions(selected.conceptId,12);
    const question=await generateAndStore({subject:target.subject,topic:selected.topic,subtopic:selected.subtopic,conceptId:selected.conceptId,mastery:selected.mastery,targetDifficulty:difficultyForMastery(selected.mastery,mode),recentMistakes:mistakes,previousQuestions:previous});
    await pool.query(`INSERT INTO revision_session_topics(session_id,concept_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[session.id,selected.conceptId]);
    await pool.query(`UPDATE revision_sessions SET question_count=1 WHERE id=$1`,[session.id]);
    res.status(201).json({session:{...session,question_count:1},question,selection:selected});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.post('/api/revision/:sessionId/answer',async(req,res)=>{
  const client=await pool.connect();
  try{
    const {questionId,selectedIndex,timeSeconds}=req.body;await client.query('BEGIN');
    const session=(await client.query(`SELECT * FROM revision_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE`,[req.params.sessionId,USER_ID])).rows[0];
    if(!session) {await client.query('ROLLBACK');return res.status(404).json({error:'Session not found'});}
    if(session.status!=='active'){await client.query('ROLLBACK');return res.status(400).json({error:'Session is already completed'});}
    const q=(await client.query(`SELECT * FROM questions WHERE id=$1`,[questionId])).rows[0];if(!q){await client.query('ROLLBACK');return res.status(404).json({error:'Question not found'});}
    const correct=Number(selectedIndex)===Number(q.answer_index);const seconds=Math.max(1,Number(timeSeconds)||60);
    await client.query(`INSERT INTO attempts(user_id,question_id,correct,time_seconds) VALUES($1,$2,$3,$4)`,[USER_ID,q.id,correct,seconds]);
    const old=(await client.query(`SELECT mastery,attempts FROM knowledge_states WHERE user_id=$1 AND concept_id=$2`,[USER_ID,q.concept_id])).rows[0] || {mastery:0,attempts:0};
    const oldM=Number(old.mastery);const n=Number(old.attempts);const difficulty=Number(q.difficulty);const expected=1/(1+Math.exp(-6*(oldM-difficulty)));const lr=Math.max(.08,Math.min(.28,.22/(1+n*0.08)));const observed=correct?1:0;const timeFactor=seconds<=45?1:seconds<=90?.95:.9;const delta=lr*(observed-expected)*timeFactor;const newM=Math.max(0,Math.min(1,oldM+delta));
    await client.query(`INSERT INTO knowledge_states(user_id,concept_id,mastery,attempts,updated_at) VALUES($1,$2,$3,1,now()) ON CONFLICT(user_id,concept_id) DO UPDATE SET mastery=EXCLUDED.mastery,attempts=knowledge_states.attempts+1,updated_at=now()`,[USER_ID,q.concept_id,newM]);
    const topic=(await client.query(`SELECT id,name,parent_id FROM concepts WHERE id=$1`,[q.concept_id])).rows[0];
    let topicConceptId=topic.parent_id || topic.id;
    if(topic.parent_id){const topicState=(await client.query(`SELECT mastery FROM knowledge_states WHERE user_id=$1 AND concept_id=$2`,[USER_ID,topic.parent_id])).rows[0];const children=(await client.query(`SELECT c.id,COALESCE(k.mastery,0) mastery FROM concepts c LEFT JOIN knowledge_states k ON k.user_id=$1 AND k.concept_id=c.id WHERE c.parent_id=$2`,[USER_ID,topic.parent_id])).rows;const aggregate=children.length?children.reduce((s,x)=>s+Number(x.mastery),0)/children.length:newM;await client.query(`UPDATE target_topics SET mastery=$1 WHERE target_id=$2 AND concept_id=$3`,[aggregate,session.target_id,topic.parent_id]);}
    const nextCount=Number(session.question_count)+1;const nextCorrect=Number(session.correct_count)+(correct?1:0);
    await client.query(`UPDATE revision_session_topics SET asked_count=asked_count+1,correct_count=correct_count+$3,confidence=LEAST(1,asked_count/5.0) WHERE session_id=$1 AND concept_id=$2`,[session.id,q.concept_id,correct?1:0]);
    const stats=(await client.query(`SELECT COUNT(*)::int total,COALESCE(SUM(CASE WHEN correct THEN 1 ELSE 0 END),0)::int correct FROM attempts WHERE user_id=$1 AND question_id=$2`,[USER_ID,q.id])).rows[0];
    const stop=nextCount>=3 && nextCorrect/nextCount>=0.9 || nextCount>=12;
    if(stop){await client.query(`UPDATE revision_sessions SET status='completed',question_count=$2,correct_count=$3,completed_at=now() WHERE id=$1`,[session.id,nextCount,nextCorrect]);await client.query('COMMIT');return res.json({completed:true,correct,explanation:q.explanation,newMastery:newM,session:{id:session.id,question_count:nextCount,correct_count:nextCorrect}});}
    await client.query(`UPDATE revision_sessions SET question_count=$2,correct_count=$3 WHERE id=$1`,[session.id,nextCount,nextCorrect]);
    await client.query('COMMIT');
    const excluded=(await pool.query(`SELECT concept_id FROM revision_session_topics WHERE session_id=$1`,[session.id])).rows.map(x=>x.concept_id);
    const selected=await chooseConcept(session.target_id,session.mode,session.topic_concept_id,session.mode==='complete'&&excluded.length<2?[]:excluded.slice(-3));
    const target=await getTarget(session.target_id);const state=await getState(selected.conceptId);const mistakes=(await getRecentAttempts(selected.conceptId,5)).filter(x=>!x.correct).map(x=>x.text);const previous=await getPreviousQuestions(selected.conceptId,12);
    const question=await generateAndStore({subject:target.subject,topic:selected.topic,subtopic:selected.subtopic,conceptId:selected.conceptId,mastery:Number(state.mastery),targetDifficulty:difficultyForMastery(Number(state.mastery),session.mode),recentMistakes:mistakes,previousQuestions:previous});
    await pool.query(`INSERT INTO revision_session_topics(session_id,concept_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[session.id,selected.conceptId]);
    res.json({completed:false,correct,explanation:q.explanation,newMastery:newM,question,selection:selected,session:{id:session.id,question_count:nextCount,correct_count:nextCorrect}});
  }catch(e){try{await client.query('ROLLBACK')}catch{}console.error(e);res.status(500).json({error:e.message});}finally{client.release();}
});

app.get('/api/targets/:id/progress',async(req,res)=>{try{const target=await getTarget(req.params.id);if(!target)return res.status(404).json({error:'Learning target not found'});const topics=await getTargetTopics(target.id);const data=[];for(const t of topics){const subs=t.concept_id?await getSubtopics(t.concept_id):[];const subData=[];for(const s of subs){const st=await getState(s.id);subData.push({id:s.id,name:s.name,mastery:Number(st.mastery),attempts:st.attempts});}data.push({id:t.id,name:t.topic_name,mastery:Number(t.mastery),subtopics:subData});}res.json({target,topics:data});}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/questions',async(_req,res)=>{try{const r=await pool.query(`SELECT q.*,c.name concept,c.subject FROM questions q JOIN concepts c ON c.id=q.concept_id ORDER BY q.id DESC`);res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/model-info',async(_req,res)=>{try{const r=await fetch(`${ML_URL}/health`);res.status(r.status).json(await r.json());}catch(e){res.status(503).json({error:'ML service unavailable'});}});

app.listen(PORT,()=>console.log(`Backend running on http://localhost:${PORT}`));
