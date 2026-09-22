'use client';
import Link from 'next/link';
import { Pill, EmptyState, Button } from './ui';

const STATUS = { queued: 'Queued', running: 'Generating', ready: 'Ready', failed: 'Failed' };

export function KitList({ kits, loading, error, onDelete, onRetry }) {
  if (loading)
    return (
      <ul aria-busy="true" aria-label="Loading kits" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-16 animate-pulse rounded-md bg-rule/50" />
        ))}
      </ul>
    );
  if (error) return <p className="text-danger">{error}</p>;
  if (!kits.length)
    return (
      <EmptyState title="No kits yet">
        Paste a job description and the company’s website. The first kit takes a minute or two while we read the site.
      </EmptyState>
    );
  return (
    <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
      {kits.map((k) => (
        <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <Link href={`/kits/${k.id}`} className="block truncate font-semibold hover:text-action">
              {k.title}
            </Link>
            <p className="truncate text-sm text-muted">
              {k.company} · {k.days} day{k.days === 1 ? '' : 's'}
              {k.questions != null && ` · ${k.questions} questions`}
              {k.status === 'failed' && k.error && <span className="text-danger"> · {k.error.message}</span>}
            </p>
          </div>
          <Pill tone={k.status}>{STATUS[k.status]}</Pill>
          {k.status === 'failed' && (
            <Button size="sm" onClick={() => onRetry(k.id)}>
              Retry
            </Button>
          )}
          {k.status !== 'running' && (
            <Button size="sm" variant="ghost" aria-label={`Delete ${k.title}`} onClick={() => onDelete(k)}>
              Delete
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
