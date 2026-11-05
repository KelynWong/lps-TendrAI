// Domain types for TendrAI v3: AI reads the tender pack and drafts the
// business case; the BD team edits it, Final Check validates it, and DRB and
// MSPO are driven from the saved versions.

import type { BusinessCaseState } from './businessCase/model';

export type TenderStatus = 'Draft' | 'Active' | 'Won' | 'Closed';
export type TenderStatusReason =
  | 'In Progress (Draft)'
  | 'Pending (Draft)'
  | 'In Approval (Draft)'
  | 'Approved (Draft)'
  | 'Rejected (Draft)'
  | 'In Progress (Active)'
  | 'Won (Won)'
  | 'Revised (Closed)'
  | 'Lost (Closed)';
export type RepoStatus = 'Open' | 'Closed' | 'Won' | 'Lost' | 'Archived';
export type ProjectType = 'Milestone Based' | 'Time Based' | 'Usage Based';

// ---- Tender pack (RFP intelligence) ---------------------------------------

export type PackDocRole =
  | 'General Requirements'
  | 'Technical Specification'
  | 'Commercial Conditions'
  | 'Legal Conditions'
  | 'Forms and Annexes'
  | 'Unclassified';

/** Document statuses mirror the real pipeline: files are stored on upload and
 *  nothing is processed until the user starts a job. */
export type PackDocStatus =
  | 'Uploaded' // stored, not processed
  | 'Extracting text'
  | 'Text ready'
  | 'Analysing'
  | 'Done'
  | 'Failed';

export interface PackDoc {
  id: string;
  name: string;
  /** file size in bytes as uploaded (the duplicate check uses name + size) */
  sizeBytes?: number;
  role: PackDocRole;
  pages: number; // 0 = not known yet (text not extracted)
  status: PackDocStatus;
  /** why extraction failed, e.g. "Unreadable scan" (status Failed only) */
  failReason?: string;
  /** true when the AI's role classification has not been confirmed */
  roleUnconfirmed?: boolean;
  /** set once text extraction has succeeded at least once (reused on reprocess) */
  textExtracted?: boolean;
}

/** The one active processing job per tender. Stage-based only - the system
 *  cannot know a precise percentage or time remaining. */
export interface ProcessingJob {
  stage: number; // 1-based index into PROCESS_STAGES
  startedAt: string; // ISO
}

export const PROCESS_STAGES = [
  'Read documents (text extraction)',
  'Build tender overview',
  'Extract submission requirements',
  'Extract qualification requirements',
  'Extract clauses',
  'Build compliance table',
  // V3: frontend only so far; api/src/types.ts and the processing_jobs stage
  // CHECK (1-6) in db/schema.sql still need the seventh stage (migration)
  'Draft business case',
] as const;

/** Review lifecycle of an AI-extracted item across reprocessing runs. */
export type ExtractReviewState =
  | 'unreviewed' // AI-extracted, not reviewed yet
  | 'reviewed' // a person confirmed it (reviewedBy carries the name)
  | 'new' // appeared in the latest run, not reviewed
  | 'changed' // text changed in the latest run, please re-review
  | 'missing'; // no longer found in the latest run (kept, not deleted)

export interface ChecklistItem {
  id: string;
  item: string;
  format: string;
  deadline: string; // ISO date
  sourceDoc: string;
  clause: string;
  owner?: string;
  status: 'Not started' | 'In progress' | 'Done';
  /** template selected for this submission document (auto-matched or user-picked) */
  templateId?: string;
  /** AI-generated first draft of this submission document (from the selected template) */
  draft?: { templateId?: string; status: 'Needs review' | 'Done'; generatedAt: string };
}

export interface Qualification {
  id: string;
  kind: 'Role' | 'Experience' | 'Certification' | 'Past project';
  requirement: string;
  sourceDoc: string;
  clause: string;
  /** boilerplate id (CV or certification) that evidences it */
  evidence?: string;
}

export type ClauseCategory = 'Commercial' | 'Technical' | 'Legal' | 'Finance' | 'HR';
export type ComplianceStatus = 'Unset' | 'Comply' | 'Partially comply' | 'Do not comply' | 'Clarify';

export interface Clause {
  id: string;
  /** EXACT numbering from the source document, never renumbered */
  number: string;
  text: string;
  category: ClauseCategory;
  /** AI classifier's score for `category` (0-1); cleared once a person sets the category */
  categoryConfidence?: number;
  subTags: string[];
  sourceDoc: string;
  page: number;
  /** set when a cross-reference does not match the clause numbering */
  refIssue?: string;
  /** reviewer name; absent = AI-extracted, not reviewed */
  reviewedBy?: string;
  /** lifecycle across reprocessing runs; undefined = unreviewed/reviewed per reviewedBy */
  reviewState?: ExtractReviewState;
  compliance: ComplianceStatus;
  response: string;
  /** earlier compliance values and remarks, oldest first */
  history?: ClauseChange[];
}

