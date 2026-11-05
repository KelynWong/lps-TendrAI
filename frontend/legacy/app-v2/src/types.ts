// Domain types for TendrAI v2: validate the BD team's Excel business case,
// drive DRB and MSPO from it, and apply AI only to reading the tender pack.

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
  qty: number;
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

/** Values the workbook STATES on its Summary/Basic Info tabs; the Final Check
 *  rules reconcile these against the recomputed line totals. */
export interface BcHeader {
  tcv: number; // CCB / contract value
  productTotal: number;
  labourTotal: number;
  marginPct: number;
  currency: string;
  durationMonths: number;
  projectStart: string;
}

export interface BcVersionData {
  header: BcHeader;
  products: BcProduct[];
  resources: BcResource[];
  billing: BcBilling[];
  /** raw numeric cells captured at upload, tab -> cell ref -> value (same shape
   *  as the API's bc_versions.cells); headline figures are read from here */
  cells?: Record<string, Record<string, number>>;
}

export interface BcVersion {
  v: number;
  uploadedBy: string;
  uploadedAt: string; // ISO
  fileName: string;
  /** Browser-local URL for viewing the uploaded workbook in the demo. */
  documentUrl?: string;
  comment?: string;
  /** true when real cell values were parsed from the uploaded .xlsx or .xlsm */
  parsedFromFile?: boolean;
  /** set when the workbook does not match a known template layout -
   *  MSPO generation is blocked until a recognisable version is uploaded */
  layoutUnrecognised?: { missingAnchors: string[] };
  /** MSPO templates were generated from this version */
  mspoDownloadedAt?: string;
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
}

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
  /** user edits to the MSPO field mapping: which business case tab and first
   *  cell fills each template column. Key: `${plan}:${target}` */
  mspoMapping?: Record<string, { tab: string; from: string; to?: string }>;
  /** rows in THIS business case per MSPO plan (where each range ends) */
  mspoRows?: Partial<Record<'product' | 'resource' | 'billing', number>>;
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
  archivedInfo?: { sizeFrom: string; sizeTo: string; at: string };
}
