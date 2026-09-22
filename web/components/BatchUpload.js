'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { parseCasesFile } from '@/lib/parseCases';
import { Button, ErrorState, Field, inputClass } from './ui';

export function BatchUpload({ onCreated }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [defaultDays, setDefaultDays] = useState(5);

  async function onFile(e) {
    const file = e.target.files?.[0];
    setError(null);
    setResults(null);
    setRows(null);
    if (!file) return;
    if (file.size > 500_000) return setError('That file is larger than 500 KB.');
    try {
      setRows(parseCasesFile(file.name, await file.text(), Number(defaultDays) || 5));
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api('/kits/batch', { method: 'POST', body: { items: rows.map(({ jd, company_url, days }) => ({ jd, company_url, days })) } });
      setResults(res.results);
      setRows(null);
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Preparing for several roles? Upload a <strong>.json</strong> array of <code>{'{ jd, company_url, days }'}</code> (the same format as the batch command) or a{' '}
        <strong>.csv</strong> with columns <code>jd,company_url,days</code>. Up to 10 at a time; they’re generated one after another.
      </p>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field label="File" id="batch-file">
          <input id="batch-file" type="file" accept=".json,.csv,application/json,text/csv" onChange={onFile} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-rule file:bg-sheet file:px-3 file:py-2 file:text-sm file:font-medium" />
        </Field>
        <Field label="Days if missing" id="batch-days">
          <input id="batch-days" type="number" min={1} max={365} className={inputClass} value={defaultDays} onChange={(e) => setDefaultDays(e.target.value)} />
        </Field>
      </div>
      {error && <ErrorState title="Could not read the file" message={error} />}
      {rows && (
        <div>
          <p className="text-sm font-semibold">{rows.length} role(s) found</p>
          <ul className="mt-2 divide-y divide-rule rounded-md border border-rule bg-sheet text-sm">
            {rows.map((r) => (
              <li key={r.row} className="flex flex-wrap gap-x-3 px-3 py-2">
                <span className="font-medium">{r.jd.split('\n')[0].slice(0, 60) || <em className="text-danger">no description</em>}</span>
                <span className="text-muted">{r.company_url || 'no URL'}</span>
                <span className="text-muted">{r.days} days</span>
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant="primary" busy={busy} onClick={submit} disabled={rows.length > 10}>
            {rows.length > 10 ? 'Too many rows (max 10)' : `Build ${rows.length} kit${rows.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      )}
      {results && (
        <ul className="space-y-1 text-sm" aria-label="Batch results">
          {results.map((r) => (
            <li key={r.index}>
              Row {r.index + 1}:{' '}
              {r.ok ? (
                <Link className="text-action underline" href={`/kits/${r.kit.id}`}>
                  {r.duplicate === 'exists' ? 'already exists, open it' : r.duplicate === 'in_progress' ? 'already generating' : 'queued'}
                </Link>
              ) : (
                <span className="text-danger">{r.error.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
