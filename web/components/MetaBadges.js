'use client';
import { Pill } from './ui';

/** Makes the generated / edited / yours / pinned state visible, because it decides what regeneration keeps. */
export function MetaBadges({ meta }) {
  if (!meta) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {meta.origin === 'user' && <Pill title="Written by you: kept when this section is regenerated">Yours</Pill>}
      {meta.origin === 'template' && <Pill tone="warn" title="The model didn't cover this requirement, so a generic question was added">Template</Pill>}
      {meta.edited && meta.origin !== 'user' && <Pill title="Edited by you: kept when this section is regenerated">Edited</Pill>}
    </span>
  );
}

export function PinToggle({ pinned, onChange, label }) {
  return (
    <button
      type="button"
      aria-pressed={Boolean(pinned)}
      onClick={() => onChange(!pinned)}
      title={pinned ? `Unpin ${label}` : `Pin ${label}: regeneration will leave it alone`}
      className={`rounded-md border px-2 py-1 text-xs font-medium ${pinned ? 'border-action bg-action/10 text-action' : 'border-rule text-muted hover:text-ink'}`}
    >
      {pinned ? 'Pinned' : 'Pin'}
    </button>
  );
}
