import { z } from 'zod';
import { system, untrusted } from '../llm/prompts.js';

/**
 * Interview-format signals are read from the hiring page text with regexes, not by the
 * model: whether a company runs a take-home is a fact on the page or it isn't.
 * The model is only asked to summarise the stages in order.
 */
const SIGNALS = {
  take_home: /\btake[- ]home|home assignment|coding (assignment|exercise|project)|async(hronous)? (exercise|assignment)\b/i,
  system_design: /\bsystem[- ]design|architecture (interview|discussion|round)|design (interview|round|session)\b/i,
  live_coding: /\blive[- ]coding|coding interview|whiteboard|algorithm(s|ic)? (interview|round)|leetcode\b/i,
  pair_programming: /\bpair(ing| programming)\b/i,
  behavioural: /\bbehaviou?ral|culture (fit|add|interview)|values (interview|conversation)|STAR\b/i,
  portfolio_review: /\bportfolio|past (work|project)s? (review|deep[- ]dive)|project deep[- ]dive\b/i,
  paid_trial: /\bpaid (trial|work trial)|work trial|trial day|superday\b/i,
};

const NEGATION = /\b(no|not|never|don'?t|doesn'?t|won'?t|without|instead of|rather than)\b/i;

/** A signal counts only if some sentence mentions it without negating it ("we do not ask whiteboard puzzles"). */
export function detectSignals(text) {
  const sentences = String(text).split(/(?<=[.!?])\s+|\n+/);
  const out = {};
  for (const [k, re] of Object.entries(SIGNALS)) out[k] = sentences.some((s) => re.test(s) && !NEGATION.test(s));
  return out;
}

const StagesSchema = z.object({
  stages: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().default(''),
        source_url: z.string().default(''),
      })
    )
    .max(12)
    .default([]),
  summary: z.string().default(''),
});

const SYSTEM = system(`You summarise a company's published hiring process for a candidate.
List the interview stages in the order the pages give them. For each: a short name, one sentence on what happens (format, length, who), and the source_url of the page that says it.
If the pages do not describe stages, return an empty list. Do not invent stages that are typical elsewhere.
JSON shape: {"stages":[{"name":"","description":"","source_url":""}],"summary":""}`);

export async function analyseHiringProcess({ hiringPages, llm }) {
  if (!hiringPages.length) {
    return {
      found: false,
      source: 'none',
      stages: [],
      signals: detectSignals(''),
      summary: 'The company does not publish its hiring process anywhere we could find, so the question bank follows the job description alone.',
      sources: [],
    };
  }
  const text = hiringPages.map((p) => p.text).join('\n');
  const signals = detectSignals(text);
  const urls = hiringPages.map((p) => p.url);
  let stages = [];
  let summary = '';
  let degraded = false;
  try {
    const out = await llm.generateJSON({
      task: 'hiring_process',
      system: SYSTEM,
      user: hiringPages.map((p) => untrusted(p.url, `${p.title}\n${p.text}`, 7000)).join('\n\n'),
      schema: StagesSchema,
      data: { pages: hiringPages.map((p) => ({ url: p.url, text: p.text })) },
      maxTokens: 1200,
      temperature: 0.1,
    });
    // The model may only cite pages we actually gave it.
    stages = out.stages.map((s) => ({ ...s, source_url: urls.includes(s.source_url) ? s.source_url : urls[0] }));
    summary = out.summary;
  } catch {
    degraded = true;
  }
  const active = Object.entries(signals).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' '));
  return {
    found: true,
    source: 'company_site',
    stages,
    signals,
    summary: summary || `The company's hiring page mentions: ${active.join(', ') || 'no specific interview formats'}.`,
    sources: urls,
    degraded,
  };
}
