/** Product name in one place (keep in sync with the existing app) */
export const APP_NAME = 'TendrAI';

export type Role = 'bd' | 'bidding-manager' | 'presales' | 'delivery' | 'finance' | 'drb';

export interface UserInfo {
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
}

/** Sign-in accounts (password below). DRB members share the read-only role. */
export const USERS: UserInfo[] = [
  { name: 'Felicia Phan', email: 'felicia.phan@lpstech.com', role: 'bd', roleLabel: 'Business Development' },
  { name: 'John Price', email: 'john.price@lpstech.com', role: 'bidding-manager', roleLabel: 'Bidding Manager' },
  { name: 'Chee Wee', email: 'chee.wee@lpstech.com', role: 'presales', roleLabel: 'Presales' },
  { name: 'Priya Nair', email: 'priya.nair@lpstech.com', role: 'delivery', roleLabel: 'Delivery' },
  // Finance sees the same tender and business case views as the working roles, read-only
  { name: 'Ruey Lin', email: 'ruey.lin@lpstech.com', role: 'finance', roleLabel: 'Finance' },
  { name: 'Eng Chuan Puay', email: 'ecpuay@lpstech.com', role: 'drb', roleLabel: 'Head of South East Asia' },
  { name: 'Thomas Low', email: 'thomas.low@lpstech.com', role: 'drb', roleLabel: 'Head of Singapore Delivery & CEO, LPS' },
  { name: 'Ethan Lim', email: 'ethan.lim@lpstech.com', role: 'drb', roleLabel: 'Senior Manager Financial P&A' },
];

export const DEMO_PASSWORD = 'Demo2026!';

/** What each role can do. Hidden = the role never uses it; disabled = shown
 *  greyed with a tooltip saying why. */
export const canDo = {
  uploadBc: (r: Role) => r === 'bd',
  downloadMspo: (r: Role) => r === 'bd',
  uploadPack: (r: Role) => r === 'bidding-manager',
  editChecklist: (r: Role) => r === 'bidding-manager',
  editClauses: (r: Role) => r === 'bd' || r === 'bidding-manager' || r === 'presales' || r === 'delivery',
  editCompliance: (r: Role) => r === 'bd' || r === 'bidding-manager',
  generateDocs: (r: Role) => r === 'bidding-manager',
  manageTemplates: (r: Role) => r === 'bd' || r === 'bidding-manager',
  manageRepo: (r: Role) => r === 'bd',
  /** Final Check rules and MSPO mapping defaults */
  manageRules: (r: Role) => r === 'bd',
  recordOutcome: (r: Role) => r === 'drb',
  /** commercial figures (Won TCV, needs attention, TCV/cost/EBITDA columns) */
  viewFinancials: (r: Role) => r === 'finance' || r === 'drb',
  /** Finance and the DRB only ever review: every tender is read-only for them */
  readOnlyReview: (r: Role) => r === 'finance' || r === 'drb',
};

/** Workflow stepper every tender shows */
export const WORKFLOW_STEPS = [
  { key: 'pack', label: 'Tender pack' },
  { key: 'clauses', label: 'Checklist and clauses' },
  { key: 'bc', label: 'Business case' },
  { key: 'drb', label: 'DRB' },
  { key: 'docs', label: 'Documents' },
  { key: 'closed', label: 'Closed' },
];

/** Every guess that needs confirming, shown on the Assumptions page */
export const ASSUMPTIONS: { area: string; assumption: string }[] = [
  { area: 'MSPO product plan', assumption: 'Sheet "Sub Grid For Quote Line": three hidden (Do Not Modify) columns, then 11 columns. Quantity spans the fiscal-year columns (H6 onward), so each business case line becomes one MSPO row per fiscal year; the demo splits quantity evenly because the mock data holds one quantity per line.' },
  { area: 'MSPO resource plan', assumption: 'Sheet "Resource Plans For Quoteline": one row per labour line per fiscal year, FY labels from Resource Plan row 6 (26/27 becomes FY26), months Apr-Mar keyed in after download. Position Name = Skill, numbered when several lines share a skill (to confirm).' },
  { area: 'MSPO quote line', assumption: 'One quote line is created in MSPO per tender and is the same for the product, resource and billing plans.' },
  { area: 'Project types', assumption: 'Milestone-based: Delivery Date = milestone date, quantity = committed units. Time-based: UoM = month, one row per charging period. Usage-based: quantity = estimated volume, flagged "subject to actuals". The real MSPO rules per project type are unconfirmed.' },
  { area: 'Final Check', assumption: 'Rules mirror the Excel template\'s Final Check list (billing = CCB/TCV, plan totals reconcile with Summary, iRate resolvable, cash-flow consistency). Exact tolerance (assumed: within S$1) to confirm.' },
  { area: 'Business case parsing', assumption: 'Business case uploads accept .xlsx and macro-enabled .xlsm files. Workbooks are best-effort parsed from sheets named "Product Plan", "Resource Plan" and "Basic Info"; otherwise mock parsed data is used.' },
  { area: 'General Requirements', assumption: 'The General Requirements document reliably lists the required submission documents and formats; detection of document roles from it is simulated.' },
  { area: 'Clause numbering', assumption: 'Cross-reference offsets (e.g. "criteria 1 to 8" not matching clause numbers) are flagged for human verification rather than auto-corrected.' },
  { area: 'Agency templates', assumption: 'MHA and ATFM maintain different compliance-table formats; a generic format is the fallback when no agency template exists.' },
  { area: 'Archive and restore', assumption: 'Archiving compresses stored files (sizes shown are simulated) and archived records stay searchable by metadata. Opening archived files requires a restore that is NOT instant; the demo shows "Restore requested" then "Available" after seconds - the real wait (assumed minutes to hours) and retention policy need confirming.' },
  { area: 'Backup', assumption: 'A second copy in a separate account/location with delete protection is required; backup cadence (assumed daily) and restore-test frequency (assumed quarterly) to confirm.' },
  { area: 'Processing job', assumption: 'One active job per tender; six stages (read documents, overview, submission reqs, qualification reqs, clauses, compliance table); per-document status during text extraction; a failed document does not stop the others. Real duration is minutes to ~20 minutes for large packs - the demo accelerates this to seconds.' },
  { area: 'Reprocessing', assumption: 'Adding, removing or repairing a document marks results "out of date". Reprocess re-runs the AI analysis across the whole current set (text extraction is reused), keeps reviewed items reviewed, and marks items New / Changed / Not found in latest run instead of silently deleting anything.' },
  { area: 'Document delete', assumption: 'Deleting a tender document is a soft delete (assumed 30-day recovery window); extracted items that came from it are removed on the NEXT processing run, not immediately.' },
  { area: 'Suggested values', assumption: 'Missing GeBIZ reference / customer values are suggested from the documents as "Suggested, please confirm" and never applied silently; when the documents disagree with a user-typed value, both are shown and the user chooses. The exact fields covered need confirming.' },
  { area: 'Template matching', assumption: 'A tender has no templates until the user runs "Find matching templates"; matching is by agency name, then tender type, with generic fallbacks; the user must confirm a match before documents are generated from it.' },
  { area: 'Business case layout detection', assumption: 'A workbook that does not match a known template layout is stored as a version but blocks MSPO generation; the error names the missing anchors (sheet names and header rows assumed). Final Check failures only warn and never block.' },
];
