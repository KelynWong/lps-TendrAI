// TendrAI's first draft of a tender's business case, produced as the last
// processing stage. Purely a demo device, like data/extraction.ts: the live
// system retrieves comparable historical business cases (pgvector) and has
// Bedrock draft the lines from the tender pack. Here a fixed set of realistic
// lines (from the V1 POC) is sized per tender and cited against the tender's
// own extracted clauses. All customers, vendors and figures are fictitious.

import type { Clause, Tender } from '../types';
import type { BusinessCaseState, Provenance, ProductItem, ResourceItem } from './model';
import { computeSummary, defaultAppliedRates, defaultVendorColumns } from './calc';

type DraftTender = Pick<Tender, 'id' | 'ref' | 'name' | 'agency' | 'projectType' | 'sfdcCrmId' | 'closingDate' | 'pack' | 'clauses'>;

const HIST = {
  bank: { docId: 'BC-2023-041', title: 'Business Case - Regional Bank Contact Centre (Won, 2023)' },
  helpdesk: { docId: 'BC-2024-012', title: 'Business Case - Govt Shared Services Helpdesk (Won, 2024)' },
  hotline: { docId: 'TD-2023-118', title: 'Tender Requirement - Statutory Board Hotline Refresh (2023)' },
  portal: { docId: 'WP-2024-007', title: 'Proposal - Ministry Citizen Portal (2024)' },
};

/** A past business case the AI may draft from (from Historical data). */
export interface DraftSource {
  docId: string;
  title: string;
  use: 'preferred' | 'standard';
}

/** Builds the citation helpers for one tender: historical matches carry the
 *  tender clause they answer, tender extractions cite the pack document. When
 *  Historical data supplies sources, they replace the reference cases: won
 *  (preferred) cases are cited twice as often as lost (standard) ones, and a
 *  lost case counts as a slightly weaker match; excluded cases never reach this list. */
function citer(t: DraftTender, sources: DraftSource[] = []) {
  const technical = t.clauses.filter((c) => c.category === 'Technical' || c.category === 'Commercial');
  const pool: Clause[] = technical.length ? technical : t.clauses;
  let next = 0;
  const clauseText = () => {
    const c = pool[next++ % Math.max(pool.length, 1)];
    return c ? `Clause ${c.number}: ${c.text}` : undefined;
  };
  const weighted = sources.flatMap((s) => (s.use === 'preferred' ? [s, s] : [s]));
  let nextSource = 0;
  const packDoc = t.pack.find((d) => d.role === 'General Requirements')?.name ?? t.pack[0]?.name ?? 'Tender pack';
  const cite = (h: { docId: string; title: string }, similarity: number, excerpt: string): Provenance => {
    const s = weighted.length ? weighted[nextSource++ % weighted.length] : undefined;
    const score = s?.use === 'standard' ? similarity - 0.05 : similarity;
    return {
      kind: 'grounded',
      citation: { docId: s?.docId ?? h.docId, title: s?.title ?? h.title, similarity: score, excerpt, tenderExcerpt: clauseText(), source: 'historical' },
    };
  };
  const extracted = (excerpt: string): Provenance => ({
    kind: 'grounded',
    citation: { docId: t.ref || t.id, title: `${t.name} - ${packDoc}`, similarity: 1, excerpt, source: 'tender', tenderId: t.id, fileName: packDoc },
  });
  return { cite, extracted };
}

/** Deterministic deal size per tender (0.6x to 1.29x of the reference case). */
function sizeFactor(id: string): number {
  const h = [...id].reduce((n, ch) => Math.imul(n ^ ch.charCodeAt(0), 2654435761) >>> 0, 2166136261);
  return 0.6 + (h % 70) / 100;
}

/** Project start: the first 1 April at least two months after closing, so
 *  project years line up with the Apr-Mar fiscal years MSPO uses. */
function projectDates(closingDate: string) {
  const c = closingDate ? new Date(closingDate) : new Date();
  const earliest = new Date(c.getFullYear(), c.getMonth() + 2, 1);
  const startYear = earliest.getMonth() > 3 ? earliest.getFullYear() + 1 : earliest.getFullYear();
  const start = `${startYear}-04-01`;
  const end = `${startYear + 3}-03-31`;
  return { start, end, baseFY: startYear };
}

