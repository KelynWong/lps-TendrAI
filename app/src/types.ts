// Domain types for the LPS-P2C POC.
// Mirrors the structure of the "template business case.xlsm" workbook.

export const FY_COUNT = 3; // POC uses a 3-fiscal-year horizon (FY26/27 .. FY28/29)

export type Category =
  | 'External Service'
  | 'Hardware'
  | 'Software'
  | 'Telephony Resource'
  | 'Project Real Estate';

export const PRODUCT_CATEGORIES: Category[] = [
  'External Service',
  'Hardware',
  'Software',
  'Telephony Resource',
  'Project Real Estate',
];

/** All cost categories in Summary order: Internal Labour + product categories */
export const ALL_CATEGORIES = ['Internal Labour', ...PRODUCT_CATEGORIES] as const;
export type SummaryCategory = (typeof ALL_CATEGORIES)[number];

/** Provenance of an AI-populated value (NFR12/NFR13, FR13/FR14/FR16) */
export type Provenance =
  | {
      kind: 'grounded';
      citation: { docId: string; title: string; similarity: number; excerpt: string };
    }
  | { kind: 'estimate' } // industry best-practice estimate, unverified, no citation
  | { kind: 'human'; confirmedBy: string };

export interface QuoteLine {
  id: number; // 1-based, "Quote Line 1" ...
  solutionOffering: string;
  projectType: 'Milestone Based' | 'Time Based' | 'Usage Based';
  remarks: string;
  /** Sell-side margin applied on direct cost to derive TCV (exec-editable) */
  marginPct: number;
}

export interface ProductItem {
  id: string;
  quoteLine: number;
  category: Category;
  description: string;
  vendor: string;
  vendorCommitment: boolean; // "No inflation will be applied if Vendor Commitment = Yes"
  unitCost: number;
  qtyByFY: number[]; // length FY_COUNT
  remarks: string;
  provenance: Provenance;
}

export interface ResourceItem {
  id: string;
  quoteLine: number;
  team: string;
  role: string;
  grade: string;
  teamCode: string;
  dayRate: number; // iRate
  mandaysByFY: number[]; // length FY_COUNT
  /** Client-facing role title (the Labour Inputs "LPS Role for Client" column) */
  remarks: string;
  /** MSPO role code mapping shown on Labour Inputs (editable) */
  mspoRole?: string;
  provenance: Provenance;
}

export interface BillingMilestone {
  id: string;
  date: string; // ISO
  schedule: string;
  amount: number;
  remarks: string;
  provenance: Provenance;
}

export interface BasicInfo {
  crmId: string;
  projectName: string;
  customer: string;
  endCustomer: string;
  gtmUnit: string;
  gtmSubTeam: string;
  majorSolutionOffering: string;
  projectStart: string; // ISO
  projectEnd: string; // ISO
  currency: string;
  inflationBaseFY: number;
  provenance: Provenance;
}

export interface VendorColumn {
  id: string;
  name: string;
  amounts: number[]; // one entry per project month
}

/** Applied % by quote line index (Summary's editable yellow cells) */
export interface AppliedRates {
  contingency: Record<SummaryCategory, number[]>;
  inflation: Record<SummaryCategory, number[]>;
  prcHwSw: number[]; // PRC Tax on Hardware & Software (CNY quotes only)
  prcOps: number[]; // PRC Tax on Operation, External Service & Internal Labour
  prcStamp: number[]; // PRC Stamp Duty
}

export type BcStatus = 'processing' | 'draft' | 'in_drb' | 'approved' | 'submitted';

export type Role =
  | 'executive-sponsor'
  | 'business-sponsor'
  | 'bidding-manager'
  | 'presales'
  | 'delivery'
  | 'bd-team';

export interface UserInfo {
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
}

export interface AuditEntry {
  id: string;
  ts: string; // ISO
  user: string;
  role: string;
  action: string;
  detail: string;
  /** Tender reference the action relates to, when applicable */
  tender?: string;
}

export interface HistoricalDoc {
  id: string;
  title: string;
  docType: 'Won Proposal' | 'Lost Proposal' | 'Tender Requirement' | 'Business Case';
  sector: 'Agency' | 'Commercial';
  customer: string;
  outcome: 'Won' | 'Lost' | '-';
  uploadedBy: string;
  uploadDate: string;
  embeddingStatus: 'Embedded' | 'Embedding…' | 'Re-embedding' | 'Extraction failed' | 'Duplicate - pending review';
  chunks: number;
  versions: number; // archived versions retained (FR05a)
}

export interface OtherIndirect {
  travelExpense: number[]; // per quote line index
  otherCosts: number[];
  vendorRebate: number[];
}

export interface BusinessCaseState {
  status: BcStatus;
  basicInfo: BasicInfo;
  quoteLines: QuoteLine[];
  productItems: ProductItem[];
  resourceItems: ResourceItem[];
  billing: BillingMilestone[];
  otherIndirect: OtherIndirect;
  /** Named vendor-payment columns in Cash Flow (BD-editable; one amount per month) */
  vendorCols: VendorColumn[];
  /** Overrides of the planning exchange rates (code → applied rate to 1 USD) */
  fxOverrides: Record<string, number>;
  /** Editable applied percentages per quote line (Summary yellow cells) */
  appliedRates: AppliedRates;
  /** Manual monthly man-day distribution per resource line (Labour Inputs grid);
   *  lines without an entry are spread evenly within each FY. */
  labourMonthly: Record<string, number[]>;
  /** DRB approvals collected so far. Two distinct sponsors are required to
   *  lock the case and unlock the submission form; any edit while partially
   *  approved clears the list. */
  approvals: string[];
  approvedBy?: string;
  approvedAt?: string;
}

/** A tender pursuit: the uploaded document plus its business case and submission form. */
export interface TenderRecord {
  id: string;
  ref: string;
  title: string;
  agency: string;
  sector: 'Agency' | 'Commercial';
  pages: number;
  fileName: string;
  fileSize: string;
  uploadedBy: string;
  uploadedAt: string; // ISO
  closingDate: string; // ISO
  processingMinutes: number;
  outcome?: 'Won' | 'Lost' | 'Awaiting result';
  /** null while the generation pipeline is still running */
  bc: BusinessCaseState | null;
  /** customer-issued submission form uploaded by the user (after approval) */
  submissionFormName?: string;
  submissionFilledAt?: string;
}
