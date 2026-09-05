function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function similarity(a,b) {
  const A=new Set(normalize(a).split(' ').filter(Boolean));
  const B=new Set(normalize(b).split(' ').filter(Boolean));
  if(!A.size||!B.size)return 0;
  let i=0; for(const t of A) if(B.has(t)) i++;
  return i/(A.size+B.size-i);
}
export function validateQuestion(q, previousQuestions=[]) {
  const errors=[];
  if(!q || typeof q!=='object') return {valid:false,errors:['Question must be an object']};
  if(typeof q.question!=='string'||q.question.trim().length<20) errors.push('Question text is too short');
  if(!Array.isArray(q.options)||q.options.length!==4) errors.push('Question must contain exactly 4 options');
  if(q.options?.some(x=>typeof x!=='string'||!x.trim())) errors.push('Options must be non-empty strings');
  if(!Number.isInteger(q.answer_index)||q.answer_index<0||q.answer_index>3) errors.push('Invalid answer_index');
  if(typeof q.explanation!=='string'||!q.explanation.trim()) errors.push('Explanation is missing');
  if(typeof q.difficulty!=='number'||q.difficulty<0||q.difficulty>1) errors.push('Difficulty must be between 0 and 1');
  if(Array.isArray(q.options)&&new Set(q.options.map(normalize)).size!==q.options.length) errors.push('Options contain duplicates');
  for(const p of previousQuestions){ if(p?.question&&similarity(q.question,p.question)>=0.75){errors.push('Question is too similar to a previous question');break;} }
  return {valid:errors.length===0,errors};
}
