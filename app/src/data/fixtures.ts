// Hardcoded but realistic demo data for the POC.
// All customers, vendors, figures and citations are fictitious.

import type {
  AppConfig,
  AuditEntry,
  BusinessCaseState,
  HistoricalDoc,
  ProductItem,
  Provenance,
  ResourceItem,
  TenderRecord,
  UserInfo,
} from '../types';
import { computeSummary, defaultAppliedRates, defaultVendorColumns } from '../lib/calc';
import { CURRENCIES, GRADE_RATES, ROLES, SOLUTION_OFFERINGS, TEAMS } from './parameters';

/** Admin-configurable lists and defaults, seeded from the parameter catalogue */
export const DEFAULT_CONFIG: AppConfig = {
  tenderTypes: ['Agency', 'Commercial'],
  outcomeTypes: ['Awaiting result', 'Won', 'Lost'],
  solutionOfferings: [...SOLUTION_OFFERINGS],
  roles: [...ROLES],
  teams: [...TEAMS],
  fxDefaults: Object.fromEntries(CURRENCIES.map(([code, , planning]) => [code, planning])),
  gradeRates: { ...GRADE_RATES },
};

export const USERS: UserInfo[] = [
  { name: 'Eng Chuan Puay', email: 'ecpuay@lpstech.com', role: 'executive-sponsor', roleLabel: 'Head of South East Asia' },
  { name: 'Thomas Low', email: 'thomas.low@lpstech.com', role: 'executive-sponsor', roleLabel: 'Head of Singapore Delivery & CEO, LPS' },
  { name: 'Ethan Lim', email: 'ethan.lim@lpstech.com', role: 'business-sponsor', roleLabel: 'Senior Manager Financial P&A' },
  { name: 'John Price', email: 'john.price@lpstech.com', role: 'bidding-manager', roleLabel: 'Bidding Manager' },
  { name: 'Chee Wee', email: 'chee.wee@lpstech.com', role: 'presales', roleLabel: 'Presales' },
  { name: 'Priya Nair', email: 'priya.nair@lpstech.com', role: 'delivery', roleLabel: 'Delivery' },
  { name: 'Felicia Phan', email: 'felicia.phan@lpstech.com', role: 'bd-team', roleLabel: 'Business Development' },
  { name: 'Kelyn Wong', email: 'kelyn.wong@lpstech.com', role: 'admin', roleLabel: 'Administrator' },
];

/** Hardcoded demo credentials - one shared password, checked in LoginPage. */
export const DEMO_PASSWORD = 'Demo2026!';

export const TENDER = {
  ref: 'ITT/2026/014',
  title: 'National Contact Centre Modernisation Programme',
  agency: 'Public Service Digital Agency (Singapore)', // fictitious
  sector: 'Agency' as const,
  pages: 214,
  fileName: 'ITT-2026-014_Requirement_Specification_v3.pdf',
  fileSize: '18.4 MB',
  uploadedBy: 'John Price',
  uploadedAt: '2026-09-28T09:12:00+08:00',
  closingDate: '2026-10-24T16:00:00+08:00',
  processingMinutes: 17, // NFR10: >100 pages within 15-20 min
};

const cite = (docId: string, title: string, similarity: number, excerpt: string, tenderExcerpt?: string): Provenance => ({
  kind: 'grounded',
  citation: { docId, title, similarity, excerpt, tenderExcerpt, source: 'historical' },
});
/** Value read directly from the uploaded tender document (no historical match) */
const extracted = (docId: string, title: string, excerpt: string): Provenance => ({
  kind: 'grounded',
  citation: { docId, title, similarity: 1, excerpt, source: 'tender' },
});
const estimate: Provenance = { kind: 'estimate' };

