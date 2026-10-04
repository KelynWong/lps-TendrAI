// Hardcoded but realistic demo data for the POC.
// All customers, vendors, figures and citations are fictitious.

import type {
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

export const USERS: UserInfo[] = [
  { name: 'Eng Chuan Puay', email: 'ecpuay@lpstech.com', role: 'executive-sponsor', roleLabel: 'Executive Sponsor' },
  { name: 'Ethan Lim', email: 'ethan.lim@lpstech.com', role: 'business-sponsor', roleLabel: 'Business Sponsor' },
  { name: 'John Price', email: 'john.price@lpstech.com', role: 'bidding-manager', roleLabel: 'Bidding Manager' },
  { name: 'Chee Wee', email: 'chee.wee@lpstech.com', role: 'presales', roleLabel: 'Presales Consultant' },
  { name: 'Priya Nair', email: 'priya.nair@lpstech.com', role: 'delivery', roleLabel: 'Delivery Manager' },
  { name: 'Felicia Phan', email: 'felicia.phan@lpstech.com', role: 'bd-team', roleLabel: 'Business Development' },
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

const cite = (docId: string, title: string, similarity: number, excerpt: string): Provenance => ({
  kind: 'grounded',
  citation: { docId, title, similarity, excerpt },
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
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.91, 'CCaaS licence S$942/agent/yr on 3-yr commit, 460 agents'),
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
    provenance: cite('BC-2024-012', 'Business Case - Govt Shared Services Helpdesk (Won, 2024)', 0.88, 'Workstation + headset bundle at S$1,430/seat, 380 seats'),
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
    provenance: cite('TD-2023-118', 'Tender Requirement - Statutory Board Hotline Refresh (2023)', 0.84, 'SBC HA pair incl. support quoted S$84.5k/unit'),
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
    provenance: cite('WP-2024-007', 'Won Proposal - Ministry Citizen Portal (2024)', 0.86, 'Annual VAPT for in-scope systems, S$45–50k/yr'),
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
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.83, 'SIP channel at S$8/mth committed (S$96/yr)'),
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
    provenance: cite('BC-2024-012', 'Business Case - Govt Shared Services Helpdesk (Won, 2024)', 0.87, 'Vendor L3 maintenance ~3.6% of licence TCV/yr'),
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
    teamCode: 'INS-CL-SG', dayRate: 980, mandaysByFY: [220, 80, 40],
    remarks: 'Programme Manager', mspoRole: 'PM-II (Project Management)',
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.89, 'PM 210 md in build year for comparable 500-seat rollout'),
  },
  {
    id: 'r2', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'System Architect', grade: '8',
    teamCode: 'INS-CL-SG', dayRate: 1150, mandaysByFY: [180, 40, 20],
    remarks: 'Lead Solution Architect', mspoRole: 'ARCH-III (Architecture)',
    provenance: cite('BC-2023-041', 'Business Case - Regional Bank Contact Centre (Won, 2023)', 0.85, 'SA 170 md build + advisory tail'),
  },
  {
    id: 'r3', quoteLine: 1, team: 'MY ODC - AD - MY', role: 'Solution Consultant', grade: '6',
    teamCode: 'MY-AD', dayRate: 820, mandaysByFY: [420, 60, 0],
    remarks: 'CCaaS Consultant (IVR / routing / CTI)', mspoRole: 'CONS-III (Consulting)',
    provenance: estimate,
  },
  {
    id: 'r4', quoteLine: 1, team: 'MY ODC - AD - MY', role: 'Analyst Programmer', grade: '4',
    teamCode: 'MY-AD', dayRate: 640, mandaysByFY: [680, 120, 0],
    remarks: 'Integration Developer', mspoRole: 'CONS-II (Consulting)',
    provenance: estimate,
  },
  {
    id: 'r5', quoteLine: 1, team: 'PH ODC - AD - PH', role: 'QA Manager', grade: '6',
    teamCode: 'PH-AD', dayRate: 700, mandaysByFY: [160, 40, 0],
    remarks: 'Test Lead (SIT/UAT)', mspoRole: 'QA-III (Quality Assurance)',
    provenance: estimate,
  },
  {
    id: 'r6', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'System Engineer', grade: '5',
    teamCode: 'INS-CL-SG', dayRate: 760, mandaysByFY: [140, 60, 40],
    remarks: 'DevOps Engineer', mspoRole: 'ENG-II (Engineering)',
    provenance: estimate,
  },
  {
    id: 'r7', quoteLine: 2, team: 'Insys - Non-cloud - SG', role: 'Technical Engineer', grade: '4',
    teamCode: 'INS-NC-SG', dayRate: 560, mandaysByFY: [120, 440, 440],
    remarks: 'Service Desk L2', mspoRole: 'SUP-II (Support)',
    provenance: cite('BC-2024-012', 'Business Case - Govt Shared Services Helpdesk (Won, 2024)', 0.9, 'L2 support 2 FTE for 400+ seat operation'),
  },
  {
    id: 'r8', quoteLine: 2, team: 'Insys - Non-cloud - SG', role: 'Operation Manager', grade: '7',
    teamCode: 'INS-NC-SG', dayRate: 850, mandaysByFY: [40, 120, 120],
    remarks: 'SDM for Operations', mspoRole: 'SDM-II (Service Mgmt)',
    provenance: estimate,
  },
  {
    id: 'r9', quoteLine: 3, team: 'PH ODC - MS - PH', role: 'Security Analyst', grade: '4',
    teamCode: 'PH-MS', dayRate: 590, mandaysByFY: [220, 660, 660],
    remarks: 'SOC Analyst (24x7 pool)', mspoRole: 'SEC-II (Security Ops)',
    provenance: estimate,
  },
  {
    id: 'r10', quoteLine: 3, team: 'PH ODC - MS - PH', role: 'Security Specialist', grade: '6',
    teamCode: 'PH-MS', dayRate: 880, mandaysByFY: [40, 80, 80],
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
      provenance: cite('ITT/2026/014', TENDER.title + ' - Requirement Specification', 1.0, 'Sections 1.2 Scope, 2.1 Contract Period (36 months from award)'),
    },
    quoteLines: [
      { id: 1, solutionOffering: 'Contact Center Solutions', projectType: 'Milestone Based', remarks: 'Design, build & rollout', marginPct: 0.24 },
      { id: 2, solutionOffering: 'Application Maintenance Services', projectType: 'Time Based', remarks: '36-month support & maintenance', marginPct: 0.28 },
      { id: 3, solutionOffering: 'Security Operations (SOC)', projectType: 'Time Based', remarks: '24x7 SOC monitoring per clause 7.2', marginPct: 0.26 },
    ],
    productItems,
    resourceItems,
    billing: [],
    otherIndirect: {
      travelExpense: [35000, 12000, 8000],
      otherCosts: [15000, 5000, 5000],
      vendorRebate: [40000, 0, 0],
    },
    vendorCols: [],
    fxOverrides: {},
    appliedRates: defaultAppliedRates(3),
    labourMonthly: {},
    approvals: [],
  };

  // Billing plan initialised to match the computed TCV (Final Check passes on generation;
  // subsequent edits may break the equality, which the checks then surface).
  const s = computeSummary(bc);
  const tcv = s.total.tcv;
  const impl = s.perLine[0].tcv;
  const rec = tcv - impl;
  const mk = (i: number, date: string, schedule: string, amount: number): typeof bc.billing[number] => ({
    id: `b${i}`, date, schedule, amount: Math.round(amount), remarks: '',
    provenance: { kind: 'estimate' },
  });
  bc.billing = [
    mk(1, '2026-05-01', 'Contract award (10% of implementation)', impl * 0.1),
    mk(2, '2026-09-01', 'Detailed design sign-off (20%)', impl * 0.2),
    mk(3, '2027-01-01', 'SIT completion (25%)', impl * 0.25),
    mk(4, '2027-04-01', 'Go-live & acceptance (35%)', impl * 0.35),
    mk(5, '2027-10-01', 'Post-implementation review (10%)', impl * 0.1),
  ];
  // Recurring services billed quarterly over 12 quarters starting Jul-2026
  const q = rec / 12;
  for (let i = 0; i < 12; i++) {
    const d = new Date(2026, 6 + i * 3, 1);
    bc.billing.push(
      mk(6 + i, d.toISOString().slice(0, 10), `Quarterly service fee Q${i + 1} (AMS + SOC)`, q),
    );
  }
  // Round-off adjustment onto the final milestone so billing exactly equals TCV
  const diff = tcv - bc.billing.reduce((a, b) => a + b.amount, 0);
  bc.billing[bc.billing.length - 1].amount += Math.round(diff);
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
    approvals: ['Eng Chuan Puay', 'Ethan Lim'],
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
  ];
}