export interface ClauseChange {
  ts: string; // ISO
  by: string;
  field: 'Compliance' | 'Remark';
  from: string;
  to: string;
}

// ---- Business case versions ------------------------------------------------

export interface BcProduct {
  id: string;
  ql: number;
  category: string;
  desc: string;
  unitCost: number;
  /** total quantity across the fiscal years */
  qty: number;
  /** quantity per fiscal year (Product Plan H6 onward), first FY first */
  fyQty?: number[];
  vendorCommitment?: boolean;
  total: number;
}

export interface BcResource {
  id: string;
  ql: number;
  role: string;
  /** Resource Plan remarks column (H), the MSPO Skill */
  skill?: string;
  grade: string;
  team: string;
  mandays: number;
  /** man-days per fiscal-year column (I8 onward), first FY first */
  fyMandays?: number[];
  dayRate: number;
  total: number;
}

export interface BcBilling {
  id: string;
  date: string;
  schedule: string;
  amount: number;
}

/** Headline values of the business case's Summary/Basic Info tabs; the Final
 *  Check rules reconcile these against the line totals. */
export interface BcHeader {
  tcv: number; // CCB / contract value
  productTotal: number;
  labourTotal: number;
  marginPct: number;
  currency: string;
  durationMonths: number;
  projectStart: string;
  /** Summary totals (quote currency); EBITDA % as a fraction like the template */
  directCost: number;
  indirectCost: number;
  ebitda: number;
  ebitdaPct: number;
}

export interface BcVersionData {
  header: BcHeader;
  products: BcProduct[];
  resources: BcResource[];
  billing: BcBilling[];
  /** Cash Flow tab totals over the project period; peakMismatch is the largest
   *  monthly funding gap, in the quote currency */
  cashFlow?: { vendorTotal: number; labourTotal: number; repaymentTotal: number; mismatchMonths: number; peakMismatch: number };
  /** numeric cells of the business case workbook layout, tab -> cell ref ->
   *  value (same shape as the API's bc_versions.cells); Final Check, MSPO and
   *  the DRB figures read business case fields instead */
  cells?: Record<string, Record<string, number>>;
}

/** One DRB member's approval of a business case version. */
export interface BcApproval {
  by: string;
  role: string;
  at: string; // ISO
}

/** One save of edits to the working version. */
export interface BcEdit {
  by: string;
  at: string; // ISO
  /** what changed, e.g. "3 product lines changed" */
  summary: string;
  comment?: string;
  /** DRB approvals this save voided (they approved the figures before it) */
  voidedApprovals?: number;
}

/** One version of a tender's business case. Version numbers only go up when
 *  the DRB approves: v1 is TendrAI's first draft, and when every DRB member
 *  has approved the latest version it is archived (read-only for good) and an
 *  identical working copy is added as the next version. The BD team's saves
 *  update the latest (working) version and are listed in `edits`. So every
 *  version except the latest is approved. */
export interface BcVersion {
  v: number;
  /** 'ai-draft' = v1, generated by TendrAI from the tender pack;
   *  'approved-copy' = working copy made when the previous version was approved */
  origin: 'ai-draft' | 'approved-copy';
  /** saves made to this version while it was the working version, oldest first */
  edits?: BcEdit[];
  /** DRB approvals recorded on this version, in the order given */
  approvals?: BcApproval[];
  /** set when every DRB member approved: the version is archived and read-only */
  approvedAt?: string;
  /** approved-copy: the approved version it copies */
  copyOf?: number;
  /** when the version was created (drafted or copied) */
  createdAt: string; // ISO
  /** who saved it last (TendrAI until a person saves) and when */
  savedBy: string;
  savedAt: string; // ISO
  comment?: string;
  /** MSPO templates were generated from this version */
  mspoDownloadedAt?: string;
  /** the full business case as last saved (all seven workbook tabs) */
  bc: BusinessCaseState;
  /** derived from bc on every save: drives Final Check, MSPO and the DRB figures */
  data: BcVersionData;
}

// ---- Templates, boilerplate, generated documents ---------------------------

export type Agency = 'MHA' | 'ATFM' | 'Generic';

/** A superseded version of a library item (template, certificate, boilerplate). */
export interface LibraryVersion {
  version: string;
  updated: string; // ISO date
  uploadedBy: string;
}

export interface TemplateDoc {
  id: string;
  name: string;
  agency: Agency;
  type: 'Compliance table' | 'Cover letter' | 'Company profile' | 'Form' | 'Document formatting';
  version: string;
  updated: string;
  uploadedBy: string;
  usedBy: string[]; // tender ids
  /** older versions, newest first; only the current version is matched to tenders */
  history?: LibraryVersion[];
}

/** Result of "Find matching templates" for one tender. The library is empty
 *  for a tender until the user runs the search and confirms a match. */
