'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { AppHeader } from '@/components/AppHeader';
import { NewKitForm } from '@/components/NewKitForm';
import { BatchUpload } from '@/components/BatchUpload';
import { KitList } from '@/components/KitList';

export default function KitsPage() {
  const toast = useToast();
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('single');

  const load = useCallback(async () => {
    try {
      const d = await api('/kits');
      setKits(d.kits);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep statuses fresh while anything is still generating.
  useEffect(() => {
    if (!kits.some((k) => k.status === 'queued' || k.status === 'running')) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [kits, load]);

  async function remove(kit) {
    if (!window.confirm(`Delete “${kit.title}”? Your edits and practice history will be lost.`)) return;
    try {
      await api(`/kits/${kit.id}`, { method: 'DELETE' });
      setKits((ks) => ks.filter((k) => k.id !== kit.id));
      toast('Kit deleted.');
    } catch (e) {
      toast(e.message, { tone: 'error' });
    }
  }

  async function retry(id) {
    try {
      await api(`/kits/${id}/retry`, { method: 'POST' });
      load();
    } catch (e) {
      toast(e.message, { tone: 'error' });
    }
  }

  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <section aria-labelledby="new-kit">
          <h1 id="new-kit" className="text-3xl font-semibold tracking-tight">
            Prepare for an interview
          </h1>
          <p className="mt-2 max-w-prose text-muted">
            We read the posting, crawl the company’s site for what they do and how they hire, and build a question bank, flashcards and a day-by-day plan you can reshape.
          </p>
          <div role="tablist" aria-label="How to add roles" className="mt-6 flex gap-1 border-b border-rule">
            {[
              ['single', 'One role'],
              ['batch', 'Several roles (file)'],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${mode === key ? 'border-action text-ink' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-5">{mode === 'single' ? <NewKitForm /> : <BatchUpload onCreated={load} />}</div>
        </section>
        <section aria-labelledby="your-kits">
          <h2 id="your-kits" className="mb-3 text-lg font-semibold">
            Your kits
          </h2>
          <KitList kits={kits} loading={loading} error={error} onDelete={remove} onRetry={retry} />
        </section>
      </main>
    </>
  );
}
