import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

const ai = new GoogleGenerativeAI(apiKey);
const model = ai.getGenerativeModel({ model: 'gemini-3.6-flash' });

function cleanJson(text) {
  return text.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
}

export async function generateQuestion(context) {
  const {
    subject, topic, subtopic = null, mastery = 0,
    targetDifficulty = 0.5, recentMistakes = [], previousQuestions = []
  } = context;

  const prompt = `You are the question-generation component of an adaptive learning system.
Generate ONE genuinely new educational multiple-choice question.

Subject: ${subject}
Topic: ${topic}
Subtopic: ${subtopic || 'Not specified'}
Estimated mastery: ${mastery}
Target difficulty: ${targetDifficulty}
Recent mistakes: ${JSON.stringify(recentMistakes.slice(0,5))}
Previously asked questions: ${JSON.stringify(previousQuestions.slice(-12))}

Rules:
- Match the requested topic and subtopic exactly.
- Do not repeat or lightly reword any previous question.
- Difficulty must be close to the target difficulty.
- Prefer reasoning/application over pure recall.
- Exactly 4 distinct options and exactly one correct option.
- Return ONLY valid JSON.

Format:
{"question":"string","options":["string","string","string","string"],"answer_index":0,"difficulty":0.5,"explanation":"short explanation"}`;

  const result = await model.generateContent(prompt);
  let question;
  try { question = JSON.parse(cleanJson(result.response.text())); }
  catch { throw new Error('Gemini returned invalid question JSON'); }

  if (typeof question.question !== 'string' || !Array.isArray(question.options) || question.options.length !== 4 ||
      !Number.isInteger(question.answer_index) || question.answer_index < 0 || question.answer_index > 3 ||
      typeof question.explanation !== 'string') {
    throw new Error('Generated question failed validation');
  }
  return question;
}