const productItems: ProductItem[] = [
  {
    id: 'p1',
    quoteLine: 1,
    category: 'Software',
    description: 'Omnichannel CCaaS platform subscription (500 named agents)',
    vendor: 'Veridian Cloud Pte Ltd',
    vendorCommitment: true,
    unitCost: 950,
    qtyByFY: [500, 500, 500],
    remarks: 'Per agent per year, 3-year committed pricing',
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.91, 'CCaaS licence S$942/agent/yr on 3-yr commit, 460 agents',
      'Clause 6.1.2: The Contractor shall provide an omnichannel cloud contact centre platform licensed for no fewer than 500 named agents for the full contract term.'),
  },
  {
    id: 'p2',
    quoteLine: 1,
    category: 'Software',
    description: 'Speech analytics & quality management add-on',
    vendor: 'Veridian Cloud Pte Ltd',
    vendorCommitment: false,
    unitCost: 120000,
    qtyByFY: [1, 1, 1],
    remarks: 'Platform-wide annual subscription',
    provenance: estimate,
  },
  {
    id: 'p3',
    quoteLine: 1,
    category: 'Hardware',
    description: 'Agent workstations (ThinkCentre neo) & certified headsets',
    vendor: 'Lenovo PCCW Solutions',
    vendorCommitment: true,
    unitCost: 1450,
    qtyByFY: [520, 0, 0],
    remarks: '500 agents + 20 spares, deployed in Year 1',
    provenance: cite('BC-2024-012', 'Business Case - Govt Shared Services Helpdesk (Won, 2024)', 0.88, 'Workstation + headset bundle at S$1,430/seat, 380 seats',
      'Clause 6.3.1: The Contractor shall supply, deploy and maintain agent workstations and certified headsets for all 500 agent positions, including operational spares.'),
  },
  {
    id: 'p4',
    quoteLine: 1,
    category: 'Hardware',
    description: 'Session border controllers, HA pair (incl. 3-yr support)',
    vendor: 'NetEdge Distribution',
    vendorCommitment: true,
    unitCost: 86000,
    qtyByFY: [2, 0, 0],
    remarks: 'Active/active across two sites',
    provenance: cite('TD-2023-118', 'Tender Requirement - Statutory Board Hotline Refresh (2023)', 0.84, 'SBC HA pair incl. support quoted S$84.5k/unit',
      'Clause 6.5.4: Voice ingress shall be protected by session border controllers deployed as a high-availability pair across both designated data centres.'),
  },
  {
    id: 'p5',
    quoteLine: 1,
    category: 'External Service',
    description: 'CRM integration services (subcontracted SI)',
    vendor: 'Apex Digital Consulting',
    vendorCommitment: false,
    unitCost: 185000,
    qtyByFY: [1, 0, 0],
    remarks: 'Fixed-price SOW, integration to agency CRM',
    provenance: estimate,
  },
  {
    id: 'p6',
    quoteLine: 1,
    category: 'External Service',
    description: 'Independent penetration test & security review (annual)',
    vendor: 'CyberProbe Labs',
    vendorCommitment: false,
    unitCost: 48000,
    qtyByFY: [1, 1, 1],
    remarks: 'Required per tender clause 7.4.2',
    provenance: cite('WP-2024-007', 'Proposal - Ministry Citizen Portal (2024)', 0.86, 'Annual VAPT for in-scope systems, S$45–50k/yr',
      'Clause 7.4.2: An independent penetration test and security review of all in-scope systems shall be conducted annually by an accredited provider.'),
  },
  {
    id: 'p7',
    quoteLine: 1,
    category: 'Telephony Resource',
    description: 'SIP trunking, 600 concurrent channels',
    vendor: 'SingConnect Telecom',
    vendorCommitment: true,
    unitCost: 96,
    qtyByFY: [600, 600, 600],
    remarks: 'Per channel per year, committed rate',
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.83, 'SIP channel at S$8/mth committed (S$96/yr)',
      'Clause 6.5.1: The solution shall support no fewer than 600 concurrent inbound voice channels delivered via SIP trunking.'),
  },
  {
    id: 'p8',
    quoteLine: 2,
    category: 'External Service',
    description: 'Vendor L3 support & maintenance - CCaaS platform',
    vendor: 'Veridian Cloud Pte Ltd',
    vendorCommitment: true,
    unitCost: 142000,
    qtyByFY: [1, 1, 1],
    remarks: '24x7 vendor back-to-back support',
    provenance: cite('BC-2024-012', 'Business Case - Govt Shared Services Helpdesk (Won, 2024)', 0.87, 'Vendor L3 maintenance ~3.6% of licence TCV/yr',
      'Clause 8.2.3: The Contractor shall maintain 24x7 back-to-back support arrangements with the platform vendor for the full contract term.'),
  },
  {
    id: 'p9',
    quoteLine: 3,
    category: 'Software',
    description: 'SIEM log ingestion licence for SOC monitoring',
    vendor: 'SentinelGrid Asia',
    vendorCommitment: false,
    unitCost: 88000,
    qtyByFY: [1, 1, 1],
    remarks: 'Up to 150 GB/day ingestion',
    provenance: estimate,
  },
  {
    id: 'p10',
    quoteLine: 3,
    category: 'Hardware',
    description: 'Log collector appliances (4 sites)',
    vendor: 'NetEdge Distribution',
    vendorCommitment: false,
    unitCost: 21500,
    qtyByFY: [4, 0, 0],
    remarks: 'One per site, Year 1 deployment',
    provenance: estimate,
  },
];

