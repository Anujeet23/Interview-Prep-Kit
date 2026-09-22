'use client';
import { useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EditableText } from './EditableText';
import { MetaBadges, PinToggle } from './MetaBadges';
import { Button, EmptyState, SectionHeader, inputClass } from './ui';
import { useToast } from '@/lib/toast';

export function FlashcardsPanel({ kit, send, optimistic }) {
  const toast = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');

  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const ids = kit.flashcards.map((f) => f.id);
    const next = arrayMove(kit.flashcards, ids.indexOf(active.id), ids.indexOf(over.id));
    optimistic((k) => ({ ...k, flashcards: next }), '/flashcards/order', 'PUT', { order: next.map((f) => f.id) }).catch(() => {});
  }

  async function add(e) {
    e.preventDefault();
    try {
      await send('/flashcards', 'POST', { front, back });
      setFront('');
      setBack('');
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }

  const patch = (id) => (body) => send(`/flashcards/${id}`, 'PATCH', body);

  return (
    <div>
      <SectionHeader title="Flashcards" description={`${kit.flashcards.length} cards. Edit either side in place; practise them in Practice.`} />
      {kit.flashcards.length === 0 ? (
        <EmptyState title="No flashcards yet">Add your own below.</EmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={kit.flashcards.map((f) => f.id)} strategy={rectSortingStrategy}>
            <ol className="grid gap-3 md:grid-cols-2">
              {kit.flashcards.map((f, i) => (
                <Card
                  key={f.id}
                  f={f}
                  index={i}
                  reqs={kit.role.requirements}
                  onPatch={patch(f.id)}
                  onDelete={() => optimistic((k) => ({ ...k, flashcards: k.flashcards.filter((x) => x.id !== f.id) }), `/flashcards/${f.id}`, 'DELETE').then(() => toast('Card deleted.')).catch(() => {})}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <form onSubmit={add} className="mt-6 grid gap-2 rounded-lg border border-dashed border-rule p-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="sr-only" htmlFor="new-front">
          Front
        </label>
        <input id="new-front" className={inputClass} placeholder="Front: a concept or prompt" value={front} onChange={(e) => setFront(e.target.value)} />
        <label className="sr-only" htmlFor="new-back">
          Back
        </label>
        <input id="new-back" className={inputClass} placeholder="Back: what you'd say" value={back} onChange={(e) => setBack(e.target.value)} />
        <Button type="submit" disabled={!front.trim()}>
          Add card
        </Button>
      </form>
    </div>
  );
}

function Card({ f, index, reqs, onPatch, onDelete }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: f.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded-lg border bg-sheet p-3 ${isDragging ? 'z-10 border-action shadow-lg' : 'border-rule'}`}>
      <div className="flex items-start gap-2">
        <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder card ${index + 1}`} className="h-8 w-6 shrink-0 cursor-grab touch-none rounded text-muted hover:bg-rule/50">
          <span aria-hidden>⋮⋮</span>
        </button>
        <div className="min-w-0 flex-1">
          <EditableText multiline label={`Front of card ${f.id}`} value={f.front} onSave={(v) => onPatch({ front: v })} textClassName="font-[family-name:var(--font-card)] font-semibold" />
          <EditableText multiline label={`Back of card ${f.id}`} value={f.back} placeholder="Answer" onSave={(v) => onPatch({ back: v })} textClassName="text-sm text-muted" className="mt-1" />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            {f.requirement_ids.map((id) => (
              <span key={id} title={reqs.find((r) => r.id === id)?.text}>
                {id}
              </span>
            ))}
            <MetaBadges meta={f.meta} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PinToggle pinned={f.meta?.pinned} onChange={(pinned) => onPatch({ pinned })} label="card" />
          <button onClick={onDelete} aria-label={`Delete card ${f.id}`} className="rounded px-2 py-1 text-xs text-muted hover:bg-danger/10 hover:text-danger">
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
