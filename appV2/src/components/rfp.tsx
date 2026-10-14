// RFP intelligence sections: tender pack, submission checklist, qualification
// requirements, clause review, compliance table and the per-tender template
// flow. All "AI" results are pre-built mock data; every extracted item shows
// its source and review state.
//
// The processing model mirrors the real backend: uploads are stored instantly,
// ONE job per tender runs six named stages (no percentages, no precise ETA),
// failed documents carry a reason and a Retry, and changing the document set
// after a run marks the results out of date instead of mutating them.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  FileUp,
  GripVertical,
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
import { useCitation } from '../ui/citation';
import { SortTh, StatusPill, TextCell, useColFilters, useSort } from './common';
import { Banner, Button, ConfirmDialog, EmptyState, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import { ts } from '../lib/format';

const DOC_ROLES: PackDocRole[] = ['General Requirements', 'Technical Specification', 'Commercial Conditions', 'Legal Conditions', 'Forms and Annexes', 'Unclassified'];
const CATEGORIES: ClauseCategory[] = ['Commercial', 'Technical', 'Legal', 'Finance', 'HR'];

/** Demo files exist for two of the mock documents; everything else renders the
 *  built-in page viewer (with page navigation) instead of a stale stand-in. */
const demoSourceUrl = (sourceDoc: string) => {
  const s = sourceDoc.toLowerCase();
  if (s === 'general requirements.pdf') return '/mock-documents/general-requirements.pdf';
  if (s === 'technical specification.pdf') return '/mock-documents/technical-specification.pdf';
  return undefined;
};

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
  const [uploadQueue, setUploadQueue] = useState<PackDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [deleteDoc, setDeleteDoc] = useState<PackDoc | null>(null);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const canUpload = canDo.uploadPack(state.role) && !isTenderLocked(t);
  const jobRunning = !!t.job;
  const { sort, toggle, apply } = useSort();
  const packFilters = useColFilters();

  useEffect(() => {
    if (!uploadQueue.length) return;
    setUploading(true);
    const next = uploadQueue[0];
    const timer = window.setTimeout(() => {
      dispatch({ type: 'add-pack-docs', tenderId: t.id, docs: [next] });
      setUploadQueue((queue) => queue.slice(1));
      setUploadedCount((count) => count + 1);
      if (uploadQueue.length === 1) {
        setUploading(false);
        setUploadTotal(0);
        setUploadedCount(0);
        toast.push('success', 'Documents stored', 'Files are stored as uploaded - nothing is processed until you start processing.');
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [dispatch, t.id, toast, uploadQueue]);

  const startProcessing = () => {
    dispatch({ type: 'start-processing', tenderId: t.id });
    toast.push('info', 'Processing started', 'One job runs per tender. Changes to the document set are locked until it finishes.');
  };

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

  const uploadProgress = uploading && uploadQueue.length > 0 ? (
    <div className="upload-progress" aria-live="polite">
      <div className="upload-progress-label">
        <span>Uploading {uploadQueue[0].name}</span>
        <span>{uploadedCount} of {uploadTotal}</span>
      </div>
      <div className="upload-progress-track">
        <div className="upload-progress-bar" style={{ width: `${uploadTotal ? (uploadedCount / uploadTotal) * 100 : 0}%` }} />
      </div>
    </div>
  ) : null;

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
      <div className="section-heading">
        <div className="muted small">
          {t.pack.length === 0
            ? 'Upload the tender pack (up to about 30 PDFs). Files are stored immediately; processing is a separate step.'
            : t.lastProcessedAt
              ? <>Last processed {ts(t.lastProcessedAt)}.</>
              : 'Documents are stored but not processed yet.'}
        </div>
        <div className="section-heading-actions document-actions">
          {canUpload && (
            <>
              <input
                type="file"
                multiple
                className="sr-only"
                id={`pack-upload-${t.id}`}
                aria-label="Add documents to this pack"
                disabled={jobRunning}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <label
                htmlFor={`pack-upload-${t.id}`}
                className={`btn btn-secondary btn-compact ${jobRunning ? 'btn-disabled-label' : ''}`}
                title={jobRunning ? 'Locked while a processing job is running' : undefined}
                aria-disabled={jobRunning}
                onClick={(e) => { if (jobRunning) e.preventDefault(); }}
              >
                <FileUp size={14} aria-hidden /> Add documents
              </label>
            </>
          )}
          {!jobRunning && canUpload && hasDocs && !t.outOfDate && (
            <Button
              variant="primary"
              compact
              disabled={!!processDisabledReason}
              title={processDisabledReason}
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
      {uploadProgress}

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
                body={canUpload ? 'Add the tender pack documents, then start processing.' : 'The Bidding Manager uploads the tender pack here.'}
                action={canUpload ? (
                  <label htmlFor={`pack-upload-${t.id}`} className="btn btn-primary">
                    <FileUp size={16} aria-hidden /> Add documents
                  </label>
                ) : undefined}
              />
            </td></tr>
          )}
        </tbody>
      </table>

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

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const docs: PackDoc[] = Array.from(files).map((file, index) => ({
      id: `upload-${Date.now()}-${index}`,
      name: file.name,
      role: 'Unclassified',
      pages: 0,
      status: 'Uploaded',
    }));
    setUploadQueue((queue) => [...queue, ...docs]);
    setUploadTotal((total) => total + docs.length);
    setUploadedCount((count) => uploadQueue.length ? count : 0);
  }

  function fileType(name: string) {
    const extension = name.split('.').pop();
    return extension && extension !== name ? extension.toUpperCase() : '-';
  }
}

// ---- Tender pack tab strip -----------------------------------------------------

export function TenderPackSection({ t }: { t: Tender }) {
  const [tab, setTab] = useState('upload');
  const extractionAvailable = t.clauses.length > 0 || t.checklist.length > 0;
  useEffect(() => {
    if (!extractionAvailable && tab !== 'upload') setTab('upload');
  }, [extractionAvailable, tab]);
  return (
    <section className="tender-pack-tabs">
      <TabsBar
        tabs={[
          { key: 'upload', label: 'Documents' },
          { key: 'checklist', label: 'Submission', disabled: !extractionAvailable },
          { key: 'quals', label: 'Qualification', disabled: !extractionAvailable },
          { key: 'clauses', label: 'Clauses', disabled: !extractionAvailable },
        ]}
        active={tab}
        onChange={setTab}
        sticky
        stickyBelow
      />
      {!extractionAvailable && tab === 'upload' && t.pack.length > 0 && !t.job && !t.processFailed && (
        <p className="muted small">Submission, qualification and clauses unlock once the documents have been processed.</p>
      )}
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
      for (const tpl of state.templates.filter((x) => x.agency === 'Generic' && x.type !== 'MSPO plan')) {
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

  const previewDraft = (k: Tender['checklist'][number]) => {
    const isCompliance = k.item.toLowerCase().includes('compliance');
    show({
      docId: k.id,
      title: `${k.item} (first draft)`,
      fileName: `${k.item.replace(/\W+/g, '_')}.${isCompliance ? 'xlsx' : 'docx'}`,
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
    const url = URL.createObjectURL(new Blob([html], { type: 'application/msword' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${k.item.replace(/\W+/g, '_')}_draft.doc`;
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
                  {k.sourceDoc} · clause {k.clause}
                  <div>
                    <button className="link-btn" type="button" onClick={() => show({ docId: k.sourceDoc, title: k.sourceDoc, fileName: k.sourceDoc, documentUrl: demoSourceUrl(k.sourceDoc), similarity: 1, source: 'tender', tab: `Clause ${k.clause}`, page: 6, pageCount: t.pack.find((d) => d.name === k.sourceDoc)?.pages || undefined, excerpt: k.item, context: k.format })}>View source</button>
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
                    {state.templates.filter((tpl) => tpl.type !== 'MSPO plan').map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.agency})</option>
                    ))}
                  </select>
                  {reason && <div className="muted small">{reason}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {generating === k.id ? (
                    <StatusPill value="Processing" />
                  ) : k.draft ? (
                    <span className="row-actions">
                      <IconButton label={`Preview draft of ${k.item}`} icon={Eye} onClick={() => previewDraft(k)} />
                      <Button compact icon={Download} onClick={() => downloadDraft(k)}>Download</Button>
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
  const { show } = useCitation();
  const [kind, setKind] = useState('');
  if (t.quals.length === 0) {
    return <EmptyState icon={Inbox} title="No qualification requirements yet" body="Roles, experience, certifications and past projects are extracted once the pack is processed." />;
  }
  const counts = QUAL_KINDS.map((k) => ({ k, n: t.quals.filter((q) => q.kind === k).length }));
  const shown = kind ? t.quals.filter((q) => q.kind === kind) : t.quals;
  return (
    <section>
      <PartialResultsBanner t={t} />
      <div className="filter-row">
        {counts.map(({ k, n }) => (
          <button key={k} className={`cat-chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>
            {k} <b>{n}</b>
          </button>
        ))}
      </div>
      <table className="grid">
        <thead><tr><th>Kind</th><th>Requirement</th><th>Source</th></tr></thead>
        <tbody>
          {shown.map((q) => (
            <tr key={q.id}>
              <td><span className={`pill ${QUAL_KIND_CLASS[q.kind] ?? 'pill-neutral'}`}>{q.kind}</span></td>
              <td>{q.requirement}</td>
              <td className="muted small">
                {q.sourceDoc} · clause {q.clause}{' '}
                <button className="link-btn" type="button" onClick={() => show({ docId: q.sourceDoc, title: q.sourceDoc, fileName: q.sourceDoc, documentUrl: demoSourceUrl(q.sourceDoc), similarity: 1, source: 'tender', tab: `Clause ${q.clause}`, page: 10, pageCount: t.pack.find((d) => d.name === q.sourceDoc)?.pages || undefined, excerpt: q.requirement })}>View source</button>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={3} className="muted">No {kind.toLowerCase()} requirements in this tender.</td></tr>}
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
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`Clauses and compliance - ${t.ref || t.name}`],
      ['Clause', 'Requirement', 'Compliance', 'Remarks'],
      ...rows,
    ]), 'Clauses');
    XLSX.writeFile(wb, `${clausesFileName}.xlsx`);
    toast.push('success', 'Clauses exported', 'Excel file downloaded.');
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
  };

  return (
    <section>
      <PartialResultsBanner t={t} />
      <div className="review-toolbar">
        <span className="review-progress">{t.clauses.length} clauses extracted</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button compact icon={Download} onClick={() => requestExport('excel')}>Export Excel</Button>
          <Button compact icon={Download} onClick={() => requestExport('word')}>Export Word</Button>
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
            <tr key={c.id}>
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
                    value={c.category}
                    aria-label={`Category of clause ${c.number}`}
                    onChange={(e) => dispatch({ type: 'patch-clause', tenderId: t.id, clauseId: c.id, patch: { category: e.target.value as ClauseCategory } })}
                  >
                    {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                  </select>
                ) : <span className="badge badge-neutral">{c.category}</span>}
              </td>
              <td className="muted small">
                {c.sourceDoc} · p.{c.page}
                <div>
                  <button className="link-btn" onClick={() => show({ docId: c.sourceDoc, title: c.sourceDoc, fileName: c.sourceDoc, documentUrl: demoSourceUrl(c.sourceDoc), similarity: 1, source: 'tender', tab: `Clause ${c.number} · page ${c.page}`, page: c.page, pageCount: t.pack.find((d) => d.name === c.sourceDoc)?.pages || undefined, excerpt: c.text })}>
                    View source
                  </button>
                </div>
              </td>
              <td>
                {editable ? (
                  <select
                    value={c.compliance}
                    aria-label={`Compliance for clause ${c.number}`}
                    onChange={(e) => dispatch({ type: 'patch-clause', tenderId: t.id, clauseId: c.id, patch: { compliance: e.target.value as Clause['compliance'] } })}
                  >
                    <option>Unset</option><option>Comply</option><option>Partially comply</option><option>Do not comply</option><option>Clarify</option>
                  </select>
                ) : <StatusPill value={c.compliance} />}
              </td>
              <td className="desc">
                <TextCell value={c.response} editable={editable} placeholder="Add remark" onCommit={(v) => dispatch({ type: 'patch-clause', tenderId: t.id, clauseId: c.id, patch: { response: v } })} />
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={6} className="muted">No clauses match these filters.</td></tr>}
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
