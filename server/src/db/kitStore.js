import { Kit } from './models/Kit.js';
import { AppError, notFound } from '../lib/errors.js';

/**
 * Optimistic-concurrency update. `fn(doc)` receives a plain snapshot and returns the
 * fields to $set (or throws). The update only lands if nobody else wrote in between;
 * otherwise we re-read and run `fn` again against the newer document.
 */
export async function mutate(kitId, userId, fn, { attempts = 6 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const filter = userId ? { _id: kitId, userId } : { _id: kitId };
    const doc = await Kit.findOne(filter).lean();
    if (!doc) throw notFound('Kit');
    const result = await fn(doc);
    const set = result?.set ?? result;
    if (!set || !Object.keys(set).length) return { doc, extra: result?.extra };
    const updated = await Kit.findOneAndUpdate({ ...filter, rev: doc.rev }, { $set: set, $inc: { rev: 1 } }, { new: true, lean: true });
    if (updated) return { doc: updated, extra: result?.extra };
  }
  throw new AppError('CONFLICT', 'The kit was changed by another request too many times in a row. Try again.', { status: 409 });
}

export async function getOwnedKit(kitId, userId) {
  if (!/^[a-f0-9]{24}$/i.test(String(kitId))) throw notFound('Kit');
  const doc = await Kit.findOne({ _id: kitId, userId }).lean();
  if (!doc) throw notFound('Kit'); // same answer for "not yours" and "doesn't exist"
  return doc;
}

export async function pushProgress(kitId, step) {
  await Kit.updateOne({ _id: kitId }, { $push: { progress: { $each: [step], $slice: -80 } } });
}
