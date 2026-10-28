/* eslint-disable react-refresh/only-export-components */
// Reusable UI primitives: Button, IconButton, Banner, EmptyState,
// ConfirmDialog, Stepper, TabsBar. One look, used everywhere.

import { useEffect, useRef } from 'react';
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Info, Lock, Plus as PlusIcon, XCircle, X } from 'lucide-react';

// ---- Buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  compact,
  icon: Icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  compact?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button className={`btn btn-${variant} ${compact ? 'btn-compact' : ''} ${className}`} {...rest}>
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className = '',
  danger,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: LucideIcon;
  danger?: boolean;
}) {
  return (
    <button
      className={`icon-btn ${danger ? 'icon-btn-danger' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}

// ---- Banner (page-level, persistent) ---------------------------------------

const BANNER_META = {
  info: { icon: Info, label: 'Note' },
  success: { icon: CheckCircle2, label: 'Done' },
  warning: { icon: AlertTriangle, label: 'Warning' },
  error: { icon: XCircle, label: 'Error' },
  locked: { icon: Lock, label: 'Locked' },
} as const;

export function Banner({
  kind,
  children,
  actions,
}: {
  kind: keyof typeof BANNER_META;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const meta = BANNER_META[kind];
  const Icon = meta.icon;
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden className="banner-icon" />
      <span className="banner-label">{meta.label}:</span>
      <div className="banner-body">{children}</div>
      {actions && <div className="banner-actions">{actions}</div>}
    </div>
  );
}

// ---- Empty state -----------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={24} aria-hidden className="empty-icon" />}
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

// ---- Confirm dialog --------------------------------------------------------
// Used only for destructive or irreversible actions. Names the consequence,
// confirm button is specific (never "OK"), cancel sits left and holds the
// default focus (the safe action).

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  confirmDisabled,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** disables the confirm button until a required acknowledgement is given */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && boxRef.current) {
        // keep focus inside the dialog
        const focusables = boxRef.current.querySelectorAll<HTMLElement>('button');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" ref={boxRef}>
        <h2 id="dlg-title" className="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

// ---- Workflow stepper ------------------------------------------------------

export interface Step {
  key: string;
  label: string;
}

export function Stepper({ steps, currentIdx }: { steps: Step[]; currentIdx: number }) {
  return (
    <ol className="stepper" aria-label="Workflow progress">
      {steps.map((s, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';
        return (
          <li key={s.key} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-marker" aria-hidden>
              {state === 'done' ? <CheckCircle2 size={14} /> : i + 1}
            </span>
            <span className="step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---- Tab strip (accessible, with review badges) ----------------------------

export interface TabDef {
  key: string;
  label: string;
  /** optional badge, e.g. number of line items still to review */
  badge?: number;
  badgeTitle?: string;
}

export function TabsBar({
  tabs,
  active,
  onChange,
  sticky,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
  sticky?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].key);
  };
  return (
    <div className={`subtabs ${sticky ? 'subtabs-sticky' : ''}`} role="tablist">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          aria-selected={active === t.key}
          tabIndex={active === t.key ? 0 : -1}
          className={active === t.key ? 'active' : ''}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.badge !== undefined && t.badge > 0 && (
            <span className="tab-badge" title={t.badgeTitle}>{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export { X as CloseIcon };

// ---- In-table add-row (divider with a + in the middle) ---------------------

export function AddRowButton({
  colSpan,
  label,
  onClick,
}: {
  colSpan: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <tr className="add-row">
      <td colSpan={colSpan}>
        <button type="button" onClick={onClick}>
          <PlusIcon size={14} aria-hidden />
          {label}
        </button>
      </td>
    </tr>
  );
}
