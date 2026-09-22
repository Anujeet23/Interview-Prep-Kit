import { z } from 'zod';
import { system, untrusted } from '../llm/prompts.js';
import { jaccard, collapse, truncate } from '../lib/text.js';

const QuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        requirement_ids: z.array(z.string()).default([]),
        prompt: z.string().min(8),
        answer_outline: z.string().default(''),
        difficulty: z.coerce.number().default(2),
      })
    )
    .default([]),
});

/** Each category gets its own instructions: a React requirement and a mentoring requirement need different questions. */
const INSTRUCTIONS = {
  technical: `Write TECHNICAL interview questions that probe real depth in the listed skills: how things work, trade-offs, debugging, and practical scenarios at the stated seniority. Avoid trivia and definitions-only questions.
answer_outline: 3-5 key points a strong answer covers, separated by "; ".`,
  behavioural: `Write BEHAVIOURAL questions ("Tell me about a time...", "How do you...") that let the candidate show the listed traits with a real story.
answer_outline: what a strong STAR answer (Situation, Task, Action, Result) should demonstrate for this requirement, and one pitfall to avoid.`,
  'system-design': `Write SYSTEM DESIGN prompts: open-ended "Design X" or "How would you scale Y" problems that exercise the listed requirements, sized for a 45-60 minute round and relevant to the company's product if known.
answer_outline: the path through a good answer: requirements & constraints; high-level design; data model; the hard trade-off; how it scales or fails.`,
  'company-fit': `Write COMPANY-FIT questions about motivation, values and how the candidate would work at THIS company, based only on the company brief. If the brief is thin, ask about the role instead of inventing company facts.
answer_outline: what the interviewer is listening for and which specifics from the brief the candidate could mention.`,
};

function formatGuidance(signals = {}, category) {
  const g = [];
  if (category === 'technical') {
    if (signals.take_home) g.push('The company uses a take-home exercise: include at least one question about explaining and defending choices made in a take-home submission.');
    if (signals.live_coding) g.push('The company runs live coding: include a question that is practical to solve out loud in 20-30 minutes.');
    if (signals.pair_programming) g.push('The company pair-programs in interviews: include a question about collaborating on code in real time.');
  }
  if (category === 'system-design' && signals.system_design) g.push('The company explicitly runs a system design round, so make these realistic, full-length prompts.');
  if (category === 'behavioural' && signals.behavioural) g.push('The company runs a dedicated values/behavioural interview.');
  return g.join('\n');
}

const DIFFICULTY = 'difficulty: 1 = warm-up, 2 = standard, 3 = hard / senior-level probing.';

export function buildQuestionPrompt({ category, requirements, count, role, brief, signals, avoid = [], gapMode = false }) {
  const reqLines = requirements.map((r) => `- ${r.id} [${r.priority}] ${r.text}`).join('\n');
  const briefText = brief ? `${brief.what_they_do}\n${brief.summary}\nHiring process: ${brief.hiring_process}` : '';
  const sys = system(`You write interview practice questions for a candidate.
${INSTRUCTIONS[category]}
${DIFFICULTY}
Every question must list in "requirement_ids" the ids (from the list given) of the requirements it genuinely tests. Use only ids from that list.
JSON shape: {"questions":[{"requirement_ids":["r1"],"prompt":"","answer_outline":"","difficulty":2}]}`);
  const user = [
    `Role: ${role.title} (${role.seniority}).`,
    `Requirements for this category:\n${reqLines || '(none listed: base questions on the role and company)'}`,
    gapMode
      ? `These requirements currently have NO question. Write ${count} question(s) so that EVERY id above is covered by at least one question, and name the skill explicitly in the prompt.`
      : `Write ${count} questions. Cover every must requirement at least once before adding a second question for any requirement.`,
    formatGuidance(signals, category),
    avoid.length ? `Do not repeat or closely paraphrase these existing questions:\n${avoid.map((p) => `- ${truncate(p, 160)}`).join('\n')}` : '',
    category === 'company-fit' || category === 'system-design' ? untrusted('company brief', briefText, 3000) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system: sys, user };
}

/** Normalise model questions: keep only known ids, clamp difficulty, drop near-duplicates. */
export function sanitiseQuestions(raw, { allowedIds, category, existing = [], allowEmptyIds = false }) {
  const out = [];
  const allowed = new Set(allowedIds);
  for (const q of raw) {
    const ids = [...new Set(q.requirement_ids.map((s) => String(s).trim()))].filter((id) => allowed.has(id));
    if (!ids.length && !allowEmptyIds) continue;
    const prompt = collapse(q.prompt);
    if ([...existing, ...out].some((e) => jaccard(e.prompt, prompt) >= 0.8)) continue;
    out.push({
      requirement_ids: ids,
      category,
      prompt,
      answer_outline: collapse(q.answer_outline),
      difficulty: Math.min(3, Math.max(1, Math.round(Number(q.difficulty) || 2))),
    });
  }
  return out;
}

export async function generateCategoryQuestions({ llm, category, requirements, allRequirements, count, role, brief, signals, existing = [], gapMode = false }) {
  const { system: sys, user } = buildQuestionPrompt({ category, requirements, count, role, brief, signals, avoid: existing.map((q) => q.prompt), gapMode });
  const out = await llm.generateJSON({
    task: gapMode ? 'gap_questions' : 'questions',
    system: sys,
    user,
    schema: QuestionsSchema,
    data: { category, requirements, count, gapMode },
    maxTokens: Math.min(4000, 350 * count + 400),
    temperature: 0.5,
  });
  const allowedIds = category === 'company-fit' ? allRequirements.map((r) => r.id) : requirements.map((r) => r.id);
  return sanitiseQuestions(out.questions, { allowedIds, category, existing, allowEmptyIds: category === 'company-fit' && allRequirements.length === 0 });
}

/**
 * Last-resort question for a requirement the model failed to cover. It is generic but
 * truthful, and it is labelled so the user can see it wasn't model-written.
 */
export function templateQuestion(req) {
  const behavioural = req.kind === 'behavioural';
  return {
    requirement_ids: [req.id],
    category: behavioural ? 'behavioural' : 'technical',
    prompt: behavioural
      ? `Tell me about a specific time you demonstrated this: "${req.text}". What did you do, and what changed as a result?`
      : `The role asks for "${req.text}". Walk me through a real project where you used this: what problem it solved, a hard decision you made, and what you would do differently.`,
    answer_outline: behavioural
      ? 'Situation and your role; the action you personally took; a measurable result; what you learned.'
      : 'Concrete context; your specific contribution; a trade-off you weighed; results; lessons learned.',
    difficulty: req.priority === 'must' ? 2 : 1,
    template: true,
  };
}
