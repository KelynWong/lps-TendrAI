// Loads tenders from PostgreSQL and maps them to the shapes in types.ts.
import type { Queryable } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { locked, notFound } from './errors.js';
import { PROCESS_STAGES, type BcVersion, type ChecklistItem, type Clause, type GenDoc, type PackDoc, type ProcessingJob, type Qualification, type Tender, type TenderSummary, type TemplateSearch } from '../types.js';

export const formatSize = (bytes: number | null | undefined) =>
  bytes == null ? '-' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`;

const iso = (v: Date | string | null | undefined) => (v == null ? undefined : v instanceof Date ? v.toISOString() : String(v));
const isoReq = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));

type Row = Record<string, any>;

const outOfDate = (r: Row) =>
  r.out_of_date_added || r.out_of_date_removed || r.out_of_date_repaired
    ? { added: r.out_of_date_added, removed: r.out_of_date_removed, repaired: r.out_of_date_repaired || undefined }
    : undefined;

const archivedInfo = (r: Row) =>
  r.archived_at ? { sizeFrom: formatSize(r.archived_size_from), sizeTo: formatSize(r.archived_size_to), at: isoReq(r.archived_at).slice(0, 10) } : undefined;

export function mapDoc(r: Row): PackDoc {
  return {
    id: r.id, name: r.name, sizeBytes: r.size_bytes, contentType: r.content_type ?? undefined, role: r.role, pages: r.pages, status: r.status,
    failReason: r.fail_reason ?? undefined, roleUnconfirmed: r.role_unconfirmed || undefined, textExtracted: r.text_extracted || undefined,
    uploadedAt: isoReq(r.uploaded_at), uploadedBy: r.uploaded_by_name ?? undefined,
  };
}

export function mapJob(r: Row): ProcessingJob {
  return { id: r.id, stage: r.stage, stageLabel: r.stage_label ?? PROCESS_STAGES[r.stage - 1], status: r.status, startedAt: isoReq(r.started_at), finishedAt: iso(r.finished_at), error: r.error ?? undefined };
}

export function mapChecklist(r: Row): ChecklistItem {
  return {
    id: r.id, item: r.item, format: r.format, deadline: r.deadline ?? '', sourceDoc: r.source_doc_name, sourceDocId: r.source_document_id ?? undefined, clause: r.clause_ref,
    owner: r.owner_display ?? undefined, ownerId: r.owner_id ?? undefined, status: r.status, templateId: r.template_id ?? undefined,
    draft: r.draft_status ? { templateId: r.draft_template_id ?? undefined, status: r.draft_status, generatedAt: isoReq(r.draft_generated_at), fileName: r.draft_s3_key ? String(r.draft_s3_key).split('/').pop() : undefined } : undefined,
    reviewState: r.review_state,
  };
}

export function mapQual(r: Row): Qualification {
  return { id: r.id, kind: r.kind, requirement: r.requirement, sourceDoc: r.source_doc_name, sourceDocId: r.source_document_id ?? undefined, clause: r.clause_ref, evidence: r.evidence_item_id ?? undefined, reviewState: r.review_state };
}

export function mapClause(r: Row): Clause {
  return {
    id: r.id, number: r.number, text: r.text, category: r.category, subTags: r.sub_tags ?? [], sourceDoc: r.source_doc_name, sourceDocId: r.source_document_id ?? undefined,
    page: r.page, refIssue: r.ref_issue ?? undefined, reviewedBy: r.reviewed_by_name ?? undefined, reviewState: r.review_state,
    compliance: r.compliance, response: r.response, version: r.version, updatedAt: isoReq(r.updated_at),
    history: Array.isArray(r.history) && r.history.length ? r.history.map((h: Row) => ({ ts: h.ts, by: h.by, field: h.field, from: h.from, to: h.to })) : undefined,
  };
}

export function mapGenDoc(r: Row): GenDoc {
  return { id: r.id, name: r.name, templateId: r.template_id ?? undefined, status: r.status, autoFilled: r.auto_filled ?? [], manual: r.manual ?? [], generatedAt: iso(r.generated_at) };
}

export function mapBcVersion(r: Row): BcVersion {
  return {
    id: r.id, v: r.v, uploadedBy: r.uploaded_by_name ?? 'Unknown', uploadedAt: isoReq(r.uploaded_at), fileName: r.file_name, sizeBytes: r.size_bytes, comment: r.comment ?? undefined,
    parsedFromFile: r.parsed_from_file || undefined,
    layoutUnrecognised: r.layout_unrecognised ? { missingAnchors: r.missing_anchors ?? [] } : undefined,
    mspoDownloadedAt: iso(r.mspo_downloaded_at),
    data: {
      header: { tcv: r.tcv, productTotal: r.product_total, labourTotal: r.labour_total, marginPct: r.margin_pct, currency: r.currency, durationMonths: r.duration_months, projectStart: r.project_start ?? '' },
      products: (r.products ?? []).map((p: Row) => ({ id: p.id, ql: p.ql, category: p.category, desc: p.description, unitCost: +p.unit_cost, qty: +p.qty, fyQty: p.fy_qty ? p.fy_qty.map(Number) : undefined, total: +p.total })),
      resources: (r.resources ?? []).map((x: Row) => ({ id: x.id, ql: x.ql, role: x.role, skill: x.skill ?? undefined, grade: x.grade, team: x.team, mandays: +x.mandays, fyMandays: x.fy_mandays ? x.fy_mandays.map(Number) : undefined, dayRate: +x.day_rate, total: +x.total })),
      billing: (r.billing ?? []).map((b: Row) => ({ id: b.id, date: b.billing_date ?? '', schedule: b.schedule, amount: +b.amount, remark: b.remark ?? undefined })),
      cells: r.cells && Object.keys(r.cells).length ? r.cells : undefined,
    },
    checks: (r.checks ?? []).map((c: Row) => ({ ruleId: c.rule_id, ok: c.ok, skipped: c.skipped || undefined, expected: c.expected, actual: c.actual })),
  };
}

export const BC_VERSION_SQL = `
  SELECT b.*, u.name AS uploaded_by_name,
    (SELECT COALESCE(json_agg(p ORDER BY p.line_no), '[]') FROM bc_products p WHERE p.version_id = b.id)  AS products,
    (SELECT COALESCE(json_agg(x ORDER BY x.line_no), '[]') FROM bc_resources x WHERE x.version_id = b.id) AS resources,
    (SELECT COALESCE(json_agg(l ORDER BY l.line_no), '[]') FROM bc_billing l WHERE l.version_id = b.id)   AS billing,
    (SELECT COALESCE(json_agg(json_build_object('rule_id', c.rule_id, 'ok', c.ok, 'skipped', c.skipped, 'expected', c.expected, 'actual', c.actual) ORDER BY fr.sort_order), '[]')
       FROM final_check_results c JOIN final_check_rules fr ON fr.id = c.rule_id WHERE c.version_id = b.id) AS checks
  FROM bc_versions b LEFT JOIN users u ON u.id = b.uploaded_by`;

export const CLAUSE_SQL = `
  SELECT c.*, ru.name AS reviewed_by_name,
    (SELECT COALESCE(json_agg(json_build_object('ts', h.ts, 'by', h.by_name, 'field', h.field, 'from', h.from_value, 'to', h.to_value) ORDER BY h.ts, h.id), '[]')
       FROM clause_changes h WHERE h.clause_id = c.id) AS history
  FROM clauses c LEFT JOIN users ru ON ru.id = c.reviewed_by`;

export const CHECKLIST_SQL = `
  SELECT k.*, COALESCE(ou.name, k.owner_name) AS owner_display
  FROM checklist_items k LEFT JOIN users ou ON ou.id = k.owner_id`;

export const DOC_SQL = `
  SELECT d.*, uu.name AS uploaded_by_name FROM tender_documents d LEFT JOIN users uu ON uu.id = d.uploaded_by`;

export async function loadTender(q: Queryable, id: string): Promise<Tender | null> {
  const t = await one<Row>(q, 'SELECT t.*, u.name AS owner_name FROM tenders t JOIN users u ON u.id = t.owner_id WHERE t.id = $1 AND t.deleted_at IS NULL', [id]);
  if (!t) return null;
  const [docs, job, checklist, quals, clauses, search, matches, mappings, versions, genDocs] = await Promise.all([
    many<Row>(q, `${DOC_SQL} WHERE d.tender_id = $1 AND d.deleted_at IS NULL ORDER BY d.sort_order, d.uploaded_at`, [id]),
    one<Row>(q, `SELECT * FROM processing_jobs WHERE tender_id = $1 AND status IN ('queued','running') ORDER BY started_at DESC LIMIT 1`, [id]),
    many<Row>(q, `${CHECKLIST_SQL} WHERE k.tender_id = $1 ORDER BY k.deadline NULLS LAST, k.sort_order`, [id]),
    many<Row>(q, 'SELECT * FROM qualifications WHERE tender_id = $1 ORDER BY sort_order, created_at', [id]),
    many<Row>(q, `${CLAUSE_SQL} WHERE c.tender_id = $1 ORDER BY c.sort_order, c.created_at`, [id]),
    one<Row>(q, 'SELECT * FROM tender_template_searches WHERE tender_id = $1', [id]),
    many<Row>(q, 'SELECT * FROM tender_template_matches WHERE tender_id = $1', [id]),
    many<Row>(q, 'SELECT * FROM tender_mspo_mappings WHERE tender_id = $1', [id]),
    many<Row>(q, `${BC_VERSION_SQL} WHERE b.tender_id = $1 AND b.deleted_at IS NULL ORDER BY b.v`, [id]),
    many<Row>(q, 'SELECT * FROM gen_docs WHERE tender_id = $1 ORDER BY sort_order, created_at', [id]),
  ]);

  const templateSearch: TemplateSearch | undefined = search
    ? { status: search.status, ranAt: iso(search.ran_at), genericFallback: search.generic_fallback || undefined, matches: matches.map((m) => ({ templateId: m.template_id, reason: m.reason, confirmed: m.confirmed || undefined })) }
    : undefined;

  const mspoMapping = mappings.length
    ? Object.fromEntries(mappings.map((m) => [`${m.group}:${m.target}`, { tab: m.tab, from: m.from_cell, to: m.to_cell ?? undefined }]))
    : undefined;
  const mspoRows = t.mspo_rows_product || t.mspo_rows_resource || t.mspo_rows_billing
    ? { product: t.mspo_rows_product ?? undefined, resource: t.mspo_rows_resource ?? undefined, billing: t.mspo_rows_billing ?? undefined }
    : undefined;

  return {
    id: t.id, sfdcCrmId: t.sfdc_crm_id ?? undefined, ref: t.ref, name: t.name, agency: t.agency, type: t.type, projectType: t.project_type,
    status: t.status, statusReason: t.status_reason, owner: t.owner_name, ownerId: t.owner_id,
    createdAt: isoReq(t.created_at).slice(0, 10), closingDate: t.closing_date ?? '', stepIdx: t.workflow_step,
    pack: docs.map(mapDoc), job: job ? mapJob(job) : undefined,
    lastProcessedAt: iso(t.last_processed_at), outOfDate: outOfDate(t), processFailed: t.process_failed ?? undefined,
    overview: t.overview ?? undefined, suggestions: t.suggestions ?? undefined,
    checklist: checklist.map(mapChecklist), quals: quals.map(mapQual), clauses: clauses.map(mapClause),
    templateSearch, mspoMapping, mspoRows,
    mspoQuoteLine: t.mspo_quote_line ?? undefined, mspoFyCount: t.mspo_fy_count ?? undefined, mspoDaysPerMonth: t.mspo_days_per_month ?? undefined,
    bcVersions: versions.map(mapBcVersion), genDocs: genDocs.map(mapGenDoc),
    drbOutcome: t.drb_outcome ?? undefined, drbNotes: t.drb_notes ?? undefined, archivedInfo: archivedInfo(t), updatedAt: isoReq(t.updated_at),
  };
}

export async function loadTenderList(q: Queryable): Promise<TenderSummary[]> {
  const rows = await many<Row>(q, 'SELECT * FROM v_tender_list ORDER BY created_at DESC');
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const attention: string[] = [];
    if (r.process_failed) attention.push('Processing failed');
    if (outOfDate(r)) attention.push('Results out of date');
    if (r.failed_document_count) attention.push(`${r.failed_document_count} document${r.failed_document_count > 1 ? 's' : ''} failed`);
    if ((r.status === 'Draft' || r.status === 'Active') && r.closing_date && r.closing_date < today) attention.push('Closing date passed');
    if (r.latest_bc_layout_unrecognised) attention.push('Business case layout not recognised');
    else if (r.latest_bc_failed_checks) attention.push('Final Check failures');
    return {
      id: r.id, sfdcCrmId: r.sfdc_crm_id ?? undefined, ref: r.ref, name: r.name, agency: r.agency, type: r.type, projectType: r.project_type,
      status: r.status, statusReason: r.status_reason, owner: r.owner_name, createdAt: isoReq(r.created_at).slice(0, 10), closingDate: r.closing_date ?? '',
      stepIdx: r.workflow_step, lastProcessedAt: iso(r.last_processed_at), outOfDate: outOfDate(r), processFailed: r.process_failed ?? undefined,
      job: r.job_id ? { id: r.job_id, stage: r.job_stage, stageLabel: PROCESS_STAGES[r.job_stage - 1], startedAt: isoReq(r.job_started_at) } : undefined,
      drbOutcome: r.drb_outcome ?? undefined,
      counts: { documents: r.document_count, failedDocuments: r.failed_document_count, clauses: r.clause_count, reviewedClauses: r.reviewed_clause_count, checklist: r.checklist_count, qualifications: r.qualification_count, bcVersions: r.bc_version_count },
      latestBc: r.latest_bc_v ? { v: r.latest_bc_v, tcv: r.latest_bc_tcv, productTotal: r.latest_bc_product_total, labourTotal: r.latest_bc_labour_total, marginPct: r.latest_bc_margin_pct, layoutUnrecognised: !!r.latest_bc_layout_unrecognised, failedChecks: r.latest_bc_failed_checks } : undefined,
      attention, archivedInfo: archivedInfo(r),
    };
  });
}

export interface TenderRow { id: string; ref: string; name: string; status: string; archived_at: Date | null; last_processed_at: Date | null; agency: string; type: 'Agency' | 'Commercial'; owner_id: string; workflow_step: number; status_reason: string; drb_outcome: string | null; closing_date: string | null; sfdc_crm_id: string | null }

/** Minimal tender row for guards; 404 when missing. */
export async function tenderRow(q: Queryable, id: string): Promise<TenderRow> {
  const t = await one<TenderRow>(q, 'SELECT id, ref, name, status, archived_at, last_processed_at, agency, type, owner_id, workflow_step, status_reason, drb_outcome, closing_date, sfdc_crm_id FROM tenders WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!t) throw notFound('Tender');
  return t;
}

/** A tender with a recorded outcome or an archive is read-only. */
export function assertUnlocked(t: TenderRow) {
  if (t.status === 'Won' || t.status === 'Closed' || t.archived_at) throw locked();
}

export const refOf = (t: { ref: string; name: string }) => t.ref || t.name;
