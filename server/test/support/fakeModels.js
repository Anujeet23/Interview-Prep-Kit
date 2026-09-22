/**
 * TEST SUPPORT ONLY. An in-memory stand-in for the few Mongoose model methods the app
 * uses, so the HTTP API can be integration-tested without a MongoDB server.
 * It supports exactly the query/update operators the code uses; nothing more.
 */
import crypto from 'node:crypto';
import { User } from '../../src/db/models/User.js';
import { Kit } from '../../src/db/models/Kit.js';

const clone = (v) => structuredClone(v);
const newId = () => crypto.randomBytes(12).toString('hex');
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond) return cond.$in.includes(v);
      if ('$ne' in cond) return v !== cond.$ne && !(cond.$ne === null && v === undefined);
      if ('$type' in cond) return typeof v === cond.$type;
    }
    return String(v) === String(cond);
  });
}

function applyUpdate(doc, update) {
  for (const [k, v] of Object.entries(update.$set || {})) doc[k] = clone(v);
  for (const k of Object.keys(update.$unset || {})) delete doc[k];
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
  for (const [k, v] of Object.entries(update.$push || {})) {
    doc[k] = [...(doc[k] || []), ...clone(v.$each || [v])];
    if (v.$slice) doc[k] = doc[k].slice(v.$slice);
  }
  doc.updatedAt = new Date();
}

class Query {
  constructor(run) {
    this.run = run;
    this.sortSpec = null;
    this.limitN = null;
  }
  lean() { return this; }
  select() { return this; }
  sort(spec) { this.sortSpec = spec; return this; }
  limit(n) { this.limitN = n; return this; }
  exec() {
    let out = this.run();
    if (Array.isArray(out)) {
      if (this.sortSpec) {
        const [[key, dir]] = Object.entries(this.sortSpec);
        out = [...out].sort((a, b) => (a[key] > b[key] ? dir : -dir));
      }
      if (this.limitN) out = out.slice(0, this.limitN);
    }
    return Promise.resolve(out == null ? null : clone(out));
  }
  then(res, rej) { return this.exec().then(res, rej); }
}

function makeStore(Model, { defaults = () => ({}), unique = [] } = {}) {
  const rows = [];
  const withDefaults = (data) => {
    const now = new Date();
    return { ...defaults(), ...clone(data), _id: data._id || newId(), createdAt: now, updatedAt: now };
  };
  Object.assign(Model, {
    _rows: rows,
    async exists(filter) { return rows.some((r) => matches(r, filter)) ? { _id: 1 } : null; },
    async create(data) {
      const doc = withDefaults(data);
      for (const u of unique) {
        const cond = u(doc);
        if (cond && rows.some((r) => matches(r, cond))) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      }
      rows.push(doc);
      const out = clone(doc);
      return { ...out, toObject: () => clone(doc) };
    },
    findOne(filter) {
      const q = new Query(() => {
        let list = rows.filter((r) => matches(r, filter));
        if (q.sortSpec) {
          const [[key, dir]] = Object.entries(q.sortSpec);
          list = list.sort((a, b) => (a[key] > b[key] ? dir : -dir));
        }
        return list[0] || null;
      });
      return q;
    },
    findById(id) { return new Query(() => rows.find((r) => String(r._id) === String(id)) || null); },
    find(filter) { return new Query(() => rows.filter((r) => matches(r, filter))); },
    findOneAndUpdate(filter, update) {
      return new Query(() => {
        const doc = rows.find((r) => matches(r, filter));
        if (!doc) return null;
        applyUpdate(doc, update);
        return doc;
      });
    },
    async updateOne(filter, update) {
      const doc = rows.find((r) => matches(r, filter));
      if (doc) applyUpdate(doc, update);
      return { modifiedCount: doc ? 1 : 0 };
    },
    async updateMany(filter, update) {
      const docs = rows.filter((r) => matches(r, filter));
      docs.forEach((d) => applyUpdate(d, update));
      return { modifiedCount: docs.length };
    },
    async deleteOne(filter) {
      const i = rows.findIndex((r) => matches(r, filter));
      if (i >= 0) rows.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
  });
}

export function installFakeModels() {
  makeStore(User, { unique: [(d) => ({ email: d.email })] });
  makeStore(Kit, {
    defaults: () => ({ status: 'queued', progress: [], kit: null, researchCache: null, practice: { cards: {}, sessions: 0 }, stories: [], nextStory: 1, regenerating: null, lastRegeneration: null, error: null, rev: 0 }),
    unique: [(d) => (typeof d.activeKey === 'string' ? { userId: d.userId, activeKey: d.activeKey } : null)],
  });
}