// remarks = client-facing role title (synced with Labour Inputs "LPS Role for Client")
const resourceItems: ResourceItem[] = [
  {
    id: 'r1', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'Project Manager', grade: '7',
    teamCode: 'INS-CL-SG', dayRate: 526, mandaysByFY: [220, 80, 40],
    remarks: 'Programme Manager', mspoRole: 'PM-II (Project Management)',
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.89, 'PM 210 md in build year for comparable 500-seat rollout',
      'Clause 5.1.1: The Contractor shall appoint a dedicated programme manager accountable for delivery across all phases of the programme.'),
  },
  {
    id: 'r2', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'System Architect', grade: '8',
    teamCode: 'INS-CL-SG', dayRate: 631, mandaysByFY: [180, 40, 20],
    remarks: 'Lead Solution Architect', mspoRole: 'ARCH-III (Architecture)',
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.85, 'SA 170 md build + advisory tail',
      'Clause 5.1.2: A lead solution architect shall own the end-to-end technical design and the integration blueprint for the solution.'),
  },
  {
    id: 'r3', quoteLine: 1, team: 'MY ODC - AD - MY', role: 'Solution Consultant', grade: '6',
    teamCode: 'MY-AD', dayRate: 447, mandaysByFY: [420, 60, 0],
    remarks: 'CCaaS Consultant (IVR / routing / CTI)', mspoRole: 'CONS-III (Consulting)',
    provenance: estimate,
  },
  {
    id: 'r4', quoteLine: 1, team: 'MY ODC - AD - MY', role: 'Analyst Programmer', grade: '4',
    teamCode: 'MY-AD', dayRate: 261, mandaysByFY: [680, 120, 0],
    remarks: 'Integration Developer', mspoRole: 'CONS-II (Consulting)',
    provenance: estimate,
  },
  {
    id: 'r5', quoteLine: 1, team: 'PH ODC - AD - PH', role: 'QA Manager', grade: '6',
    teamCode: 'PH-AD', dayRate: 447, mandaysByFY: [160, 40, 0],
    remarks: 'Test Lead (SIT/UAT)', mspoRole: 'QA-III (Quality Assurance)',
    provenance: estimate,
  },
  {
    id: 'r6', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'System Engineer', grade: '5',
    teamCode: 'INS-CL-SG', dayRate: 309, mandaysByFY: [140, 60, 40],
    remarks: 'DevOps Engineer', mspoRole: 'ENG-II (Engineering)',
    provenance: estimate,
  },
  {
    id: 'r7', quoteLine: 2, team: 'Insys - Non-cloud - SG', role: 'Technical Engineer', grade: '4',
    teamCode: 'INS-NC-SG', dayRate: 261, mandaysByFY: [120, 440, 440],
    remarks: 'Service Desk L2', mspoRole: 'SUP-II (Support)',
    provenance: cite('BC-2024-012', 'Business Case - Govt Shared Services Helpdesk (Won, 2024)', 0.9, 'L2 support 2 FTE for 400+ seat operation',
      'Clause 8.1.4: The Contractor shall operate a service desk with L2 support sized for the full agent population across the contracted operating hours.'),
  },
  {
    id: 'r8', quoteLine: 2, team: 'Insys - Non-cloud - SG', role: 'Operation Manager', grade: '7',
    teamCode: 'INS-NC-SG', dayRate: 526, mandaysByFY: [40, 120, 120],
    remarks: 'SDM for Operations', mspoRole: 'SDM-II (Service Mgmt)',
    provenance: estimate,
  },
  {
    id: 'r9', quoteLine: 3, team: 'PH ODC - MS - PH', role: 'Security Analyst', grade: '4',
    teamCode: 'PH-MS', dayRate: 261, mandaysByFY: [220, 660, 660],
    remarks: 'SOC Analyst (24x7 pool)', mspoRole: 'SEC-II (Security Ops)',
    provenance: estimate,
  },
  {
    id: 'r10', quoteLine: 3, team: 'PH ODC - MS - PH', role: 'Security Specialist', grade: '6',
    teamCode: 'PH-MS', dayRate: 447, mandaysByFY: [40, 80, 80],
    remarks: 'Threat Intelligence Lead', mspoRole: 'SEC-III (Security Ops)',
    provenance: estimate,
  },
];

