'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EditableText } from './EditableText';
import { MetaBadges, PinToggle } from './MetaBadges';
import { CATEGORY_LABELS, CATEGORIES } from '@/lib/api';

const DIFF = { 1: 'Warm-up', 2: 'Standard', 3: 'Hard' };

export function QuestionCard({ q, index, requirements, onPatch, onDelete, onMove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const reqById = new Map(requirements.map((r) => [r.id, r]));

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border bg-sheet p-3 sm:p-4 ${isDragging ? 'relative z-10 border-action shadow-lg' : 'border-rule'}`}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder question ${index + 1}. Press space to pick up, arrow keys to move, space to drop.`}
          className="mt-0.5 h-8 w-6 shrink-0 cursor-grab touch-none rounded text-muted hover:bg-rule/50 active:cursor-grabbing"
        >
          <span aria-hidden>⋮⋮</span>
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <EditableText multiline label={`Question ${q.id}`} value={q.prompt} onSave={(v) => onPatch({ prompt: v })} textClassName="font-medium leading-snug" />
          <details>
            <summary className="cursor-pointer text-sm text-muted hover:text-ink">Answer outline</summary>
            <EditableText multiline label={`Answer outline for ${q.id}`} value={q.answer_outline} placeholder="What a strong answer covers" onSave={(v) => onPatch({ answer_outline: v })} textClassName="text-sm leading-relaxed" className="mt-1" />
          </details>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {q.requirement_ids.map((id) => (
              <span key={id} title={reqById.get(id)?.text} className={`rounded px-1.5 py-0.5 ${reqById.get(id)?.priority === 'must' ? 'must-mark' : 'border border-rule text-muted'}`}>
                {id} {truncate(reqById.get(id)?.text, 28)}
              </span>
            ))}
            <RequirementPicker q={q} requirements={requirements} onChange={(ids) => onPatch({ requirement_ids: ids })} />
            <MetaBadges meta={q.meta} />
          </div>
        </div>
        <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 border-t border-rule pt-2 sm:col-span-1 sm:flex-col sm:flex-nowrap sm:items-end sm:border-0 sm:pt-0">
          <div className="flex items-center gap-1">
            <PinToggle pinned={q.meta?.pinned} onChange={(pinned) => onPatch({ pinned })} label="question" />
            <button onClick={onDelete} aria-label={`Delete question ${q.id}`} className="rounded px-2 py-1 text-xs text-muted hover:bg-danger/10 hover:text-danger">
              Delete
            </button>
          </div>
          <label className="sr-only" htmlFor={`diff-${q.id}`}>
            Difficulty
          </label>
          <select id={`diff-${q.id}`} value={q.difficulty} onChange={(e) => onPatch({ difficulty: Number(e.target.value) })} className="rounded border border-rule bg-sheet px-1.5 py-1 text-xs">
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>
                {DIFF[d]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`cat-${q.id}`}>
            Move to category
          </label>
          <select id={`cat-${q.id}`} value={q.category} onChange={(e) => onMove(e.target.value)} className="rounded border border-rule bg-sheet px-1.5 py-1 text-xs">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </li>
  );
}

function RequirementPicker({ q, requirements, onChange }) {
  if (!requirements.length) return null;
  const toggle = (id) => onChange(q.requirement_ids.includes(id) ? q.requirement_ids.filter((x) => x !== id) : [...q.requirement_ids, id]);
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-dashed border-rule px-1.5 py-0.5 text-muted hover:text-ink">Covers…</summary>
      <fieldset className="absolute left-0 z-20 mt-1 w-72 space-y-1 rounded-md border border-rule bg-sheet p-3 shadow-lg">
        <legend className="sr-only">Requirements this question covers</legend>
        {requirements.map((r) => (
          <label key={r.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={q.requirement_ids.includes(r.id)} onChange={() => toggle(r.id)} />
            <span>
              <span className="text-muted">{r.id}</span> {r.text}
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

const truncate = (s = '', n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
