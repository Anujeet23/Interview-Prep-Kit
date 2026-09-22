'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button, EmptyState, ErrorState, SectionHeader, Spinner } from './ui';

const RATINGS = [
  [1, 'Again', 'Couldn’t answer'],
  [2, 'Shaky', 'Got there, slowly'],
  [3, 'Confident', 'Could say it in an interview'],
];

export function PracticePanel({ kitId, kit }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState([]);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/kits/${kitId}/practice`);
      setData(d);
      setQueue(d.order);
      setPos(0);
      setRevealed(false);
    } catch (e) {
      setError(e.message);
    }
  }, [kitId]);
  useEffect(() => {
    load();
  }, [load]);

  const card = kit.flashcards.find((f) => f.id === queue[pos]);
  const done = data && pos >= queue.length;

  const rate = useCallback(
    async (confidence) => {
      if (!card || !revealed || saving) return;
      setSaving(true);
      try {
        const res = await api(`/kits/${kitId}/practice/reviews`, { method: 'POST', body: { card_id: card.id, confidence } });
        setData((d) => ({ ...d, summary: res.summary, state: res.state }));
        setPos((p) => p + 1);
        setRevealed(false);
      } catch (e) {
        toast(e.message, { tone: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [card, revealed, saving, kitId, toast]
  );

  async function newSession() {
    const res = await api(`/kits/${kitId}/practice/sessions`, { method: 'POST' });
    setData((d) => ({ ...d, summary: res.summary, order: res.order }));
    setQueue(res.order);
    setPos(0);
    setRevealed(false);
  }

  async function reset() {
    if (!window.confirm('Clear all confidence ratings for this kit?')) return;
    await api(`/kits/${kitId}/practice`, { method: 'DELETE' });
    load();
  }

  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === ' ' || e.key === 'Enter') && !revealed && card && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        setRevealed(true);
      }
      if (['1', '2', '3'].includes(e.key)) rate(Number(e.key));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, card, rate]);

  if (error) return <ErrorState title="Could not load practice" message={error} action={<Button onClick={load}>Try again</Button>} />;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-muted">
        <Spinner /> Loading practice…
      </p>
    );
  if (!kit.flashcards.length) return <EmptyState title="No flashcards to practise">Add some in the Flashcards section first.</EmptyState>;

  const s = data.summary;
  const seenInSession = pos;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="practice-h">
        <SectionHeader
          title={<span id="practice-h">Practice</span>}
          description="Least-confident and never-seen cards come first. Keys: space to reveal, 1 / 2 / 3 to rate."
          actions={
            <Button size="sm" variant="ghost" onClick={reset}>
              Reset ratings
            </Button>
          }
        />
        {done ? (
          <div className="rounded-xl border border-rule bg-sheet p-8 text-center">
            <p className="text-xl font-semibold">Session done: {seenInSession} cards</p>
            <p className="mt-1 text-muted">
              {s.again + s.shaky > 0 ? `${s.again + s.shaky} card(s) still need work; they'll lead the next session.` : 'Everything reviewed is marked confident.'}
            </p>
            <Button className="mt-5" variant="primary" onClick={newSession}>
              Start next session
            </Button>
          </div>
        ) : (
          card && (
            <div>
              <p className="mb-2 text-sm text-muted" aria-live="polite">
                Card {pos + 1} of {queue.length}
                {data.state?.cards?.[card.id] ? ` · last time: ${RATINGS.find((r) => r[0] === data.state.cards[card.id].confidence)?.[1]}` : ' · new'}
              </p>
              <div className="index-card relative min-h-72 rounded-md border border-rule px-6 pb-8 pt-4 shadow-sm sm:pl-16">
                <p className="text-xs text-muted">{card.requirement_ids.map((id) => kit.role.requirements.find((r) => r.id === id)?.text).filter(Boolean).join(' · ')}</p>
                <p className="mt-6 font-[family-name:var(--font-card)] text-2xl leading-8">{card.front}</p>
                {revealed ? (
                  <p className="mt-8 font-[family-name:var(--font-card)] text-lg leading-8 text-ink/90" aria-live="polite">
                    {card.back || <em className="text-muted">No answer written for this card.</em>}
                  </p>
                ) : (
                  <Button className="mt-8" onClick={() => setRevealed(true)} autoFocus>
                    Reveal answer
                  </Button>
                )}
              </div>
              {revealed && (
                <fieldset className="mt-4">
                  <legend className="mb-2 text-sm font-semibold">How confident were you?</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {RATINGS.map(([n, label, hint]) => (
                      <button
                        key={n}
                        onClick={() => rate(n)}
                        disabled={saving}
                        autoFocus={n === 2}
                        className="rounded-md border border-rule bg-sheet px-3 py-3 text-left hover:border-action disabled:opacity-50"
                      >
                        <span className="block font-semibold">
                          <kbd className="mr-1 text-muted">{n}</kbd> {label}
                        </span>
                        <span className="block text-xs text-muted">{hint}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )
        )}
      </section>

      <aside aria-labelledby="coverage-h" className="space-y-4">
        <h3 id="coverage-h" className="font-semibold">
          Covered so far
        </h3>
        <div className="flex h-2 overflow-hidden rounded bg-rule" role="img" aria-label={`${s.confident} confident, ${s.shaky} shaky, ${s.again} again, ${s.total - s.reviewed} not seen`}>
          <span className="bg-action" style={{ width: `${(s.confident / s.total) * 100}%` }} />
          <span className="bg-warn" style={{ width: `${(s.shaky / s.total) * 100}%` }} />
          <span className="bg-danger" style={{ width: `${(s.again / s.total) * 100}%` }} />
        </div>
        <p className="text-sm text-muted">
          {s.reviewed} of {s.total} cards reviewed: {s.confident} confident, {s.shaky} shaky, {s.again} again.
        </p>
        <ul className="space-y-2 text-sm">
          {s.requirements.map((r) => (
            <li key={r.requirement_id} className="flex items-start justify-between gap-2">
              <span className={r.priority === 'must' ? 'must-mark' : ''}>{r.text}</span>
              <span className={`shrink-0 text-xs ${r.status === 'ready' ? 'text-action' : r.status === 'needs_work' ? 'text-danger' : 'text-muted'}`}>
                {{ ready: 'Ready', needs_work: 'Needs work', not_covered: `${r.reviewed}/${r.cards} seen`, no_cards: 'No cards' }[r.status]}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