export function buildInitialBusinessCase(): BusinessCaseState {
  const bc: BusinessCaseState = {
    status: 'draft',
    basicInfo: {
      crmId: 'SFDC-00871245',
      projectName: 'National Contact Centre Modernisation Programme',
      customer: 'Public Service Digital Agency (Singapore)',
      endCustomer: 'Whole-of-Government contact centre operations',
      gtmUnit: 'Public HK', // template GTM list; SEA public equivalent
      gtmSubTeam: 'Public SEA',
      majorSolutionOffering: 'Contact Center Solutions',
      projectStart: '2026-04-01',
      projectEnd: '2029-03-31',
      currency: 'SGD',
      inflationBaseFY: 2026,
      // Per-field provenance: extracted fields cite the tender document itself;
      // internal GTM mappings are AI inferences with no source.
      // Extracted fields cite the tender document itself; Salesforce-sourced
      // fields are manual entry (Salesforce integration is out of scope).
      fieldProv: {
        crmId: { kind: 'manual', source: 'Salesforce' },
        projectName: extracted('ITT/2026/014', TENDER.title + ' - Requirement Specification', 'Cover page: "National Contact Centre Modernisation Programme"'),
        customer: extracted('ITT/2026/014', TENDER.title + ' - Requirement Specification', 'Section 1.1: issued by the Public Service Digital Agency (Singapore)'),
        endCustomer: { kind: 'manual', source: 'Salesforce' },
        gtmUnit: { kind: 'manual', source: 'Salesforce' },
        gtmSubTeam: { kind: 'manual', source: 'Salesforce' },
        majorSolutionOffering: { kind: 'manual', source: 'Salesforce' },
        projectStart: { kind: 'manual', source: 'Salesforce' },
        projectEnd: { kind: 'manual', source: 'Salesforce' },
        currency: extracted('ITT/2026/014', TENDER.title + ' - Requirement Specification', 'Section 9.2: all prices shall be quoted in Singapore Dollars (SGD)'),
      },
    },
    quoteLines: [
      { id: 1, solutionOffering: 'Contact Center Solutions', projectType: 'Milestone Based', remarks: 'Design, build & rollout', marginPct: 0.24,
        provenance: extracted('ITT/2026/014', TENDER.title + ' - Requirement Specification', 'Section 3: design, build and rollout of the modernised contact centre platform') },
      { id: 2, solutionOffering: 'Application Maintenance Services', projectType: 'Time Based', remarks: '36-month support & maintenance', marginPct: 0.28,
        provenance: extracted('ITT/2026/014', TENDER.title + ' - Requirement Specification', 'Section 8: application maintenance and support for the full 36-month contract term') },
      { id: 3, solutionOffering: 'Security Operations (SOC)', projectType: 'Time Based', remarks: '24x7 SOC monitoring per clause 7.2', marginPct: 0.26,
        provenance: extracted('ITT/2026/014', TENDER.title + ' - Requirement Specification', 'Clause 7.2: 24x7 security operations monitoring of all in-scope systems') },
    ],
    productItems,
    resourceItems,
    billing: [],
    billingFrequency: 'Quarterly',
    summaryRemarks: '',
    otherIndirect: {
      travelExpense: [35000, 12000, 8000],
      otherCosts: [15000, 5000, 5000],
      vendorRebate: [40000, 0, 0],
    },
    vendorCols: [],
    fxOverrides: {},
    gradeRateOverrides: {},
    appliedRates: defaultAppliedRates(3),
    labourMonthly: {},
    confirmedInputs: [],
    approvals: [],
  };

  // Billing plan: the TCV divided evenly across the project duration at the
  // chosen frequency (Final Check passes on generation; later edits may break
  // the equality, which the checks then surface).
  const s = computeSummary(bc);
  const tcv = Math.round(s.total.tcv);
  const per = 3; // quarterly
  const count = Math.max(1, Math.ceil(s.durationMonths / per));
  const startD = new Date(bc.basicInfo.projectStart);
  const base = Math.floor(tcv / count);
  bc.billing = Array.from({ length: count }, (_, i) => ({
    id: `b${i + 1}`,
    date: new Date(startD.getFullYear(), startD.getMonth() + i * per, 1).toISOString().slice(0, 10),
    schedule: `Quarterly billing ${i + 1} of ${count}`,
    amount: i === count - 1 ? tcv - base * (count - 1) : base,
    remarks: '',
    provenance: { kind: 'estimate' as const },
  }));
  // Named vendor-payment columns seeded from the Product Plan allocation
  bc.vendorCols = defaultVendorColumns(bc, s.durationMonths);
  return bc;
}

