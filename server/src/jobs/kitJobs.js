import { Kit } from '../db/models/Kit.js';
import { mutate, pushProgress } from '../db/kitStore.js';
import { generationQueue, regenerationQueue } from './queue.js';
import { runPipeline } from '../pipeline/runPipeline.js';
import { createPipelineDeps } from '../pipeline/deps.js';
import {
  computeCategoryRegeneration,
  applyCategoryRegeneration,
  computeBriefRegeneration,
  applyBriefRegeneration,
  regenerateSchedule,
} from '../kit/regenerate.js';
import { log } from '../lib/logger.js';
import { findGaps, closeCoverageGaps } from '../pipeline/coverage.js';
import { addQuestion } from '../kit/mutations.js';

let deps;
const getDeps = () => (deps ??= createPipelineDeps());

export function enqueueGeneration(kitId) {
  return generationQueue.push(String(kitId), () => generate(kitId));
}

async function generate(kitId) {
  const doc = await Kit.findById(kitId).lean();
  if (!doc || doc.status !== 'queued') return;
  await Kit.updateOne({ _id: kitId }, { $set: { status: 'running', progress: [], error: null }, $inc: { rev: 1 } });
  const { llm, fetcher, config } = getDeps();
  try {
    const { kit, cache } = await runPipeline(doc.input, {
      llm,
      fetcher,
      config,
      onProgress: (step) => pushProgress(kitId, step).catch(() => {}),
    });
    await Kit.updateOne(
      { _id: kitId },
      {
        $set: { status: 'ready', kit, researchCache: { ...cache, jd: doc.input.jd }, title: kit.source.role, company: kit.source.company, practice: { cards: {}, sessions: 0 } },
        $unset: { activeKey: '' },
        $inc: { rev: 1 },
      }
    );
  } catch (e) {
    log.warn(`generation failed for ${kitId}: ${e.code || ''} ${e.message}`);
    await Kit.updateOne(
      { _id: kitId },
      { $set: { status: 'failed', error: { code: e.code || 'PIPELINE_ERROR', message: e.message } }, $unset: { activeKey: '' }, $inc: { rev: 1 } }
    );
  }
}

/**
 * Regenerate one section. The slow part runs against a snapshot; the merge re-reads the
 * latest document inside mutate(), so edits made during the model call are respected.
 */
export function enqueueRegeneration(kitId, { section, category }) {
  return regenerationQueue.push(`${kitId}:${section}:${category || ''}`, () => regenerate(kitId, { section, category }));
}

async function regenerate(kitId, { section, category }) {
  const { llm } = getDeps();
  const snapshot = await Kit.findById(kitId).lean();
  if (!snapshot?.kit) return;
  try {
    let summary;
    if (section === 'questions') {
      const computed = await computeCategoryRegeneration(snapshot.kit, category, { llm });
      const { extra } = await mutate(kitId, null, (doc) => {
        const r = applyCategoryRegeneration(doc.kit, computed);
        return { set: { kit: r.kit }, extra: r.summary };
      });
      summary = extra;
    } else if (section === 'company_brief') {
      const brief = await computeBriefRegeneration(snapshot.kit, { llm, cache: snapshot.researchCache });
      const { extra } = await mutate(kitId, null, (doc) => {
        const r = applyBriefRegeneration(doc.kit, brief);
        return { set: { kit: r.kit }, extra: r.summary };
      });
      summary = extra;
    } else if (section === 'gaps') {
      // User deleted the last question for a requirement and asked us to cover it again.
      const gaps = findGaps(snapshot.kit.role.requirements, snapshot.kit.questions);
      const cov = await closeCoverageGaps({
        llm,
        requirements: snapshot.kit.role.requirements,
        questions: snapshot.kit.questions,
        role: snapshot.kit.role,
        brief: snapshot.kit.company_brief,
        signals: snapshot.kit.research?.hiring_signals || {},
      });
      const known = new Set(snapshot.kit.questions.map((q) => q.id));
      const added = cov.questions.filter((q) => !known.has(q.id));
      const { extra } = await mutate(kitId, null, (doc) => {
        let k = doc.kit;
        const ids = [];
        for (const q of added) {
          const r = addQuestion(k, { ...q });
          k = r.kit;
          const item = k.questions.find((x) => x.id === r.item.id);
          item.meta = { origin: q.template ? 'template' : 'generated', edited: false, pinned: false };
          ids.push(item.id);
        }
        return { set: { kit: k }, extra: { added: ids.length, gaps: gaps.map((g) => g.id) } };
      });
      summary = extra;
    } else if (section === 'schedule') {
      const { extra } = await mutate(kitId, null, (doc) => {
        const r = regenerateSchedule(doc.kit);
        return { set: { kit: r.kit }, extra: r.summary };
      });
      summary = extra;
    }
    await Kit.updateOne(
      { _id: kitId },
      { $set: { regenerating: null, lastRegeneration: { section, category, ok: true, summary, at: new Date().toISOString() } }, $inc: { rev: 1 } }
    );
  } catch (e) {
    await Kit.updateOne(
      { _id: kitId },
      {
        $set: { regenerating: null, lastRegeneration: { section, category, ok: false, error: { code: e.code || 'REGENERATION_FAILED', message: e.message }, at: new Date().toISOString() } },
        $inc: { rev: 1 },
      }
    );
  }
}

/** On boot: jobs that were queued/running in a previous process can't be resumed mid-flight. */
export async function recoverInterruptedJobs() {
  const res = await Kit.updateMany(
    { status: { $in: ['queued', 'running'] } },
    { $set: { status: 'failed', error: { code: 'INTERRUPTED', message: 'The server restarted while this kit was being generated. Retry to generate it again.' } }, $unset: { activeKey: '' }, $inc: { rev: 1 } }
  );
  await Kit.updateMany({ regenerating: { $ne: null } }, { $set: { regenerating: null } });
  if (res.modifiedCount) log.warn(`marked ${res.modifiedCount} interrupted generation(s) as failed`);
}
