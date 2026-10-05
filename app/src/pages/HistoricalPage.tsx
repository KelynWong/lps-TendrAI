// Historical data store: past tender requirements, proposals and business
// cases with tags and embedding status. Documents from the same tender are
// linked into a set (any combination, at most one of each type, one shared
// outcome) and shown grouped in the table. Upload supports multiple files at
// once, linking to existing documents, and a reminder when a set is uploaded
// without its linked counterparts. Editing can relink or unlink a document.

import { Fragment, useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, FileUp, Inbox, Link2, Pencil, Trash2, Upload, X } from 'lucide-react';
import { dateShort } from '../lib/format';
import { useStore } from '../state/store';
import { Pager, SortTh, usePager, useSort } from '../components/common';
import { Banner, Button, ConfirmDialog, EmptyState, IconButton } from '../ui/ui';
import { useToast } from '../ui/toast';
import type { HistoricalDoc } from '../types';

const statusCls: Record<string, string> = {
  Embedded: 'ok',
  'Re-embedding': 'warn',
  'Embedding…': 'warn',
  'Extraction failed': 'err',
  'Duplicate - pending review': 'warn',
};

type DocType = HistoricalDoc['docType'];
type Outcome = 'Won' | 'Lost';
const DOC_TYPES: DocType[] = ['Tender Requirement', 'Proposal', 'Business Case'];
const TYPE_ORDER: Record<DocType, number> = { 'Tender Requirement': 0, Proposal: 1, 'Business Case': 2 };

/** Best-guess document type from the file name (user can correct it). */
function guessType(fileName: string): DocType {
  const n = fileName.toLowerCase();
  if (/tender|requirement|itt|rfp/.test(n)) return 'Tender Requirement';
  if (/business|case/.test(n)) return 'Business Case';
  return 'Proposal';
}

function cleanTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
}

/** One file in an upload batch (per-file metadata). */
interface NewDoc {
  fileName: string;
  title: string;
  docType: DocType;
}

/** The upload form: files plus shared tags and an optional link target. */
interface Batch {
  docs: NewDoc[];
  sector: HistoricalDoc['sector'];
  customer: string;
  /** One outcome for the whole linked set */
  outcome: Outcome;
  /** '' = none, 'g:<groupId>' = existing linked set, 'd:<docId>' = ungrouped doc */
  linkTo: string;
}

interface EditDoc {
  id: string;
  title: string;
  docType: DocType;
  sector: HistoricalDoc['sector'];
  customer: string;
  outcome: Outcome;
  /** same encoding as Batch.linkTo; '' = not linked */
  linkTo: string;
  /** replacement file name; set = major version bump on save */
  replaceFile?: string;
}

/** Next version label: metadata edits bump minor, replacing the file bumps major */
function bumpVersion(v: string, major: boolean): string {
  const [M, m] = v.split('.').map((x) => parseInt(x, 10) || 0);
  return major ? `${M + 1}.0` : `${M}.${m + 1}`;
}

