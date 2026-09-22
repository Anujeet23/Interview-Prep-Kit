'use client';
import { useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { QuestionCard } from './QuestionCard';
import { Button, EmptyState, SectionHeader, Spinner, inputClass } from './ui';
import { CATEGORIES, CATEGORY_LABELS } from '@/lib/api';
import { useToast } from '@/lib/toast';

const isProtected = (q) => q.meta && (q.meta.origin === 'user' || q.meta.edited || q.meta.pinned);

const CATEGORY_HELP = {
  technical: 'Depth in the skills the posting asks for.',
  behavioural: 'Stories that show how you work with people.',
  'system-design': 'Open-ended design problems for senior roles or a published design round.',
  'company-fit': 'Why this company, grounded in what we found about them.',
};

export function QuestionsPanel({ kit, send, optimistic, regenerate, regenerating }) {
  const toast = useToast();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const reqs = kit.role.requirements;
  const uncovered = kit.coverage.uncovered_requirement_ids.map((id) => reqs.find((r) => r.id === id)).filter(Boolean);

  function onDragEnd(category) {
    return ({ active, over }) => {
      if (!over || active.id === over.id) return;
      const inCat = kit.questions.filter((q) => q.category === category);
      const moved = arrayMove(inCat, inCat.findIndex((q) => q.id === active.id), inCat.findIndex((q) => q.id === over.id));
      let i = 0;
      const next = kit.questions.map((q) => (q.category === category ? moved[i++] : q));
      optimistic((k) => ({ ...k, questions: next }), '/questions/order', 'PUT', { order: next.map((q) => q.id) }).catch(() => {});
    };
  }

  const patch = (id) => (body) =>
    send(`/questions/${id}`, 'PATCH', body).catch((e) => {
      toast(e.message, { tone: 'error' });
      throw e;
    });

  function move(q, category) {
    optimistic(
      (k) => ({ ...k, questions: [...k.questions.filter((x) => x.id !== q.id), { ...q, category, meta: { ...q.meta, edited: true } }] }),
      `/questions/${q.id}/move`,
      'POST',
      { category }
    )
      .then(() => toast(`Moved to ${CATEGORY_LABELS[category]}.`))
      .catch(() => {});
  }

  function remove(q) {
    optimistic((k) => ({ ...k, questions: k.questions.filter((x) => x.id !== q.id) }), `/questions/${q.id}`, 'DELETE')
      .then(() =>
        toast('Question deleted.', {
          action: {
            label: 'Undo',
            onClick: () =>
              send('/questions', 'POST', { category: q.category, prompt: q.prompt, answer_outline: q.answer_outline, difficulty: q.difficulty, requirement_ids: q.requirement_ids }).catch((e) =>
                toast(e.message, { tone: 'error' })
              ),
          },
        })
      )
      .catch(() => {});
  }

  function regen(category) {
    const inCat = kit.questions.filter((q) => q.category === category);
    const keep = inCat.filter(isProtected).length;
    const replace = inCat.length - keep;
    if (!window.confirm(`Regenerate ${CATEGORY_LABELS[category]} questions?\n\n${replace} generated question(s) will be replaced. ${keep} you wrote, edited or pinned will stay.`)) return;
    regenerate('questions', category);
  }

  const shown = CATEGORIES.filter((c) => kit.questions.some((q) => q.category === c) || kit.research?.category_plan?.some((p) => p.category === c));

  return (
    <div className="space-y-10">
      <SectionHeader
        title="Question bank"
        description={`${kit.questions.length} questions. Drag the handle (or focus it and use space and the arrow keys) to reorder. Anything you write, edit or pin survives regeneration.`}
      />
      {uncovered.length > 0 ? (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-5 py-4">
          <p className="font-semibold text-danger">
            {uncovered.length} requirement{uncovered.length > 1 ? 's have' : ' has'} no question
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {uncovered.map((r) => (
              <li key={r.id}>
                {r.id} {r.text} {r.priority === 'must' && <strong>(must-have)</strong>}
              </li>
            ))}
          </ul>
          <Button className="mt-3" size="sm" variant="primary" onClick={() => regenerate('gaps')} busy={regenerating?.section === 'gaps'} disabled={!!regenerating}>
            Generate questions for these
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Every requirement has at least one question. Checked by code after generation in {kit.coverage.passes} pass{kit.coverage.passes === 1 ? '' : 'es'}.
        </p>
      )}

      {shown.map((category) => {
        const qs = kit.questions.filter((q) => q.category === category);
        const busy = regenerating?.section === 'questions' && regenerating.category === category;
        return (
          <section key={category} aria-labelledby={`cat-${category}`} aria-busy={busy}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-2">
              <div>
                <h3 id={`cat-${category}`} className="text-lg font-semibold">
                  {CATEGORY_LABELS[category]} <span className="text-sm font-normal text-muted">({qs.length})</span>
                </h3>
                <p className="text-sm text-muted">{CATEGORY_HELP[category]}</p>
              </div>
              <Button size="sm" onClick={() => regen(category)} busy={busy} disabled={!!regenerating}>
                Regenerate {CATEGORY_LABELS[category].toLowerCase()}
              </Button>
            </div>
            {busy && (
              <p className="mb-3 flex items-center gap-2 rounded-md bg-action/10 px-3 py-2 text-sm text-action">
                <Spinner /> Regenerating. You can keep editing; your changes will be kept.
              </p>
            )}
            {qs.length === 0 ? (
              <EmptyState title={`No ${CATEGORY_LABELS[category].toLowerCase()} questions`}>Add one below or regenerate this category.</EmptyState>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(category)}>
                <SortableContext items={qs.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                  <ol className="space-y-2">
                    {qs.map((q, i) => (
                      <QuestionCard key={q.id} q={q} index={i} requirements={reqs} onPatch={patch(q.id)} onDelete={() => remove(q)} onMove={(c) => move(q, c)} />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            )}
            <AddQuestion category={category} send={send} />
          </section>
        );
      })}
    </div>
  );
}

function AddQuestion({ category, send }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function add(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await send('/questions', 'POST', { category, prompt: text.trim() });
      setText('');
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={add} className="mt-3 flex gap-2">
      <label htmlFor={`add-${category}`} className="sr-only">
        Add a {CATEGORY_LABELS[category]} question
      </label>
      <input id={`add-${category}`} className={inputClass} placeholder={`Add your own ${CATEGORY_LABELS[category].toLowerCase()} question`} value={text} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" busy={busy} disabled={!text.trim()}>
        Add
      </Button>
    </form>
  );
}
