'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button, ErrorState, Field, SectionHeader, Spinner, inputClass } from './ui';

const EMPTY = { title: '', situation: '', action: '', result: '', requirement_ids: [] };

/**
 * Story bank: behavioural rounds are answered with your own stories, and people freeze
 * when they realise mid-interview they have none for "tell me about a time you disagreed
 * with a manager". This is the kit's coverage check pointed at the candidate: which
 * behavioural requirements have no story of yours yet?
 */
export function StoryBankPanel({ kitId, kit }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/kits/${kitId}/stories`).then(setData).catch((e) => setError(e.message)), [kitId]);
  useEffect(() => {
    load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = editing ? await api(`/kits/${kitId}/stories/${editing}`, { method: 'PATCH', body: form }) : await api(`/kits/${kitId}/stories`, { method: 'POST', body: form });
      setData(res);
      setForm(EMPTY);
      setEditing(null);
      toast(editing ? 'Story updated.' : 'Story saved.');
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this story?')) return;
    setData(await api(`/kits/${kitId}/stories/${id}`, { method: 'DELETE' }));
  }

  if (error) return <ErrorState message={error} />;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-muted">
        <Spinner /> Loading stories…
      </p>
    );

  const reqs = kit.role.requirements;
  const gaps = data.coverage.filter((c) => !c.story_ids.length);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (id) => setForm((f) => ({ ...f, requirement_ids: f.requirement_ids.includes(id) ? f.requirement_ids.filter((x) => x !== id) : [...f.requirement_ids, id] }));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="stories-h">
        <SectionHeader
          title={<span id="stories-h">Story bank</span>}
          description="Write down the real experiences you'll draw on, and tag which requirements each one proves. One good story can answer several questions."
        />
        <form onSubmit={save} className="space-y-3 rounded-lg border border-rule bg-sheet p-4">
          <Field label="Title" id="st-title">
            <input id="st-title" className={inputClass} placeholder="e.g. Migrating billing to Postgres without downtime" value={form.title} onChange={set('title')} required />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ['situation', 'Situation', 'What was going on, and your role'],
              ['action', 'Action', 'What you personally did'],
              ['result', 'Result', 'What changed; numbers if you have them'],
            ].map(([k, label, ph]) => (
              <Field key={k} label={label} id={`st-${k}`}>
                <textarea id={`st-${k}`} rows={3} className={inputClass} placeholder={ph} value={form[k]} onChange={set(k)} />
              </Field>
            ))}
          </div>
          <fieldset>
            <legend className="text-sm font-semibold">This story shows…</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {reqs.map((r) => (
                <label key={r.id} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${form.requirement_ids.includes(r.id) ? 'border-action bg-action/10' : 'border-rule'}`}>
                  <input type="checkbox" className="sr-only" checked={form.requirement_ids.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span aria-hidden>{form.requirement_ids.includes(r.id) ? '✓' : '+'}</span> {r.text}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={busy} disabled={!form.title.trim()}>
              {editing ? 'Save changes' : 'Add story'}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={() => (setEditing(null), setForm(EMPTY))}>
                Cancel
              </Button>
            )}
          </div>
        </form>

        <ul className="mt-6 space-y-3">
          {data.stories.map((s) => (
            <li key={s.id} className="rounded-lg border border-rule bg-sheet p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{s.title}</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => (setEditing(s.id), setForm({ ...EMPTY, ...s }))}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>
                    Delete
                  </Button>
                </div>
              </div>
              {[s.situation, s.action, s.result].some(Boolean) && (
                <dl className="mt-2 grid gap-2 text-sm md:grid-cols-3">
                  {[
                    ['Situation', s.situation],
                    ['Action', s.action],
                    ['Result', s.result],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-muted">{k}</dt>
                      <dd>{v || '–'}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-2 text-xs text-muted">Shows: {s.requirement_ids.map((id) => reqs.find((r) => r.id === id)?.text).filter(Boolean).join(' · ') || 'nothing tagged yet'}</p>
            </li>
          ))}
        </ul>
      </section>

      <aside aria-labelledby="story-gaps-h">
        <h3 id="story-gaps-h" className="font-semibold">
          {gaps.length ? `${gaps.length} requirement${gaps.length === 1 ? '' : 's'} without a story` : 'Every behavioural requirement has a story'}
        </h3>
        <p className="text-sm text-muted">Behavioural and company-fit questions in your kit test these.</p>
        <ul className="mt-3 space-y-2 text-sm">
          {data.coverage.map((c) => (
            <li key={c.requirement_id} className="flex items-start justify-between gap-2">
              <span className={c.priority === 'must' ? 'must-mark' : ''}>{c.text}</span>
              <span className={`shrink-0 text-xs ${c.story_ids.length ? 'text-action' : 'text-danger'}`}>{c.story_ids.length ? `${c.story_ids.length} story` : 'None'}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