/** Scale every monetary/effort figure so seeded tenders have distinct deal sizes. */
function scaleBusinessCase(bc: BusinessCaseState, f: number): BusinessCaseState {
  const scaled: BusinessCaseState = {
    ...bc,
    productItems: bc.productItems.map((p) => ({ ...p, unitCost: Math.round(p.unitCost * f) })),
    resourceItems: bc.resourceItems.map((r) => ({ ...r, mandaysByFY: r.mandaysByFY.map((d) => Math.round(d * f)) })),
    billing: bc.billing.map((b) => ({ ...b, amount: Math.round(b.amount * f) })),
    otherIndirect: {
      travelExpense: bc.otherIndirect.travelExpense.map((v) => Math.round(v * f)),
      otherCosts: bc.otherIndirect.otherCosts.map((v) => Math.round(v * f)),
      vendorRebate: bc.otherIndirect.vendorRebate.map((v) => Math.round(v * f)),
    },
  };
  // Re-derive vendor columns from the scaled product plan so Final Check holds
  scaled.vendorCols = defaultVendorColumns(scaled, scaled.vendorCols[0]?.amounts.length || 36);
  return scaled;
}

function pastBc(
  projectName: string,
  customer: string,
  crmId: string,
  scale: number,
  approvedBy: string,
): BusinessCaseState {
  const bc = scaleBusinessCase(buildInitialBusinessCase(), scale);
  return {
    ...bc,
    status: 'submitted',
    approvals: ['Eng Chuan Puay', 'Thomas Low', 'Ethan Lim'],
    approvedBy,
    approvedAt: '2026-06-30T15:00:00+08:00',
    basicInfo: { ...bc.basicInfo, projectName, customer, endCustomer: customer, crmId },
  };
}

/** Business case produced by the pipeline for a freshly uploaded tender. */
export function buildGeneratedBusinessCase(projectName: string): BusinessCaseState {
  const bc = scaleBusinessCase(buildInitialBusinessCase(), 0.85);
  return {
    ...bc,
    basicInfo: {
      ...bc.basicInfo,
      projectName,
      crmId: `SFDC-00${Math.floor(870000 + Math.random() * 9999)}`,
      customer: 'To be confirmed from tender document',
      endCustomer: 'To be confirmed',
    },
  };
}

