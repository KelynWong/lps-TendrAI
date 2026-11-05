// Shared table atoms, carried over from the existing app so both apps read as
// one product family: sortable headers with Excel-style column filters,
// pagination, editable cells - plus v2's review/status badges.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
} from 'lucide-react';

// ---- Sorting ---------------------------------------------------------------

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

export interface ColFilter {
  text: string;
  sel: string[] | null; // null = all values selected
  operator: 'contains' | 'equals' | 'notEquals' | 'beginsWith' | 'endsWith' | 'notContains';
}

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
        if (f.text) {
          const value = v.toLowerCase();
          const text = f.text.toLowerCase();
          const matches = f.operator === 'equals' ? value === text
            : f.operator === 'notEquals' ? value !== text
            : f.operator === 'beginsWith' ? value.startsWith(text)
            : f.operator === 'endsWith' ? value.endsWith(text)
            : f.operator === 'notContains' ? !value.includes(text)
            : value.includes(text);
          if (!matches) return false;
        }
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
  const operator = filter?.operator ?? 'contains';
  const toggleVal = (v: string) => {
    const cur = selSet ?? values;
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onFilter?.({ text: filter?.text ?? '', sel: next.length === values.length ? null : next, operator });
  };
  const selectAll = () => onFilter?.({ text: filter?.text ?? '', sel: null, operator });
  const deselectAll = () => onFilter?.({ text: filter?.text ?? '', sel: [], operator });

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
            <select
              aria-label="Filter operator"
              value={operator}
              onChange={(e) => onFilter?.({ text: filter?.text ?? '', sel: selSet, operator: e.target.value as ColFilter['operator'] })}
            >
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="notEquals">Does not equal</option>
              <option value="beginsWith">Begins with</option>
              <option value="endsWith">Ends with</option>
              <option value="notContains">Does not contain</option>
            </select>
            <input
              type="search"
              placeholder="Filter value..."
              value={filter?.text ?? ''}
              onChange={(e) => onFilter?.({ text: e.target.value, sel: selSet, operator })}
            />
            <div className="colfilter-select-actions">
              <button type="button" onClick={selectAll}>Select all</button>
              <button type="button" onClick={deselectAll}>Deselect all</button>
            </div>
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

export const PAGE_SIZES = [10, 20, 50, 100];

/** Pager for the list pages (Tenders, Historical data, Audit log): the user
 *  picks the rows per page; changing it keeps them on the same first record,
 *  not the same page number. The table scrolls inside its own area. */
export function usePagedTable<T>(items: T[], initialSize = 20) {
  const [pageSize, setSize] = useState(initialSize);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = items.slice(cur * pageSize, cur * pageSize + pageSize);
  const setPageSize = (n: number) => {
    const firstRecord = cur * pageSize;
    setSize(n);
    setPage(Math.floor(firstRecord / n));
  };
  return {
    slice,
    cur,
    pages,
    total: items.length,
    from: items.length ? cur * pageSize + 1 : 0,
    to: cur * pageSize + slice.length,
    setPage: (p: number) => setPage(Math.max(0, Math.min(p, pages - 1))),
    pageSize,
    setPageSize,
  };
}

export function Pager({
  cur,
  pages,
  from,
  to,
  total,
  setPage,
  pageSize,
  setPageSize,
}: {
  cur: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  setPage: (p: number) => void;
  pageSize?: number;
  setPageSize?: (n: number) => void;
}) {
  return (
    <div className="pager">
      {pageSize !== undefined && setPageSize && (
        <label className="pager-size muted small">
          Rows per page
          <select value={pageSize} aria-label="Rows per page" onChange={(e) => setPageSize(+e.target.value)}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      <button className="btn btn-compact" aria-label="First page" title="First page" disabled={cur === 0} onClick={() => setPage(0)}><ChevronsLeft size={16} aria-hidden /></button>
      <button className="btn btn-compact" aria-label="Previous page" title="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft size={16} aria-hidden /></button>
      <span className="pager-page">Page {cur + 1} of {pages}</span>
      <button className="btn btn-compact" aria-label="Next page" title="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight size={16} aria-hidden /></button>
      <button className="btn btn-compact" aria-label="Last page" title="Last page" disabled={cur >= pages - 1} onClick={() => setPage(pages - 1)}><ChevronsRight size={16} aria-hidden /></button>
      <span className="muted small">Showing {from}-{to} of {total}</span>
    </div>
  );
}


// ---- Editable cells --------------------------------------------------------

export function TextCell({
  value,
  onCommit,
  editable,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  editable: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editable) return <span>{value || placeholder || '-'}</span>;
  if (!editing) {
    return (
      <button className="cell-btn cell-btn-text" title="Click to edit" onClick={() => setEditing(true)}>
        {value || placeholder || '-'}
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

// ---- v2 badges -------------------------------------------------------------

/** Generic status pill used across checklist, documents and repository.
 *  One vocabulary across the app - add new statuses here, not inline. */
export function StatusPill({ value }: { value: string }) {
  const cls: Record<string, string> = {
    'Done': 'pill-won',
    'Generated': 'pill-won',
    'Won': 'pill-won',
    'Comply': 'pill-won',
    'Available': 'pill-won',
    'Lost': 'pill-lost',
    'Failed': 'pill-lost',
    'Do not comply': 'pill-lost',
    'In progress': 'pill-submitted',
    'Extracting text': 'pill-submitted',
    'Analysing': 'pill-submitted',
    'Processing': 'pill-submitted',
    'Text ready': 'pill-active',
    'Restore requested': 'pill-pending',
    'Needs review': 'pill-review',
    'Clarify': 'pill-review',
    'Partially comply': 'pill-review',
    'Uploaded, not processed': 'pill-neutral',
    'Uploaded': 'pill-neutral',
    'Archived': 'pill-archived',
    'Draft': 'pill-draft',
    'Active': 'pill-active',
    'Closed': 'pill-closed',
    'In Progress (Draft)': 'pill-draft',
    'Pending (Draft)': 'pill-pending',
    'In Approval (Draft)': 'pill-pending',
    'Approved (Draft)': 'pill-approved',
    'Rejected (Draft)': 'pill-rejected',
    'In Progress (Active)': 'pill-active',
    'Won (Won)': 'pill-won',
    'Revised (Closed)': 'pill-closed',
    'Lost (Closed)': 'pill-lost',
  };
  // Document rows store 'Uploaded'; users read 'Uploaded, not processed'
  const label = value === 'Uploaded' ? 'Uploaded, not processed' : value;
  return <span className={`pill ${cls[value] ?? 'pill-neutral'}`}>{label}</span>;
}