export const HISTORICAL_DOCS: HistoricalDoc[] = [
  { id: 'BC-2023-041', title: 'Business Case - Regional Bank Contact Centre', docType: 'Business Case', sector: 'Commercial', customer: 'Meridian Bank', outcome: 'Won', uploadedBy: 'Felicia Phan', uploadDate: '2025-11-03', embeddingStatus: 'Embedded', chunks: 214, versions: 2 },
  { id: 'BC-2024-012', title: 'Business Case - Govt Shared Services Helpdesk', docType: 'Business Case', sector: 'Agency', customer: 'Central Provident Services', outcome: 'Won', uploadedBy: 'Felicia Phan', uploadDate: '2025-12-14', embeddingStatus: 'Embedded', chunks: 187, versions: 1 },
  { id: 'WP-2024-007', title: 'Won Proposal - Ministry Citizen Portal', docType: 'Won Proposal', sector: 'Agency', customer: 'Ministry of Community Services', outcome: 'Won', uploadedBy: 'Jessica Tan', uploadDate: '2026-01-20', embeddingStatus: 'Embedded', chunks: 402, versions: 1 },
  { id: 'LP-2024-019', title: 'Lost Proposal - Port Authority Service Desk', docType: 'Lost Proposal', sector: 'Agency', customer: 'Harbour & Maritime Board', outcome: 'Lost', uploadedBy: 'Rimple Sulekh', uploadDate: '2026-02-02', embeddingStatus: 'Embedded', chunks: 156, versions: 1 },
  { id: 'TD-2023-118', title: 'Tender Requirement - Statutory Board Hotline Refresh', docType: 'Tender Requirement', sector: 'Agency', customer: 'Utilities Regulatory Office', outcome: '-', uploadedBy: 'John Price', uploadDate: '2026-02-17', embeddingStatus: 'Embedded', chunks: 523, versions: 1 },
  { id: 'BC-2022-087', title: 'Business Case - Insurer Omnichannel Platform', docType: 'Business Case', sector: 'Commercial', customer: 'Pacific Assurance Group', outcome: 'Won', uploadedBy: 'Felicia Phan', uploadDate: '2026-03-01', embeddingStatus: 'Re-embedding', chunks: 178, versions: 3 },
  { id: 'TD-2026-031', title: 'Tender Requirement - Regional Hospital Command Centre', docType: 'Tender Requirement', sector: 'Agency', customer: 'Eastern Health Cluster', outcome: '-', uploadedBy: 'Chee Wee', uploadDate: '2026-06-11', embeddingStatus: 'Extraction failed', chunks: 0, versions: 1 },
  { id: 'WP-2026-002', title: 'Won Proposal - Ministry Citizen Portal (duplicate upload)', docType: 'Won Proposal', sector: 'Agency', customer: 'Ministry of Community Services', outcome: 'Won', uploadedBy: 'Suriyan K', uploadDate: '2026-08-05', embeddingStatus: 'Duplicate - pending review', chunks: 0, versions: 1 },
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
