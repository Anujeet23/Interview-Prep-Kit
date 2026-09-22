'use client';

export function Button({ variant = 'secondary', size = 'md', className = '', busy = false, children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = { sm: 'px-2.5 py-1 text-sm', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  const variants = {
    primary: 'bg-action text-action-ink hover:brightness-110',
    secondary: 'border border-rule bg-sheet text-ink hover:border-muted',
    ghost: 'text-muted hover:bg-rule/40 hover:text-ink',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }) {
  return <span aria-hidden className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

const PILL = {
  queued: 'bg-rule text-ink',
  running: 'bg-action/15 text-action',
  ready: 'bg-action text-action-ink',
  failed: 'bg-danger/15 text-danger',
  must: 'must-mark text-ink font-semibold',
  nice: 'border border-rule text-muted',
  neutral: 'border border-rule text-muted',
  warn: 'bg-warn/15 text-warn',
};
export function Pill({ tone = 'neutral', children, className = '', title }) {
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${PILL[tone] || PILL.neutral} ${className}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, action }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-5 py-4">
      <p className="font-semibold text-danger">{title}</p>
      {message && <p className="mt-1 text-sm">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, error, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-rule bg-sheet px-3 py-2 text-ink placeholder:text-muted/70 focus:border-action focus:outline-none focus:ring-2 focus:ring-action/30';

export function SectionHeader({ title, description, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
