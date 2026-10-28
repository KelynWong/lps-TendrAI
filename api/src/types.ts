// API data shapes. Field names and enum spellings match frontend/src/types.ts so
// the frontend can swap its in-memory store for these responses unchanged.
// Ids are UUID strings; timestamps are ISO-8601 strings.

export type TenderStatus = 'Draft' | 'Active' | 'Won' | 'Closed';
export type TenderStatusReason =
  | 'In Progress (Draft)' | 'Pending (Draft)' | 'In Approval (Draft)' | 'Approved (Draft)' | 'Rejected (Draft)'
  | 'In Progress (Active)' | 'Won (Won)' | 'Revised (Closed)' | 'Lost (Closed)';
export type ProjectType = 'Milestone Based' | 'Time Based' | 'Usage Based';
export type TenderType = 'Agency' | 'Commercial';

export type PackDocRole = 'General Requirements' | 'Technical Specification' | 'Commercial Conditions' | 'Legal Conditions' | 'Forms and Annexes' | 'Unclassified';
export type PackDocStatus = 'Uploaded' | 'Extracting text' | 'Text ready' | 'Analysing' | 'Done' | 'Failed';

export interface PackDoc {
  id: string;
  name: string;
  sizeBytes: number;
  contentType?: string;
  role: PackDocRole;
  pages: number;
  status: PackDocStatus;
  failReason?: string;
  roleUnconfirmed?: boolean;
  textExtracted?: boolean;
  uploadedAt: string;
  uploadedBy?: string;
}

export const PROCESS_STAGES = [
  'Read documents (text extraction)',
  'Build tender overview',
  'Extract submission requirements',
  'Extract qualification requirements',
  'Extract clauses',
  'Build compliance table',
] as const;

export interface ProcessingJob {
  id: string;
  stage: number;
  stageLabel: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export type ExtractReviewState = 'unreviewed' | 'reviewed' | 'new' | 'changed' | 'missing';

export interface ChecklistItem {
  id: string;
  item: string;
  format: string;
  deadline: string;
  sourceDoc: string;
  sourceDocId?: string;
  clause: string;
  owner?: string;
  ownerId?: string;
  status: 'Not started' | 'In progress' | 'Done';
  templateId?: string;
  draft?: { templateId?: string; status: 'Needs review' | 'Done'; generatedAt: string; fileName?: string };
  reviewState: ExtractReviewState;
}

export interface Qualification {
  id: string;
  kind: 'Role' | 'Experience' | 'Certification' | 'Past project';
  requirement: string;
  sourceDoc: string;
  sourceDocId?: string;
  clause: string;
  evidence?: string;
  reviewState: ExtractReviewState;
}

export type ClauseCategory = 'Commercial' | 'Technical' | 'Legal' | 'Finance' | 'HR';
export type ComplianceStatus = 'Unset' | 'Comply' | 'Partially comply' | 'Do not comply' | 'Clarify';

export interface ClauseChange {
  ts: string;
  by: string;
  field: 'Compliance' | 'Remark' | 'Category';
  from: string;
  to: string;
}

export interface Clause {
  id: string;
  number: string;
  text: string;
  category: ClauseCategory;
  subTags: string[];
  sourceDoc: string;
  sourceDocId?: string;
  page: number;
  refIssue?: string;
  reviewedBy?: string;
  reviewState?: ExtractReviewState;
  compliance: ComplianceStatus;
  response: string;
  history?: ClauseChange[];
  /** optimistic-concurrency token; send it back with edits */
  version: number;
  updatedAt: string;
}

export interface BcProduct { id: string; ql: number; category: string; desc: string; unitCost: number; qty: number; fyQty?: number[]; total: number }
export interface BcResource { id: string; ql: number; role: string; skill?: string; grade: string; team: string; mandays: number; fyMandays?: number[]; dayRate: number; total: number }
export interface BcBilling { id: string; date: string; schedule: string; amount: number; remark?: string }
export interface BcHeader { tcv: number; productTotal: number; labourTotal: number; marginPct: number; currency: string; durationMonths: number; projectStart: string }
export interface BcVersionData { header: BcHeader; products: BcProduct[]; resources: BcResource[]; billing: BcBilling[]; cells?: Record<string, Record<string, number>> }

export interface CheckRunResult { ruleId: string; ok: boolean; skipped?: boolean; expected: string; actual: string }

export interface BcVersion {
  id: string;
  v: number;
  uploadedBy: string;
  uploadedAt: string;
  fileName: string;
  sizeBytes: number;
  comment?: string;
  parsedFromFile?: boolean;
  layoutUnrecognised?: { missingAnchors: string[] };
  mspoDownloadedAt?: string;
  data: BcVersionData;
  checks: CheckRunResult[];
}

export type LibraryKind = 'template' | 'boilerplate' | 'certification' | 'cv';
export type TemplateType = 'Compliance table' | 'Cover letter' | 'Company profile' | 'Form' | 'Document formatting';
export type BoilerplateType = 'Company background' | 'Certification' | 'CV';

export interface LibraryVersion { version: string; updated: string; uploadedBy: string; fileName: string; current?: boolean }

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  agency: string;
  type: TemplateType | BoilerplateType;
  version: string;
  updated: string;
  owner: string;
  uploadedBy: string;
  fileName?: string;
  usedBy: string[];
  history: LibraryVersion[];
  expires?: string;
  issuer?: string;
  certNumber?: string;
  issued?: string;
  tags?: string[];
  role?: string;
  years?: number;
}