function referenceLines(t: DraftTender, sources: DraftSource[]) {
  const { cite } = citer(t, sources);
  const estimate: Provenance = { kind: 'estimate' };
  const productItems: ProductItem[] = [
    { id: 'p1', quoteLine: 1, category: 'Software', description: 'Omnichannel CCaaS platform subscription (500 named agents)', vendor: 'Veridian Cloud Pte Ltd', vendorCommitment: true, unitCost: 950, qtyByFY: [500, 500, 500], remarks: 'Per agent per year, 3-year committed pricing',
      provenance: cite(HIST.bank, 0.91, 'CCaaS licence S$942/agent/yr on 3-yr commit, 460 agents') },
    { id: 'p2', quoteLine: 1, category: 'Software', description: 'Speech analytics & quality management add-on', vendor: 'Veridian Cloud Pte Ltd', vendorCommitment: false, unitCost: 120000, qtyByFY: [1, 1, 1], remarks: 'Platform-wide annual subscription', provenance: estimate },
    { id: 'p3', quoteLine: 1, category: 'Hardware', description: 'Agent workstations (ThinkCentre neo) & certified headsets', vendor: 'Lenovo PCCW Solutions', vendorCommitment: true, unitCost: 1450, qtyByFY: [520, 0, 0], remarks: '500 agents + 20 spares, deployed in Year 1',
      provenance: cite(HIST.helpdesk, 0.88, 'Workstation + headset bundle at S$1,430/seat, 380 seats') },
    { id: 'p4', quoteLine: 1, category: 'Hardware', description: 'Session border controllers, HA pair (incl. 3-yr support)', vendor: 'NetEdge Distribution', vendorCommitment: true, unitCost: 86000, qtyByFY: [2, 0, 0], remarks: 'Active/active across two sites',
      provenance: cite(HIST.hotline, 0.84, 'SBC HA pair incl. support quoted S$84.5k/unit') },
    { id: 'p5', quoteLine: 1, category: 'External Service', description: 'CRM integration services (subcontracted SI)', vendor: 'Apex Digital Consulting', vendorCommitment: false, unitCost: 185000, qtyByFY: [1, 0, 0], remarks: 'Fixed-price SOW, integration to customer CRM', provenance: estimate },
    { id: 'p6', quoteLine: 1, category: 'External Service', description: 'Independent penetration test & security review (annual)', vendor: 'CyberProbe Labs', vendorCommitment: false, unitCost: 48000, qtyByFY: [1, 1, 1], remarks: 'Annual VAPT required by the tender',
      provenance: cite(HIST.portal, 0.86, 'Annual VAPT for in-scope systems, S$45-50k/yr') },
    { id: 'p7', quoteLine: 1, category: 'Telephony Resource', description: 'SIP trunking, 600 concurrent channels', vendor: 'SingConnect Telecom', vendorCommitment: true, unitCost: 96, qtyByFY: [600, 600, 600], remarks: 'Per channel per year, committed rate',
      provenance: cite(HIST.bank, 0.77, 'SIP channel at S$8/mth committed (S$96/yr)') },
    { id: 'p8', quoteLine: 2, category: 'External Service', description: 'Vendor L3 support & maintenance - platform', vendor: 'Veridian Cloud Pte Ltd', vendorCommitment: true, unitCost: 142000, qtyByFY: [1, 1, 1], remarks: '24x7 vendor back-to-back support',
      provenance: cite(HIST.helpdesk, 0.87, 'Vendor L3 maintenance ~3.6% of licence TCV/yr') },
    { id: 'p9', quoteLine: 3, category: 'Software', description: 'SIEM log ingestion licence for SOC monitoring', vendor: 'SentinelGrid Asia', vendorCommitment: false, unitCost: 88000, qtyByFY: [1, 1, 1], remarks: 'Up to 150 GB/day ingestion', provenance: estimate },
    { id: 'p10', quoteLine: 3, category: 'Hardware', description: 'Log collector appliances (4 sites)', vendor: 'NetEdge Distribution', vendorCommitment: false, unitCost: 21500, qtyByFY: [4, 0, 0], remarks: 'One per site, Year 1 deployment', provenance: estimate },
  ];
  // remarks = client-facing role title (Labour Inputs "LPS Role for Client", the MSPO Skill)
  const resourceItems: ResourceItem[] = [
    { id: 'r1', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'Project Manager', grade: '7', teamCode: 'INS-CL-SG', dayRate: 526, mandaysByFY: [220, 80, 40], remarks: 'Programme Manager', mspoRole: 'PM-II (Project Management)',
      provenance: cite(HIST.bank, 0.89, 'PM 210 md in build year for comparable 500-seat rollout') },
    { id: 'r2', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'System Architect', grade: '8', teamCode: 'INS-CL-SG', dayRate: 631, mandaysByFY: [180, 40, 20], remarks: 'Lead Solution Architect', mspoRole: 'ARCH-III (Architecture)',
      provenance: cite(HIST.bank, 0.85, 'SA 170 md build + advisory tail') },
    { id: 'r3', quoteLine: 1, team: 'MY ODC - AD - MY', role: 'Solution Consultant', grade: '6', teamCode: 'MY-AD', dayRate: 447, mandaysByFY: [420, 60, 0], remarks: 'Platform Consultant (IVR / routing / CTI)', mspoRole: 'CONS-III (Consulting)', provenance: estimate },
    { id: 'r4', quoteLine: 1, team: 'MY ODC - AD - MY', role: 'Analyst Programmer', grade: '4', teamCode: 'MY-AD', dayRate: 261, mandaysByFY: [680, 120, 0], remarks: 'Integration Developer', mspoRole: 'CONS-II (Consulting)', provenance: estimate },
    { id: 'r5', quoteLine: 1, team: 'PH ODC - AD - PH', role: 'QA Manager', grade: '6', teamCode: 'PH-AD', dayRate: 447, mandaysByFY: [160, 40, 0], remarks: 'Test Lead (SIT/UAT)', mspoRole: 'QA-III (Quality Assurance)', provenance: estimate },
    { id: 'r6', quoteLine: 1, team: 'Insys - Cloud - SG', role: 'System Engineer', grade: '5', teamCode: 'INS-CL-SG', dayRate: 309, mandaysByFY: [140, 60, 40], remarks: 'DevOps Engineer', mspoRole: 'ENG-II (Engineering)', provenance: estimate },
    { id: 'r7', quoteLine: 2, team: 'Insys - Non-cloud - SG', role: 'Technical Engineer', grade: '4', teamCode: 'INS-NC-SG', dayRate: 261, mandaysByFY: [120, 440, 440], remarks: 'Service Desk L2', mspoRole: 'SUP-II (Support)',
      provenance: cite(HIST.helpdesk, 0.9, 'L2 support 2 FTE for 400+ seat operation') },
    { id: 'r8', quoteLine: 2, team: 'Insys - Non-cloud - SG', role: 'Operation Manager', grade: '7', teamCode: 'INS-NC-SG', dayRate: 526, mandaysByFY: [40, 120, 120], remarks: 'SDM for Operations', mspoRole: 'SDM-II (Service Mgmt)', provenance: estimate },
    { id: 'r9', quoteLine: 3, team: 'PH ODC - MS - PH', role: 'Security Analyst', grade: '4', teamCode: 'PH-MS', dayRate: 261, mandaysByFY: [220, 660, 660], remarks: 'SOC Analyst (24x7 pool)', mspoRole: 'SEC-II (Security Ops)', provenance: estimate },
    { id: 'r10', quoteLine: 3, team: 'PH ODC - MS - PH', role: 'Security Specialist', grade: '6', teamCode: 'PH-MS', dayRate: 447, mandaysByFY: [40, 80, 80], remarks: 'Threat Intelligence Lead', mspoRole: 'SEC-III (Security Ops)', provenance: estimate },
  ];
  // reference prices are SGD quotes; they convert if the quote currency changes
  return { productItems: productItems.map((p) => ({ ...p, currency: 'SGD' })), resourceItems };
}