export function buildSeedTenders(): TenderRecord[] {
  return [
    {
      id: 't-main',
      ref: TENDER.ref,
      title: TENDER.title,
      agency: TENDER.agency,
      sector: TENDER.sector,
      pages: TENDER.pages,
      fileName: TENDER.fileName,
      fileSize: TENDER.fileSize,
      uploadedBy: TENDER.uploadedBy,
      uploadedAt: TENDER.uploadedAt,
      closingDate: TENDER.closingDate,
      processingMinutes: TENDER.processingMinutes,
      bc: buildInitialBusinessCase(),
    },
    {
      id: 't-insurer',
      ref: 'RFP/2026/221',
      title: 'Insurer Claims Portal Revamp',
      agency: 'Pacific Assurance Group',
      sector: 'Commercial',
      pages: 132,
      fileName: 'RFP-2026-221_Claims_Portal.pdf',
      fileSize: '11.7 MB',
      uploadedBy: 'John Price',
      uploadedAt: '2026-08-12T10:05:00+08:00',
      closingDate: '2026-09-04T16:00:00+08:00',
      processingMinutes: 14,
      outcome: 'Awaiting result',
      bc: pastBc('Insurer Claims Portal Revamp', 'Pacific Assurance Group', 'SFDC-00863310', 0.22, 'Ethan Lim'),
      submissionFormName: 'Form_of_Tender_RFP-2026-221.docx',
      submissionFilledAt: '2026-09-02T11:20:00+08:00',
    },
    {
      id: 't-hotline',
      ref: 'ITT/2026/007',
      title: 'Statutory Board Hotline Refresh',
      agency: 'Utilities Regulatory Office',
      sector: 'Agency',
      pages: 187,
      fileName: 'ITT-2026-007_Hotline_Refresh.pdf',
      fileSize: '15.2 MB',
      uploadedBy: 'John Price',
      uploadedAt: '2026-02-20T09:40:00+08:00',
      closingDate: '2026-03-27T16:00:00+08:00',
      processingMinutes: 16,
      outcome: 'Won',
      bc: pastBc('Statutory Board Hotline Refresh', 'Utilities Regulatory Office', 'SFDC-00841177', 0.35, 'Eng Chuan Puay'),
      submissionFormName: 'ITT-2026-007_Form_of_Tender.docx',
      submissionFilledAt: '2026-03-24T09:45:00+08:00',
    },
    {
      id: 't-port',
      ref: 'RFP/2025/198',
      title: 'Port Authority Service Desk',
      agency: 'Harbour & Maritime Board',
      sector: 'Agency',
      pages: 209,
      fileName: 'RFP-2025-198_Service_Desk.pdf',
      fileSize: '17.9 MB',
      uploadedBy: 'John Price',
      uploadedAt: '2025-11-18T14:22:00+08:00',
      closingDate: '2025-12-19T16:00:00+08:00',
      processingMinutes: 18,
      outcome: 'Lost',
      bc: pastBc('Port Authority Service Desk', 'Harbour & Maritime Board', 'SFDC-00822904', 0.55, 'Eng Chuan Puay'),
      submissionFormName: 'RFP-2025-198_Submission_Form.docx',
      submissionFilledAt: '2025-12-16T16:05:00+08:00',
    },
    {
      id: 't-erp',
      ref: 'RFP/2025/166',
      title: 'Statutory Board ERP Consolidation',
      agency: 'Land & Estates Authority',
      sector: 'Agency',
      pages: 243,
      fileName: 'RFP-2025-166_ERP_Consolidation.pdf',
      fileSize: '21.3 MB',
      uploadedBy: 'John Price',
      uploadedAt: '2025-09-02T10:12:00+08:00',
      closingDate: '2025-10-10T16:00:00+08:00',
      processingMinutes: 19,
      outcome: 'Won',
      bc: pastBc('Statutory Board ERP Consolidation', 'Land & Estates Authority', 'SFDC-00814452', 0.4, 'Eng Chuan Puay'),
      submissionFormName: 'RFP-2025-166_Form_of_Tender.docx',
      submissionFilledAt: '2025-10-06T11:00:00+08:00',
    },
    {
      id: 't-dw',
      ref: 'ITT/2025/089',
      title: 'Digital Workplace Refresh',
      agency: 'Coastal Insurance Group',
      sector: 'Commercial',
      pages: 98,
      fileName: 'ITT-2025-089_Digital_Workplace.pdf',
      fileSize: '8.1 MB',
      uploadedBy: 'John Price',
      uploadedAt: '2025-06-14T09:30:00+08:00',
      closingDate: '2025-07-18T16:00:00+08:00',
      processingMinutes: 12,
      outcome: 'Lost',
      bc: pastBc('Digital Workplace Refresh', 'Coastal Insurance Group', 'SFDC-00798210', 0.3, 'Ethan Lim'),
      submissionFormName: 'ITT-2025-089_Submission.docx',
      submissionFilledAt: '2025-07-15T15:40:00+08:00',
    },
    {
      id: 't-iot',
      ref: 'RFP/2026/203',
      title: 'Smart Facility IoT Rollout',
      agency: 'Metro Transit Operator',
      sector: 'Commercial',
      pages: 154,
      fileName: 'RFP-2026-203_IoT_Rollout.pdf',
      fileSize: '13.9 MB',
      uploadedBy: 'John Price',
      uploadedAt: '2026-07-08T14:05:00+08:00',
      closingDate: '2026-08-14T16:00:00+08:00',
      processingMinutes: 15,
      outcome: 'Awaiting result',
      bc: pastBc('Smart Facility IoT Rollout', 'Metro Transit Operator', 'SFDC-00869004', 0.27, 'Eng Chuan Puay'),
      submissionFormName: 'RFP-2026-203_Form_of_Tender.docx',
      submissionFilledAt: '2026-08-11T10:25:00+08:00',
    },
  ];
}

