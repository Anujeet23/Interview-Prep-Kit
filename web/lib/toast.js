'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext({ toast: () => {} });

/** Toasts announce results politely to screen readers (role="status"). */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const dismiss = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message, { tone = 'info', action, duration = 5000 } = {}) => {
      const id = ++idRef.current;
      setItems((xs) => [...xs.slice(-3), { id, message, tone, action }]);
      if (duration) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex max-w-md items-center gap-3 rounded-md border px-4 py-3 text-sm shadow-lg ${
              t.tone === 'error' ? 'border-danger bg-sheet text-danger' : 'border-rule bg-ink text-paper'
            }`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                className="font-semibold underline underline-offset-2"
                onClick={() => {
                  t.action.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" className="ml-1 opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext).toast;
