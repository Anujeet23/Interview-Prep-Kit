'use client';
import { useEffect, useState } from 'react';
import { Spinner } from './ui';

/**
 * Generation takes one to three minutes, mostly waiting on rate-limited model calls.
 * Showing each real step (with what it found) makes the wait legible and makes a partial
 * failure, like "company site unreachable", visible the moment it happens.
 */
export function GenerationProgress({ doc }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const latest = new Map();
  for (const p of doc.progress || []) latest.set(p.key, p);
  const started = doc.progress?.[0]?.at ? Date.parse(doc.progress[0].at) : Date.parse(doc.created_at);
  const elapsed = Math.max(0, Math.round((now - started) / 1000));

  return (
    <section aria-labelledby="gen-title" className="mx-auto max-w-2xl">
      <h1 id="gen-title" className="text-2xl font-semibold tracking-tight">
        {doc.status === 'queued' ? 'Waiting to start' : 'Building your kit'}
      </h1>
      <p className="mt-1 text-muted">
        {doc.status === 'queued' && doc.queue_position > 1
          ? `${doc.queue_position - 1} kit(s) ahead of this one. `
          : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} elapsed. `}
        This usually takes one to three minutes. You can leave this page; it keeps going.
      </p>
      <ol className="mt-6 space-y-1" aria-live="polite">
        {doc.steps.map((s) => {
          const p = latest.get(s.key);
          const status = p?.status || 'pending';
          return (
            <li key={s.key} className="flex items-start gap-3 rounded-md px-2 py-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
                {status === 'running' ? (
                  <Spinner className="text-action" />
                ) : status === 'done' ? (
                  <span className="text-action">✓</span>
                ) : status === 'failed' ? (
                  <span className="text-warn">!</span>
                ) : status === 'skipped' ? (
                  <span className="text-muted">–</span>
                ) : (
                  <span className="h-2 w-2 rounded-full bg-rule" />
                )}
              </span>
              <div className="min-w-0">
                <p className={status === 'pending' ? 'text-muted' : 'font-medium'}>
                  {s.label}
                  <span className="sr-only">: {status}</span>
                </p>
                {p?.detail && <p className={`truncate text-sm ${status === 'failed' ? 'text-warn' : 'text-muted'}`}>{p.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-sm text-muted">Steps marked “!” couldn’t complete. The kit continues without them and says so honestly.</p>
    </section>
  );
}
