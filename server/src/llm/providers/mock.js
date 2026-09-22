import { heuristicExtract } from '../../pipeline/heuristicExtract.js';

/**
 * Deterministic stand-in for a model, used by the test-suite and by
 * `LLM_PROVIDERS=mock npm run evaluate` so the whole pipeline can be exercised offline.
 * It answers from the structured `data` each task passes alongside its prompt.
 *
 * By default it behaves like an imperfect model: on the first question pass it "forgets"
 * the last requirement of each category, so the coverage loop has a real gap to close.
 */
export function mockProvider({ perfect = false, failTasks = [], latencyMs = 0 } = {}) {
  return {
    name: 'mock:deterministic',
    async complete({ task, data }) {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      if (failTasks.includes(task) || failTasks.includes(`${task}:${data?.category}`)) {
        const { ProviderError } = await import('./errors.js');
        throw new ProviderError('BAD_REQUEST', `mock configured to fail ${task}`);
      }
      const handler = HANDLERS[task];
      if (!handler) return { text: '{}' };
      return { text: JSON.stringify(handler(data, { perfect })) };
    },
  };
}

const firstSentences = (text, n = 2) =>
  String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 20)
    .slice(0, n)
    .join(' ');

const HANDLERS = {
  extract_requirements({ jd }) {
    return heuristicExtract(jd);
  },

  hiring_process({ pages }) {
    const stages = [];
    for (const p of pages) {
      for (const line of p.text.split('\n')) {
        const m = line.match(/^\s*(?:-|\d+[.)])\s*(.{3,80}?)(?:[:—–-]\s+(.*))?$/);
        if (m && /interview|screen|take[- ]home|design|call|chat|offer|onsite|pair|exercise|review/i.test(line)) {
          stages.push({ name: m[1].trim(), description: (m[2] || m[1]).trim(), source_url: p.url });
        }
      }
    }
    return { stages: stages.slice(0, 8), summary: stages.length ? `${stages.length} published stages.` : '' };
  },

  company_brief({ pages, hasPages }) {
    if (!hasPages) return { summary: 'Only the job description was available.', what_they_do: '', talking_points: [], unknowns: ['What the company builds'] };
    const home = pages[0];
    const about = pages.find((p) => /about/i.test(p.url)) || home;
    return {
      summary: firstSentences(about.text, 2) || home.title,
      what_they_do: home.description || firstSentences(home.text, 1),
      talking_points: pages.slice(0, 3).map((p) => p.title).filter(Boolean),
      unknowns: [],
    };
  },

  questions({ category, requirements, count }, { perfect }) {
    const pool = perfect || requirements.length < 2 ? requirements : requirements.slice(0, -1);
    const out = [];
    for (let i = 0; i < count; i++) {
      const r = pool[i % Math.max(1, pool.length)];
      if (!r) break;
      out.push(makeQuestion(category, r, i));
    }
    if (category === 'company-fit' && !requirements.length) {
      out.push({ requirement_ids: [], prompt: 'Why do you want to work here, and what do you know about what we do?', answer_outline: 'Specific reasons; what you learned about the company; how the role fits your goals.', difficulty: 1 });
    }
    return { questions: out };
  },

  gap_questions({ category, requirements }) {
    return { questions: requirements.map((r, i) => makeQuestion(category, r, i + 100)) };
  },

  flashcards({ requirements }) {
    return {
      flashcards: requirements.map((r) => ({
        front: r.kind === 'behavioural' ? `Story prompt: ${r.text}` : `Key ideas: ${r.text}`,
        back: r.kind === 'behavioural' ? 'Situation, your action, measurable result, what you learned.' : `Definition, a trade-off, and one real example involving ${r.text}.`,
        requirement_ids: [r.id],
      })),
    };
  },
};

function makeQuestion(category, r, i) {
  const templates = {
    technical: [`How have you applied ${r.text} in production, and what trade-offs did you make?`, `What is a common pitfall with ${r.text}, and how do you avoid it?`],
    behavioural: [`Tell me about a time you showed ${r.text}.`, `Describe a situation where ${r.text} was hard. What did you do?`],
    'system-design': [`Design a service where ${r.text} is central. Walk through data model, scaling and failure modes.`],
    'company-fit': [`How would your experience with ${r.text} help this team in your first 90 days?`],
  };
  const list = templates[category] || templates.technical;
  return {
    requirement_ids: [r.id],
    prompt: `${list[i % list.length]}${i >= list.length ? ` (angle ${i + 1})` : ''}`,
    answer_outline: 'Context; your specific action; trade-offs; result; lesson.',
    difficulty: r.priority === 'must' ? (i % 2 ? 3 : 2) : 1,
  };
}