/** Demo download: generates a Word-compatible document for the archived record. */
function downloadDoc(d: HistoricalDoc, ver: string) {
  const html = `<!doctype html><html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${d.title}</title></head><body style="font-family:Calibri,Arial,sans-serif">
<h1>${d.title}</h1>
<p><b>${d.id}</b> · v${ver} · ${d.docType} · ${d.customer} (${d.sector})</p>
<h2>1. Executive summary</h2>
<p>This is a demonstration rendering of the archived document stored in the TendrAI historical data library. In the live system this download serves the original uploaded file for this version.</p>
<h2>4.2 Commercial model</h2>
<p>Figures recorded in this section ground AI-suggested values in newly generated business cases. Superseded versions and their embeddings are archived, not erased, so citations stay valid.</p>
</body></html>`;
  const blob = new Blob([html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const aEl = document.createElement('a');
  aEl.href = url;
  aEl.download = `${d.id}-v${ver}.doc`;
  aEl.click();
  URL.revokeObjectURL(url);
}

interface LinkOption {
  value: string;
  label: string;
  types: DocType[];
  outcome?: Outcome;
}

export default function HistoricalPage() {
  const { state, dispatch } = useStore();
  const user = state.user!;
  const toast = useToast();
  const [fTitle, setFTitle] = useState('');
  const [fType, setFType] = useState('');
  const [fSector, setFSector] = useState('');
  const [fOutcome, setFOutcome] = useState('');
  const [dragging, setDragging] = useState(false);
  const [replDragging, setReplDragging] = useState(false);
  const { sort, toggle, apply } = useSort();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [edit, setEdit] = useState<EditDoc | null>(null);
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [verId, setVerId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const verDoc = verId ? state.historical.find((d) => d.id === verId) ?? null : null;
  useEffect(() => {
    if (!verId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVerId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [verId]);

  // Archived ("deleted") documents stay citable but leave the library view
  const library = state.historical.filter((d) => !d.archived);

  // ---- Linked sets -----------------------------------------------------------
  const groupsMap = new Map<string, HistoricalDoc[]>();
  for (const d of library) {
    if (d.group) groupsMap.set(d.group, [...(groupsMap.get(d.group) ?? []), d]);
  }
  const setOutcome = (ds: HistoricalDoc[]): Outcome | undefined => {
    const o = ds.find((d) => d.outcome === 'Won' || d.outcome === 'Lost')?.outcome;
    return o === 'Won' || o === 'Lost' ? o : undefined;
  };
  const groupOption = (g: string, ds: HistoricalDoc[]): LinkOption => {
    const sorted = [...ds].sort((a, b) => TYPE_ORDER[a.docType] - TYPE_ORDER[b.docType]);
    return {
      value: `g:${g}`,
      label: `Linked set · ${sorted[0].customer} (${sorted.map((d) => d.docType).join(' + ')})`,
      types: sorted.map((d) => d.docType),
      outcome: setOutcome(sorted),
    };
  };
  const docOption = (d: HistoricalDoc): LinkOption => ({
    value: `d:${d.id}`,
    label: `${d.id} · ${d.title}`,
    types: [d.docType],
    outcome: d.outcome === 'Won' || d.outcome === 'Lost' ? d.outcome : undefined,
  });

  // Upload can link to any set that is not yet complete, or any ungrouped doc
  const uploadLinkOptions: LinkOption[] = [
    ...[...groupsMap.entries()]
      .map(([g, ds]) => groupOption(g, ds))
      .filter((o) => new Set(o.types).size < DOC_TYPES.length),
    ...library.filter((d) => !d.group).map(docOption),
  ];

  // Edit can relink to any target that does not already hold this doc's type
  const editLinkOptions: LinkOption[] = edit
    ? [
        ...[...groupsMap.entries()]
          .map(([g, ds]) => [g, ds.filter((d) => d.id !== edit.id)] as const)
          .filter(([, ds]) => ds.length > 0 && !ds.some((d) => d.docType === edit.docType))
          .map(([g, ds]) => groupOption(g, ds)),
        ...library
          .filter((d) => !d.group && d.id !== edit.id && d.docType !== edit.docType)
          .map(docOption),
      ]
    : [];

  const linkSel = uploadLinkOptions.find((o) => o.value === batch?.linkTo);

  // Types still missing from the upload set (counting any linked documents)
  const presentTypes = new Set<DocType>([
    ...(batch?.docs.map((d) => d.docType) ?? []),
    ...(linkSel?.types ?? []),
  ]);
  const missing = batch ? DOC_TYPES.filter((t) => !presentTypes.has(t)) : [];
  const missingText = missing.map((m) => m.toLowerCase()).join(' or ');

  // Validation: a linked set holds at most ONE of each document type
  const typeCounts = new Map<DocType, number>();
  for (const d of batch?.docs ?? []) typeCounts.set(d.docType, (typeCounts.get(d.docType) ?? 0) + 1);
  for (const t of linkSel?.types ?? []) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  const dupTypes = DOC_TYPES.filter((t) => (typeCounts.get(t) ?? 0) > 1);

  // ---- Table data: filter docs, then group linked ones into display units ----
  const filtered = library.filter((d) => {
    if (fTitle && !`${d.title} ${d.id} ${d.customer}`.toLowerCase().includes(fTitle.toLowerCase())) return false;
    if (fType && d.docType !== fType) return false;
    if (fSector && d.sector !== fSector) return false;
    if (fOutcome && d.outcome !== fOutcome) return false;
    return true;
  });
  const unitMap = new Map<string, HistoricalDoc[]>();
  for (const d of filtered) {
    const k = d.group ?? `solo:${d.id}`;
    unitMap.set(k, [...(unitMap.get(k) ?? []), d]);
  }
  const units0 = [...unitMap.values()].map((ds) =>
    [...ds].sort((a, b) => TYPE_ORDER[a.docType] - TYPE_ORDER[b.docType]),
  );
  const units = apply(units0, {
    id: (u) => u[0].id,
    title: (u) => u[0].title,
    docType: (u) => u[0].docType,
    sector: (u) => u[0].sector,
    customer: (u) => u[0].customer,
    outcome: (u) => u[0].outcome,
    uploaded: (u) => u[0].uploadDate,
    embedding: (u) => u[0].embeddingStatus,
    chunks: (u) => u[0].chunks,
    version: (u) => parseFloat(u[0].version),
  });
  const pager = usePager(units, 8);
  const linkedSets = units.filter((u) => u.length > 1).length;

  const scheduleEmbed = (id: string) => {
    timers.current.push(window.setTimeout(() => dispatch({ type: 'historical-embedded', id }), 2500));
  };

  const toNewDocs = (files: FileList | null | undefined): NewDoc[] =>
    Array.from(files ?? []).map((f) => ({
      fileName: f.name,
      title: cleanTitle(f.name),
      docType: guessType(f.name),
    }));

  const startUpload = (files: FileList | null | undefined) => {
    const docs = toNewDocs(files);
    if (!docs.length) return;
    setBatch({ docs, sector: 'Agency', customer: '', outcome: 'Won', linkTo: '' });
  };

  const addFiles = (files: FileList | null | undefined) => {
    const docs = toNewDocs(files);
    if (!docs.length || !batch) return;
    setBatch({ ...batch, docs: [...batch.docs, ...docs] });
  };

  const parseLink = (linkTo: string): { group?: string; linkedTo?: string } => {
    if (linkTo.startsWith('g:')) return { group: linkTo.slice(2) };
    if (linkTo.startsWith('d:')) return { group: `grp-${linkTo.slice(2)}`, linkedTo: linkTo.slice(2) };
    return {};
  };

  const doUpload = (b: Batch) => {
    let { group, linkedTo } = parseLink(b.linkTo);
    if (!group && b.docs.length > 1) group = `grp-${Date.now()}`;
    const base = 100 + state.historical.length;
    const docs: HistoricalDoc[] = b.docs.map((d, i) => ({
      id: `HD-2026-${base + i}`,
      title: d.title || '(untitled)',
      docType: d.docType,
      sector: b.sector,
      customer: b.customer || 'Unspecified',
      outcome: d.docType === 'Tender Requirement' ? '-' : b.outcome,
      uploadedBy: user.name,
      uploadDate: new Date().toISOString().slice(0, 10),
      embeddingStatus: 'Embedding…',
      chunks: 0,
      version: '1.0',
      group,
    }));
    dispatch({ type: 'add-historical', docs, linkedTo });
    docs.forEach((d) => scheduleEmbed(d.id));
    toast.push(
      'success',
      docs.length > 1 ? `${docs.length} documents uploaded, embedding` : 'Document uploaded, embedding',
      group ? 'They appear in the table as a linked set.' : 'It appears in the table with its embedding status.',
    );
    setBatch(null);
  };

  const tryUpload = () => {
    if (!batch || dupTypes.length) return;
    if (missing.length) setShowIncomplete(true);
    else doUpload(batch);
  };

  const startEdit = (d: HistoricalDoc) => {
    setEdit({
      id: d.id,
      title: d.title,
      docType: d.docType,
      sector: d.sector,
      customer: d.customer,
      outcome: d.outcome === 'Lost' ? 'Lost' : 'Won',
      linkTo: d.group ? `g:${d.group}` : '',
    });
  };

  const saveEdit = () => {
    if (!edit) return;
    const existing = state.historical.find((d) => d.id === edit.id)!;
    const { group, linkedTo } = parseLink(edit.linkTo);
    const replaced = !!edit.replaceFile;
    const version = bumpVersion(existing.version, replaced);
    dispatch({
      type: 'update-historical',
      doc: {
        ...existing,
        title: edit.title,
        docType: edit.docType,
        sector: edit.sector,
        customer: edit.customer,
        outcome: edit.docType === 'Tender Requirement' ? '-' : edit.outcome,
        embeddingStatus: 'Re-embedding',
        chunks: replaced ? 0 : existing.chunks,
        version,
        group,
      },
      linkedTo,
      replacedWith: edit.replaceFile,
    });
    scheduleEmbed(edit.id);
    setEdit(null);
    toast.push(
      'success',
      replaced ? `Document replaced, now v${version}, re-embedding` : `Metadata updated, now v${version}, re-embedding`,
      'The prior version is archived.',
    );
  };

  return (
    <div>
      {!batch && !edit && (
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); startUpload(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload historical documents"
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm"
            style={{ display: 'none' }}
            onChange={(e) => { startUpload(e.target.files); e.target.value = ''; }}
          />
          <b><FileUp size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> Upload historical documents</b> - drop files here or click to browse (PDF, DOCX, XLSX)
          <br />
          <span className="muted small">
            The tender requirement, proposal and business case from the same tender are linked:
            upload them together where possible, or link them to documents already in the store.
          </span>
        </div>
      )}

      {batch && (
        <div className="card">
          <h3>New historical documents</h3>
          <p className="muted small">
            Check the type detected for each file. Documents uploaded together (or linked below) are
            stored as one linked tender set.
          </p>
          {batch.docs.map((d, i) => (
            <div className="hd-doc-row" key={`${d.fileName}-${i}`}>
              <span className="hd-file" title={d.fileName}><FileUp size={14} aria-hidden /> {d.fileName}</span>
              <label>
                Title
                <input
                  value={d.title}
                  onChange={(e) => setBatch({ ...batch, docs: batch.docs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                />
              </label>
              <label>
                Type
                <select
                  value={d.docType}
                  onChange={(e) => setBatch({ ...batch, docs: batch.docs.map((x, j) => (j === i ? { ...x, docType: e.target.value as DocType } : x)) })}
                >
                  {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <IconButton
                label="Remove this file from the upload"
                icon={X}
                disabled={batch.docs.length === 1}
                onClick={() => setBatch({ ...batch, docs: batch.docs.filter((_, j) => j !== i) })}
              />
            </div>
          ))}
          <input
            ref={moreRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm"
            style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <Button variant="ghost" icon={FilePlus2} onClick={() => moreRef.current?.click()}>
            Add another file to this set
          </Button>
          <div className="hd-form">
            <label>
              Sector
              <select value={batch.sector} onChange={(e) => setBatch({ ...batch, sector: e.target.value as Batch['sector'] })}>
                <option>Agency</option>
                <option>Commercial</option>
              </select>
            </label>
            <label>
              Customer
              <input value={batch.customer} onChange={(e) => setBatch({ ...batch, customer: e.target.value })} />
            </label>
            {batch.docs.some((d) => d.docType !== 'Tender Requirement') && (
              <label>
                Outcome (applies to the whole set)
                <select value={batch.outcome} onChange={(e) => setBatch({ ...batch, outcome: e.target.value as Outcome })}>
                  <option>Won</option>
                  <option>Lost</option>
                </select>
              </label>
            )}
            <label>
              Link to existing documents
              <select
                value={batch.linkTo}
                onChange={(e) => {
                  const o = uploadLinkOptions.find((x) => x.value === e.target.value);
                  setBatch({ ...batch, linkTo: e.target.value, outcome: o?.outcome ?? batch.outcome });
                }}
              >
                <option value="">None - this upload is its own set</option>
                {uploadLinkOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          {dupTypes.length > 0 && (
            <Banner kind="error">
              A linked set can hold only one of each document type. This upload would contain more
              than one {dupTypes.map((t) => t.toLowerCase()).join(' and more than one ')}. Change a
              type, remove a file, or pick a different link target.
            </Banner>
          )}
          {dupTypes.length === 0 && missing.length > 0 && (
            <p className="muted small hd-link-note">
              <Link2 size={14} aria-hidden />
              Recommended: a full set has all three document types. This one has no {missingText}.
              Add the file above or link to existing documents; if you do not have {missing.length > 1 ? 'them' : 'it'}, you can still proceed.
            </p>
          )}
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setBatch(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={Upload}
              disabled={dupTypes.length > 0}
              title={dupTypes.length > 0 ? 'Resolve the duplicate document types first' : undefined}
              onClick={tryUpload}
            >
              Upload and embed{batch.docs.length > 1 ? ` (${batch.docs.length} documents)` : ''}
            </Button>
          </div>
        </div>
      )}

      {edit && (
        <div className="card">
          <h3>Edit {edit.id}</h3>
          <div className="hd-form">
            <label>
              Title
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </label>
            <label>
              Type
              <select value={edit.docType} onChange={(e) => setEdit({ ...edit, docType: e.target.value as DocType })}>
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Sector
              <select value={edit.sector} onChange={(e) => setEdit({ ...edit, sector: e.target.value as EditDoc['sector'] })}>
                <option>Agency</option>
                <option>Commercial</option>
              </select>
            </label>
            <label>
              Customer
              <input value={edit.customer} onChange={(e) => setEdit({ ...edit, customer: e.target.value })} />
            </label>
            {edit.docType !== 'Tender Requirement' && (
              <label>
                Outcome (applies to the whole set)
                <select value={edit.outcome} onChange={(e) => setEdit({ ...edit, outcome: e.target.value as Outcome })}>
                  <option>Won</option>
                  <option>Lost</option>
                </select>
              </label>
            )}
            <label>
              Linked documents
              <select
                value={edit.linkTo}
                onChange={(e) => {
                  const o = editLinkOptions.find((x) => x.value === e.target.value);
                  setEdit({ ...edit, linkTo: e.target.value, outcome: o?.outcome ?? edit.outcome });
                }}
              >
                <option value="">Not linked{state.historical.find((d) => d.id === edit.id)?.group ? ' (unlink from the current set)' : ''}</option>
                {editLinkOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <input
            ref={replaceRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm"
            style={{ display: 'none' }}
            onChange={(e) => { setEdit({ ...edit, replaceFile: e.target.files?.[0]?.name }); e.target.value = ''; }}
          />
          <div
            className={`dropzone dropzone-compact ${replDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setReplDragging(true); }}
            onDragLeave={() => setReplDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setReplDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setEdit({ ...edit, replaceFile: f.name });
            }}
            onClick={() => replaceRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); replaceRef.current?.click(); } }}
            role="button"
            tabIndex={0}
            aria-label="Replace the document"
          >
            <b><FileUp size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> Replace document</b> - drop the new file here or click to browse
            <br />
            <span className="muted small">
              {edit.replaceFile
                ? `${edit.replaceFile} selected: saving bumps to v${bumpVersion(state.historical.find((d) => d.id === edit.id)?.version ?? '1.0', true)} and re-embeds`
                : 'Replacing the document bumps the MAJOR version; metadata-only edits bump the minor version.'}
            </span>
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" icon={Upload} onClick={saveEdit}>
              Save (archives prior version, re-embeds)
            </Button>
          </div>
        </div>
      )}

      <div className="filter-row">
        <input
          type="search"
          placeholder="Filter by title, ID or customer"
          value={fTitle}
          onChange={(e) => setFTitle(e.target.value)}
        />
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
        <span className="muted small">
          {filtered.length} of {library.length} documents{linkedSets > 0 ? ` · ${linkedSets} linked set${linkedSets > 1 ? 's' : ''}` : ''}
        </span>
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
            <SortTh label="Version" k="version" sort={sort} onToggle={toggle} num />
            <th />
          </tr>
        </thead>
        <tbody>
          {pager.slice.map((u) => {
            const grouped = u.length > 1;
            const missingInSet = DOC_TYPES.filter((t) => !u.some((d) => d.docType === t));
            return (
              <Fragment key={u[0].group ? `g-${u[0].group}` : u[0].id}>
                {grouped && (
                  <tr className="group-row">
                    <td colSpan={11}>
                      <Link2 size={13} aria-hidden /> Linked set · {u[0].customer} · {u.map((d) => d.docType).join(' + ')}
                      {missingInSet.length > 0 && (
                        <span className="muted"> (no {missingInSet.map((m) => m.toLowerCase()).join(' or ')} on record)</span>
                      )}
                    </td>
                  </tr>
                )}
                {u.map((d) => (
                  <tr key={d.id} className={grouped ? 'in-group' : ''}>
                    <td className="mono">{d.id}</td>
                    <td>{d.title}</td>
                    <td>{d.docType}</td>
                    <td><span className="badge badge-sector">{d.sector}</span></td>
                    <td>{d.customer}</td>
                    <td>{d.outcome === 'Won' ? <span className="pill pill-won">Won</span> : d.outcome === 'Lost' ? <span className="pill pill-lost">Lost</span> : '-'}</td>
                    <td className="muted">{dateShort(d.uploadDate)} · {d.uploadedBy}</td>
                    <td><span className={statusCls[d.embeddingStatus] ?? ''}>{d.embeddingStatus}</span></td>
                    <td className="num">{d.chunks ? d.chunks.toLocaleString() : '-'}</td>
                    <td className="num">
                      <button
                        className="cell-btn"
                        title="View version history (superseded versions are archived, not erased, so citations stay valid)"
                        onClick={() => setVerId(d.id)}
                      >
                        v{d.version}
                      </button>
                    </td>
                    <td className="row-actions">
                      <IconButton
                        label="Edit metadata or replace the document (archives the prior version)"
                        icon={Pencil}
                        onClick={() => startEdit(d)}
                      />
                      <IconButton
                        danger
                        label="Delete (archive) this document"
                        icon={Trash2}
                        onClick={() => setArchiveId(d.id)}
                      />
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
          {units.length === 0 && (
            <tr>
              <td colSpan={11}>
                <EmptyState
                  icon={Inbox}
                  title="No documents match these filters"
                  body="Clear a filter, or upload a historical document above."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pager {...pager} />

      {verDoc && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setVerId(null)}>
          <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="ver-title">
            <h2 id="ver-title" className="dialog-title">Version history · {verDoc.id}</h2>
            <div className="dialog-body">
              <p className="muted small">
                {verDoc.title}. Superseded versions and their embeddings are archived, not erased:
                a figure cited from an archived version still resolves to the text it was grounded in.
              </p>
              <div className="ver-scroll">
              <table className="grid">
                <thead>
                  <tr><th>Version</th><th>Status</th><th>Date</th><th>By</th><th>Changes</th><th /></tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">v{verDoc.version}</td>
                    <td><span className="ok">Current</span></td>
                    <td className="muted">{dateShort(verDoc.uploadDate)}</td>
                    <td>{verDoc.uploadedBy}</td>
                    <td className="muted">Latest embedded version; new retrievals cite this one.</td>
                    <td>
                      <IconButton
                        label={`Download v${verDoc.version} (.doc)`}
                        icon={Download}
                        onClick={() => downloadDoc(verDoc, verDoc.version)}
                      />
                    </td>
                  </tr>
                  {[...(verDoc.history ?? [])].reverse().map((h) => (
                    <tr key={h.v}>
                      <td className="mono">v{h.v}</td>
                      <td><span className="muted">Archived</span></td>
                      <td className="muted">{dateShort(h.archivedAt)}</td>
                      <td>{h.by}</td>
                      <td>{h.note}</td>
                      <td>
                        <IconButton
                          label={`Download archived v${h.v} (.doc)`}
                          icon={Download}
                          onClick={() => downloadDoc(verDoc, h.v)}
                        />
                      </td>
                    </tr>
                  ))}
                  {(verDoc.history ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">No archived versions yet. Editing this document archives the current version here.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
            <div className="dialog-actions">
              <Button variant="primary" onClick={() => setVerId(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={archiveId !== null}
        title={`Delete ${state.historical.find((d) => d.id === archiveId)?.title ?? 'this document'}?`}
        confirmLabel="Delete and archive"
        danger
        onConfirm={() => {
          if (archiveId) {
            dispatch({ type: 'archive-historical', id: archiveId });
            toast.push('success', 'Document archived', 'Existing citations keep resolving to it; new tenders will not retrieve it.');
          }
          setArchiveId(null);
        }}
        onClose={() => setArchiveId(null)}
      >
        Deleting archives the document rather than erasing it: business cases that already cite it
        keep resolving to the cited version, but newly uploaded tender requirements will no longer
        retrieve or ground against this document.
      </ConfirmDialog>

      <ConfirmDialog
        open={showIncomplete}
        title="Upload without the full linked set?"
        confirmLabel="Proceed with upload"
        onConfirm={() => { setShowIncomplete(false); if (batch) doUpload(batch); }}
        onClose={() => setShowIncomplete(false)}
      >
        The tender requirement, proposal and business case from the same tender are linked documents,
        and it is recommended to upload or link them together. This upload has no {missingText}.
        If you do not have {missing.length > 1 ? 'them' : 'it'}, proceed: the missing document can be
        linked to this set when it is uploaded later.
      </ConfirmDialog>
    </div>
  );
}