export const HISTORICAL_DOCS: HistoricalDoc[] = [
  { id: 'BC-2023-041', title: 'Business Case - Regional Bank Contact Centre', docType: 'Business Case', sector: 'Commercial', customer: 'Meridian Bank', outcome: 'Won', uploadedBy: 'Felicia Phan', uploadDate: '2025-11-03', embeddingStatus: 'Embedded', chunks: 214, version: '1.1', history: [
    { v: '1.0', archivedAt: '2025-12-09', by: 'Felicia Phan', note: 'Customer: Meridian Bank Ltd -> Meridian Bank; replaced draft workbook with the final signed version' },
  ] },
  // Linked set: full triple (requirement + proposal + business case) for the Citizen Portal tender
  { id: 'TD-2024-052', title: 'Tender Requirement - Ministry Citizen Portal', docType: 'Tender Requirement', sector: 'Agency', customer: 'Ministry of Community Services', outcome: '-', uploadedBy: 'Jessica Tan', uploadDate: '2026-01-20', embeddingStatus: 'Embedded', chunks: 318, version: '1.0', group: 'grp-portal' },
  { id: 'WP-2024-007', title: 'Proposal - Ministry Citizen Portal', docType: 'Proposal', sector: 'Agency', customer: 'Ministry of Community Services', outcome: 'Won', uploadedBy: 'Jessica Tan', uploadDate: '2026-01-20', embeddingStatus: 'Embedded', chunks: 402, version: '1.0', group: 'grp-portal' },
  { id: 'BC-2024-008', title: 'Business Case - Ministry Citizen Portal', docType: 'Business Case', sector: 'Agency', customer: 'Ministry of Community Services', outcome: 'Won', uploadedBy: 'Felicia Phan', uploadDate: '2026-01-21', embeddingStatus: 'Embedded', chunks: 196, version: '1.0', group: 'grp-portal' },
  // Linked set: partial pair (no proposal was archived for this tender)
  { id: 'TD-2023-104', title: 'Tender Requirement - Govt Shared Services Helpdesk', docType: 'Tender Requirement', sector: 'Agency', customer: 'Central Provident Services', outcome: '-', uploadedBy: 'John Price', uploadDate: '2025-12-12', embeddingStatus: 'Embedded', chunks: 441, version: '1.0', group: 'grp-helpdesk' },
  { id: 'BC-2024-012', title: 'Business Case - Govt Shared Services Helpdesk', docType: 'Business Case', sector: 'Agency', customer: 'Central Provident Services', outcome: 'Won', uploadedBy: 'Felicia Phan', uploadDate: '2025-12-14', embeddingStatus: 'Embedded', chunks: 187, version: '1.0', group: 'grp-helpdesk' },
  { id: 'LP-2024-019', title: 'Proposal - Port Authority Service Desk', docType: 'Proposal', sector: 'Agency', customer: 'Harbour & Maritime Board', outcome: 'Lost', uploadedBy: 'Rimple Sulekh', uploadDate: '2026-02-02', embeddingStatus: 'Embedded', chunks: 156, version: '1.0' },
  { id: 'TD-2023-118', title: 'Tender Requirement - Statutory Board Hotline Refresh', docType: 'Tender Requirement', sector: 'Agency', customer: 'Utilities Regulatory Office', outcome: '-', uploadedBy: 'John Price', uploadDate: '2026-02-17', embeddingStatus: 'Embedded', chunks: 523, version: '1.0' },
  { id: 'BC-2022-087', title: 'Business Case - Insurer Omnichannel Platform', docType: 'Business Case', sector: 'Commercial', customer: 'Pacific Assurance Group', outcome: 'Won', uploadedBy: 'Felicia Phan', uploadDate: '2026-03-01', embeddingStatus: 'Re-embedding', chunks: 178, version: '1.2', history: [
    { v: '1.0', archivedAt: '2026-01-15', by: 'Felicia Phan', note: 'Title: Business Case - Insurer Contact Platform -> Business Case - Insurer Omnichannel Platform' },
    { v: '1.1', archivedAt: '2026-03-01', by: 'Felicia Phan', note: 'Sector: Agency -> Commercial; customer corrected to the contracting entity' },
  ] },
  { id: 'TD-2026-031', title: 'Tender Requirement - Regional Hospital Command Centre', docType: 'Tender Requirement', sector: 'Agency', customer: 'Eastern Health Cluster', outcome: '-', uploadedBy: 'Chee Wee', uploadDate: '2026-06-11', embeddingStatus: 'Extraction failed', chunks: 0, version: '1.0' },
  { id: 'WP-2026-002', title: 'Proposal - Ministry Citizen Portal (duplicate upload)', docType: 'Proposal', sector: 'Agency', customer: 'Ministry of Community Services', outcome: 'Won', uploadedBy: 'Suriyan K', uploadDate: '2026-08-05', embeddingStatus: 'Duplicate - pending review', chunks: 0, version: '1.0' },
];

