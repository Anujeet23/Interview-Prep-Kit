import mongoose from 'mongoose';

/**
 * One document per kit. `kit` holds the Appendix A structure (plus our extensions);
 * everything else is bookkeeping around it.
 *
 * Concurrency: every write goes through kitStore.mutate(), which matches on `rev` and
 * increments it. Two writers can't silently overwrite each other; the loser re-reads
 * and re-applies its change to the latest document.
 */
const StepSchema = new mongoose.Schema(
  { key: String, status: String, detail: String, at: String },
  { _id: false }
);

const StorySchema = new mongoose.Schema(
  {
    id: String,
    title: { type: String, maxlength: 200 },
    situation: { type: String, maxlength: 2000 },
    action: { type: String, maxlength: 2000 },
    result: { type: String, maxlength: 2000 },
    requirement_ids: [String],
  },
  { _id: false }
);

const KitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['queued', 'running', 'ready', 'failed'], default: 'queued', index: true },
    input: {
      jd: { type: String, required: true },
      company_url: { type: String, default: '' },
      days: { type: Number, required: true },
    },
    title: String,
    company: String,
    dedupeKey: { type: String, index: true },
    // Set only while queued/running: a unique partial index makes double-submits impossible.
    activeKey: { type: String },
    progress: { type: [StepSchema], default: [] },
    kit: { type: mongoose.Schema.Types.Mixed, default: null },
    researchCache: { type: mongoose.Schema.Types.Mixed, default: null },
    practice: { type: mongoose.Schema.Types.Mixed, default: () => ({ cards: {}, sessions: 0 }) },
    stories: { type: [StorySchema], default: [] },
    nextStory: { type: Number, default: 1 },
    regenerating: { type: mongoose.Schema.Types.Mixed, default: null }, // { section, category, started_at }
    lastRegeneration: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    rev: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false }
);

KitSchema.index({ userId: 1, activeKey: 1 }, { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } });
KitSchema.index({ userId: 1, updatedAt: -1 });

export const Kit = mongoose.models.Kit || mongoose.model('Kit', KitSchema);
