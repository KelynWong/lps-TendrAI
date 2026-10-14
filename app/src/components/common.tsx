// Shared UI atoms: figure-state badges (trust system), status chips,
// editable cells, sorting, pagination, formula tooltips.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSearch,
  Filter,
  Lock,
  PenLine,
  Sparkles,
} from 'lucide-react';
import type { BcStatus, Provenance } from '../types';
import { useCitation } from '../ui/citation';

/**
 * Excel-style formula tooltip: hover a computed cell (or a row/column header)
 * to see how the value is linked and calculated across tabs. The popup picks
 * its side based on where the trigger sits, so it never leaves the viewport.
 */
export function Fx({ f, children }: { f: string; children: ReactNode }) {
  const [pos, setPos] = useState('fx-right fx-above');
  const [style, setStyle] = useState<React.CSSProperties>({ display: 'flex' });
  const [show, setShow] = useState(false);
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const horiz = r.left < window.innerWidth / 2 ? 'fx-left' : 'fx-right';
    const vert = r.top < 180 ? 'fx-below' : 'fx-above';
    setPos(`${horiz} ${vert}`);
    // Fixed positioning so the tip escapes scroll panes (overflow clipping).
    // display:flex is set inline too: stylesheet flex on this out-of-flow
    // inline span gets blockified by the browser, which stretched the fx
    // marker across the full row - the inline declaration wins reliably.
    setStyle({
      position: 'fixed',
      display: 'flex',
      ...(vert === 'fx-below' ? { top: r.bottom + 7 } : { bottom: window.innerHeight - r.top + 7 }),
      ...(horiz === 'fx-left' ? { left: r.left } : { right: window.innerWidth - r.right }),
    });
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
      {/* Portalled to <body>: a sticky header cell creates its own stacking
          context, which would otherwise let later sticky cells paint over
          the tip regardless of z-index. */}
      {show &&
        createPortal(
          <span className="fx-tip" role="tooltip" style={style}>
            <span className="fx-fx" aria-hidden>fx</span>
            <span className="fx-text">{f}</span>
          </span>,
          document.body,
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

// ---- Excel-style column filters -------------------------------------------

/** Per-column filter: free-text contains + multi-select of distinct values */
export interface ColFilter {
  text: string;
  /** null = all values selected */
  sel: string[] | null;
}

/** Holds the per-column filters of one table and applies them to its rows */
export function useColFilters() {
  const [filters, setFilters] = useState<Record<string, ColFilter>>({});
  const set = (k: string, f: ColFilter | null) =>
    setFilters((cur) => {
      const next = { ...cur };
      if (f && (f.text || f.sel)) next[k] = f;
      else delete next[k];
      return next;
    });
  const apply = <T,>(items: T[], accessors: Record<string, (t: T) => string | number>): T[] =>
    items.filter((it) =>
      Object.entries(filters).every(([k, f]) => {
        const acc = accessors[k];
        if (!acc) return true;
        const v = String(acc(it));
        if (f.text && !v.toLowerCase().includes(f.text.toLowerCase())) return false;
        if (f.sel && !f.sel.includes(v)) return false;
        return true;
      }),
    );
  return { filters, set, apply };
}

export function SortTh({
  label,
  k,
  sort,
  onToggle,
  num,
  filterValues,
  filter,
  onFilter,
}: {
  label: ReactNode;
  k: string;
  sort: SortState | null;
  onToggle: (key: string) => void;
  num?: boolean;
  /** Distinct values of this column: enables the Excel-style filter popover */
  filterValues?: string[];
  filter?: ColFilter;
  onFilter?: (f: ColFilter | null) => void;
}) {
  const active = sort?.key === k;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const values = filterValues ? [...new Set(filterValues)].sort((a, b) => a.localeCompare(b)) : [];
  const selSet = filter?.sel ?? null;
  const fActive = !!filter && (!!filter.text || !!filter.sel);
  const toggleVal = (v: string) => {
    const cur = selSet ?? values;
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onFilter?.({ text: filter?.text ?? '', sel: next.length === values.length ? null : next });
  };

  return (
    <th className={`sort-th ${num ? 'num' : ''}`} onClick={() => onToggle(k)}>
      {label}
      <span className={`sort-arrow ${active ? 'on' : ''}`} aria-hidden>
        {active ? (sort!.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}
      </span>
      {filterValues && onFilter && (
        <button
          ref={btnRef}
          type="button"
          className={`colfilter-btn ${fActive ? 'on' : ''}`}
          aria-label="Filter this column"
          title="Filter this column"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), top: r.bottom + 4 });
            setOpen((v) => !v);
          }}
        >
          <Filter size={11} aria-hidden />
        </button>
      )}
      {open && pos &&
        createPortal(
          <div ref={popRef} className="colfilter-pop" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
            <input
              type="search"
              placeholder="Contains..."
              value={filter?.text ?? ''}
              onChange={(e) => onFilter?.({ text: e.target.value, sel: selSet })}
            />
            <div className="colfilter-list">
              {values.map((v) => (
                <label key={v}>
                  <input type="checkbox" checked={!selSet || selSet.includes(v)} onChange={() => toggleVal(v)} />
                  <span>{v || '(blank)'}</span>
                </label>
              ))}
            </div>
            <div className="colfilter-actions">
              <button className="btn btn-compact" type="button" onClick={() => onFilter?.(null)}>Clear</button>
              <button className="btn btn-compact" type="button" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>,
          document.body,
        )}
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
      <button className="btn btn-compact" aria-label="First page" title="First page" disabled={cur === 0} onClick={() => setPage(0)}><ChevronsLeft size={16} aria-hidden /></button>
      <button className="btn btn-compact" aria-label="Previous page" title="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft size={16} aria-hidden /></button>
      <span className="pager-page">Page {cur + 1} of {pages}</span>
      <button className="btn btn-compact" aria-label="Next page" title="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight size={16} aria-hidden /></button>
      <button className="btn btn-compact" aria-label="Last page" title="Last page" disabled={cur >= pages - 1} onClick={() => setPage(pages - 1)}><ChevronsRight size={16} aria-hidden /></button>
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

/**
 * Figure-state badge. Four states, each distinguishable by icon + label +
 * border style (never colour alone):
 *  - Cited:     AI-suggested, grounded in a historical record (solid border,
 *               underlined, click opens the source panel)
 *  - Estimate:  AI-suggested, NO source - unverified (dashed border)
 *  - Confirmed: human-confirmed (solid border, check icon)
 * The sparkle icon marks both AI-suggested states as not yet confirmed.
 */
export function ProvenanceBadge({ p, context, tab }: { p: Provenance; context?: string; tab?: string }) {
  const { show } = useCitation();
  if (p.kind === 'grounded') {
    return (
      <button
        type="button"
        className="badge badge-cited"
        title={`AI suggested, cited from ${p.citation.docId}. Select to view the source.`}
        onClick={() => show({ ...p.citation, context, tab })}
      >
        <Sparkles size={12} aria-hidden />
        Cited · {p.citation.docId}
      </button>
    );
  }
  if (p.kind === 'estimate') {
    return (
      <span className="badge badge-estimate" title="AI suggested, industry estimate. No source document - verify before relying on it.">
        <Sparkles size={12} aria-hidden />
        Estimate · no source
      </span>
    );
  }
  if (p.kind === 'manual') {
    return (
      <span
        className="badge badge-manual"
        title={`Not AI-populated: ${p.source ?? 'the source system'} is not integrated in this project scope. Look the value up in ${p.source ?? 'the source system'} and key it in manually.`}
      >
        <PenLine size={12} aria-hidden />
        Manual · {p.source ?? 'entry'}
      </span>
    );
  }
  // Confirmed value that was originally cited: the citation is preserved, so
  // the badge still opens the source. Two distinct states: the cited value was
  // confirmed as-is, or it was changed after citing (old value kept in panel).
  if (p.citation) {
    return (
      <button
        type="button"
        className={`badge ${p.edited ? 'badge-cited-edited' : 'badge-cited-confirmed'}`}
        title={`${p.edited ? `Cited value changed by ${p.confirmedBy}; the original cited value is kept` : `Cited value confirmed unchanged by ${p.confirmedBy}`}. Select to view the source.`}
        onClick={() => show({ ...p.citation!, context, tab, confirmedBy: p.confirmedBy, edited: p.edited })}
      >
        <Sparkles size={12} aria-hidden />
        <CheckCircle2 size={12} aria-hidden />
        {p.edited ? 'Cited · edited' : 'Cited · confirmed'} · {p.confirmedBy.split(' ')[0]}
      </button>
    );
  }
  return (
    <span className="badge badge-human" title={`Confirmed by ${p.confirmedBy}`}>
      <CheckCircle2 size={12} aria-hidden />
      Confirmed · {p.confirmedBy.split(' ')[0]}
    </span>
  );
}

/** Legend for the figure states; rendered in its own row, toggled by the Hint button. */
export function ProvenanceLegendItems() {
  return (
    <div className="legend-items">
      <span><span className="badge badge-cited"><Sparkles size={12} aria-hidden />Cited · DOC-ID</span> AI suggested, grounded in a historical record. Click to view the source.</span>
      <span><span className="badge badge-estimate"><Sparkles size={12} aria-hidden />Estimate · no source</span> AI suggested, unverified industry estimate.</span>
      <span><span className="badge badge-manual"><PenLine size={12} aria-hidden />Manual · Salesforce</span> Not AI-populated: look the value up in the named system and key it in by hand.</span>
      <span><span className="badge badge-cited-confirmed"><Sparkles size={12} aria-hidden /><CheckCircle2 size={12} aria-hidden />Cited · confirmed · Name</span> Cited value confirmed unchanged by a person; the citation is kept.</span>
      <span><span className="badge badge-cited-edited"><Sparkles size={12} aria-hidden /><CheckCircle2 size={12} aria-hidden />Cited · edited · Name</span> Cited value changed by a person; the original cited value stays viewable.</span>
      <span><span className="badge badge-human"><CheckCircle2 size={12} aria-hidden />Confirmed · Name</span> Human-entered or confirmed value with no citation.</span>
      <span><FileSearch size={14} aria-hidden /> AI-suggested figures carry the sparkle icon until someone confirms them.</span>
    </div>
  );
}

export const STATUS_META: Record<BcStatus, { label: string; cls: string }> = {
  processing: { label: 'Processing', cls: 'st-processing' },
  draft: { label: 'Draft - AI generated', cls: 'st-draft' },
  in_drb: { label: 'In Deal Review Board', cls: 'st-drb' },
  approved: { label: 'Approved and locked', cls: 'st-approved' },
  submitted: { label: 'Submitted', cls: 'st-submitted' },
};

export function StatusChip({ status }: { status: BcStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`status-chip ${m.cls}`}>
      {status === 'approved' && <Lock size={12} aria-hidden />}
      {m.label}
    </span>
  );
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
