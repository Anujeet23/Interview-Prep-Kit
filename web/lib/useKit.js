'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useToast } from './toast';
import { CATEGORY_LABELS } from './api';

const SECTION_LABEL = { company_brief: 'Company brief', schedule: 'Schedule', gaps: 'Coverage gaps' };

/**
 * Owns one kit on the client.
 *  - polls a lightweight /status endpoint while generating or regenerating
 *  - applies server responses only if they are newer (by `rev`) than what we hold,
 *    so out-of-order responses can't roll the UI back
 *  - `optimistic(update, request)` applies a local change immediately and reverts on failure
 */
export function useKit(id) {
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const rev = useRef(-1);
  const lastRegenAt = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`/kits/${id}`);
      rev.current = d.rev;
      lastRegenAt.current ??= d.last_regeneration?.at ?? '';
      setDoc(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const busy = doc && (doc.status === 'queued' || doc.status === 'running' || doc.regenerating);
  useEffect(() => {
    if (!busy) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api(`/kits/${id}/status`);
        if (stop) return;
        const finishedGeneration = s.status !== doc.status && (s.status === 'ready' || s.status === 'failed');
        const finishedRegen = doc.regenerating && !s.regenerating;
        if (finishedGeneration || finishedRegen) {
          await load();
          const r = s.last_regeneration;
          if (finishedRegen && r && r.at !== lastRegenAt.current) {
            lastRegenAt.current = r.at;
            const what = r.section === 'questions' ? `${CATEGORY_LABELS[r.category]} questions` : SECTION_LABEL[r.section];
            if (!r.ok) toast(`${what}: ${r.error.message}`, { tone: 'error', duration: 8000 });
            else if (r.section === 'questions') toast(`${what} regenerated: ${r.summary.added} new, ${r.summary.kept} of yours kept.`);
            else if (r.section === 'gaps') toast(`Added ${r.summary.added} question(s) for uncovered requirements.`);
            else toast(`${what} regenerated.`);
          }
        } else {
          setDoc((d) => ({ ...d, status: s.status, progress: s.progress, queue_position: s.queue_position, error: s.error }));
        }
      } catch {
        /* transient: try again next tick */
      }
    };
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [busy, id, doc?.status, doc?.regenerating, load, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyKit = useCallback((kit, newRev) => {
    if (newRev != null) {
      if (newRev < rev.current) return;
      rev.current = newRev;
    }
    setDoc((d) => ({ ...d, kit }));
  }, []);

  /** Send an edit; the server answers with the whole updated kit. */
  const send = useCallback(
    async (path, method, body) => {
      const res = await api(`/kits/${id}${path}`, { method, body });
      if (res?.kit) applyKit(res.kit, res.rev);
      return res;
    },
    [id, applyKit]
  );

  const optimistic = useCallback(
    async (localUpdate, path, method, body) => {
      let before;
      setDoc((d) => {
        before = d.kit;
        return { ...d, kit: localUpdate(d.kit) };
      });
      try {
        return await send(path, method, body);
      } catch (e) {
        setDoc((d) => ({ ...d, kit: before }));
        toast(e.message, { tone: 'error' });
        throw e;
      }
    },
    [send, toast]
  );

  const regenerate = useCallback(
    async (section, category) => {
      try {
        const res = await api(`/kits/${id}/regenerate`, { method: 'POST', body: { section, category } });
        setDoc((d) => ({ ...d, regenerating: res.regenerating }));
      } catch (e) {
        toast(e.message, { tone: 'error' });
      }
    },
    [id, toast]
  );

  const retry = useCallback(async () => {
    try {
      await api(`/kits/${id}/retry`, { method: 'POST' });
      await load();
    } catch (e) {
      toast(e.message, { tone: 'error' });
    }
  }, [id, load, toast]);

  return { doc, kit: doc?.kit, error, load, send, optimistic, regenerate, retry, setDoc };
}