export interface TemplateMatch {
  templateId: string;
  reason: string;
  confirmed?: boolean;
}

export interface TemplateSearch {
  status: 'idle' | 'searching' | 'done';
  ranAt?: string;
  matches: TemplateMatch[];
  /** true when no agency template matched and the generic fallback is offered */
  genericFallback?: boolean;
}

export interface Boilerplate {
  id: string;
  name: string;
  type: 'Company background' | 'Certification' | 'CV';
  version: string;
  owner: string;
  uploadedBy: string;
  updated: string; // ISO date
  /** older versions, newest first */
  history?: LibraryVersion[];
  /** certification expiry (shown with an expiring/expired warning) */
  expires?: string;
  /** certification: who issued it, its number and issue date */
  issuer?: string;
  certNumber?: string;
  issued?: string;
  /** boilerplate: topics it covers, used to find it quickly */
  tags?: string[];
  /** CV tags for matching qualification requirements */
  role?: string;
  years?: number;
}

export interface GenDoc {
  id: string;
  name: string;
  templateId?: string;
  status: 'Not generated' | 'Generated' | 'Needs review';
  autoFilled: string[];
  manual: string[];
}

// ---- Audit log ----------------------------------------------------------------

/** One user (or system) action. Every dispatched state change is logged. */
export interface AuditEntry {
  id: string;
  ts: string; // ISO
  user: string;
  role: string;
  action: string;
  detail: string;
  /** tender reference (GeBIZ ref, else title) the action relates to */
  tender?: string;
  /** app area, e.g. Documents, Clauses, Business case, Templates */
  section?: string;
}

// ---- Repository and backup --------------------------------------------------

export interface RepoVersion {
  v: number;
  date: string;
  by: string;
  note: string;
}

export interface RepoRecord {
  id: string;
  name: string;
  agency: string;
  kind: 'Tender' | 'Proposal' | 'Business case' | 'BOM';
  type: 'Agency' | 'Commercial';
  status: RepoStatus;
  statusReason: string;
  owner: string;
  created: string;
  updated: string;
  /** the stored files (tender documents, workbooks) under this record */
  documents: string[];
  versions: RepoVersion[];
  archived?: { sizeFrom: string; sizeTo: string; at: string };
  /** archived files need a restore before they can be opened - not instant */
  restore?: { state: 'requested' | 'available'; requestedAt: string };
  /** business cases: how the AI may use this case when drafting new business
   *  cases. Won cases start as preferred, lost ones as standard; BD can
   *  exclude a stale or unrepresentative case. */
  aiSource?: AiSourceUse;
  /** the id AI citations show for this case, e.g. BC-2024-012 */
  refId?: string;
  /** the tender this record was filed from (set when the outcome is recorded) */
  tenderId?: string;
  /** lessons learned recorded on the tender's outcome */
  lessons?: string;
}

/** How the AI may use a historical business case as a drafting source. */
export type AiSourceUse = 'preferred' | 'standard' | 'excluded';

// ---- The tender record ------------------------------------------------------

export interface Tender {
  id: string;
  sfdcCrmId?: string;
  ref: string;
  name: string;
  agency: string;
  type: 'Agency' | 'Commercial';
  projectType: ProjectType;
  status: TenderStatus;
  statusReason: TenderStatusReason;
  owner: string;
  createdAt: string; // ISO date
  closingDate: string;
  /** index into WORKFLOW_STEPS */
  stepIdx: number;
  pack: PackDoc[];
  /** the one active processing job, if any */
  job?: ProcessingJob;
  /** when AI results were last produced (absent = never processed) */
  lastProcessedAt?: string;
  /** documents changed since the last run - results are out of date */
  outOfDate?: { added: number; removed: number; repaired?: number };
  /** entirely failed last run (nothing produced); offers Retry */
  processFailed?: string;
  checklist: ChecklistItem[];
  quals: Qualification[];
  clauses: Clause[];
  templateSearch?: TemplateSearch;
  /** user edits to the MSPO field mapping: which business case field fills
   *  each template column for this tender. Key: `${plan}:${target}` */
  mspoMapping?: Record<string, { field: string }>;
  /** the quote line created in MSPO; written to every row of all three plans */
  mspoQuoteLine?: string;
  /** fiscal-year columns in THIS business case (Quantity / Fiscal Year ranges) */
  mspoFyCount?: number;
  /** man-days one person works per month (resource plan row split) */
  mspoDaysPerMonth?: number;
  bcVersions: BcVersion[];
  genDocs: GenDoc[];
  drbOutcome?: 'Won' | 'Lost' | 'Awaiting result';
  drbNotes?: string;
  /** lessons learned once the outcome is known (Won or Closed) */
  lessons?: { text: string; by: string; at: string };
  archivedInfo?: { sizeFrom: string; sizeTo: string; at: string };
}
