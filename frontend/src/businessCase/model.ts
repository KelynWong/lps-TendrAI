// The AI-drafted business case: same structure as the "template business
// case.xlsm" workbook (Basic Info, Summary, Cash Flow, Product Plan, Resource
// Plan, Working, Labour Inputs). Ported from the V1 POC; every AI-populated
// value carries its provenance until a person confirms it.

export const FY_COUNT = 3; // 3-fiscal-year horizon (the template supports 15)

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

/** A citation into the historical store or the uploaded tender pack */
export interface GroundedCitation {
  docId: string;
  title: string;
  similarity: number;
  excerpt: string;
  /** 'tender' = extracted directly from the uploaded tender pack */
  source?: 'historical' | 'tender';
  /** the matching requirement passage in the uploaded tender pack */
  tenderExcerpt?: string;
  /** tender citations: the tender and the pack document the passage is in */
  tenderId?: string;
  fileName?: string;
}

/** Provenance of an AI-populated value */
export type Provenance =
  | { kind: 'grounded'; citation: GroundedCitation }
  | { kind: 'estimate' } // industry best-practice estimate, unverified, no citation
  /** Not AI-populated: keyed in from a system outside the integration scope (e.g. Salesforce) */
  | { kind: 'manual'; source?: string }
  | {
      kind: 'human';
      confirmedBy: string;
      /** carried over when the value was cited before confirmation */
      citation?: GroundedCitation;
      /** true when the person changed the value rather than just confirming it */
      edited?: boolean;
    };

export interface QuoteLine {
  id: number; // 1-based, "Quote Line 1" ...
  solutionOffering: string;
  projectType: 'Milestone Based' | 'Time Based' | 'Usage Based';
  remarks: string;
  /** Sell-side margin applied on direct cost to derive TCV */
  marginPct: number;
  provenance: Provenance;
}

export interface ProductItem {
  id: string;
  quoteLine: number;
  category: Category;
  description: string;
  vendor: string;
  vendorCommitment: boolean; // "No inflation will be applied if Vendor Commitment = Yes"
  /** in the line's currency (`currency`, default the quote currency) */
  unitCost: number;
  /** currency the vendor priced this line in; absent = the quote currency */
  currency?: string;
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
  dayRate: number; // iRate, in the SGD rate card (converted to the quote currency)
  mandaysByFY: number[]; // length FY_COUNT
  /** Client-facing role title (the Labour Inputs "LPS Role for Client" column, MSPO Skill) */
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
  /** Per-field provenance for the AI-filled deal information values */
  fieldProv: Record<string, Provenance>;
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

export interface OtherIndirect {
  travelExpense: number[]; // per quote line index
  otherCosts: number[];
  vendorRebate: number[];
}

export interface BusinessCaseState {
  basicInfo: BasicInfo;
  quoteLines: QuoteLine[];
  productItems: ProductItem[];
  resourceItems: ResourceItem[];
  billing: BillingMilestone[];
  /** Billing cadence: regenerating lines spreads the TCV evenly across the
   *  project duration at this interval */
  billingFrequency: 'Monthly' | 'Quarterly' | 'Yearly';
  otherIndirect: OtherIndirect;
  /** Free-text remarks for the Summary tab (DRB notes) */
  summaryRemarks: string;
  /** Named vendor-payment columns in Cash Flow (one amount per month) */
  vendorCols: VendorColumn[];
  /** Overrides of the planning exchange rates (code -> applied rate to 1 USD) */
  fxOverrides: Record<string, number>;
  /** Overrides of the default day rate (iRate) per grade; editing one updates
   *  every resource line of that grade */
  gradeRateOverrides: Record<string, number>;
  /** Editable applied percentages per quote line (Summary yellow cells) */
  appliedRates: AppliedRates;
  /** Editable Finance Cost % of TCV (Summary total column); when unset the
   *  finance cost is the compound interest computed from the Cash Flow. */
  financeOverridePct?: number;
  /** Manual monthly man-day distribution per resource line (Labour Inputs grid);
   *  lines without an entry are spread evenly within each FY. */
  labourMonthly: Record<string, number[]>;
  /** Keys of manual-input groups a person has verified by editing them
   *  (Summary applied-% and indirect rows: sum:*, Cash Flow vendor columns:
   *  cf:<colId>). Anything not listed still counts as an AI estimate. */
  confirmedInputs: string[];
}
