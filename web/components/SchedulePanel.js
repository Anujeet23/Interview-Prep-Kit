'use client';
import { useState } from 'react';
import { EditableText } from './EditableText';
import { PinToggle } from './MetaBadges';
import { Button, SectionHeader } from './ui';
import { CATEGORY_LABELS } from '@/lib/api';

export function SchedulePanel({ kit, send, regenerate, regenerating }) {
  const { schedule } = kit;
  const qById = new Map(kit.questions.map((q) => [q.id, q]));
  const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
  const missingMust = kit.role.requirements.filter((r) => r.priority === 'must' && !kit.questions.some((q) => scheduled.has(q.id) && q.requirement_ids.includes(r.id)));
  const total = schedule.days.reduce((s, d) => s + d.minutes, 0);
  const busy = regenerating?.section === 'schedule';

  function regen() {
    if (schedule.meta?.edited && !window.confirm('Rebuilding the schedule replaces your changes to it. Continue?')) return;
    regenerate('schedule');
  }

  return (
    <div>
      <SectionHeader
        title="Study schedule"
        description={`${schedule.days_available} day${schedule.days_available === 1 ? '' : 's'}, ${hours(total)} in total. Must-have and harder material comes first; the last day is a light review.`}
        actions={
          <>
            <PinToggle pinned={schedule.meta?.pinned} onChange={(pinned) => send('/schedule', 'PATCH', { pinned })} label="schedule" />
            <Button size="sm" onClick={regen} busy={busy} disabled={schedule.meta?.pinned || !!regenerating}>
              Rebuild schedule
            </Button>
          </>
        }
      />
      {missingMust.length > 0 && (
        <p role="alert" className="mb-4 rounded-md bg-danger/5 px-4 py-3 text-sm text-danger">
          Not in the schedule: {missingMust.map((r) => r.text).join('; ')}. Rebuild the schedule or add their questions to a day.
        </p>
      )}
      <ol className="space-y-3">
        {schedule.days.map((d) => (
          <Day key={d.day} d={d} qById={qById} send={send} />
        ))}
      </ol>
    </div>
  );
}

function Day({ d, qById, send }) {
  const [minutes, setMinutes] = useState(d.minutes);
  const [prev, setPrev] = useState(d.minutes);
  if (prev !== d.minutes) {
    setPrev(d.minutes);
    setMinutes(d.minutes);
  }
  const saveMinutes = () => {
    const m = Math.round(Number(minutes));
    if (Number.isInteger(m) && m >= 0 && m !== d.minutes) send(`/schedule/days/${d.day}`, 'PATCH', { minutes: m }).catch(() => setMinutes(d.minutes));
    else setMinutes(d.minutes);
  };
  const final = d.focus.startsWith('Final review');
  return (
    <li className={`rounded-lg border bg-sheet p-4 ${final ? 'border-action/40' : 'border-rule'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-14 shrink-0">
          <p className="text-xs text-muted">Day</p>
          <p className="text-2xl font-semibold tabular-nums leading-none">{d.day}</p>
        </div>
        <div className="min-w-0 flex-1">
          <EditableText label={`Focus for day ${d.day}`} value={d.focus} onSave={(v) => send(`/schedule/days/${d.day}`, 'PATCH', { focus: v })} textClassName="font-medium" />
          <ul className="mt-2 space-y-1 text-sm">
            {d.question_ids.map((id) => {
              const q = qById.get(id);
              return (
                <li key={id} className="flex gap-2">
                  <span className="shrink-0 text-muted">{CATEGORY_LABELS[q?.category] || ''}</span>
                  <span className="min-w-0 truncate">{q?.prompt || id}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="shrink-0 text-right">
          <label htmlFor={`min-${d.day}`} className="block text-xs text-muted">
            Minutes
          </label>
          <input
            id={`min-${d.day}`}
            type="number"
            min={0}
            max={1440}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={saveMinutes}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-20 rounded border border-rule bg-sheet px-2 py-1 text-right tabular-nums"
          />
        </div>
      </div>
    </li>
  );
}

const hours = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());