export interface TemplateMatch { templateId: string; reason: string; confirmed?: boolean }
export interface TemplateSearch { status: 'idle' | 'searching' | 'done'; ranAt?: string; matches: TemplateMatch[]; genericFallback?: boolean }

export interface GenDoc { id: string; name: string; templateId?: string; status: 'Not generated' | 'Generated' | 'Needs review'; autoFilled: string[]; manual: string[]; generatedAt?: string }

export interface Tender {
  id: string;
  sfdcCrmId?: string;
  ref: string;
  name: string;
  agency: string;
  type: TenderType;
  projectType: ProjectType;
  status: TenderStatus;
  statusReason: TenderStatusReason;
  owner: string;
  ownerId: string;
  createdAt: string;
  closingDate: string;
  stepIdx: number;
  pack: PackDoc[];
  job?: ProcessingJob;
  lastProcessedAt?: string;
  outOfDate?: { added: number; removed: number; repaired?: number };
  processFailed?: string;
  overview?: string;
  suggestions?: Record<string, string>;
  checklist: ChecklistItem[];
  quals: Qualification[];
  clauses: Clause[];
  templateSearch?: TemplateSearch;
  mspoMapping?: Record<string, { tab: string; from: string; to?: string }>;
  mspoRows?: Partial<Record<'product' | 'resource' | 'billing', number>>;
  mspoQuoteLine?: string;
  mspoFyCount?: number;
  mspoDaysPerMonth?: number;
  bcVersions: BcVersion[];
  genDocs: GenDoc[];
  drbOutcome?: 'Won' | 'Lost' | 'Awaiting result';
  drbNotes?: string;
  archivedInfo?: { sizeFrom: string; sizeTo: string; at: string };
  updatedAt: string;
}

/** Row of the tender list (no nested collections). */
export interface TenderSummary {
  id: string;
  sfdcCrmId?: string;
  ref: string;
  name: string;
  agency: string;
  type: TenderType;
  projectType: ProjectType;
  status: TenderStatus;
  statusReason: TenderStatusReason;
  owner: string;
  createdAt: string;
  closingDate: string;
  stepIdx: number;
  lastProcessedAt?: string;
  outOfDate?: { added: number; removed: number; repaired?: number };
  processFailed?: string;
  job?: Pick<ProcessingJob, 'id' | 'stage' | 'stageLabel' | 'startedAt'>;
  drbOutcome?: 'Won' | 'Lost' | 'Awaiting result';
  counts: { documents: number; failedDocuments: number; clauses: number; reviewedClauses: number; checklist: number; qualifications: number; bcVersions: number };
  latestBc?: { v: number; tcv: number; productTotal: number; labourTotal: number; marginPct: number; layoutUnrecognised: boolean; failedChecks: number };
  attention: string[];
  archivedInfo?: { sizeFrom: string; sizeTo: string; at: string };
}

export interface AuditEntry { id: string; ts: string; user: string; role: string; action: string; detail: string; tender?: string; tenderId?: string; section?: string }

export interface RepoVersion { v: number; date: string; by: string; note: string }
export interface RepoFile { id: string; name: string; sizeBytes: number; storageClass: string }
export interface RepoRecord {
  id: string;
  name: string;
  agency: string;
  kind: 'Tender' | 'Proposal' | 'Business case' | 'BOM';
  type: TenderType;
  status: 'Open' | 'Closed' | 'Won' | 'Lost' | 'Archived';
  statusReason: string;
  owner: string;
  tenderId?: string;
  created: string;
  updated: string;
  documents: string[];
  files: RepoFile[];
  versions: RepoVersion[];
  archived?: { sizeFrom: string; sizeTo: string; at: string };
  restore?: { state: 'requested' | 'available'; requestedAt: string; expiresAt?: string };
}

export type RuleKind = 'compare' | 'range' | 'every-line' | 'builtin';
export interface CellRef { tab: string; ref: string }
export type LineOp = '>' | '>=' | '<' | '<=' | '=' | 'between';
export interface RuleDef {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning';
  enabled: boolean;
  kind: RuleKind;
  left?: CellRef; right?: CellRef; tolerance?: number;
  target?: CellRef; min?: number; max?: number; op?: LineOp; value?: number; value2?: number;
  builtin?: 'line-totals-consistent' | 'billing-within-duration' | 'quote-line-assigned' | 'billing-present';
  tabs?: string[];
}

export type MapGroup = 'product' | 'resource' | 'billing' | 'figures';
export interface FieldMapEntry { target: string; source: 'workbook' | 'mspo' | 'manual' | 'calculated'; tab?: string; from?: string; span?: 'single' | 'rows' | 'cols' | 'rows-cols'; note?: string; dropdown?: 'category' | 'subcategory' }
