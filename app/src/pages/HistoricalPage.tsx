// Historical data store: past proposals, tenders and business cases with tags
// and embedding status. Upload and edit are functional for demo purposes:
// new/edited documents embed after a short delay and land in the audit log.

import { useEffect, useRef, useState } from 'react';
import { dateShort } from '../lib/format';
import { useStore } from '../state/store';
import { Pager, SortTh, usePager, useSort } from '../components/common';
import type { HistoricalDoc } from '../types';

const statusCls: Record<string, string> = {
  Embedded: 'ok',
  'Re-embedding': 'warn',
  'Embedding…': 'warn',
  'Extraction failed': 'err',
  'Duplicate - pending review': 'warn',
};

const DOC_TYPES = ['Won Proposal', 'Lost Proposal', 'Tender Requirement', 'Business Case'] as const;

interface DraftDoc {
  id?: string; // present = editing an existing record
  title: string;
  docType: HistoricalDoc['docType'];
  sector: HistoricalDoc['sector'];
  customer: string;
  outcome: HistoricalDoc['outcome'];
  fileName?: string;
}

export default function HistoricalPage() {
  const { state, dispatch } = useStore();
  const user = state.user!;
  const [fType, setFType] = useState('');
  const [fSector, setFSector] = useState('');
  const [fOutcome, setFOutcome] = useState('');
  const [dragging, setDragging] = useState(false);
  const { sort, toggle, apply } = useSort();
  const [draft, setDraft] = useState<DraftDoc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const docs0 = state.historical.filter((d) => {
    if (fType && d.docType !== fType) return false;
    if (fSector && d.sector !== fSector) return false;
    if (fOutcome && d.outcome !== fOutcome) return false;
    return true;
  });
  const docs = apply(docs0, {
    id: (d) => d.id,
    title: (d) => d.title,
    docType: (d) => d.docType,
    sector: (d) => d.sector,
    customer: (d) => d.customer,
    outcome: (d) => d.outcome,
    uploaded: (d) => d.uploadDate,
    embedding: (d) => d.embeddingStatus,
    chunks: (d) => d.chunks,
    versions: (d) => d.versions,
  });
  const pager = usePager(docs, 10);

  const scheduleEmbed = (id: string) => {
    timers.current.push(window.setTimeout(() => dispatch({ type: 'historical-embedded', id }), 2500));
  };

  const startUpload = (file: File | undefined | null) => {
    if (!file) return;
    setDraft({
      title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      docType: 'Won Proposal',
      sector: 'Agency',
      customer: '',
      outcome: 'Won',
      fileName: file.name,
    });
  };

  const save = () => {
    if (!draft) return;
    if (draft.id) {
      const existing = state.historical.find((d) => d.id === draft.id)!;
      dispatch({
        type: 'update-historical',
        doc: {
          ...existing,
          title: draft.title,
          docType: draft.docType,
          sector: draft.sector,
          customer: draft.customer,
          outcome: draft.docType === 'Tender Requirement' ? '-' : draft.outcome,
          embeddingStatus: 'Re-embedding',
          versions: existing.versions + 1,
        },
      });
      scheduleEmbed(draft.id);
    } else {
      const id = `HD-2026-${String(100 + state.historical.length)}`;
      dispatch({
        type: 'add-historical',
        doc: {
          id,
          title: draft.title || '(untitled)',
          docType: draft.docType,
          sector: draft.sector,
          customer: draft.customer || 'Unspecified',
          outcome: draft.docType === 'Tender Requirement' ? '-' : draft.outcome,
          uploadedBy: user.name,
          uploadDate: new Date().toISOString().slice(0, 10),
          embeddingStatus: 'Embedding…',
          chunks: 0,
          versions: 1,
        },
      });
      scheduleEmbed(id);
    }
    setDraft(null);
  };

  return (
    <div>
      {!draft && (
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); startUpload(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm"
            style={{ display: 'none' }}
            onChange={(e) => { startUpload(e.target.files?.[0]); e.target.value = ''; }}
          />
          <b>Upload a historical document</b> - drop it here or click to browse (PDF, DOCX, XLSX)
          <br />
          <span className="muted small">
            Past proposals, tender requirement documents and business cases are tagged, embedded and
            become retrievable comparables for new tenders.
          </span>
        </div>
      )}

      {draft && (
        <div className="card">
          <h3>{draft.id ? `Edit ${draft.id}` : 'New historical document'}</h3>
          {draft.fileName && <p className="muted small">File: {draft.fileName}</p>}
          <div className="hd-form">
            <label>
              Title
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label>
              Type
              <select value={draft.docType} onChange={(e) => setDraft({ ...draft, docType: e.target.value as DraftDoc['docType'] })}>
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Sector
              <select value={draft.sector} onChange={(e) => setDraft({ ...draft, sector: e.target.value as DraftDoc['sector'] })}>
                <option>Agency</option>
                <option>Commercial</option>
              </select>
            </label>
            <label>
              Customer
              <input value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })} />
            </label>
            {draft.docType !== 'Tender Requirement' && (
              <label>
                Outcome
                <select value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value as DraftDoc['outcome'] })}>
                  <option>Won</option>
                  <option>Lost</option>
                </select>
              </label>
            )}
          </div>
          <div className="actions-row">
            <button className="btn primary" onClick={save}>
              {draft.id ? 'Save (archives prior version, re-embeds)' : 'Upload and embed'}
            </button>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="filter-row">
        <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">All types</option>
          {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={fSector} onChange={(e) => setFSector(e.target.value)}>
          <option value="">Agency + Commercial</option>
          <option>Agency</option>
          <option>Commercial</option>
        </select>
        <select value={fOutcome} onChange={(e) => setFOutcome(e.target.value)}>
          <option value="">Any outcome</option>
          <option>Won</option>
          <option>Lost</option>
        </select>
        <span className="muted small">{docs.length} of {state.historical.length} documents</span>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <SortTh label="ID" k="id" sort={sort} onToggle={toggle} />
            <SortTh label="Title" k="title" sort={sort} onToggle={toggle} />
            <SortTh label="Type" k="docType" sort={sort} onToggle={toggle} />
            <SortTh label="Sector" k="sector" sort={sort} onToggle={toggle} />
            <SortTh label="Customer" k="customer" sort={sort} onToggle={toggle} />
            <SortTh label="Outcome" k="outcome" sort={sort} onToggle={toggle} />
            <SortTh label="Uploaded" k="uploaded" sort={sort} onToggle={toggle} />
            <SortTh label="Embedding" k="embedding" sort={sort} onToggle={toggle} />
            <SortTh label="Chunks" k="chunks" sort={sort} onToggle={toggle} num />
            <SortTh label="Versions" k="versions" sort={sort} onToggle={toggle} num />
            <th />
          </tr>
        </thead>
        <tbody>
          {pager.slice.map((d) => (
            <tr key={d.id}>
              <td className="mono">{d.id}</td>
              <td>{d.title}</td>
              <td>{d.docType}</td>
              <td><span className="badge badge-sector">{d.sector}</span></td>
              <td>{d.customer}</td>
              <td>{d.outcome === 'Won' ? <span className="pill pill-won">Won</span> : d.outcome === 'Lost' ? <span className="pill pill-lost">Lost</span> : '-'}</td>
              <td className="muted">{dateShort(d.uploadDate)} · {d.uploadedBy}</td>
              <td><span className={statusCls[d.embeddingStatus] ?? ''}>{d.embeddingStatus}</span></td>
              <td className="num">{d.chunks ? d.chunks.toLocaleString() : '-'}</td>
              <td className="num" title="Superseded versions and their embeddings are archived, not erased, so citations stay valid">{d.versions}</td>
              <td>
                <button
                  className="icon-btn"
                  title="Edit metadata (re-embeds and archives the prior version)"
                  onClick={() =>
                    setDraft({
                      id: d.id,
                      title: d.title,
                      docType: d.docType,
                      sector: d.sector,
                      customer: d.customer,
                      outcome: d.outcome === '-' ? 'Won' : d.outcome,
                    })
                  }
                >
                  ✎
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager {...pager} />
    </div>
  );
}