/** Billing plan: the TCV divided evenly across the duration at the cadence
 *  (the last line absorbs the remainder, so the draft passes Final Check). */
export function evenBilling(bc: BusinessCaseState, perMonths: number, label: string): BusinessCaseState['billing'] {
  const s = computeSummary(bc);
  const tcv = Math.round(s.total.tcv);
  const count = Math.max(1, Math.ceil(s.durationMonths / perMonths));
  const start = new Date(bc.basicInfo.projectStart);
  const base = Math.floor(tcv / count);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i * perMonths, 1);
    return {
      id: `b${i + 1}`,
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
      schedule: `${label} billing ${i + 1} of ${count}`,
      amount: i === count - 1 ? tcv - base * (count - 1) : base,
      remarks: '',
      provenance: { kind: 'estimate' as const },
    };
  });
}

/** Scales every cost and effort figure (deal sizing). */
function scaled(bc: BusinessCaseState, f: number): BusinessCaseState {
  return {
    ...bc,
    productItems: bc.productItems.map((p) => ({ ...p, unitCost: Math.round(p.unitCost * f) })),
    resourceItems: bc.resourceItems.map((r) => ({ ...r, mandaysByFY: r.mandaysByFY.map((d) => Math.round(d * f)) })),
    otherIndirect: {
      travelExpense: bc.otherIndirect.travelExpense.map((v) => Math.round(v * f)),
      otherCosts: bc.otherIndirect.otherCosts.map((v) => Math.round(v * f)),
      vendorRebate: bc.otherIndirect.vendorRebate.map((v) => Math.round(v * f)),
    },
  };
}

