// Tenders hub: list of active/recent tenders with a functional document upload.
// Opening a tender shows its detail with two sections - Overview & Intake and
// Business Case. The flow ends at DRB approval; the outcome (Awaiting result /
// Won / Lost) is recorded manually once the case is approved.

import { Fragment, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, Circle, FileText, FileUp, Inbox, Loader2, Upload, X } from 'lucide-react';
import { PIPELINE_STAGES } from '../data/fixtures';
import { computeSummary } from '../lib/calc';
import { dateShort, money, pct, ts } from '../lib/format';
import { can, useConfig, useStore, useTender } from '../state/store';
import { Pager, SortTh, STATUS_META, StatusChip, useColFilters, usePager, useSort } from '../components/common';
import { Button, EmptyState, IconButton, Stepper } from '../ui/ui';
import { useToast } from '../ui/toast';
import type { TenderRecord } from '../types';
import BusinessCasePage from './BusinessCasePage';

function fmtBytes(n: number): string {
  if (n > 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n > 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// ---- Upload zone -----------------------------------------------------------

function UploadZone() {
  const { state, dispatch } = useStore();
  const config = useConfig();
  const user = state.user!;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // A tender can have SEVERAL requirement documents: stage them first so the
  // user can put them in reading order before processing starts.
  const [staged, setStaged] = useState<{ name: string; size: number }[]>([]);
  const [stagedType, setStagedType] = useState(config.tenderTypes[0] ?? 'Agency');
  const allowed = can.uploadTender(user.role);

  const toast = useToast();
  const addFiles = (files: FileList | null | undefined) => {
    const list = Array.from(files ?? []).map((f) => ({ name: f.name, size: f.size || 4200000 }));
    if (list.length) setStaged((cur) => [...cur, ...list]);
  };
  const move = (i: number, dir: -1 | 1) =>
    setStaged((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const start = () => {
    if (!staged.length) return;
    const total = staged.reduce((a, f) => a + f.size, 0);
    dispatch({
      type: 'upload-tender',
      files: staged.map((f) => f.name),
      sizeLabel: fmtBytes(total),
      pages: Math.max(60, Math.round(total / 90000)),
      tenderType: stagedType,
    });
    toast.push('info', 'Tender uploaded, processing started', `${staged.length} document${staged.length > 1 ? 's' : ''} - extraction, retrieval and draft generation take 15-20 minutes for 100+ pages. You can leave and come back.`);
    setStaged([]);
  };

  // Hidden entirely for roles without upload privileges
  if (!allowed) return null;

  return (
    <div>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        role="button"
        tabIndex={0}
        aria-label="Upload tender requirement documents"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx"
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <b><FileUp size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> Create a new tender</b> - drop the requirement documents here or click to browse (PDF, DOCX; multiple files allowed)
        <br />
        <span className="muted small">
          Documents are stored encrypted and processed in your chosen order: extraction, retrieval of
          comparable past deals, and a first-cut business case.
        </span>
      </div>

      {staged.length > 0 && (
        <div className="card upload-stage">
          <h3>New tender · {staged.length} document{staged.length > 1 ? 's' : ''}</h3>
          <p className="muted small">Put the files in reading order (the first file names the tender), pick the type, then upload.</p>
          <ol className="stage-files">
            {staged.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="stage-idx">{i + 1}</span>
                <FileText size={14} aria-hidden />
                <span className="stage-name">{f.name}</span>
                <span className="row-actions">
                  <IconButton label="Move up" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton label="Move down" icon={ArrowDown} disabled={i === staged.length - 1} onClick={() => move(i, 1)} />
                  <IconButton danger label="Remove file" icon={X} onClick={() => setStaged((cur) => cur.filter((_, j) => j !== i))} />
                </span>
              </li>
            ))}
          </ol>
          <div className="form-actions">
            <label className="outcome-picker">
              Type
              <select value={stagedType} onChange={(e) => setStagedType(e.target.value)}>
                {config.tenderTypes.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <Button variant="ghost" onClick={() => setStaged([])}>Cancel</Button>
            <Button variant="primary" icon={Upload} onClick={start}>Upload and process</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Processing pipeline ---------------------------------------------------

type StageState = 'pending' | 'running' | 'warning' | 'done';

function Pipeline({ live, onComplete }: { live: boolean; onComplete?: () => void }) {
  const [stages, setStages] = useState<StageState[]>(
    PIPELINE_STAGES.map(() => (live ? 'pending' : 'done')),
  );
  const [running, setRunning] = useState(live);
  const timers = useRef<number[]>([]);
  const done = useRef(false);

  const play = (notify: boolean) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRunning(true);
    setStages(PIPELINE_STAGES.map(() => 'pending'));
    let at = 300;
    PIPELINE_STAGES.forEach((st, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setStages((prev) => prev.map((s, j) => (j === i ? 'running' : j < i ? (PIPELINE_STAGES[j].warning ? 'warning' : 'done') : s)));
        }, at),
      );
      at += st.durationMs;
      timers.current.push(
        window.setTimeout(() => {
          setStages((prev) => prev.map((s, j) => (j === i ? (st.warning ? 'warning' : 'done') : s)));
          if (i === PIPELINE_STAGES.length - 1) {
            setRunning(false);
            if (notify && !done.current) {
              done.current = true;
              onComplete?.();
            }
          }
        }, at),
      );
    });
  };

  useEffect(() => {
    if (live) play(true);
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const icons: Record<StageState, React.ReactNode> = {
    pending: <Circle size={14} aria-hidden />,
    running: <Loader2 size={16} aria-hidden />,
    warning: <AlertTriangle size={16} aria-hidden />,
    done: <CheckCircle2 size={16} aria-hidden />,
  };

  return (
    <>
      <h3>
        Processing pipeline
        {!live && (
          <button className="btn small" onClick={() => play(false)} disabled={running}>
            {running ? 'Processing…' : '↻ Replay processing'}
          </button>
        )}
      </h3>
      <ol className="pipeline">
        {PIPELINE_STAGES.map((st, i) => (
          <li key={st.key} className={`stage ${stages[i]}`}>
            <span className="stage-icon">{icons[stages[i]]}</span>
            <div>
              <div className="stage-label">{st.label}</div>
              <div className="muted small">{st.detail}</div>
              {st.warning && stages[i] !== 'pending' && (
                <div className="warn-inline small">
                  Section 6.3 (scanned annex) failed extraction - retried with OCR fallback and
                  recovered; the rest of the document was processed without interruption
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

// ---- Tender detail ---------------------------------------------------------

function TenderOverview() {
  const { dispatch } = useStore();
  const tender = useTender();

  return (
    <div className="two-col">
      <section className="card">
        <h3>Tender document</h3>
        <table className="grid narrow">
          <tbody>
            <tr><td>Reference</td><td><b>{tender.ref}</b></td></tr>
            <tr><td>Title</td><td>{tender.title}</td></tr>
            <tr><td>Issuer</td><td>{tender.agency} <span className="badge badge-sector">{tender.sector}</span></td></tr>
            <tr><td>Files</td><td>{(tender.files ?? [tender.fileName]).map((f, i) => `${i + 1}. ${f}`).join('  ·  ')} · {tender.fileSize} · ~{tender.pages} pages</td></tr>
            <tr><td>Uploaded</td><td>{tender.uploadedBy}, {ts(tender.uploadedAt)}</td></tr>
            <tr><td>Closing date</td><td><b>{dateShort(tender.closingDate)}</b></td></tr>
            <tr><td>Processing time</td><td>{tender.processingMinutes} min <span className="muted small">for ~{tender.pages} pages</span></td></tr>
          </tbody>
        </table>
      </section>
      <section className="card">
        <Pipeline
          key={tender.id}
          live={!tender.bc}
          onComplete={() => dispatch({ type: 'generation-complete', id: tender.id })}
        />
      </section>
    </div>
  );
}

const WORKFLOW_STEPS = [
  { key: 'upload', label: 'Upload tender' },
  { key: 'processing', label: 'Processing' },
  { key: 'draft', label: 'Draft business case' },
  { key: 'drb', label: 'DRB review' },
  { key: 'approved', label: 'Approved' },
];

function workflowIdx(t: TenderRecord): number {
  if (!t.bc) return 1; // processing
  switch (t.bc.status) {
    case 'draft':
    case 'in_drb':
      return 3; // sponsors can approve at any time
    case 'approved':
    case 'submitted': // legacy status from seeded past pursuits
      return 5; // the flow ends at approval
    default:
      return 2;
  }
}

function TenderDetail() {
  const { state, dispatch } = useStore();
  const config = useConfig();
  const tender = useTender();
  const [section, setSection] = useState<'overview' | 'bc'>('overview');
  const ready = !!tender.bc;

  return (
    <div>
      <div className="page-head">
        <div className="detail-title-row">
          <button className="back-link" onClick={() => dispatch({ type: 'close-tender' })}><ArrowLeft size={14} aria-hidden /> All tenders</button>
          <div>
          <h2>
            {tender.ref} - {tender.title}
            {ready ? <StatusChip status={tender.bc!.status} /> : <span className="status-chip st-processing">Processing</span>}
          </h2>
          <div className="sub">{tender.agency} · closing {dateShort(tender.closingDate)}</div>
          </div>
        </div>
        {(tender.bc?.status === 'approved' || tender.bc?.status === 'submitted') && (
          <label className="outcome-picker">
            Tender outcome
            <select
              value={tender.outcome ?? ''}
              onChange={(e) => {
                if (e.target.value) dispatch({ type: 'set-outcome', outcome: e.target.value });
              }}
            >
              <option value="" disabled>Not set</option>
              {config.outcomeTypes.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        )}
      </div>
      <Stepper steps={WORKFLOW_STEPS} currentIdx={workflowIdx(tender)} />
      <nav className="subtabs">
        <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}>Overview &amp; Intake</button>
        <button className={section === 'bc' ? 'active' : ''} disabled={!ready} onClick={() => setSection('bc')}>Business Case</button>
      </nav>
      {section === 'overview' && <TenderOverview key={state.activeTenderId ?? ''} />}
      {section === 'bc' && ready && <BusinessCasePage />}
    </div>
  );
}

// ---- Tender list -----------------------------------------------------------

function statusCell(t: TenderRecord) {
  if (!t.bc) return <span className="status-chip st-processing">Processing</span>;
  if (t.outcome === 'Won') return <span className="pill pill-won">Won</span>;
  if (t.outcome === 'Lost') return <span className="pill pill-lost">Lost</span>;
  if (t.outcome === 'Awaiting result') return <span className="pill pill-submitted">Awaiting result</span>;
  return <StatusChip status={t.bc.status} />;
}

function statusText(t: TenderRecord): string {
  if (!t.bc) return 'Processing';
  return t.outcome ?? STATUS_META[t.bc.status].label;
}

function TenderList() {
  const { state, dispatch } = useStore();
  const { sort, toggle, apply } = useSort();
  const cf = useColFilters();
  const [fTitle, setFTitle] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const searched = state.tenders.filter(
    (t) => !fTitle || `${t.title} ${t.ref}`.toLowerCase().includes(fTitle.toLowerCase()),
  );
  const rows0 = searched.map((t) => ({ t, s: t.bc ? computeSummary(t.bc) : null }));
  const colAccessors = {
    agency: (r: { t: TenderRecord }) => r.t.agency,
    sector: (r: { t: TenderRecord }) => r.t.sector,
    status: (r: { t: TenderRecord }) => statusText(r.t),
  };
  const rows = cf.apply(rows0, colAccessors);
  const sorted = apply(rows, {
    ref: (r) => r.t.ref,
    title: (r) => r.t.title,
    agency: (r) => r.t.agency,
    sector: (r) => r.t.sector,
    closing: (r) => r.t.closingDate,
    tcv: (r) => r.s?.total.tcv ?? 0,
    ebitda: (r) => r.s?.total.ebitdaPct ?? 0,
    status: (r) => statusText(r.t),
  });
  const pager = usePager(sorted, 10);
  const fcol = (k: keyof typeof colAccessors) => ({
    filterValues: rows0.map((r) => String(colAccessors[k](r))),
    filter: cf.filters[k],
    onFilter: (f: Parameters<typeof cf.set>[1]) => cf.set(k, f),
  });

  return (
    <div>
      <UploadZone />
      {state.tenders.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No tenders yet"
          body="Upload a tender requirement document to generate the first draft business case."
        />
      ) : (
      <>
      <div className="filter-row">
        <input
          type="search"
          placeholder="Filter by title or reference"
          value={fTitle}
          onChange={(e) => setFTitle(e.target.value)}
        />
        <span className="muted small">{rows.length} of {state.tenders.length} tenders · use the funnel icons to filter columns</span>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th aria-label="Show documents" />
            <SortTh label="Reference" k="ref" sort={sort} onToggle={toggle} />
            <SortTh label="Title" k="title" sort={sort} onToggle={toggle} />
            <SortTh label="Issuer" k="agency" sort={sort} onToggle={toggle} {...fcol('agency')} />
            <SortTh label="Type" k="sector" sort={sort} onToggle={toggle} {...fcol('sector')} />
            <SortTh label="Closing" k="closing" sort={sort} onToggle={toggle} />
            <SortTh label="TCV" k="tcv" sort={sort} onToggle={toggle} num />
            <SortTh label="EBITDA %" k="ebitda" sort={sort} onToggle={toggle} num />
            <SortTh label="Status" k="status" sort={sort} onToggle={toggle} {...fcol('status')} />
          </tr>
        </thead>
        <tbody>
          {pager.slice.map(({ t, s }) => {
            const files = t.files ?? [t.fileName];
            const open = expanded === t.id;
            return (
              <Fragment key={t.id}>
                <tr className="row-click" onClick={() => dispatch({ type: 'open-tender', id: t.id })}>
                  <td className="expand-cell">
                    <button
                      className="expand-btn"
                      aria-label={open ? 'Hide uploaded documents' : 'Show uploaded documents'}
                      aria-expanded={open}
                      onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : t.id); }}
                    >
                      {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                    </button>
                  </td>
                  <td className="mono">{t.ref}</td>
                  <td><b>{t.title}</b><div className="muted small">{files.length} document{files.length > 1 ? 's' : ''}</div></td>
                  <td>{t.agency}</td>
                  <td><span className="badge badge-sector">{t.sector}</span></td>
                  <td>{dateShort(t.closingDate)}</td>
                  <td className="num">{s ? money(s.total.tcv) : '-'}</td>
                  <td className="num">{s ? pct(s.total.ebitdaPct) : '-'}</td>
                  <td>{statusCell(t)}</td>
                </tr>
                {open && (
                  <tr className="expand-row">
                    <td />
                    <td colSpan={8}>
                      <div className="muted small">Uploaded requirement documents (reading order):</div>
                      <ol className="stage-files readonly">
                        {files.map((f, i) => (
                          <li key={`${f}-${i}`}>
                            <span className="stage-idx">{i + 1}</span>
                            <FileText size={14} aria-hidden />
                            <span className="stage-name">{f}</span>
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={9} className="muted">No tenders match these filters.</td></tr>
          )}
        </tbody>
      </table>
      </>
      )}
      <Pager {...pager} />
    </div>
  );
}

export default function TendersPage() {
  const { state } = useStore();
  if (state.activeTenderId) return <TenderDetail />;
  return <TenderList />;
}
