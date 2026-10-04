// Shared UI atoms: provenance badges (NFR12/13), status chips, editable cells.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { BcStatus, Provenance } from '../types';

/**
 * Excel-style formula tooltip: hover a computed cell (or a row/column header)
 * to see how the value is linked and calculated across tabs. The popup picks
 * its side based on where the trigger sits, so it never leaves the viewport.
 */
export function Fx({ f, children }: { f: string; children: ReactNode }) {
  const [pos, setPos] = useState('fx-right fx-above');
  const [show, setShow] = useState(false);
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const horiz = r.left < window.innerWidth / 2 ? 'fx-left' : 'fx-right';
    const vert = r.top < 180 ? 'fx-below' : 'fx-above';
    setPos(`${horiz} ${vert}`);
  };
  // Visibility is state-driven (not CSS :hover) and the tip ignores pointer
  // events, so it can never hold itself open or appear without a live hover.
  return (
    <span
      className={`fx ${pos}`}
      onMouseEnter={(e) => { place(e.currentTarget); setShow(true); }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="fx-tip" role="tooltip">
          <span className="fx-fx">fx</span>
          {f}
        </span>
      )}
    </span>
  );
}

// ---- Table sorting ---------------------------------------------------------

export interface SortState {
  key: string;
  dir: 1 | -1;
}

export function useSort(initial?: SortState) {
  const [sort, setSort] = useState<SortState | null>(initial ?? null);
  const toggle = (key: string) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const apply = <T,>(items: T[], accessors: Record<string, (t: T) => string | number>): T[] => {
    if (!sort || !accessors[sort.key]) return items;
    const get = accessors[sort.key];
    return [...items].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
  };
  return { sort, toggle, apply };
}

export function SortTh({
  label,
  k,
  sort,
  onToggle,
  num,
}: {
  label: ReactNode;
  k: string;
  sort: SortState | null;
  onToggle: (key: string) => void;
  num?: boolean;
}) {
  const active = sort?.key === k;
  return (
    <th className={`sort-th ${num ? 'num' : ''}`} onClick={() => onToggle(k)}>
      {label}
      <span className={`sort-arrow ${active ? 'on' : ''}`}>
        {active ? (sort!.dir === 1 ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
}

// ---- Pagination ------------------------------------------------------------

export function usePager<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = items.slice(cur * pageSize, cur * pageSize + pageSize);
  return {
    slice,
    cur,
    pages,
    total: items.length,
    from: items.length ? cur * pageSize + 1 : 0,
    to: cur * pageSize + slice.length,
    setPage,
  };
}

export function Pager({
  cur,
  pages,
  from,
  to,
  total,
  setPage,
}: {
  cur: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  setPage: (p: number) => void;
}) {
  return (
    <div className="pager">
      <button className="btn small" disabled={cur === 0} onClick={() => setPage(0)}>«</button>
      <button className="btn small" disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹</button>
      <span className="pager-page">Page {cur + 1} of {pages}</span>
      <button className="btn small" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>›</button>
      <button className="btn small" disabled={cur >= pages - 1} onClick={() => setPage(pages - 1)}>»</button>
      <span className="muted small">{from}-{to} of {total} rows</span>
    </div>
  );
}

/** Date cell: shows a formatted date, becomes a date input when editable. */
export function DateCell({
  value,
  onCommit,
  editable,
}: {
  value: string; // ISO yyyy-mm-dd
  onCommit: (v: string) => void;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const fmt = new Date(value).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!editable) return <span>{fmt}</span>;
  if (!editing) {
    return (
      <button className="cell-btn" title="Click to edit" onClick={() => setEditing(true)}>
        {fmt}
      </button>
    );
  }
  return (
    <input
      className="cell-input cell-input-date"
      type="date"
      autoFocus
      defaultValue={value.slice(0, 10)}
      onBlur={(e) => {
        setEditing(false);
        if (e.target.value && e.target.value !== value.slice(0, 10)) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

export function ProvenanceBadge({ p }: { p: Provenance }) {
  if (p.kind === 'grounded') {
    return (
      <span
        className="badge badge-grounded"
        title={`Grounded in ${p.citation.docId} - ${p.citation.title} (similarity ${(p.citation.similarity * 100).toFixed(0)}%)\n“${p.citation.excerpt}”`}
      >
        ◆ {p.citation.docId}
      </span>
    );
  }
  if (p.kind === 'estimate') {
    return (
      <span className="badge badge-estimate" title="AI industry best-practice estimate - UNVERIFIED, no historical citation">
        ◇ Estimate
      </span>
    );
  }
  return (
    <span className="badge badge-human" title={`Human-confirmed by ${p.confirmedBy}`}>
      ✓ {p.confirmedBy.split(' ')[0]}
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <div className="legend">
      <span className="badge badge-grounded">◆ Cited</span>
      <span>AI-generated, grounded in a historical record</span>
      <span className="badge badge-estimate">◇ Estimate</span>
      <span>AI estimate - unverified, no citation</span>
      <span className="badge badge-human">✓ Name</span>
      <span>Human-confirmed / edited</span>
    </div>
  );
}

export const STATUS_META: Record<BcStatus, { label: string; cls: string }> = {
  processing: { label: 'Processing', cls: 'st-processing' },
  draft: { label: 'Draft - AI generated', cls: 'st-draft' },
  in_drb: { label: 'In Deal Review Board', cls: 'st-drb' },
  approved: { label: 'Approved · Locked', cls: 'st-approved' },
  submitted: { label: 'Submitted', cls: 'st-submitted' },
};

export function StatusChip({ status }: { status: BcStatus }) {
  const m = STATUS_META[status];
  return <span className={`status-chip ${m.cls}`}>{m.label}</span>;
}

/** Numeric cell: renders formatted text, becomes an input when editable and clicked. */
export function NumCell({
  value,
  onCommit,
  editable,
  format,
  title,
}: {
  value: number;
  onCommit: (v: number) => void;
  editable: boolean;
  format?: (v: number) => string;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  if (!editable) {
    return <span title={title}>{format ? format(value) : value.toLocaleString()}</span>;
  }
  if (!editing) {
    return (
      <button className="cell-btn" title={title ?? 'Click to edit'} onClick={() => setEditing(true)}>
        {format ? format(value) : value.toLocaleString()}
      </button>
    );
  }
  const commit = () => {
    const v = parseFloat(draft.replace(/[^0-9.-]/g, ''));
    setEditing(false);
    if (!Number.isNaN(v) && v !== value) onCommit(v);
  };
  return (
    <input
      className="cell-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

export function TextCell({
  value,
  onCommit,
  editable,
}: {
  value: string;
  onCommit: (v: string) => void;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editable) return <span>{value}</span>;
  if (!editing) {
    return (
      <button className="cell-btn cell-btn-text" title="Click to edit" onClick={() => setEditing(true)}>
        {value || '-'}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className="cell-input cell-input-text"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