/** TendrAI's first draft for a processed tender. `targetTcv` sizes the deal
 *  to a known contract value (used by the seeded historical tenders). */
export function generateBusinessCase(t: DraftTender, opts: { targetTcv?: number; sources?: DraftSource[]; fxRates?: Record<string, number> } = {}): BusinessCaseState {
  const { extracted } = citer(t);
  const { productItems, resourceItems } = referenceLines(t, opts.sources ?? []);
  const { start, end, baseFY } = projectDates(t.closingDate);
  const manual = (source = 'Salesforce'): Provenance => ({ kind: 'manual', source });
  const base: BusinessCaseState = {
    basicInfo: {
      crmId: t.sfdcCrmId ?? '',
      projectName: t.name,
      customer: t.agency || 'To be confirmed from the tender pack',
      endCustomer: '',
      gtmUnit: 'SEA',
      gtmSubTeam: 'Public SEA',
      majorSolutionOffering: 'Contact Center Solutions',
      projectStart: start,
      projectEnd: end,
      currency: 'SGD',
      inflationBaseFY: baseFY,
      // Pack-extracted fields cite the tender pack; Salesforce fields are keyed in
      fieldProv: {
        crmId: manual(),
        projectName: extracted(`Cover page: "${t.name}"`),
        customer: extracted(`Section 1.1: issued by ${t.agency || 'the customer'}`),
        endCustomer: manual(),
        gtmUnit: manual(),
        gtmSubTeam: manual(),
        majorSolutionOffering: manual(),
        projectStart: extracted('Contract term: commencement on 1 April following award, for 36 months'),
        projectEnd: extracted('Contract term: 36 months from commencement'),
        currency: extracted('All prices shall be quoted in Singapore Dollars (SGD)'),
      },
    },
    quoteLines: [
      { id: 1, solutionOffering: 'Contact Center Solutions', projectType: t.projectType, remarks: 'Design, build & rollout', marginPct: 0.24,
        provenance: extracted('Scope of work: design, build and rollout of the solution') },
      { id: 2, solutionOffering: 'Application Maintenance Services', projectType: 'Time Based', remarks: '36-month support & maintenance', marginPct: 0.28,
        provenance: extracted('Scope of work: maintenance and support for the full 36-month contract term') },
      { id: 3, solutionOffering: 'Security Operations (SOC)', projectType: 'Time Based', remarks: '24x7 SOC monitoring', marginPct: 0.26,
        provenance: extracted('Security requirements: 24x7 security operations monitoring of all in-scope systems') },
    ],
    productItems,
    resourceItems,
    billing: [],
    billingFrequency: 'Quarterly',
    summaryRemarks: '',
    otherIndirect: { travelExpense: [35000, 12000, 8000], otherCosts: [15000, 5000, 5000], vendorRebate: [40000, 0, 0] },
    vendorCols: [],
    // the company default exchange rates at drafting time become this case's applied rates
    fxOverrides: { ...(opts.fxRates ?? {}) },
    gradeRateOverrides: {},
    appliedRates: defaultAppliedRates(3),
    labourMonthly: {},
    confirmedInputs: [],
  };
  const refTcv = computeSummary(base).total.tcv;
  const f = opts.targetTcv && refTcv ? opts.targetTcv / refTcv : sizeFactor(t.id);
  const bc = scaled(base, f);
  bc.billing = evenBilling(bc, 3, 'Quarterly');
  // vendor-payment columns seeded from the Product Plan allocation
  bc.vendorCols = defaultVendorColumns(bc, computeSummary(bc).durationMonths);
  return bc;
}
