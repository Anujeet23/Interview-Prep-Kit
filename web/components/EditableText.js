'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Inline editor that feels immediate:
 *  - typing updates local state only; a save is sent 700 ms after the last keystroke, or on blur
 *  - while the user is editing (focused or unsaved), updates arriving from the server are
 *    ignored for this field, so a refresh or regeneration never overwrites text mid-edit
 *  - Escape reverts to the last saved value
 */
export function EditableText({ value, onSave, label, multiline = false, placeholder = '', className = '', textClassName = '', maxLength }) {
  const [draft, setDraft] = useState(value ?? '');
  const [state, setState] = useState('idle'); // idle | dirty | saving | saved | error
  const focused = useRef(false);
  const saved = useRef(value ?? '');
  const timer = useRef(null);

  useEffect(() => {
    if (!focused.current && state !== 'dirty' && state !== 'saving') {
      setDraft(value ?? '');
      saved.current = value ?? '';
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);

  async function flush(text) {
    clearTimeout(timer.current);
    if (text === saved.current) {
      setState((s) => (s === 'dirty' ? 'idle' : s));
      return;
    }
    if (!text.trim() && !placeholder) return;
    setState('saving');
    try {
      await onSave(text);
      saved.current = text;
      setState('saved');
      setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      setState('error');
    }
  }

  function change(e) {
    const text = e.target.value;
    setDraft(text);
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(text), 700);
  }

  const common = {
    value: draft,
    onChange: change,
    'aria-label': label,
    placeholder,
    maxLength,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      flush(draft);
    },
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        clearTimeout(timer.current);
        setDraft(saved.current);
        setState('idle');
        e.currentTarget.blur();
      }
      if (!multiline && e.key === 'Enter') e.currentTarget.blur();
    },
    className: `w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-rule focus:border-action focus:bg-sheet focus:outline-none ${textClassName}`,
  };

  return (
    <div className={`relative ${className}`}>
      {multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
      <span aria-live="polite" className={`pointer-events-none absolute -top-2 right-1 text-[11px] ${state === 'error' ? 'text-danger' : 'text-muted'}`}>
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved: click away to retry' : ''}
      </span>
    </div>
  );
}
