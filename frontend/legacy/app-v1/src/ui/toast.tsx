/* eslint-disable react-refresh/only-export-components */
// Toast system: transient confirmations only (completed actions, non-blocking
// info). Warnings/errors that need action do not auto-dismiss. Top-right under
// the top bar, max 3 stacked, pause on hover, manual close always available.

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

const ICONS = { success: CheckCircle2, info: Info, warning: AlertTriangle, error: XCircle };
const LABELS = { success: 'Success', info: 'Info', warning: 'Warning', error: 'Error' };
const AUTO_DISMISS_MS = 5000;

const Ctx = createContext<{ push: (kind: ToastKind, title: string, detail?: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast outside provider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = seq.current++;
      setToasts((t) => [...t.slice(-2), { id, kind, title, detail }]); // max 3
      // success/info auto-dismiss; warning/error stay until closed
      if (kind === 'success' || kind === 'info') {
        timers.current.set(id, window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
      }
    },
    [dismiss],
  );

  const pause = (id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  };
  const resume = (id: number, kind: ToastKind) => {
    if (kind === 'success' || kind === 'info') {
      timers.current.set(id, window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS));
    }
  };

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              className={`toast toast-${t.kind}`}
              role={t.kind === 'error' ? 'alert' : 'status'}
              aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id, t.kind)}
              onFocus={() => pause(t.id)}
              onBlur={() => resume(t.id, t.kind)}
            >
              <Icon size={16} aria-hidden className="toast-icon" />
              <div className="toast-text">
                <span className="toast-kind">{LABELS[t.kind]}:</span> <b>{t.title}</b>
                {t.detail && <div className="toast-detail">{t.detail}</div>}
              </div>
              <button className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
