import { z } from 'zod';
import { system } from '../llm/prompts.js';
import { collapse, jaccard, truncate } from '../lib/text.js';

const CardsSchema = z.object({
  flashcards: z
    .array(z.object({ front: z.string().min(2), back: z.string().min(2), requirement_ids: z.array(z.string()).default([]) }))
    .default([]),
});

const SYSTEM = system(`You write study flashcards for an interview candidate.
Front: one concept, term, or short prompt (max 20 words). Back: a crisp answer a candidate could say aloud in under 30 seconds (max 60 words).
Technical requirements: key concepts, trade-offs and gotchas. Behavioural requirements: a reminder of what a good story must show. Domain requirements: key facts or vocabulary.
Each card lists the requirement ids it supports, using only ids given.
JSON shape: {"flashcards":[{"front":"","back":"","requirement_ids":["r1"]}]}`);

export async function generateFlashcards({ llm, requirements, role }) {
  if (!requirements.length) return { cards: [], degraded: false };
  const count = Math.min(20, Math.max(4, requirements.length * 2));
  const ids = new Set(requirements.map((r) => r.id));
  try {
    const out = await llm.generateJSON({
      task: 'flashcards',
      system: SYSTEM,
      user: `Role: ${role.title} (${role.seniority}).\nRequirements:\n${requirements.map((r) => `- ${r.id} [${r.kind}, ${r.priority}] ${r.text}`).join('\n')}\n\nWrite ${count} flashcards, at least one per must requirement.`,
      schema: CardsSchema,
      data: { requirements, count },
      maxTokens: Math.min(4000, count * 140 + 300),
      temperature: 0.4,
    });
    const cards = [];
    for (const c of out.flashcards) {
      const rids = [...new Set(c.requirement_ids)].filter((id) => ids.has(id));
      if (!rids.length) continue;
      if (cards.some((x) => jaccard(x.front, c.front) >= 0.85)) continue;
      cards.push({ front: truncate(collapse(c.front), 200), back: truncate(collapse(c.back), 600), requirement_ids: rids });
    }
    return { cards, degraded: false };
  } catch {
    return { cards: [], degraded: true };
  }
}

/** Fallback: one card per question so practice mode always has material. */
export function cardsFromQuestions(questions) {
  return questions.slice(0, 20).map((q) => ({
    front: q.prompt,
    back: q.answer_outline || 'Outline your answer before revealing: context, your action, the result.',
    requirement_ids: q.requirement_ids,
    derived_from: q.id,
  }));
}
