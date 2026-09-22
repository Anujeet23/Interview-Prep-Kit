import { z } from 'zod';
import { checkSchedule } from '../pipeline/scheduler.js';

/**
 * Appendix A, as a zod schema. Objects are .passthrough() because the brief allows
 * extensions (we add `meta`, `research`, `quality`, ...), but every listed field must
 * be present with the listed name and type.
 */
const int = z.number().int();
const meta = z
  .object({ origin: z.enum(['generated', 'user', 'template']), edited: z.boolean(), pinned: z.boolean() })
  .passthrough()
  .optional();

export const RequirementSchema = z
  .object({ id: z.string().regex(/^r\d+$/), text: z.string().min(1), kind: z.enum(['technical', 'behavioural', 'domain']), priority: z.enum(['must', 'nice']) })
  .passthrough();

export const QuestionSchema = z
  .object({
    id: z.string().regex(/^q\d+$/),
    requirement_ids: z.array(z.string()),
    category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
    prompt: z.string().min(1),
    answer_outline: z.string(),
    difficulty: int.min(1).max(3),
    meta,
  })
  .passthrough();

export const FlashcardSchema = z
  .object({ id: z.string().regex(/^f\d+$/), front: z.string().min(1), back: z.string(), requirement_ids: z.array(z.string()), meta })
  .passthrough();

export const KitSchema = z
  .object({
    source: z
      .object({
        company: z.string(),
        company_url: z.string(),
        role: z.string(),
        location: z.string(),
        jd_chars: int.min(0),
        researched_at: z.string(),
        pages_used: z.array(z.string()),
      })
      .passthrough(),
    company_brief: z.object({ summary: z.string(), what_they_do: z.string(), sources: z.array(z.string()) }).passthrough(),
    role: z
      .object({ title: z.string(), seniority: z.string(), responsibilities: z.array(z.string()), requirements: z.array(RequirementSchema) })
      .passthrough(),
    questions: z.array(QuestionSchema),
    flashcards: z.array(FlashcardSchema),
    schedule: z
      .object({
        days_available: int.min(1),
        days: z.array(z.object({ day: int.min(1), focus: z.string(), question_ids: z.array(z.string()), minutes: int.min(0) }).passthrough()),
      })
      .passthrough(),
    coverage: z.object({ uncovered_requirement_ids: z.array(z.string()), passes: int.min(0) }).passthrough(),
  })
  .passthrough();

/**
 * Structure + referential integrity. Returns { ok, errors }.
 * `strict` (used before saving a generated kit) also enforces the schedule rules
 * and that no must-have is uncovered; user edits are checked non-strictly so a user
 * can, say, delete the only question for a requirement and see a warning instead of an error.
 */
export function validateKit(kit, { strict = true } = {}) {
  const errors = [];
  const parsed = KitSchema.safeParse(kit);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 20)) errors.push(`${i.path.join('.')}: ${i.message}`);
    return { ok: false, errors };
  }
  const reqIds = new Set();
  for (const r of kit.role.requirements) {
    if (reqIds.has(r.id)) errors.push(`duplicate requirement id ${r.id}`);
    reqIds.add(r.id);
  }
  const qIds = new Set();
  for (const q of kit.questions) {
    if (qIds.has(q.id)) errors.push(`duplicate question id ${q.id}`);
    qIds.add(q.id);
    for (const id of q.requirement_ids) if (!reqIds.has(id)) errors.push(`question ${q.id} references unknown requirement ${id}`);
  }
  const fIds = new Set();
  for (const f of kit.flashcards) {
    if (fIds.has(f.id)) errors.push(`duplicate flashcard id ${f.id}`);
    fIds.add(f.id);
    for (const id of f.requirement_ids) if (!reqIds.has(id)) errors.push(`flashcard ${f.id} references unknown requirement ${id}`);
  }
  for (const id of kit.coverage.uncovered_requirement_ids) if (!reqIds.has(id)) errors.push(`coverage lists unknown requirement ${id}`);
  for (const d of kit.schedule.days) for (const id of d.question_ids) if (!qIds.has(id)) errors.push(`schedule day ${d.day} references missing question ${id}`);

  if (strict) {
    errors.push(
      ...checkSchedule(kit.schedule, { questions: kit.questions, requirements: kit.role.requirements, days: kit.schedule.days_available })
    );
    const covered = new Set(kit.questions.flatMap((q) => q.requirement_ids));
    for (const r of kit.role.requirements) if (r.priority === 'must' && !covered.has(r.id)) errors.push(`must-have ${r.id} has no question`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}
