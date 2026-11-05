// Business case workspace atoms (ported from the V1 POC): formula tooltips,
// editable number/date cells, the in-table add-row divider and the
// figure-state (provenance) badges. Text cells are the shared TextCell.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { CheckCircle2, FileSearch, PenLine, Plus, Sparkles } from 'lucide-react';
import type { GroundedCitation, Provenance } from './model';
import { canDo } from '../config';
import { confidenceText } from '../lib/confidence';
import { useStore } from '../state/store';
import { useCitation, type CitationInfo } from '../ui/citation';
import { historicalDocumentUrl, tenderDocumentUrl } from '../data/mockDocuments';

export { TextCell } from '../components/common';

/**
 * Excel-style formula tooltip: hover a computed cell (or a row/column header)
 * to see how the value is linked and calculated across tabs. The popup picks
 * its side based on where the trigger sits, so it never leaves the viewport.
 */
export function Fx({ f, children }: { f: string; children: ReactNode }) {
  const [pos, setPos] = useState('fx-right fx-above');
  const [style, setStyle] = useState<CSSProperties>({ display: 'flex' });
  const [show, setShow] = useState(false);
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const horiz = r.left < window.innerWidth / 2 ? 'fx-left' : 'fx-right';
    const vert = r.top < 180 ? 'fx-below' : 'fx-above';
    setPos(`${horiz} ${vert}`);
    // Fixed positioning so the tip escapes scroll panes (overflow clipping);
    // display:flex inline because the browser blockifies this out-of-flow span.
    setStyle({
      position: 'fixed',
      display: 'flex',
      ...(vert === 'fx-below' ? { top: r.bottom + 7 } : { bottom: window.innerHeight - r.top + 7 }),
      ...(horiz === 'fx-left' ? { left: r.left } : { right: window.innerWidth - r.right }),
    });
  };
  return (
    <span
      className={`fx ${pos}`}
      onMouseEnter={(e) => { place(e.currentTarget); setShow(true); }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {/* Portalled to <body> so sticky header cells cannot paint over the tip */}
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

/** In-table add-row: a divider with a + in the middle. */
export function AddRowButton({ colSpan, label, onClick }: { colSpan: number; label: string; onClick: () => void }) {
  return (
    <tr className="add-row">
      <td colSpan={colSpan}>
        <button type="button" onClick={onClick}>
          <Plus size={14} aria-hidden />
          {label}
        </button>
      </td>
    </tr>
  );
}

/** Date cell: shows a formatted date, becomes a date input when editable. */
export function DateCell({ value, onCommit, editable }: { value: string; onCommit: (v: string) => void; editable: boolean }) {
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

/**
 * Figure-state badge, distinguishable by icon + label + border style (never
 * colour alone):
 *  - Cited:     AI-drafted, grounded in a historical record or the tender pack
 *  - Estimate:  AI-drafted, NO source - unverified (dashed border)
 *  - Manual:    not AI-populated, keyed in from an external system
 *  - Confirmed: human-confirmed (citation kept when there was one)
 */
export function ProvenanceBadge({ p, context, tab }: { p: Provenance; context?: string; tab?: string }) {
  const { show } = useCitation();
  const { state } = useStore();
  const allowed = canDo.viewHistoricalPricing(state.role);
  /** Historical business cases hold other customers' prices: roles without
   *  access see the match and the tender clause, not the case or its figures. */
  const visible = (c: GroundedCitation) => (c.source !== 'historical' || allowed ? c : {
    ...c,
    docId: 'Historical business case',
    title: 'Historical business case (restricted)',
    excerpt: 'Prices and customer details from past business cases are visible to BD, Presales, Finance and the DRB only.',
  });
  /** The stored file the citation points at: the tender pack document, or the
   *  past business case's latest workbook (only for roles that may see it). */
  const withFile = (c: GroundedCitation): CitationInfo => {
    if (c.source === 'tender') {
      return c.tenderId && c.fileName ? { ...c, documentUrl: tenderDocumentUrl(c.tenderId, c.fileName) } : c;
    }
    if (!allowed) return c;
    const rec = state.repository.find((r) => r.refId === c.docId);
    return { ...c, fileName: rec?.documents[rec.documents.length - 1] ?? `${c.docId}.xlsx`, documentUrl: historicalDocumentUrl(c.docId) };
  };
  if (p.kind === 'grounded') {
    const c = visible(p.citation);
    const conf = confidenceText(p.citation.similarity, 'match');
    return (
      <button
        type="button"
        className="badge badge-cited"
        title={`AI drafted from ${c.source === 'tender' ? 'the tender pack' : c.docId} (${conf}). Select to view the source.`}
        onClick={() => show({ ...withFile(c), context, tab })}
      >
        <Sparkles size={12} aria-hidden />
        Cited · {c.source === 'tender' ? 'tender pack' : allowed ? c.docId : 'past case'} · {c.source === 'tender' ? 'extracted' : conf}
      </button>
    );
  }
  if (p.kind === 'estimate') {
    return (
      <span className="badge badge-estimate" title="AI drafted, industry estimate: no comparable past business case was found. Low confidence - verify before relying on it.">
        <Sparkles size={12} aria-hidden />
        Estimate · no source · low
      </span>
    );
  }
  if (p.kind === 'manual') {
    return (
      <span
        className="badge badge-manual"
        title={`Not AI-populated: ${p.source ?? 'the source system'} is not integrated. Look the value up in ${p.source ?? 'the source system'} and key it in.`}
      >
        <PenLine size={12} aria-hidden />
        Manual · {p.source ?? 'entry'}
      </span>
    );
  }
  if (p.citation) {
    return (
      <button
        type="button"
        className={`badge ${p.edited ? 'badge-cited-edited' : 'badge-cited-confirmed'}`}
        title={`${p.edited ? `Cited value changed by ${p.confirmedBy}; the original cited value is kept` : `Cited value confirmed unchanged by ${p.confirmedBy}`}. Select to view the source.`}
        onClick={() => show({ ...withFile(visible(p.citation!)), context, tab, confirmedBy: p.confirmedBy, edited: p.edited })}
      >
        <Sparkles size={12} aria-hidden />
        <CheckCircle2 size={12} aria-hidden />
        {p.edited ? 'Cited · edited' : 'Cited · confirmed'} · {p.confirmedBy.split(' ')[0]}
        {/* the AI's match stays visible after confirmation: it is what the value was based on */}
        {p.citation.source !== 'tender' && ` · ${confidenceText(p.citation.similarity, 'match')}`}
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

/** Legend for the figure states (toggled by the Hint button). */
export function ProvenanceLegendItems() {
  return (
    <div className="legend-items">
      <span><span className="badge badge-cited"><Sparkles size={12} aria-hidden />Cited · DOC-ID · 91% match, high</span> AI drafted from a past business case; the % is how closely it matches this tender (high 88% and up, medium 80% and up, otherwise low). Select to view the source. "Cited · tender pack" values were read from this tender.</span>
      <span><span className="badge badge-estimate"><Sparkles size={12} aria-hidden />Estimate · no source · low</span> AI drafted industry estimate: no comparable past case was found. Check these first.</span>
      <span><span className="badge badge-manual"><PenLine size={12} aria-hidden />Manual · Salesforce</span> Not AI-populated: look the value up in the named system and key it in.</span>
      <span><span className="badge badge-cited-confirmed"><Sparkles size={12} aria-hidden /><CheckCircle2 size={12} aria-hidden />Cited · confirmed · Name</span> Cited value confirmed unchanged by a person; the citation is kept.</span>
      <span><span className="badge badge-cited-edited"><Sparkles size={12} aria-hidden /><CheckCircle2 size={12} aria-hidden />Cited · edited · Name</span> Cited value changed by a person; the original cited value stays viewable.</span>
      <span><span className="badge badge-human"><CheckCircle2 size={12} aria-hidden />Confirmed · Name</span> Entered or confirmed by a person, no citation.</span>
      <span><FileSearch size={14} aria-hidden /> AI-drafted figures carry the sparkle icon until someone confirms them.</span>
    </div>
  );
}
