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

/** The DRB members; a business case version is approved once all of them approve it. */
export const DRB_APPROVERS = USERS.filter((u) => u.role === 'drb');

/** What each role can do. Hidden = the role never uses it; disabled = shown
 *  greyed with a tooltip saying why. */
export const canDo = {
  /** edit the AI-drafted business case and save versions */
  editBc: (r: Role) => r === 'bd',
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
  /** see the past business cases (other customers' prices) an AI line was drafted from */
  viewHistoricalPricing: (r: Role) => r === 'bd' || r === 'presales' || r === 'finance' || r === 'drb',
  /** record lessons learned once a tender's outcome is known */
  recordLessons: (r: Role) => r === 'bd' || r === 'bidding-manager',
  /** approve a business case version (every DRB member must approve) */
  approveBc: (r: Role) => r === 'drb',
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

