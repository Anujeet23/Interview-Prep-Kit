'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, Field, inputClass, ErrorState } from './ui';

export function NewKitForm() {
  const router = useRouter();
  const [jd, setJd] = useState('');
  const [url, setUrl] = useState('');
  const [days, setDays] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [duplicate, setDuplicate] = useState(null);

  async function submit(e, { force = false } = {}) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/kits', { method: 'POST', body: { jd, company_url: url, days: Number(days), force } });
      if (res.duplicate === 'exists') {
        setDuplicate(res.kit);
        setBusy(false);
        return;
      }
      router.push(`/kits/${res.kit.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const fieldError = (path) => error?.details?.find((d) => d.path === path)?.message;
  const short = jd.trim().length > 0 && jd.trim().length < 300;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field
        label="Job description"
        id="jd"
        hint="Paste the whole posting, including requirements and nice-to-haves."
        error={fieldError('jd')}
      >
        <textarea
          id="jd"
          required
          rows={10}
          className={`${inputClass} min-h-48 font-[inherit]`}
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          aria-describedby="jd-hint jd-count"
        />
        <p id="jd-count" className="mt-1 text-xs text-muted">
          {jd.length.toLocaleString()} characters
          {short && ' · A short posting gives a small kit. We won’t invent requirements it doesn’t state.'}
        </p>
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field label="Company website" id="url" hint="We’ll read it to learn what they do and how they hire." error={fieldError('company_url')}>
          <input id="url" required inputMode="url" placeholder="posthog.com" className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Days until interview" id="days" error={fieldError('days')}>
          <input id="days" type="number" min={1} max={365} required className={inputClass} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
      </div>
      {error && !error.details && <ErrorState title="Could not start the kit" message={error.message} />}
      {duplicate && (
        <div role="status" className="rounded-md border border-rule bg-sheet px-4 py-3 text-sm">
          You already have a kit for this exact posting, company and number of days.{' '}
          <Link className="font-semibold text-action underline" href={`/kits/${duplicate.id}`}>
            Open it
          </Link>{' '}
          or{' '}
          <button type="button" className="font-semibold text-action underline" onClick={() => submit(null, { force: true })}>
            generate a fresh one
          </button>
          .
        </div>
      )}
      <Button type="submit" variant="primary" size="lg" busy={busy}>
        Build my kit
      </Button>
    </form>
  );
}