export const SEED_AUDIT: AuditEntry[] = [
  { id: 'a1', ts: '2026-09-28T09:12:00+08:00', user: 'John Price', role: 'Bidding Manager', action: 'Tender uploaded', tender: TENDER.ref, detail: `${TENDER.fileName} (${TENDER.pages} pages) uploaded to S3; processing started` },
  { id: 'a2', ts: '2026-09-28T09:14:00+08:00', user: 'system', role: 'Pipeline', action: 'Extraction', tender: TENDER.ref, detail: '214 pages extracted; section 6.3 (scanned annex) failed OCR - retried and recovered' },
  { id: 'a3', ts: '2026-09-28T09:21:00+08:00', user: 'system', role: 'Pipeline', action: 'Retrieval', tender: TENDER.ref, detail: 'Similarity search over pgvector store - 5 comparable records retrieved (filter: Agency)' },
  { id: 'a4', ts: '2026-09-28T09:29:00+08:00', user: 'system', role: 'Pipeline', action: 'Draft generated', tender: TENDER.ref, detail: 'Draft business case generated in 17 min: 10 product lines (6 grounded, 4 estimates), 10 labour lines' },
];

export interface PipelineStage {
  key: string;
  label: string;
  durationMs: number;
  detail: string;
  warning?: boolean;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: 'upload', label: 'Upload to S3 (KMS-encrypted)', durationMs: 900, detail: `${TENDER.fileName} · ${TENDER.fileSize}` },
  { key: 'extract', label: 'Text extraction & chunking', durationMs: 2600, detail: '214 pages → 1,872 chunks · section 6.3 failed OCR, retried OK', warning: true },
  { key: 'embed', label: 'Embedding (Titan Text Embeddings V2, in-Region)', durationMs: 1800, detail: '1,872 vectors stored in RDS pgvector' },
  { key: 'retrieve', label: 'Similarity retrieval from historical store', durationMs: 1400, detail: 'Filter: Agency · top-5 comparable records' },
  { key: 'generate', label: 'Draft generation (Bedrock, grounded + estimates)', durationMs: 2600, detail: '10 product lines · 10 labour lines · billing plan drafted' },
];
