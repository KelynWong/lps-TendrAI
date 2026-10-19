// RFP intelligence sections: tender pack, submission checklist, qualification
// requirements, clause review, compliance table and the per-tender template
// flow. All "AI" results are pre-built mock data; every extracted item shows
// its source and review state.
//
// The processing model mirrors the real backend: uploads are stored instantly,
// ONE job per tender runs six named stages (no percentages, no precise ETA),
// failed documents carry a reason and a Retry, and changing the document set
// after a run marks the results out of date instead of mutating them.

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  Eye,
  FileText,
  FileUp,
  GripVertical,
  History,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Clause, ClauseCategory, PackDoc, PackDocRole, Tender } from '../types';
import { PROCESS_STAGES } from '../types';
import { canDo } from '../config';
import { useStore } from '../state/store';
import { useCitation, type CitationInfo } from '../ui/citation';
import { LibraryUpload } from './library';
import { writeXlsxWithDropdowns } from '../lib/xlsxDropdown';
import { UploadDialog, type StagedFile } from './upload';
import { SortTh, StatusPill, TextCell, useColFilters, useSort } from './common';
import { Banner, Button, ConfirmDialog, EmptyState, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import { dateShort, ts } from '../lib/format';
import { useLeaveGuard, useUnsavedChanges } from '../lib/leaveGuard';

const DOC_ROLES: PackDocRole[] = ['General Requirements', 'Technical Specification', 'Commercial Conditions', 'Legal Conditions', 'Forms and Annexes', 'Unclassified'];
const CATEGORIES: ClauseCategory[] = ['Commercial', 'Technical', 'Legal', 'Finance', 'HR'];
const COMPLIANCE_OPTIONS: Clause['compliance'][] = ['Unset', 'Comply', 'Partially comply', 'Do not comply', 'Clarify'];

/** Demo files exist for two of the mock documents; everything else renders the
 *  built-in page viewer (with page navigation) instead of a stale stand-in. */
const demoSourceUrl = (sourceDoc: string) => {
  const s = sourceDoc.toLowerCase();
  if (s === 'general requirements.pdf') return '/mock-documents/general-requirements.pdf';
  if (s === 'technical specification.pdf') return '/mock-documents/technical-specification.pdf';
  return undefined;
};

/** Builds the source-viewer citation for an extracted item: document, clause,
 *  page, and a few sentences either side of the passage. Neighbouring text
 *  comes from the clauses extracted from the same document; the live system
 *  takes it straight from the document text. */
function clausesInDoc(t: Tender, sourceDoc: string) {
  return t.clauses.filter((c) => c.sourceDoc === sourceDoc).sort((a, b) => a.page - b.page);
}

/** Page a cited clause sits on: the extracted clause's page when known,
 *  otherwise estimated from the clause's section number. */
function citedPage(t: Tender, sourceDoc: string, clause: string): number {
  return clausesInDoc(t, sourceDoc).find((c) => c.number === clause)?.page
    ?? Math.max(1, 2 + 2 * (parseInt(clause, 10) || 1));
}

function sourceCitation(
  t: Tender,
  item: { sourceDoc: string; clause: string; excerpt: string; page?: number },
): CitationInfo {
  const sameDoc = clausesInDoc(t, item.sourceDoc);
  const idx = sameDoc.findIndex((c) => c.number === item.clause || c.text === item.excerpt);
  const page = item.page ?? citedPage(t, item.sourceDoc, item.clause);
  const cite = (c?: Clause) => (c ? `${c.number} ${c.text}` : undefined);
  // show the document's own wording when the cited clause was extracted;
  // checklist and qualification items are summaries of it
  const passage = idx >= 0 ? sameDoc[idx].text : item.excerpt;
  const before = idx > 0
    ? [cite(sameDoc[idx - 2]), cite(sameDoc[idx - 1])].filter(Boolean) as string[]
    : ['Tenderers shall read this section together with the Conditions of Contract and any clarifications issued by the Authority.'];
  const after = idx >= 0 && idx < sameDoc.length - 1
    ? [cite(sameDoc[idx + 1]), cite(sameDoc[idx + 2])].filter(Boolean) as string[]
    : ['Submissions that do not meet this requirement may be disregarded at the Authority\'s discretion.'];
  const pageCount = t.pack.find((d) => d.name === item.sourceDoc)?.pages || undefined;
  return {
    docId: item.sourceDoc,
    title: item.sourceDoc,
    fileName: item.sourceDoc,
    documentUrl: demoSourceUrl(item.sourceDoc),
    similarity: 1,
    source: 'tender',
    tab: `Clause ${item.clause} · page ${page}`,
    page,
    pageCount: pageCount && pageCount >= page ? pageCount : undefined,
    excerpt: passage,
    contextBefore: before,
    contextAfter: after,
  };
}

/** A tender with a recorded outcome is read-only (its record lives on in the
 *  repository); so is an archived one. */
export const isTenderLocked = (t: Tender) =>
  t.status === 'Won' || t.status === 'Closed' || !!t.archivedInfo;

// ---- Shared processing status helpers ----------------------------------------

export function docCounts(t: Tender) {
  const done = t.pack.filter((d) => d.status === 'Done').length;
  const failed = t.pack.filter((d) => d.status === 'Failed').length;
  const inRun = done + failed;
  return { done, failed, inRun };
}

/** "Based on N of M documents" banner shown wherever partial results appear. */
function PartialResultsBanner({ t }: { t: Tender }) {
  const { done, failed, inRun } = docCounts(t);
  if (!t.lastProcessedAt || failed === 0 || t.clauses.length === 0) return null;
  return (
    <Banner kind="warning">
      Results are based on <b>{done} of {inRun} documents</b>: {failed} document{failed > 1 ? 's' : ''} failed
      text extraction. Fix or remove the failed document{failed > 1 ? 's' : ''} on the Documents tab,
      then reprocess.
    </Banner>
  );
}

/** Out-of-date banner: the document set changed after the last run. */
function OutOfDateBanner({ t, onReprocess, canProcess }: { t: Tender; onReprocess: () => void; canProcess: boolean }) {
  if (!t.outOfDate || t.job) return null;
  const parts: string[] = [];
  if (t.outOfDate.added) parts.push(`${t.outOfDate.added} document${t.outOfDate.added > 1 ? 's' : ''} added`);
  if (t.outOfDate.removed) parts.push(`${t.outOfDate.removed} removed`);
  if (t.outOfDate.repaired) parts.push(`${t.outOfDate.repaired} repaired`);
  return (
    <Banner
      kind="warning"
      actions={canProcess ? <Button compact variant="primary" icon={RefreshCw} onClick={onReprocess}>Reprocess documents</Button> : undefined}
    >
      Results are out of date: {parts.join(', ')}. Reprocess to update - your compliance statuses
      and responses are kept.
      {t.lastProcessedAt && <> Results below are from the run on {ts(t.lastProcessedAt)}.</>}
    </Banner>
  );
}

/** Drives the simulated job for the open tender: advances stages on timers.
 *  Purely a demo device - the real job runs minutes to ~20 minutes. */
export function useJobSim(t: Tender) {
  const { dispatch } = useStore();
  const toast = useToast();
  const stage = t.job?.stage;
  useEffect(() => {
    if (!stage) return;
    const timer = window.setTimeout(() => {
      if (stage >= PROCESS_STAGES.length) {
        dispatch({ type: 'finish-processing', tenderId: t.id });
        toast.push('success', 'Processing complete', 'Extracted results are ready for review. Every item keeps a link to its source.');
      } else {
        dispatch({ type: 'set-process-stage', tenderId: t.id, stage: stage + 1 });
      }
    }, stage === 1 ? 4500 : 2600);
    return () => window.clearTimeout(timer);
  }, [stage, t.id, dispatch, toast]);
}

/** Stage-based progress: stage names and a rough duration range, never a
 *  percentage or a precise time remaining (the system cannot know them). */
function JobPanel({ t }: { t: Tender }) {
  if (!t.job) return null;
  const cur = t.job.stage;
  return (
    <div className="job-panel" aria-live="polite">
      <div className="job-panel-head">
        <span className="job-stage-count">Stage {cur} of {PROCESS_STAGES.length}</span>
        <b>{PROCESS_STAGES[cur - 1]}</b>
        <span className="muted small">
          Started {ts(t.job.startedAt)} · large packs take minutes to about 20 minutes
          (accelerated in this demo). You can leave this page - the job keeps running.
        </span>
      </div>
      <ol className="pipeline">
        {PROCESS_STAGES.map((label, i) => {
          const state = i + 1 < cur ? 'done' : i + 1 === cur ? 'running' : 'pending';
          return (
            <li key={label} className={`stage ${state}`}>
              <span className="stage-icon">
                {state === 'done' ? <CheckCircle2 size={16} aria-hidden /> : state === 'running' ? <Loader2 size={16} aria-hidden /> : <Circle size={14} aria-hidden />}
              </span>
              <div>
                <div className="stage-label">{label}</div>
                {i === 0 && state !== 'pending' && (
                  <div className="muted small">Per-document status is shown in the table below. Documents extract in parallel; a failed document does not stop the others.</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---- Tender pack (Documents tab) ---------------------------------------------

export function PackSection({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState<PackDoc | null>(null);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const canUpload = canDo.uploadPack(state.role) && !isTenderLocked(t);
  const jobRunning = !!t.job;
  const { sort, toggle, apply } = useSort();
  const packFilters = useColFilters();


  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const runProcessing = () => {
    dispatch({ type: 'start-processing', tenderId: t.id });
    toast.push('info', 'Processing started', 'One job runs per tender. Changes to the document set are locked until it finishes.');
  };
  // Reprocessing regenerates extracted results, so warn first whenever there
  // are results (and possibly human edits) to regenerate.
  const hasResults = t.clauses.length + t.checklist.length + t.quals.length > 0;
  const startProcessing = () => (hasResults ? setConfirmReprocess(true) : runProcessing());
  const withCompliance = t.clauses.filter((c) => c.compliance !== 'Unset').length;
  const withRemarks = t.clauses.filter((c) => c.response.trim()).length;
  const withDrafts = t.checklist.filter((k) => k.draft).length;

  const retryDoc = (doc: PackDoc) => {
    setRetrying(doc.id);
    dispatch({ type: 'retry-doc', tenderId: t.id, docId: doc.id });
    window.setTimeout(() => {
      dispatch({ type: 'retry-doc-done', tenderId: t.id, docId: doc.id });
      setRetrying(null);
      toast.push('success', 'Text extracted on retry', t.lastProcessedAt
        ? `${doc.name} is readable now. Reprocess to include it in the results.`
        : `${doc.name} is readable now.`);
    }, 2400);
  };


  const packAccessors = {
    document: (d: PackDoc) => d.name,
    fileType: (d: PackDoc) => fileType(d.name),
    role: (d: PackDoc) => d.role,
    pages: (d: PackDoc) => d.pages,
    status: (d: PackDoc) => d.status,
  };
  const filteredPack = packFilters.apply(t.pack, packAccessors);
  const sortedPack = apply(filteredPack, packAccessors);
  const packFilterColumn = (key: keyof typeof packAccessors) => ({
    filterValues: t.pack.map((d) => String(packAccessors[key](d))),
    filter: packFilters.filters[key],
    onFilter: (filter: Parameters<typeof packFilters.set>[1]) => packFilters.set(key, filter),
  });

  // what the primary action is right now, and why it might be unavailable
  const hasDocs = t.pack.length > 0;
  const noPermission = isTenderLocked(t) ? 'This tender is locked - documents can no longer be changed' : 'Only the Bidding Manager uploads and processes the tender documents';
  const processLabel = t.processFailed ? 'Retry processing' : t.outOfDate ? 'Reprocess documents' : t.lastProcessedAt ? 'Reprocess documents' : 'Process documents';
  const processDisabledReason = jobRunning
    ? 'A processing job is already running for this tender'
    : !hasDocs
      ? 'Upload at least one document first'
      : !canUpload
        ? 'Only the Bidding Manager manages the tender pack'
        : undefined;

  // consequence of deleting a document (shown in the confirm dialog)
  const deleteImpact = useMemo(() => {
    if (!deleteDoc) return null;
    const clauses = t.clauses.filter((c) => c.sourceDoc === deleteDoc.name);
    const checklist = t.checklist.filter((k) => k.sourceDoc === deleteDoc.name);
    const quals = t.quals.filter((q) => q.sourceDoc === deleteDoc.name);
    return { clauses: clauses.length, checklist: checklist.length, quals: quals.length };
  }, [deleteDoc, t]);

  return (
    <section>
      <div className="section-heading pack-toolbar">
        <div className="muted small">
          {t.pack.length === 0
            ? 'Upload the tender pack (PDF, Word or Excel). Files are stored immediately; processing is a separate step.'
            : t.lastProcessedAt
              ? <>Last processed {ts(t.lastProcessedAt)}.</>
              : 'Documents are stored but not processed yet.'}
        </div>
        <div className="section-heading-actions document-actions">
          <Button
            compact
            icon={FileUp}
            disabled={!canUpload || jobRunning}
            title={!canUpload ? noPermission : jobRunning ? 'Locked while a processing job is running' : undefined}
            onClick={() => setUploadOpen(true)}
          >
            Add documents
          </Button>
          {!jobRunning && !t.outOfDate && (
            <Button
              variant="primary"
              compact
              disabled={!canUpload || !!processDisabledReason}
              title={!canUpload ? noPermission : processDisabledReason}
              onClick={startProcessing}
            >
              {processLabel}
            </Button>
          )}
        </div>
      </div>

      {t.processFailed && !jobRunning && (
        <Banner kind="error" actions={canUpload ? <Button compact variant="primary" icon={RefreshCw} onClick={startProcessing}>Retry processing</Button> : undefined}>
          {t.processFailed}
        </Banner>
      )}
      <OutOfDateBanner t={t} onReprocess={startProcessing} canProcess={canUpload && !jobRunning} />
      <PartialResultsBanner t={t} />
      <JobPanel t={t} />

      <table className="grid">
        <thead>
          <tr>
            {canUpload && <th aria-label="Reorder" className="pack-order-head" />}
            <th aria-label="Row number" />
            <SortTh label="Document" k="document" sort={sort} onToggle={toggle} {...packFilterColumn('document')} />
            <SortTh label="File type" k="fileType" sort={sort} onToggle={toggle} {...packFilterColumn('fileType')} />
            <SortTh label="Role in the pack" k="role" sort={sort} onToggle={toggle} {...packFilterColumn('role')} />
            <SortTh label="Pages" k="pages" sort={sort} onToggle={toggle} num />
            <SortTh label="Status" k="status" sort={sort} onToggle={toggle} {...packFilterColumn('status')} />
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sortedPack.map((d) => (
            <tr
              key={d.id}
              draggable={canUpload && !jobRunning}
              onDragStart={() => canUpload && !jobRunning && setDraggedDocId(d.id)}
              onDragEnd={() => setDraggedDocId(null)}
              onDragOver={(event) => {
                if (canUpload && draggedDocId && draggedDocId !== d.id) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!canUpload || !draggedDocId || draggedDocId === d.id) return;
                const from = t.pack.findIndex((doc) => doc.id === draggedDocId);
                const to = t.pack.findIndex((doc) => doc.id === d.id);
                if (from < 0 || to < 0) return;
                const direction = from < to ? 'down' : 'up';
                for (let index = from; direction === 'down' ? index < to : index > to; index += direction === 'down' ? 1 : -1) {
                  dispatch({ type: 'move-pack-doc', tenderId: t.id, docId: draggedDocId, direction });
                }
                setDraggedDocId(null);
              }}
              className={draggedDocId === d.id ? 'pack-row-dragging' : undefined}
            >
              {canUpload && (
                <td className="pack-order" aria-label={`Drag to reorder ${d.name}`}>
                  {!jobRunning && <GripVertical className="pack-drag-handle" size={16} aria-label="Drag to reorder" />}
                </td>
              )}
              <td className="pack-index">{t.pack.indexOf(d) + 1}</td>
              <td>
                {d.name}
                {d.status === 'Failed' && d.failReason && (
                  <div className="ref-issue"><AlertTriangle size={13} aria-hidden /> {d.failReason}</div>
                )}
              </td>
              <td className="muted">{fileType(d.name)}</td>
              <td>
                {canUpload && !jobRunning ? (
                  <>
                    <select
                      value={d.role}
                      aria-label={`Role of ${d.name}`}
                      onChange={(e) => {
                        dispatch({ type: 'correct-doc-role', tenderId: t.id, docId: d.id, role: e.target.value as PackDocRole });
                        toast.push('success', 'Classification confirmed', `${d.name} is now "${e.target.value}"`);
                      }}
                    >
                      {DOC_ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                    {d.roleUnconfirmed && (
                      <div className="muted small">Suggested, please confirm</div>
                    )}
                  </>
                ) : d.role}
              </td>
              <td className="num" title={d.pages === 0 ? 'Known after text extraction' : undefined}>{d.pages === 0 ? '-' : d.pages}</td>
              <td>
                {retrying === d.id
                  ? <StatusPill value="Extracting text" />
                  : <StatusPill value={d.status} />}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {d.status === 'Failed' && canUpload && !jobRunning && (
                  <Button compact icon={RefreshCw} onClick={() => retryDoc(d)} disabled={retrying === d.id}>Retry</Button>
                )}{' '}
                {canUpload && !jobRunning && <IconButton label={`Delete ${d.name}`} icon={Trash2} danger onClick={() => setDeleteDoc(d)} />}
              </td>
            </tr>
          ))}
          {sortedPack.length === 0 && (
            <tr><td colSpan={canUpload ? 8 : 7}>
              <EmptyState
                icon={Inbox}
                title="No documents yet"
                body={canUpload ? 'Use Add documents above to upload the tender pack, then start processing.' : 'The Bidding Manager uploads the tender pack here.'}
              />
            </td></tr>
          )}
        </tbody>
      </table>

      <UploadDialog
        open={uploadOpen}
        title="Add documents to the tender pack"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm"
        hint="PDF, Word or Excel formats accepted. Files are stored as uploaded; processing is a separate step."
        confirmLabel="Confirm upload"
        onClose={() => setUploadOpen(false)}
        onConfirm={confirmUpload}
        rejectFile={(f) => (t.pack.some((d) => d.name === f.name && d.sizeBytes === f.size)
          ? 'the same file (name and size) is already in this tender pack' : undefined)}
      />

      <ConfirmDialog
        open={confirmReprocess}
        title="Reprocess the tender documents?"
        confirmLabel="Reprocess documents"
        onClose={() => setConfirmReprocess(false)}
        onConfirm={() => { setConfirmReprocess(false); runProcessing(); }}
      >
        <p>
          Reprocessing regenerates everything extracted from the documents:
          the <b>{t.checklist.length} submission documents</b>, <b>{t.quals.length} qualification
          requirements</b> and <b>{t.clauses.length} clauses</b>.
        </p>
        {(withCompliance > 0 || withRemarks > 0 || withDrafts > 0) && (
          <div className="ref-issue" role="status">
            <AlertTriangle size={13} aria-hidden /> Work already done on these results:
            {withCompliance > 0 && <> {withCompliance} clause{withCompliance === 1 ? ' has a' : 's have a'} compliance status;</>}
            {withRemarks > 0 && <> {withRemarks} clause{withRemarks === 1 ? ' has a' : 's have'} remark{withRemarks === 1 ? '' : 's'};</>}
            {withDrafts > 0 && <> {withDrafts} submission document{withDrafts === 1 ? ' has a' : 's have'} generated draft{withDrafts === 1 ? '' : 's'};</>}
            {' '}these are carried over where the same item is found again, but anything on items
            that are no longer found will be lost.
          </div>
        )}
        <p className="muted small">The job takes minutes to about 20 minutes for large packs. Results stay visible until it finishes.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleteDoc}
        title="Delete document"
        confirmLabel="Delete document"
        danger
        onClose={() => setDeleteDoc(null)}
        onConfirm={() => {
          if (deleteDoc) {
            dispatch({ type: 'remove-pack-doc', tenderId: t.id, docId: deleteDoc.id });
            setDeleteDoc(null);
            toast.push('success', 'Document deleted', `${deleteDoc.name} was removed from the tender pack.`);
          }
        }}
      >
        {deleteImpact && (deleteImpact.clauses + deleteImpact.checklist + deleteImpact.quals > 0) ? (
          <>
            <p>
              <b>{deleteImpact.clauses} clause{deleteImpact.clauses === 1 ? '' : 's'}</b>,{' '}
              <b>{deleteImpact.checklist} checklist item{deleteImpact.checklist === 1 ? '' : 's'}</b> and{' '}
              <b>{deleteImpact.quals} qualification requirement{deleteImpact.quals === 1 ? '' : 's'}</b> come from{' '}
              <b>{deleteDoc?.name}</b>. They will be removed on the next processing run.
            </p>
            <p className="muted small">The file itself is kept recoverable for 30 days (soft delete).</p>
          </>
        ) : (
          <>
            <p>Delete <b>{deleteDoc?.name}</b> from this tender pack? No extracted results come from it yet.</p>
            <p className="muted small">The file itself is kept recoverable for 30 days (soft delete).</p>
          </>
        )}
      </ConfirmDialog>
    </section>
  );

  function confirmUpload(staged: StagedFile[]) {
    const docs: PackDoc[] = staged.map((s, index) => ({
      id: `upload-${Date.now()}-${index}`,
      name: s.file.name,
      sizeBytes: s.file.size,
      role: 'Unclassified',
      pages: 0,
      status: 'Uploaded',
    }));
    dispatch({ type: 'add-pack-docs', tenderId: t.id, docs });
    setUploadOpen(false);
    toast.push('success', `${docs.length} document${docs.length > 1 ? 's' : ''} uploaded`, t.lastProcessedAt
      ? 'Stored. Results are now out of date - reprocess when the pack is complete.'
      : 'Stored as uploaded - nothing is processed until you start processing.');
  }

  function fileType(name: string) {
    const extension = name.split('.').pop();
    return extension && extension !== name ? extension.toUpperCase() : '-';
  }
}

// ---- Tender pack tab strip -----------------------------------------------------

export function TenderPackSection({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  // "Back to tender" reopens the tab the user left from
  const [tab, setTab] = useState(() => state.packTabRequest ?? 'upload');
  const { requestLeave } = useLeaveGuard();
  useEffect(() => { if (state.packTabRequest) dispatch({ type: 'clear-pack-tab-request' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const extractionAvailable = t.clauses.length > 0 || t.checklist.length > 0;
  useEffect(() => {
    if (!extractionAvailable && tab !== 'upload') setTab('upload');
  }, [extractionAvailable, tab]);
  const lockedHint = t.pack.length === 0
    ? 'Upload and process the tender documents to unlock this tab'
    : 'Unlocks once the documents have been processed';
  return (
    <section className="tender-pack-tabs">
      <TabsBar
        tabs={[
          { key: 'upload', label: 'Documents' },
          { key: 'checklist', label: 'Submission', disabled: !extractionAvailable, disabledHint: lockedHint },
          { key: 'quals', label: 'Qualification', disabled: !extractionAvailable, disabledHint: lockedHint },
          { key: 'clauses', label: 'Clauses', disabled: !extractionAvailable, disabledHint: lockedHint },
        ]}
        active={tab}
        onChange={(k) => requestLeave(() => setTab(k))}
        sticky
        stickyBelow
      />
      {tab === 'upload' && <PackSection t={t} />}
      {tab === 'checklist' && <SubmissionSection t={t} />}
      {tab === 'quals' && <QualSection t={t} />}
      {tab === 'clauses' && <ClausesSection t={t} />}
    </section>
  );
}

// ---- Submission requirements -----------------------------------------------
// What has to be submitted (extracted from the tender pack). Each submission
// document can have a template selected - "Find suitable templates" proposes
// matches from the library automatically, and the user can change the pick.
// Where a template is selected, AI can generate a first draft from it.

export function SubmissionSection({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const { show } = useCitation();
  const canGen = canDo.generateDocs(state.role) && !isTenderLocked(t);
  const search = t.templateSearch;
  const [generating, setGenerating] = useState<string | null>(null);
  // changing the template of an already generated document discards the draft
  const [pendingTemplate, setPendingTemplate] = useState<{ item: Tender['checklist'][number]; templateId?: string } | null>(null);

  const items = [...t.checklist].sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (items.length === 0) {
    return <EmptyState icon={Inbox} title="No submission requirements yet" body="The documents to submit are extracted from the General Requirements document once the pack is processed." />;
  }

  /** Which template type fits a submission document, by its wording. */
  const wantedType = (itemText: string) => {
    const text = itemText.toLowerCase();
    return text.includes('compliance') ? 'Compliance table'
      : /cover|form of tender|declaration|acknowledgement|nda/.test(text) ? 'Cover letter'
        : /acra|profile|company|financial/.test(text) ? 'Company profile'
          : /cv|personnel|track record|reference/.test(text) ? 'Form'
            : null;
  };

  const matchReason = (k: Tender['checklist'][number]) => {
    if (!k.templateId || search?.status !== 'done') return null;
    return search.matches.find((m) => m.templateId === k.templateId)?.reason ?? null;
  };

  const runSearch = () => {
    dispatch({ type: 'template-search-start', tenderId: t.id });
    window.setTimeout(() => {
      const agencyTemplates = state.templates.filter((tpl) => tpl.agency !== 'Generic' && tpl.agency === t.agency);
      const matches = agencyTemplates.map((tpl) => ({
        templateId: tpl.id,
        reason: `Agency name matches ${tpl.agency}`,
      }));
      const haveTypes = new Set(agencyTemplates.map((x) => x.type));
      for (const tpl of state.templates.filter((x) => x.agency === 'Generic')) {
        if (!haveTypes.has(tpl.type)) {
          matches.push({
            templateId: tpl.id,
            reason: t.type === 'Commercial'
              ? 'Type: Commercial - no agency template applies, generic offered'
              : `Type: Agency, but ${t.agency || 'this agency'} has no ${tpl.type.toLowerCase()} template - generic offered`,
          });
        }
      }
      dispatch({
        type: 'template-search-done',
        tenderId: t.id,
        search: { status: 'done', ranAt: new Date().toISOString(), matches, genericFallback: agencyTemplates.length === 0 },
      });
      // propose a template per submission document; the user can change it
      for (const k of t.checklist) {
        const want = wantedType(k.item);
        if (!want) continue;
        const m = matches.find((x) => state.templates.find((tpl) => tpl.id === x.templateId)?.type === want);
        if (m) dispatch({ type: 'patch-checklist', tenderId: t.id, itemId: k.id, patch: { templateId: m.templateId } });
      }
      toast.push('info', 'Template search finished', agencyTemplates.length
        ? `${agencyTemplates.length} agency template(s) matched. Suggested templates are filled in below - change any of them.`
        : 'No agency template matched; the generic fallbacks are suggested where they fit.');
    }, 1800);
  };

  const generateDraft = (k: Tender['checklist'][number]) => {
    setGenerating(k.id);
    window.setTimeout(() => {
      dispatch({
        type: 'patch-checklist', tenderId: t.id, itemId: k.id,
        patch: { draft: { templateId: k.templateId, status: 'Needs review', generatedAt: new Date().toISOString() } },
      });
      setGenerating(null);
      toast.push('success', 'First draft generated', `${k.item}: review the sections marked [TO COMPLETE] before use.`);
    }, 1600);
  };

  const isSheet = (k: Tender['checklist'][number]) => k.item.toLowerCase().includes('compliance');
  /** the generated file's name, shown in the table and used for the download */
  const draftFileName = (k: Tender['checklist'][number]) => `${k.item.replace(/\W+/g, '_').replace(/_+$/, '')}_draft.${isSheet(k) ? 'xls' : 'doc'}`;
  const previewDraft = (k: Tender['checklist'][number]) => {
    const isCompliance = isSheet(k);
    show({
      docId: k.id,
      title: `${k.item} (first draft)`,
      fileName: draftFileName(k),
      documentUrl: isCompliance ? '/mock-documents/MHA_business_case_demo.xlsm' : '/mock-documents/supplier-response.docx',
      similarity: 1,
      source: 'tender',
      tab: 'Generated first draft',
      excerpt: '',
    });
  };

  const downloadDraft = (k: Tender['checklist'][number]) => {
    const tpl = state.templates.find((x) => x.id === k.draft?.templateId);
    const html = `<html><head><meta charset="utf-8"></head><body><h1>${k.item}</h1><p><b>${t.ref || t.name}</b> - ${t.name}</p><p>Template: ${tpl ? `${tpl.name} (v${tpl.version})` : 'generic'}</p><p>First draft generated by TendrAI. Sections that could not be auto-filled are marked [TO COMPLETE].</p></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: isSheet(k) ? 'application/vnd.ms-excel' : 'application/msword' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = draftFileName(k);
    dispatch({ type: 'log', event: { action: 'Draft downloaded', detail: k.item, tenderId: t.id, section: 'Submission' } });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <PartialResultsBanner t={t} />
      <div className="review-toolbar">
        <span className="muted small">
          {search?.status === 'done' && search.ranAt
            ? <>Template search ran {ts(search.ranAt)}. Suggested templates are filled in per document - change any of them, then generate a first draft.</>
            : 'The documents required for submission. Find suitable templates to see which ones can be drafted from the library.'}
        </span>
        <span className="review-toolbar-actions">
          <LibraryUpload kind="template" returnTo={{ tenderId: t.id, packTab: 'checklist', label: t.name }} />
          {search?.status === 'searching' ? (
            <span className="muted small"><Loader2 size={14} aria-hidden className="spin-icon" /> Searching the template library...</span>
          ) : (
            <Button
              variant={search?.status === 'done' ? 'secondary' : 'primary'}
              compact
              icon={Search}
              disabled={!canGen}
              title={canGen ? undefined : 'Only the Bidding Manager matches templates and generates documents'}
              onClick={runSearch}
            >
              Find suitable templates
            </Button>
          )}
        </span>
      </div>
      {search?.status === 'done' && search.genericFallback && (
        <Banner kind="info">
          No {t.agency || 'agency'}-specific template exists in the library, so the generic formats
          are suggested. Upload an agency template on the Templates page to use it next time.
        </Banner>
      )}
      <table className="grid">
        <thead>
          <tr><th>Document to submit</th><th>Required format</th><th>Source</th><th>Matching template</th><th>First draft</th></tr>
        </thead>
        <tbody>
          {items.map((k) => {
            const reason = matchReason(k);
            return (
              <tr key={k.id}>
                <td><b>{k.item}</b></td>
                <td className="muted">{k.format}</td>
                <td className="muted small">
                  {k.sourceDoc} · clause {k.clause} · p.{citedPage(t, k.sourceDoc, k.clause)}
                  <div>
                    <button className="link-btn" type="button" onClick={() => show(sourceCitation(t, { sourceDoc: k.sourceDoc, clause: k.clause, excerpt: k.item }))}>View source</button>
                  </div>
                </td>
                <td>
                  <select
                    value={k.templateId ?? ''}
                    disabled={!canGen}
                    aria-label={`Template for ${k.item}`}
                    onChange={(e) => {
                      const next = e.target.value || undefined;
                      if (k.draft) setPendingTemplate({ item: k, templateId: next });
                      else dispatch({ type: 'patch-checklist', tenderId: t.id, itemId: k.id, patch: { templateId: next } });
                    }}
                  >
                    <option value="">None - prepared manually</option>
                    {state.templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.agency})</option>
                    ))}
                  </select>
                  {reason && <div className="muted small">{reason}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {generating === k.id ? (
                    <StatusPill value="Processing" />
                  ) : k.draft ? (
                    <span className="draft-file">
                      <FileText size={14} aria-hidden className="muted" />
                      <span className="draft-file-name" title={draftFileName(k)}>{draftFileName(k)}</span>
                      <IconButton label={`Preview draft of ${k.item}`} icon={Eye} onClick={() => previewDraft(k)} />
                      <IconButton label={`Download draft of ${k.item}`} icon={Download} onClick={() => downloadDraft(k)} />
                    </span>
                  ) : k.templateId ? (
                    <Button
                      compact
                      disabled={!canGen}
                      title={canGen ? undefined : 'Only the Bidding Manager generates documents'}
                      onClick={() => generateDraft(k)}
                    >
                      Generate draft
                    </Button>
                  ) : (
                    <span className="muted small">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmDialog
        open={pendingTemplate !== null}
        title="Change template and discard the draft?"
        confirmLabel="Change template and discard draft"
        danger
        onClose={() => setPendingTemplate(null)}
        onConfirm={() => {
          if (pendingTemplate) {
            dispatch({
              type: 'patch-checklist', tenderId: t.id, itemId: pendingTemplate.item.id,
              patch: { templateId: pendingTemplate.templateId, draft: undefined },
            });
            toast.push('info', 'Template changed', `${pendingTemplate.item.item}: the generated draft was removed. Generate a new draft from the new template.`);
          }
          setPendingTemplate(null);
        }}
      >
        <p>
          <b>{pendingTemplate?.item.item}</b> already has a generated first draft. Changing the
          template removes that draft - you would generate a new one from the new template.
        </p>
      </ConfirmDialog>
    </section>
  );
}

// ---- Qualification requirements ---------------------------------------------

/** Kind pills: one colour per kind so the mix is scannable at a glance. */
const QUAL_KIND_CLASS: Record<string, string> = {
  'Role': 'pill-agency',
  'Experience': 'pill-active',
  'Certification': 'pill-won',
  'Past project': 'pill-pending',
};

const QUAL_KINDS = ['Role', 'Experience', 'Certification', 'Past project'] as const;

export function QualSection({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const { show } = useCitation();
  const [kind, setKind] = useState('');
  const [matching, setMatching] = useState(false);
  const canLink = canDo.generateDocs(state.role) && !isTenderLocked(t);
  if (t.quals.length === 0) {
    return <EmptyState icon={Inbox} title="No qualification requirements yet" body="Roles, experience, certifications and past projects are extracted once the pack is processed." />;
  }
  const counts = QUAL_KINDS.map((k) => ({ k, n: t.quals.filter((q) => q.kind === k).length }));
  const shown = kind ? t.quals.filter((q) => q.kind === kind) : t.quals;
  const today = new Date().toISOString().slice(0, 10);
  const certs = state.boilerplate.filter((b) => b.type === 'Certification');

  const certQuals = t.quals.filter((q) => q.kind === 'Certification');
  /** Certificate linked to a certification requirement (picked or matched). */
  const certFor = (q: Tender['quals'][number]) =>
    q.kind === 'Certification' ? certs.find((c) => c.id === q.evidence) : undefined;
  /** Library certificate whose name appears in the requirement wording. */
  const suggestCert = (q: Tender['quals'][number]) => {
    const text = q.requirement.toLowerCase();
    return certs.find((c) => text.includes(c.name.toLowerCase().replace(/ certificate$/, '')));
  };
  const findMatches = () => {
    setMatching(true);
    window.setTimeout(() => {
      let linked = 0;
      for (const q of certQuals) {
        const m = suggestCert(q);
        if (m) {
          linked += 1;
          if (m.id !== q.evidence) dispatch({ type: 'patch-qual', tenderId: t.id, qualId: q.id, patch: { evidence: m.id } });
        }
      }
      setMatching(false);
      toast.push(linked === certQuals.length ? 'success' : 'info', 'Certificate search finished', `${linked} of ${certQuals.length} certification requirement${certQuals.length === 1 ? '' : 's'} matched to a library certificate${linked < certQuals.length ? ' - upload or pick the rest manually' : ''}.`);
    }, 1300);
  };
  const previewCert = (c: typeof certs[number]) => show({
    docId: c.id, title: c.name, fileName: `${c.name.replace(/\W+/g, '_')}.pdf`,
    documentUrl: '/mock-documents/certificate-demo.pdf', similarity: 1, source: 'tender', tab: `v${c.version}`, excerpt: '',
  });
  const downloadCert = (c: typeof certs[number]) => {
    const a = document.createElement('a');
    a.href = '/mock-documents/certificate-demo.pdf';
    a.download = `${c.name.replace(/\W+/g, '_')}_v${c.version}.pdf`;
    a.click();
    dispatch({ type: 'log', event: { action: 'Certificate downloaded', detail: `${c.name} v${c.version}`, tenderId: t.id, section: 'Qualification' } });
    toast.push('success', 'Certificate downloaded', `${c.name} v${c.version}`);
  };

  return (
    <section>
      <PartialResultsBanner t={t} />
      <div className="filter-row">
        {counts.map(({ k, n }) => (
          <button key={k} className={`cat-chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>
            {k} <b>{n}</b>
          </button>
        ))}
        <span className="review-toolbar-actions">
          <LibraryUpload kind="certification" returnTo={{ tenderId: t.id, packTab: 'quals', label: t.name }} />
          {matching ? (
            <span className="muted small"><Loader2 size={14} aria-hidden className="spin-icon" /> Searching the certificate library...</span>
          ) : (
            <Button
              variant="secondary"
              compact
              icon={Search}
              disabled={!canLink || certQuals.length === 0}
              title={!canLink ? 'Only the Bidding Manager links certificates' : certQuals.length === 0 ? 'This tender has no certification requirements' : undefined}
              onClick={findMatches}
            >
              Find matching certificates
            </Button>
          )}
        </span>
      </div>
      <table className="grid">
        <thead><tr><th>Kind</th><th>Requirement</th><th>Source</th><th>Certificate on file</th></tr></thead>
        <tbody>
          {shown.map((q) => {
            const cert = certFor(q);
            return (
              <tr key={q.id}>
                <td><span className={`pill ${QUAL_KIND_CLASS[q.kind] ?? 'pill-neutral'}`}>{q.kind}</span></td>
                <td>{q.requirement}</td>
                <td className="muted small">
                  {q.sourceDoc} · clause {q.clause} · p.{citedPage(t, q.sourceDoc, q.clause)}{' '}
                  <button className="link-btn" type="button" onClick={() => show(sourceCitation(t, { sourceDoc: q.sourceDoc, clause: q.clause, excerpt: q.requirement }))}>View source</button>
                </td>
                <td>
                  {q.kind !== 'Certification' ? (
                    <span className="muted">-</span>
                  ) : (
                    <span className="cert-cell">
                      <span>
                        <select
                          value={cert?.id ?? ''}
                          disabled={!canLink}
                          aria-label={`Certificate for ${q.requirement}`}
                          onChange={(e) => dispatch({ type: 'patch-qual', tenderId: t.id, qualId: q.id, patch: { evidence: e.target.value || undefined } })}
                        >
                          <option value="">None linked</option>
                          {certs.map((c) => <option key={c.id} value={c.id}>{c.name} (v{c.version})</option>)}
                        </select>
                        {cert?.expires && cert.expires < today && (
                          <span className="attn" style={{ display: 'flex' }}><AlertTriangle size={12} aria-hidden /> Expired {dateShort(cert.expires)}</span>
                        )}
                      </span>
                      {cert && <IconButton label={`Preview ${cert.name}`} icon={Eye} onClick={() => previewCert(cert)} />}
                      {cert && <IconButton label={`Download ${cert.name}`} icon={Download} onClick={() => downloadCert(cert)} />}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {shown.length === 0 && <tr><td colSpan={4} className="muted">No {kind.toLowerCase()} requirements in this tender.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

// ---- Clause review -----------------------------------------------------------

export function ClausesSection({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const editable = canDo.editClauses(state.role) && !isTenderLocked(t);
  const [cat, setCat] = useState('');
  const [confirmExport, setConfirmExport] = useState<null | 'excel' | 'word'>(null);
  // edits are held here until "Save changes" - one audit entry per save
  const [pending, setPending] = useState<Record<string, Partial<Pick<Clause, 'compliance' | 'category' | 'response'>>>>({});
  const edit = (c: Clause, patch: Partial<Pick<Clause, 'compliance' | 'category' | 'response'>>) =>
    setPending((cur) => {
      const merged = { ...cur[c.id], ...patch };
      // drop fields that are back to the saved value
      for (const k of Object.keys(merged) as (keyof typeof merged)[]) if (merged[k] === c[k]) delete merged[k];
      const next = { ...cur };
      if (Object.keys(merged).length) next[c.id] = merged; else delete next[c.id];
      return next;
    });
  const pendingRows = Object.keys(pending).length;
  const pendingFields = Object.values(pending).reduce((n, p) => n + Object.keys(p).length, 0);
  const saveClauses = () => {
    dispatch({ type: 'save-clauses', tenderId: t.id, patches: Object.entries(pending).map(([clauseId, patch]) => ({ clauseId, patch })) });
    toast.push('success', 'Clause changes saved', `${pendingFields} change${pendingFields === 1 ? '' : 's'} on ${pendingRows} clause${pendingRows === 1 ? '' : 's'} saved.`);
    setPending({});
  };
  useUnsavedChanges(pendingRows ? `${pendingFields} unsaved change${pendingFields === 1 ? '' : 's'} on ${pendingRows} clause${pendingRows === 1 ? '' : 's'}` : null, () => setPending({}));
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const toggleHistory = (id: string) => setOpenHistory((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [doc, setDoc] = useState('');
  const { show } = useCitation();
  const { sort, toggle, apply } = useSort();
  const clauseFilters = useColFilters();

  const docs = useMemo(() => [...new Set(t.clauses.map((c) => c.sourceDoc))], [t.clauses]);

  const filtered = t.clauses.filter((c) => {
    if (cat && c.category !== cat) return false;
    if (doc && c.sourceDoc !== doc) return false;
    return true;
  });
  const clauseAccessors = {
    number: (c: Clause) => c.number,
    text: (c: Clause) => c.text,
    category: (c: Clause) => c.category,
    source: (c: Clause) => c.sourceDoc,
    compliance: (c: Clause) => c.compliance,
    response: (c: Clause) => c.response,
  };
  const shown = apply(clauseFilters.apply(filtered, clauseAccessors), clauseAccessors);
  const filterColumn = (key: keyof typeof clauseAccessors) => ({
    filterValues: t.clauses.map((c) => String(clauseAccessors[key](c))),
    filter: clauseFilters.filters[key],
    onFilter: (filter: Parameters<typeof clauseFilters.set>[1]) => clauseFilters.set(key, filter),
  });

  if (t.clauses.length === 0) {
    return <EmptyState icon={Inbox} title="No clauses extracted yet" body="Clauses appear here once the tender pack has been processed." />;
  }

  const counts = CATEGORIES.map((c) => ({ c, n: t.clauses.filter((x) => x.category === c).length }));
  const clausesFileName = `${t.name}-${t.agency}-clauses`.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim();
  // gaps the user is warned about before downloading (download still allowed)
  const unsetCount = t.clauses.filter((c) => c.compliance === 'Unset').length;
  const emptyRemarks = t.clauses.filter((c) => !c.response.trim()).length;
  const requestExport = (which: 'excel' | 'word') => {
    if (unsetCount || emptyRemarks) setConfirmExport(which);
    else (which === 'excel' ? exportExcel : exportWord)();
  };
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const rows = t.clauses.map((c) => [c.number, c.text, c.compliance, c.response]);
    const sheet = XLSX.utils.aoa_to_sheet([
      [`Clauses and compliance - ${t.ref || t.name}`],
      ['Clause', 'Requirement', 'Compliance', 'Remarks'],
      ...rows,
    ]);
    sheet['!cols'] = [{ wch: 10 }, { wch: 80 }, { wch: 18 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, sheet, 'Clauses');
    // compliance cells keep the same choices as the table's dropdown
    writeXlsxWithDropdowns(wb, `${clausesFileName}.xlsx`, [
      { sqref: `C3:C${2 + Math.max(1, t.clauses.length)}`, options: COMPLIANCE_OPTIONS },
    ]);
    toast.push('success', 'Clauses exported', 'Excel file downloaded - the Compliance column has a dropdown on every row.');
    dispatch({ type: 'log', event: { action: 'Clauses exported', detail: `Excel, ${t.clauses.length} clauses`, tenderId: t.id, section: 'Clauses' } });
  };
  const exportWord = () => {
    const html = `<html><head><meta charset="utf-8"></head><body><h1>Clauses and compliance - ${t.ref || t.name}</h1><table border="1" cellspacing="0" cellpadding="4"><tr><th>Clause</th><th>Requirement</th><th>Compliance</th><th>Remarks</th></tr>${t.clauses.map((c) => `<tr><td>${c.number}</td><td>${c.text}</td><td>${c.compliance}</td><td>${c.response}</td></tr>`).join('')}</table></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'application/msword' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clausesFileName}.doc`;
    a.click();
    URL.revokeObjectURL(url);
    toast.push('success', 'Clauses exported', 'Word document downloaded.');
    dispatch({ type: 'log', event: { action: 'Clauses exported', detail: `Word, ${t.clauses.length} clauses`, tenderId: t.id, section: 'Clauses' } });
  };

  return (
    <section>
      <PartialResultsBanner t={t} />
      <div className="review-toolbar">
        <span className="review-progress">
          {t.clauses.length} clauses extracted
          {pendingRows > 0 && <span className="attn" style={{ marginLeft: 12 }}>{pendingFields} unsaved change{pendingFields === 1 ? '' : 's'} on {pendingRows} clause{pendingRows === 1 ? '' : 's'}</span>}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {pendingRows > 0 ? (
            <>
              <Button compact onClick={() => setPending({})}>Discard changes</Button>
              <Button compact variant="primary" onClick={saveClauses}>Save changes</Button>
            </>
          ) : (
            <>
              <Button compact icon={Download} onClick={() => requestExport('excel')}>Export Excel</Button>
              <Button compact icon={Download} onClick={() => requestExport('word')}>Export Word</Button>
              <Button
                compact
                variant="primary"
                icon={History}
                title="Open the Audit log filtered to the clause changes of this tender"
                onClick={() => dispatch({ type: 'open-audit', tender: t.ref || t.name, section: 'Clauses', returnTo: { tenderId: t.id, packTab: 'clauses', label: t.name } })}
              >
                View history
              </Button>
            </>
          )}
        </span>
      </div>
      <div className="filter-row">
        {counts.map(({ c, n }) => (
          <button key={c} className={`cat-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? '' : c)}>
            {c} <b>{n}</b>
          </button>
        ))}
        <select value={doc} onChange={(e) => setDoc(e.target.value)} aria-label="Filter by document">
          <option value="">All documents</option>
          {docs.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th aria-label="Change history" />
            <SortTh label="Clause" k="number" sort={sort} onToggle={toggle} {...filterColumn('number')} />
            <SortTh label="Text" k="text" sort={sort} onToggle={toggle} {...filterColumn('text')} />
            <SortTh label="Category" k="category" sort={sort} onToggle={toggle} {...filterColumn('category')} />
            <SortTh label="Source" k="source" sort={sort} onToggle={toggle} {...filterColumn('source')} />
            <SortTh label="Compliance" k="compliance" sort={sort} onToggle={toggle} {...filterColumn('compliance')} />
            <SortTh label="Remarks" k="response" sort={sort} onToggle={toggle} {...filterColumn('response')} />
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <Fragment key={c.id}>
            <tr>
              <td className="expand-cell">
                {c.history?.length ? (
                  <button
                    className="expand-btn"
                    aria-expanded={openHistory.has(c.id)}
                    aria-label={`${openHistory.has(c.id) ? 'Hide' : 'Show'} change history of clause ${c.number}`}
                    title={`${c.history.length} earlier change${c.history.length > 1 ? 's' : ''}`}
                    onClick={() => toggleHistory(c.id)}
                  >
                    {openHistory.has(c.id) ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  </button>
                ) : null}
              </td>
              <td className="mono" style={{ whiteSpace: 'nowrap' }}>{c.number}</td>
              <td className="desc">
                {c.text}
                {c.refIssue && (
                  <div className="ref-issue">
                    <AlertTriangle size={13} aria-hidden /> <b>Check reference:</b> {c.refIssue}{' '}
                    <span className="muted small">({c.sourceDoc}, p.{c.page})</span>
                  </div>
                )}
                {c.subTags.length > 0 && (
                  <div className="muted small">Tags: {c.subTags.join(', ')}</div>
                )}
              </td>
              <td>
                {editable ? (
                  <select
                    value={pending[c.id]?.category ?? c.category}
                    aria-label={`Category of clause ${c.number}`}
                    className={pending[c.id]?.category !== undefined ? 'cell-changed' : undefined}
                    onChange={(e) => edit(c, { category: e.target.value as ClauseCategory })}
                  >
                    {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                  </select>
                ) : <span className="badge badge-neutral">{c.category}</span>}
              </td>
              <td className="muted small">
                {c.sourceDoc} · p.{c.page}
                <div>
                  <button className="link-btn" onClick={() => show(sourceCitation(t, { sourceDoc: c.sourceDoc, clause: c.number, excerpt: c.text, page: c.page }))}>
                    View source
                  </button>
                </div>
              </td>
              <td>
                {editable ? (
                  <select
                    value={pending[c.id]?.compliance ?? c.compliance}
                    aria-label={`Compliance for clause ${c.number}`}
                    className={pending[c.id]?.compliance !== undefined ? 'cell-changed' : undefined}
                    onChange={(e) => edit(c, { compliance: e.target.value as Clause['compliance'] })}
                  >
                    {COMPLIANCE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : <StatusPill value={c.compliance} />}
              </td>
              <td className={`desc${pending[c.id]?.response !== undefined ? ' cell-changed-td' : ''}`}>
                <TextCell value={pending[c.id]?.response ?? c.response} editable={editable} placeholder="Add remark" onCommit={(v) => edit(c, { response: v })} />
              </td>
            </tr>
            {openHistory.has(c.id) && c.history?.length ? (
              <tr className="expand-row">
                <td />
                <td colSpan={6}>
                  <div className="muted small" style={{ margin: '4px 0' }}>Change history of clause {c.number} (latest first):</div>
                  <table className="grid narrow">
                    <thead><tr><th>When</th><th>By</th><th>Field</th><th>Previous value</th><th>Changed to</th></tr></thead>
                    <tbody>
                      {[...c.history].reverse().map((h, i) => (
                        <tr key={i}>
                          <td className="muted" style={{ whiteSpace: 'nowrap' }}>{ts(h.ts)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{h.by}</td>
                          <td>{h.field}</td>
                          <td className="muted">{h.from || <i>(empty)</i>}</td>
                          <td>{h.to || <i>(empty)</i>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            ) : null}
            </Fragment>
          ))}
          {shown.length === 0 && <tr><td colSpan={7} className="muted">No clauses match these filters.</td></tr>}
        </tbody>
      </table>

      <ConfirmDialog
        open={confirmExport !== null}
        title="Some clauses are not filled in yet"
        confirmLabel="Download anyway"
        onClose={() => setConfirmExport(null)}
        onConfirm={() => {
          if (confirmExport === 'excel') exportExcel();
          if (confirmExport === 'word') exportWord();
          setConfirmExport(null);
        }}
      >
        <p>
          {unsetCount > 0 && <><b>{unsetCount} clause{unsetCount === 1 ? ' has' : 's have'}</b> compliance still set to "Unset". </>}
          {emptyRemarks > 0 && <><b>{emptyRemarks} clause{emptyRemarks === 1 ? ' has' : 's have'}</b> no remark. </>}
          The export will contain these gaps - you can download it now and fill them in later.
        </p>
      </ConfirmDialog>
    </section>
  );
}
