// Realistic but fictitious demo data. Everything here is mock data: uploads
// are simulated, AI results are pre-built, refreshing resets the demo.
//
// The tender set deliberately covers every lifecycle situation:
//  t1  fully processed, partly reviewed (34/120 clauses), BC v1-v3, MSPO downloaded
//  t2  processed ATFM tender, BC v1 failing checks, ATFM template matched
//  t3  commercial tender, processed, generic template fallback, no BC yet
//  t4  newly created, no documents
//  t5  30 documents uploaded (some very large), never processed
//  t6  processing in progress (stage 3 of 6)
//  t7  half processed: 5 of 7 done, 2 failed, recently reprocessed (new/changed items)
//  t8  processing failed entirely, Retry offered; deadline overdue
//  t9  fully processed, nothing reviewed; title deliberately similar to t1
//  t10 processed, then 2 documents added and 1 removed - results out of date
//  t11 created without the optional GeBIZ ref and customer
//  t12 business case upload whose layout was not recognised
//  t13 agency tender with no agency template in the library (generic offered)
//  t14 past DRB, Won        t15 past DRB, Lost        t16 closed and archived

import { USERS } from '../config';
import type {
  AuditEntry,
  BcBilling,
  BcProduct,
  BcResource,
  BcVersion,
  Boilerplate,
  ChecklistItem,
  Clause,
  ClauseCategory,
  PackDoc,
  Qualification,
  RepoRecord,
  TemplateDoc,
  Tender,
} from '../types';

// Dates are produced relative to "today" so the demo never looks stale.
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const daysFromNow = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const tsAt = (daysAgo: number, hhmm = '10:05') =>
  `${daysFromNow(-daysAgo)}T${hhmm}:00+08:00`;

// ---- Business case versions (tender T1) ------------------------------------

const products = (over: Partial<BcProduct>[] = []): BcProduct[] => {
  const base: BcProduct[] = [
    { id: 'p1', ql: 1, category: 'Software', desc: 'Omnichannel CCaaS platform subscription (500 agents)', unitCost: 950, qty: 1500, total: 1425000 },
    { id: 'p2', ql: 1, category: 'Hardware', desc: 'Agent workstations and certified headsets', unitCost: 1450, qty: 520, total: 754000 },
    { id: 'p3', ql: 1, category: 'Hardware', desc: 'Session border controllers, HA pair', unitCost: 86000, qty: 2, total: 172000 },
    { id: 'p4', ql: 2, category: 'External Service', desc: 'Independent penetration test (annual)', unitCost: 48000, qty: 3, total: 144000 },
    { id: 'p5', ql: 3, category: 'Software', desc: 'SIEM log ingestion licence', unitCost: 88000, qty: 3, total: 264000 },
  ];
  return base.map((p) => ({ ...p, ...(over.find((o) => o.id === p.id) ?? {}) }));
};

const resources = (over: Partial<BcResource>[] = []): BcResource[] => {
  const base: BcResource[] = [
    // man-days per fiscal year (26/27 Sep-Mar 7 months, 27/28, 28/29, 29/30 Apr-Aug 5 months);
    // one person at 18.5 man-days a month = 129.5 / 222 / 222 / 92.5
    { id: 'r1', ql: 1, role: 'Project Manager', skill: 'Programme Management', grade: '7', team: 'Insys - Cloud - SG', fyMandays: [129.5, 222, 222, 92.5], mandays: 666, dayRate: 980, total: 652680 },
    { id: 'r2', ql: 1, role: 'System Architect', skill: 'Solution Architecture', grade: '8', team: 'Insys - Cloud - SG', fyMandays: [129.5, 111, 0, 0], mandays: 240.5, dayRate: 1150, total: 276575 },
    { id: 'r3', ql: 1, role: 'Analyst Programmer', skill: 'CCaaS Development', grade: '4', team: 'MY ODC - AD - MY', fyMandays: [259, 222, 222, 0], mandays: 703, dayRate: 640, total: 449920 },
    { id: 'r4', ql: 2, role: 'Helpdesk Officer', skill: 'Onsite Desktop L1', grade: '3', team: 'Insys - Non-cloud - SG', fyMandays: [388.5, 666, 666, 277.5], mandays: 1998, dayRate: 210, total: 419580 },
    { id: 'r5', ql: 3, role: 'Security Analyst', skill: 'SOC Analyst', grade: '4', team: 'PH ODC - MS - PH', fyMandays: [64.75, 222, 222, 46.25], mandays: 555, dayRate: 590, total: 327450 },
  ];
  return base.map((r) => ({ ...r, ...(over.find((o) => o.id === r.id) ?? {}) }));
};

const billing = (count: number, amount: number, last?: number): BcBilling[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `b${i + 1}`,
    date: (() => { const d = new Date(2026, 8 + i * 3, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; })(),
    schedule: `Quarterly billing ${i + 1} of ${count}`,
    amount: i === count - 1 && last !== undefined ? last : amount,
  }));

/** v1: consistent totals, but one product is assigned to a quote line that
 *  does not exist (QL rule fails, warning). */
const v1: BcVersion = {
  v: 1,
  uploadedBy: 'Felicia Phan',
  uploadedAt: tsAt(25),
  fileName: 'NCCM_business_case_v1.xlsx',
  comment: 'First cut from the workshop',
  data: {
    header: { tcv: 5350000, productTotal: 2759000, labourTotal: 2126205, marginPct: 16.6, currency: 'SGD', durationMonths: 36, projectStart: '2026-09-01' },
    products: products([{ id: 'p5', ql: 4 }]), // QL4 does not exist
    resources: resources(),
    billing: billing(12, 445833, 445837),
  },
};

/** v2: deliberately fails several checks (billing short of CCB, stated labour
 *  total does not reconcile, one day rate missing). */
const v2: BcVersion = {
  v: 2,
  uploadedBy: 'Felicia Phan',
  uploadedAt: tsAt(14, '16:40'),
  fileName: 'NCCM_business_case_v2.xlsx',
  comment: 'Post-clarification pricing; SOC scope enlarged',
  data: {
    header: { tcv: 5350000, productTotal: 2759000, labourTotal: 1900000, marginPct: 16.6, currency: 'SGD', durationMonths: 36, projectStart: '2026-09-01' },
    products: products(),
    resources: resources([{ id: 'r5', dayRate: 0, total: 0 }]),
    billing: billing(11, 437727, 437730), // sums to 4,815,000 - short of CCB
  },
};

/** v3: latest; reconciles except a low-margin advisory. MSPO generated. */
const v3: BcVersion = {
  v: 3,
  uploadedBy: 'Felicia Phan',
  uploadedAt: tsAt(7, '09:20'),
  fileName: 'NCCM_business_case_v3.xlsx',
  comment: 'Fixed billing plan and SOC day rate after Final Check',
  mspoDownloadedAt: tsAt(6, '11:35'),
  data: {
    header: { tcv: 5350000, productTotal: 2759000, labourTotal: 2090685, marginPct: 9.4, currency: 'SGD', durationMonths: 36, projectStart: '2026-09-01' },
    products: products([{ id: 'p2', unitCost: 1500, total: 780000 }, { id: 'p5', ql: 3 }]),
    resources: resources([{ id: 'r3', fyMandays: [259, 222, 166.5, 0], mandays: 647.5, total: 414400 }]),
    billing: billing(12, 445833, 445837),
  },
};
// keep v3 header consistent with the p2/r3 changes
v3.data.header.productTotal = v3.data.products.reduce((a, p) => a + p.total, 0);
v3.data.header.labourTotal = v3.data.resources.reduce((a, r) => a + r.total, 0);

// ---- Clause builders ---------------------------------------------------------

const C = (
  number: string, text: string, category: Clause['category'], subTags: string[],
  sourceDoc: string, page: number, extra: Partial<Clause> = {},
): Clause => ({
  id: `c-${number.replace(/[^a-z0-9]/gi, '')}-${page}`,
  number, text, category, subTags, sourceDoc, page,
  compliance: 'Unset', response: '', ...extra,
});

const GR = 'General Requirements.pdf';
const TS = 'Technical Specification.pdf';
const CC = 'Commercial Conditions.pdf';
const LC = 'Legal Conditions.pdf';

/** Hand-written anchor clauses for t1, incl. the two reference-offset flags. */
const t1BaseClauses: Clause[] = [
  C('1.2', 'The Contract Period shall be thirty-six (36) months from the date of award.', 'Commercial', [], GR, 4, {
    reviewedBy: 'John Price',
    compliance: 'Comply',
    response: 'Accepted. 36-month term priced in business case v3.',
    history: [
      { ts: tsAt(18, '10:12'), by: 'John Price', field: 'Compliance', from: 'Unset', to: 'Clarify' },
      { ts: tsAt(18, '10:13'), by: 'John Price', field: 'Remark', from: '', to: 'Confirm whether the term includes the 24-month extension option.' },
      { ts: tsAt(12, '15:40'), by: 'Felicia Phan', field: 'Compliance', from: 'Clarify', to: 'Comply' },
      { ts: tsAt(12, '15:41'), by: 'Felicia Phan', field: 'Remark', from: 'Confirm whether the term includes the 24-month extension option.', to: 'Accepted. 36-month term priced in business case v3.' },
    ],
  }),
  C('2.1', 'Tenderers shall submit all documents listed in Annex A in the formats prescribed therein.', 'Commercial', [], GR, 6, { reviewedBy: 'John Price' }),
  C('2.3(a)', 'A signed Non-Disclosure Agreement (Form NDA-2) shall accompany the tender submission.', 'Legal', ['confidentiality'], GR, 7),
  C('2.3(b)', 'All forms shall be signed by a person authorised to bind the Tenderer.', 'Legal', [], GR, 7),
  C('3.4', 'The evaluation shall apply criteria 1 to 8 set out in clause 5.', 'Commercial', [], GR, 9, { refIssue: 'Clause 5 lists criteria numbered 5.1 to 5.7 only - "criteria 1 to 8" does not match. Verify against the source.' }),
  C('4.1.2', 'The Contractor shall provide an omnichannel contact centre platform licensed for no fewer than 500 named agents.', 'Technical', [], TS, 12, { reviewedBy: 'Chee Wee' }),
  C('4.2.1(b)', 'Voice ingress shall be protected by session border controllers deployed as a high-availability pair.', 'Technical', [], TS, 14, { reviewedBy: 'Chee Wee' }),
  C('4.3.5', 'The solution shall support no fewer than 600 concurrent inbound voice channels.', 'Technical', [], TS, 15),
  C('4.6', 'System availability shall be no less than 99.9% measured monthly, excluding agreed maintenance windows.', 'Legal', ['SLA'], TS, 18),
  C('5.1', 'Track record: at least two contact-centre deployments of 300+ seats completed in the last five years.', 'Commercial', [], GR, 10, { reviewedBy: 'John Price' }),
  C('5.4', 'Key personnel shall hold the certifications listed in clause 7.2.', 'HR', [], GR, 10, { refIssue: 'Clause 7.2 is "Payment Terms" in this document; the certification list is actually in clause 6.2. Cross-reference appears offset by one - verify.' }),
  // wording matches the demo General Requirements PDF so the viewer can find and highlight it
  C('6.2', 'The project manager shall hold PMP certification and have eight years experience.', 'HR', [], GR, 11),
  C('6.3', 'The lead security engineer shall hold CISSP or equivalent.', 'HR', [], GR, 11),
  C('7.1', 'Payment shall be made within thirty (30) days of a correctly rendered invoice.', 'Finance', [], CC, 3, {
    reviewedBy: 'Ethan Lim',
    compliance: 'Partially comply',
    response: 'Request 21-day terms for hardware milestones.',
    history: [
      { ts: tsAt(15, '09:05'), by: 'Felicia Phan', field: 'Compliance', from: 'Unset', to: 'Comply' },
      { ts: tsAt(9, '14:22'), by: 'John Price', field: 'Compliance', from: 'Comply', to: 'Partially comply' },
      { ts: tsAt(9, '14:24'), by: 'John Price', field: 'Remark', from: '', to: 'Request 21-day terms for hardware milestones.' },
    ],
  }),
  C('7.4.2', 'An independent penetration test shall be conducted annually by an accredited provider.', 'Technical', [], TS, 22),
  C('8.1', 'The Contractor shall maintain Workmen\'s Compensation insurance for all deployed personnel.', 'Finance', ['workmen\'s compensation', 'insurance'], LC, 5),
  C('8.2', 'Public liability insurance of not less than S$5,000,000 per occurrence shall be maintained.', 'Finance', ['insurance'], LC, 5),
  C('9.1', 'All intellectual property created under this Contract shall vest in the Authority.', 'Legal', ['IP'], LC, 7),
  C('9.3', 'Pre-existing IP remains with the Contractor, with a perpetual licence granted to the Authority.', 'Legal', ['IP'], LC, 7),
  C('10.2', 'Liquidated damages of 0.5% of the monthly charge per commenced day of delay, capped at 10%.', 'Legal', ['liquidated damages'], LC, 9),
  C('10.5', 'Aggregate liability shall not exceed the total Contract value.', 'Legal', ['liability'], LC, 10),
  C('11.1', 'The Contractor shall comply with the Authority\'s ICT security policy as amended from time to time.', 'Technical', [], LC, 11),
  C('12.3', 'Confidential information shall not be disclosed for five (5) years after Contract expiry.', 'Legal', ['confidentiality'], LC, 12),
  C('13.1', 'All personnel deployed on-site shall obtain security clearance before commencement.', 'HR', [], GR, 13),
  C('14.2', 'Prices shall be fixed for the Contract Period and quoted in Singapore Dollars.', 'Commercial', [], CC, 4),
  C('14.5', 'The Authority may exercise an option to extend for up to twenty-four (24) months.', 'Commercial', [], CC, 5),
  C('15.1', 'Monthly service reports shall be submitted within five (5) working days of month end.', 'Technical', ['SLA'], TS, 26),
  C('16.4', 'The Contractor shall effect handover to any incoming contractor at no additional charge.', 'Commercial', [], CC, 8),
];

/** Generates plausible filler clauses so large tenders feel real. Numbering is
 *  sectional and monotonic; text is varied but clearly fictitious. */
function genClauses(
  prefix: string,
  docs: { name: string; firstPage: number }[],
  count: number,
  reviewers: string[],
  reviewedCount: number,
  startSection = 17,
): Clause[] {
  const bodies: [string, ClauseCategory, string[]][] = [
    ['The Contractor shall provide 24x7 service desk coverage with severity-one response within 15 minutes.', 'Technical', ['SLA']],
    ['Invoices shall itemise charges per quote line and per billing milestone.', 'Finance', []],
    ['The Contractor shall conduct quarterly service reviews with the Authority\'s contract manager.', 'Commercial', []],
    ['All data shall be hosted within Singapore unless prior written approval is obtained.', 'Technical', ['data residency']],
    ['Sub-contracting any part of the Services requires the Authority\'s prior written consent.', 'Legal', ['subcontracting']],
    ['The Contractor shall maintain a risk register and table it at each project steering committee.', 'Commercial', []],
    ['Replacement of key personnel requires fourteen (14) days\' notice and equivalent qualifications.', 'HR', []],
    ['The system shall maintain an immutable audit trail of all privileged actions.', 'Technical', ['audit']],
    ['The Authority may terminate for convenience with ninety (90) days\' written notice.', 'Legal', ['termination']],
    ['Training shall be provided for up to forty (40) Authority staff before commissioning.', 'Technical', []],
    ['The Contractor shall comply with the Personal Data Protection Act in force in Singapore.', 'Legal', ['PDPA']],
    ['Performance bonds of 5% of the Contract value shall be furnished within 14 days of award.', 'Finance', ['bond']],
    ['The solution shall integrate with the Authority\'s existing identity provider via SAML 2.0.', 'Technical', []],
    ['Monthly utilisation reports shall state consumed capacity against committed capacity.', 'Commercial', []],
    ['All deliverables shall pass user acceptance testing before any milestone payment.', 'Finance', []],
    ['On-site personnel shall complete the Authority\'s safety induction before deployment.', 'HR', []],
    ['The disaster recovery site shall achieve an RTO of four (4) hours and an RPO of one (1) hour.', 'Technical', ['DR']],
    ['Variations to the Contract shall be agreed in writing before any work proceeds.', 'Legal', ['variation']],
  ];
  const out: Clause[] = [];
  let section = startSection;
  let sub = 1;
  for (let i = 0; i < count; i++) {
    const doc = docs[i % docs.length];
    const [text, category, tags] = bodies[i % bodies.length];
    const number = sub <= 4 ? `${section}.${sub}` : `${section}.${sub - 4}(${'abcd'[(i % 4)]})`;
    out.push({
      id: `${prefix}-g${i + 1}`,
      number,
      text,
      category,
      subTags: tags,
      sourceDoc: doc.name,
      page: doc.firstPage + Math.floor(i / docs.length),
      compliance: 'Unset',
      response: '',
      reviewedBy: i < reviewedCount ? reviewers[i % reviewers.length] : undefined,
    });
    sub += 1;
    if (sub > 7) { sub = 1; section += 1; }
  }
  return out;
}

// t1 carries 120 clauses, 34 of them reviewed (28 anchors with 6 reviewed +
// 92 generated with 28 reviewed).
const t1Clauses: Clause[] = [
  ...t1BaseClauses,
  ...genClauses('t1', [
    { name: GR, firstPage: 14 }, { name: TS, firstPage: 28 }, { name: CC, firstPage: 9 }, { name: LC, firstPage: 13 },
  ], 92, ['John Price', 'Chee Wee', 'Priya Nair'], 28),
];

// ---- Checklist / qualification builders --------------------------------------

function genChecklist(prefix: string, general: string, commercial: string, closing: string, owners: (string | undefined)[]): ChecklistItem[] {
  const base: [string, string, number, string][] = [
    ['Form of Tender, signed', 'Original, signed by authorised signatory', 0, '2.1'],
    ['Signed Non-Disclosure Agreement', 'PDF, wet or digital signature', -7, '2.3(a)'],
    ['Company ACRA business profile', 'PDF, issued within 3 months', 0, '2.2'],
    ['Tender deposit banker\'s guarantee', 'Original', -3, '14.1'],
    ['Key personnel CVs', 'PDF, prescribed template', -2, '5.4'],
    ['Track record references (2 projects)', 'Prescribed template', -2, '5.1'],
    ['Compliance table', 'Excel, prescribed format', 0, '2.1'],
    ['Insurance certificates', 'PDF, certified true copies', -4, '8.1'],
    ['Audited financial statements (3 years)', 'PDF', 0, '2.4'],
    ['Clarification log acknowledgement', 'PDF, signed', -1, '3.6'],
  ];
  const close = new Date(closing);
  return base.map(([item, format, offset, clause], i) => {
    const d = new Date(close);
    d.setDate(d.getDate() + offset);
    return {
      id: `${prefix}-k${i + 1}`,
      item, format,
      deadline: iso(d),
      sourceDoc: i === 3 ? commercial : general,
      clause,
      owner: owners[i % owners.length],
      status: 'Not started' as const,
    };
  });
}

function genQuals(prefix: string, general: string, technical: string): Qualification[] {
  const rows: [Qualification['kind'], string, string, string, string | undefined][] = [
    ['Role', 'PMP-certified project manager with 8+ years of delivery experience', general, '6.2', 'cv1'],
    ['Role', 'Lead security engineer, CISSP or equivalent', general, '6.3', 'cv4'],
    ['Certification', 'Company ISO 27001 certification', general, '6.1', 'bp3'],
    ['Past project', 'Two comparable implementations completed in the last five years', general, '5.1', 'bp2'],
    ['Experience', 'Solution architect with 10+ years in government ICT', general, '6.4', 'cv2'],
    ['Role', '24x7 operations manned by certified analysts', technical, '11.4', undefined],
    ['Certification', 'bizSAFE Level 3 or equivalent WSH certification', general, '8.4', 'bp4'],
    ['Experience', 'Service manager with ITIL 4 and 5+ years of operations', general, '6.5', 'cv5'],
  ];
  return rows.map(([kind, requirement, sourceDoc, clause, evidence], i) => ({
    id: `${prefix}-q${i + 1}`, kind, requirement, sourceDoc, clause, evidence,
  }));
}

// ---- Tender 1: agency (MHA), fully populated, partly reviewed ----------------

const t1: Tender = {
  id: 't1',
  sfdcCrmId: 'OPP-004512',
  ref: 'MHA/ITT/2026/014',
  name: 'National Contact Centre Modernisation Programme',
  agency: 'MHA',
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Active',
  statusReason: 'In Progress (Active)',
  owner: 'John Price',
  createdAt: daysFromNow(-28),
  closingDate: daysFromNow(11),
  stepIdx: 3, // at DRB
  mspoQuoteLine: 'QL-0045120',
  lastProcessedAt: tsAt(21, '14:12'),
  pack: [
    { id: 'd1', name: GR, role: 'General Requirements', pages: 18, status: 'Done', textExtracted: true },
    { id: 'd2', name: TS, role: 'Technical Specification', pages: 64, status: 'Done', textExtracted: true },
    { id: 'd3', name: CC, role: 'Commercial Conditions', pages: 12, status: 'Done', textExtracted: true },
    { id: 'd4', name: LC, role: 'Legal Conditions', pages: 16, status: 'Done', textExtracted: true },
    { id: 'd5', name: 'Annex A - Forms.pdf', role: 'Forms and Annexes', pages: 22, status: 'Done', textExtracted: true, roleUnconfirmed: true },
    { id: 'd6', name: 'Annex B - Site plans (scanned).pdf', role: 'Unclassified', pages: 9, status: 'Failed', failReason: 'Unreadable scan - no machine-readable text found' },
  ],
  checklist: [
    { id: 'k1', item: 'Signed NDA (Form NDA-2)', format: 'PDF, wet or digital signature', deadline: daysFromNow(4), sourceDoc: GR, clause: '2.3(a)', owner: 'John Price', status: 'Done', templateId: 'tpl-mha-cl' },
    { id: 'k2', item: 'Form of Tender (Annex A1)', format: 'Original, signed', deadline: daysFromNow(11), sourceDoc: GR, clause: '2.1', owner: 'John Price', status: 'In progress', templateId: 'tpl-mha-cl' },
    { id: 'k3', item: 'Tender deposit banker\'s guarantee', format: 'Original, S$50,000', deadline: daysFromNow(8), sourceDoc: CC, clause: '14.1', owner: 'Ethan Lim', status: 'In progress' },
    { id: 'k4', item: 'Company ACRA business profile', format: 'PDF, within 3 months', deadline: daysFromNow(11), sourceDoc: GR, clause: '2.2', status: 'Not started', templateId: 'tpl-generic-profile' },
    { id: 'k5', item: 'ISO 27001 certificate', format: 'Certified true copy', deadline: daysFromNow(11), sourceDoc: GR, clause: '6.1', owner: 'Felicia Phan', status: 'Done' },
    { id: 'k6', item: 'Key personnel CVs with certifications', format: 'PDF, template Annex A4', deadline: daysFromNow(9), sourceDoc: GR, clause: '5.4', owner: 'Priya Nair', status: 'In progress', templateId: 'tpl-generic-personnel' },
    { id: 'k7', item: 'Track record references (2 projects)', format: 'Template Annex A5', deadline: daysFromNow(9), sourceDoc: GR, clause: '5.1', owner: 'Felicia Phan', status: 'Not started', templateId: 'tpl-generic-personnel' },
    { id: 'k8', item: 'Compliance table (Authority format)', format: 'Excel, Annex A6', deadline: daysFromNow(11), sourceDoc: GR, clause: '2.1', owner: 'John Price', status: 'In progress', templateId: 'tpl-mha-ct', draft: { templateId: 'tpl-mha-ct', status: 'Needs review', generatedAt: tsAt(2, '16:20') } },
    { id: 'k9', item: 'Insurance certificates', format: 'PDF', deadline: daysFromNow(-3), sourceDoc: LC, clause: '8.1', status: 'Not started' }, // overdue in demo
    { id: 'k10', item: 'Clarification log acknowledgement', format: 'PDF, signed', deadline: daysFromNow(7), sourceDoc: GR, clause: '3.6', owner: 'John Price', status: 'Not started', templateId: 'tpl-mha-cl' },
  ],
  quals: genQuals('t1', GR, TS),
  clauses: t1Clauses,
  templateSearch: {
    status: 'done',
    ranAt: tsAt(20, '09:15'),
    matches: [
      { templateId: 'tpl-mha-ct', reason: 'Agency name matches MHA', confirmed: true },
      { templateId: 'tpl-mha-cl', reason: 'Agency name matches MHA', confirmed: true },
      { templateId: 'tpl-generic-profile', reason: 'Generic template - no agency-specific company profile exists' },
      { templateId: 'tpl-generic-personnel', reason: 'Type: Agency, but MHA has no form template - generic offered' },
    ],
  },
  bcVersions: [v1, v2, v3],
  genDocs: [
    { id: 'g1', name: 'Compliance table (Annex A6)', templateId: 'tpl-mha-ct', status: 'Generated', autoFilled: ['Clause numbers and requirement text', 'Compliance statuses', 'Responses entered so far'], manual: ['Responses marked "Clarify"', 'Signatory block'] },
    { id: 'g2', name: 'Cover letter', templateId: 'tpl-mha-cl', status: 'Needs review', autoFilled: ['Tender reference and title', 'Company background paragraph'], manual: ['Pricing summary sentence'] },
    { id: 'g3', name: 'Company profile', templateId: 'tpl-generic-profile', status: 'Not generated', autoFilled: [], manual: [] },
    { id: 'g4', name: 'Key personnel annex (A4)', status: 'Not generated', autoFilled: [], manual: [] },
  ],
};

// ---- Tender 2: ATFM, processed, BC v1 fails checks ---------------------------

const t2GR = 'RFP Main Document.pdf';
const t2TS = 'Maintenance Requirements.pdf';
const t2: Tender = {
  id: 't2',
  sfdcCrmId: 'OPP-004527',
  ref: 'ATFM/RFP/2026/031',
  name: 'Airfield Transport Fleet Maintenance System',
  agency: 'ATFM',
  type: 'Agency',
  projectType: 'Time Based',
  status: 'Draft',
  statusReason: 'Pending (Draft)',
  owner: 'John Price',
  createdAt: daysFromNow(-12),
  closingDate: daysFromNow(32),
  stepIdx: 2,
  lastProcessedAt: tsAt(9, '11:30'),
  pack: [
    { id: 'd1', name: t2GR, role: 'General Requirements', pages: 42, status: 'Done', textExtracted: true },
    { id: 'd2', name: t2TS, role: 'Technical Specification', pages: 55, status: 'Done', textExtracted: true },
    { id: 'd3', name: 'Terms and Conditions.pdf', role: 'Legal Conditions', pages: 20, status: 'Done', textExtracted: true },
    { id: 'd4', name: 'Pricing Schedules.xlsx', role: 'Commercial Conditions', pages: 6, status: 'Done', textExtracted: true },
  ],
  checklist: [
    { id: 'k1', item: 'Tenderer declaration form', format: 'PDF, signed', deadline: daysFromNow(32), sourceDoc: t2GR, clause: '3.1', owner: 'John Price', status: 'Not started' },
    { id: 'k2', item: 'Pricing schedule (locked cells)', format: 'Excel, Schedule B', deadline: daysFromNow(32), sourceDoc: 'Pricing Schedules.xlsx', clause: 'B.1', owner: 'Felicia Phan', status: 'In progress' },
    { id: 'k3', item: 'Safety management plan', format: 'PDF', deadline: daysFromNow(25), sourceDoc: t2TS, clause: '9.2', owner: 'Priya Nair', status: 'Not started' },
    { id: 'k4', item: 'Workshop certification (ISO 9001)', format: 'Certified true copy', deadline: daysFromNow(32), sourceDoc: t2GR, clause: '5.2', owner: 'Felicia Phan', status: 'Not started' },
    { id: 'k5', item: 'Fleet reference contracts', format: 'Prescribed template', deadline: daysFromNow(28), sourceDoc: t2GR, clause: '5.3', status: 'Not started' },
    { id: 'k6', item: 'Compliance matrix (ATFM format)', format: 'Excel', deadline: daysFromNow(32), sourceDoc: t2GR, clause: '3.4', owner: 'John Price', status: 'Not started' },
    { id: 'k7', item: 'Key personnel list', format: 'PDF', deadline: daysFromNow(30), sourceDoc: t2GR, clause: '6.1', status: 'Not started' },
    { id: 'k8', item: 'Clarification acknowledgement', format: 'PDF, signed', deadline: daysFromNow(21), sourceDoc: t2GR, clause: '2.8', status: 'Not started' },
  ],
  quals: [
    { id: 'q1', kind: 'Certification', requirement: 'Workshop certified to ISO 9001', sourceDoc: t2GR, clause: '5.2', evidence: 'bp5' },
    { id: 'q2', kind: 'Experience', requirement: 'Fleet maintenance contract of 150+ vehicles in the last 3 years', sourceDoc: t2GR, clause: '5.3' },
    { id: 'q3', kind: 'Role', requirement: 'Operations manager with 5+ years of fleet operations', sourceDoc: t2GR, clause: '6.1', evidence: 'cv5' },
    { id: 'q4', kind: 'Certification', requirement: 'bizSAFE Level 3', sourceDoc: t2GR, clause: '9.1', evidence: 'bp4' },
    { id: 'q5', kind: 'Past project', requirement: 'Reference deployment of a maintenance management system', sourceDoc: t2TS, clause: '4.2', evidence: 'bp2' },
    { id: 'q6', kind: 'Role', requirement: 'Certified vehicle diagnostics technicians on every shift', sourceDoc: t2TS, clause: '7.3' },
  ],
  clauses: [
    C('3.1', 'Tenderers shall submit the declaration form at Annex 1 duly signed.', 'Commercial', [], t2GR, 8, { reviewedBy: 'John Price' }),
    C('5.2', 'The maintenance workshop shall be certified to ISO 9001.', 'Technical', [], t2GR, 12),
    C('9.2', 'A safety management plan shall accompany the tender.', 'HR', [], t2TS, 21),
    C('12.4', 'Liquidated damages apply per unserviceable vehicle day beyond the agreed turnaround.', 'Legal', ['liquidated damages'], 'Terms and Conditions.pdf', 9),
    ...genClauses('t2', [
      { name: t2GR, firstPage: 15 }, { name: t2TS, firstPage: 24 }, { name: 'Terms and Conditions.pdf', firstPage: 10 },
    ], 26, ['John Price'], 3, 13),
  ],
  templateSearch: {
    status: 'done',
    ranAt: tsAt(8, '15:40'),
    matches: [
      { templateId: 'tpl-atfm-ct', reason: 'Agency name matches ATFM', confirmed: true },
      { templateId: 'tpl-generic-cl', reason: 'Type: Agency, but ATFM has no cover letter template - generic offered' },
    ],
  },
  bcVersions: [
    {
      v: 1,
      uploadedBy: 'Felicia Phan',
      uploadedAt: tsAt(8, '14:00'),
      fileName: 'ATFM_fleet_bc_v1.xlsx',
      comment: 'Initial costing - labour summary still manual',
      data: {
        // Stated labour total does not reconcile with the lines (fails the
        // reconciliation check); margin below guardrail (warning).
        header: { tcv: 2140000, productTotal: 420000, labourTotal: 1480000, marginPct: 8.2, currency: 'SGD', durationMonths: 24, projectStart: '2027-01-01' },
        products: [
          { id: 'p1', ql: 1, category: 'Software', desc: 'Fleet maintenance management system licence', unitCost: 105000, qty: 2, total: 210000 },
          { id: 'p2', ql: 1, category: 'Hardware', desc: 'Workshop diagnostic terminals', unitCost: 7000, qty: 30, total: 210000 },
        ],
        resources: [
          { id: 'r1', ql: 1, role: 'Operation Manager', grade: '7', team: 'Insys - Non-cloud - SG', mandays: 480, dayRate: 850, total: 408000 },
          { id: 'r2', ql: 1, role: 'Technical Engineer', grade: '4', team: 'Insys - Non-cloud - SG', mandays: 1860, dayRate: 560, total: 1041600 },
        ],
        billing: billing(8, 267500),
      },
    },
  ],
  genDocs: [
    { id: 'g1', name: 'Compliance matrix (ATFM format)', templateId: 'tpl-atfm-ct', status: 'Not generated', autoFilled: [], manual: [] },
    { id: 'g2', name: 'Cover letter', status: 'Not generated', autoFilled: [], manual: [] },
  ],
};

// ---- Tender 3: commercial, processed, generic fallback, no BC yet ------------

const t3GR = 'RFP - Document Processing.pdf';
const t3: Tender = {
  id: 't3',
  sfdcCrmId: 'OPP-004561',
  ref: 'PAG-RFP-2026-087',
  name: 'Insurer Document Processing Service',
  agency: 'Pacific Assurance Group',
  type: 'Commercial',
  projectType: 'Usage Based',
  status: 'Draft',
  statusReason: 'In Progress (Draft)',
  owner: 'Dana Lim',
  createdAt: daysFromNow(-9),
  closingDate: daysFromNow(49),
  stepIdx: 1,
  lastProcessedAt: tsAt(6, '16:05'),
  pack: [
    { id: 'd1', name: t3GR, role: 'General Requirements', pages: 25, status: 'Done', textExtracted: true },
    { id: 'd2', name: 'Data Protection Addendum.pdf', role: 'Legal Conditions', pages: 11, status: 'Done', textExtracted: true },
    { id: 'd3', name: 'Volume Projections.xlsx', role: 'Commercial Conditions', pages: 4, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t3', t3GR, 'Volume Projections.xlsx', daysFromNow(49), ['Dana Lim', 'Felicia Phan', undefined]).slice(0, 8),
  quals: genQuals('t3', t3GR, t3GR).slice(0, 6),
  clauses: genClauses('t3', [
    { name: t3GR, firstPage: 6 }, { name: 'Data Protection Addendum.pdf', firstPage: 2 },
  ], 25, ['Dana Lim'], 0, 2),
  templateSearch: {
    status: 'done',
    ranAt: tsAt(5, '10:20'),
    genericFallback: true,
    matches: [
      { templateId: 'tpl-generic-ct', reason: 'Type: Commercial - no agency template applies, generic compliance table offered', confirmed: true },
      { templateId: 'tpl-generic-cl', reason: 'Type: Commercial - generic cover letter offered' },
    ],
  },
  bcVersions: [],
  genDocs: [
    { id: 'g1', name: 'Compliance table', templateId: 'tpl-generic-ct', status: 'Not generated', autoFilled: [], manual: [] },
    { id: 'g2', name: 'Cover letter', status: 'Not generated', autoFilled: [], manual: [] },
  ],
};

// ---- Tender 4: newly created, empty ------------------------------------------

const t4: Tender = {
  id: 't4',
  ref: 'GOVTECH/ITQ/2026/201',
  name: 'Whole-of-Government Chatbot Pilot',
  agency: 'GovTech',
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Draft',
  statusReason: 'In Progress (Draft)',
  owner: 'John Price',
  createdAt: daysFromNow(-1),
  closingDate: daysFromNow(38),
  stepIdx: 0,
  pack: [],
  checklist: [],
  quals: [],
  clauses: [],
  bcVersions: [],
  genDocs: [],
};

// ---- Tender 5: 30 documents uploaded, never processed ------------------------

const t5DocNames = [
  ['Invitation to Tender.pdf', 'General Requirements', 36],
  ['Part 1 - Conditions of Contract.pdf', 'Legal Conditions', 88],
  ['Part 2 - Requirement Specifications.pdf', 'Technical Specification', 302],
  ['Part 3 - Price Schedules.xlsx', 'Commercial Conditions', 14],
  ['Part 4 - Forms of Tender.pdf', 'Forms and Annexes', 28],
  ['Annex A - Network Diagrams.pdf', 'Technical Specification', 44],
  ['Annex B - Data Centre Specifications.pdf', 'Technical Specification', 67],
  ['Annex C - Security Requirements.pdf', 'Technical Specification', 59],
  ['Annex D - Service Levels.pdf', 'Technical Specification', 23],
  ['Annex E - Transition Plan Template.docx', 'Forms and Annexes', 18],
] as const;
const t5: Tender = {
  id: 't5',
  sfdcCrmId: 'OPP-004580',
  ref: 'MOH/ITT/2026/118',
  name: 'Healthcare Logistics Tracking Platform',
  agency: 'MOH Holdings',
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Draft',
  statusReason: 'In Progress (Draft)',
  owner: 'Marcus Chen',
  createdAt: daysFromNow(-4),
  closingDate: daysFromNow(38),
  stepIdx: 0,
  pack: Array.from({ length: 30 }, (_, i): PackDoc => {
    const base = t5DocNames[i % t5DocNames.length];
    const suffix = i >= t5DocNames.length ? ` (clarification set ${Math.ceil((i - 9) / 10)}, doc ${i - 9}).pdf` : '';
    return {
      id: `d${i + 1}`,
      name: suffix ? `Clarification ${i - 9}${suffix.includes('xlsx') ? '.xlsx' : '.pdf'}` : base[0],
      role: i >= t5DocNames.length ? 'Unclassified' : base[1],
      pages: 0, // unknown until text extraction runs
      status: 'Uploaded',
    };
  }),
  checklist: [],
  quals: [],
  clauses: [],
  bcVersions: [],
  genDocs: [],
};
// Page counts are unknown before extraction, but the upload dialog captured
// sizes for the first few named parts - keep those at 0 anyway (realism).

// ---- Tender 6: processing in progress (stage 3 of 6) --------------------------

const t6: Tender = {
  id: 't6',
  sfdcCrmId: 'OPP-004571',
  ref: 'LTA/RFP/2026/076',
  name: 'Depot Asset Monitoring and Analytics',
  agency: 'LTA',
  type: 'Agency',
  projectType: 'Time Based',
  status: 'Draft',
  statusReason: 'In Progress (Draft)',
  owner: 'Marcus Chen',
  createdAt: daysFromNow(-3),
  closingDate: daysFromNow(27),
  stepIdx: 0,
  job: { stage: 3, startedAt: new Date(Date.now() - 6 * 60000).toISOString() },
  pack: [
    { id: 'd1', name: 'RFP Document.pdf', role: 'General Requirements', pages: 48, status: 'Analysing', textExtracted: true },
    { id: 'd2', name: 'Asset Register Extract.xlsx', role: 'Commercial Conditions', pages: 8, status: 'Analysing', textExtracted: true },
    { id: 'd3', name: 'SCADA Interface Specs.pdf', role: 'Technical Specification', pages: 73, status: 'Analysing', textExtracted: true },
    { id: 'd4', name: 'Contract Terms.pdf', role: 'Legal Conditions', pages: 31, status: 'Analysing', textExtracted: true },
    { id: 'd5', name: 'Annex - Depot Layouts.pdf', role: 'Forms and Annexes', pages: 12, status: 'Analysing', textExtracted: true },
  ],
  checklist: [],
  quals: [],
  clauses: [],
  bcVersions: [],
  genDocs: [],
};

// ---- Tender 7: half processed (5 of 7 done, 2 failed), reprocessed ------------

const t7GR = 'Tender Specifications.pdf';
const t7Clauses = genClauses('t7', [
  { name: t7GR, firstPage: 7 }, { name: 'Contract Conditions.pdf', firstPage: 4 },
], 32, ['Dana Lim', 'John Price'], 9, 3);

const t7: Tender = {
  id: 't7',
  sfdcCrmId: 'OPP-004533',
  ref: 'PUB/ITT/2026/052',
  name: 'Water Quality Telemetry Network Refresh',
  agency: 'PUB',
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Draft',
  statusReason: 'In Approval (Draft)',
  owner: 'Dana Lim',
  createdAt: daysFromNow(-16),
  closingDate: daysFromNow(3),
  stepIdx: 1,
  lastProcessedAt: tsAt(1, '09:45'),
  pack: [
    { id: 'd1', name: t7GR, role: 'General Requirements', pages: 54, status: 'Done', textExtracted: true },
    { id: 'd2', name: 'Contract Conditions.pdf', role: 'Legal Conditions', pages: 27, status: 'Done', textExtracted: true },
    { id: 'd3', name: 'Telemetry Equipment List.xlsx', role: 'Commercial Conditions', pages: 5, status: 'Done', textExtracted: true },
    { id: 'd4', name: 'Sensor Calibration Annex.pdf', role: 'Technical Specification', pages: 19, status: 'Done', textExtracted: true },
    { id: 'd5', name: 'Legacy Network Diagrams (scanned).pdf', role: 'Unclassified', pages: 0, status: 'Failed', failReason: 'Unreadable scan - no machine-readable text found' },
    { id: 'd6', name: 'Site Access Conditions.pdf', role: 'Legal Conditions', pages: 0, status: 'Failed', failReason: 'Password-protected PDF - remove the password and re-upload' },
    { id: 'd7', name: 'Clarification Set 1.pdf', role: 'General Requirements', pages: 6, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t7', t7GR, 'Telemetry Equipment List.xlsx', daysFromNow(3), ['Dana Lim', undefined]).slice(0, 9),
  quals: genQuals('t7', t7GR, 'Sensor Calibration Annex.pdf').slice(0, 7),
  clauses: t7Clauses,
  bcVersions: [],
  genDocs: [
    { id: 'g1', name: 'Compliance table', status: 'Not generated', autoFilled: [], manual: [] },
    { id: 'g2', name: 'Cover letter', status: 'Not generated', autoFilled: [], manual: [] },
  ],
};

// ---- Tender 8: processing failed entirely; deadline overdue -------------------

const t8: Tender = {
  id: 't8',
  ref: 'NEA/ITQ/2026/090',
  name: 'Environmental Sensor Data Lake',
  agency: 'NEA',
  type: 'Agency',
  projectType: 'Usage Based',
  status: 'Draft',
  statusReason: 'In Progress (Draft)',
  owner: 'Marcus Chen',
  createdAt: daysFromNow(-19),
  closingDate: daysFromNow(-4), // overdue
  stepIdx: 0,
  processFailed: 'The document analysis service was unavailable during the run. No results were produced. Retry when ready - uploaded files are unaffected.',
  pack: [
    { id: 'd1', name: 'ITQ Requirements.pdf', role: 'General Requirements', pages: 0, status: 'Failed', failReason: 'Analysis service unavailable - retry processing' },
    { id: 'd2', name: 'Data Schemas.xlsx', role: 'Technical Specification', pages: 0, status: 'Failed', failReason: 'Analysis service unavailable - retry processing' },
    { id: 'd3', name: 'Terms of Contract.pdf', role: 'Legal Conditions', pages: 0, status: 'Failed', failReason: 'Analysis service unavailable - retry processing' },
  ],
  checklist: [],
  quals: [],
  clauses: [],
  bcVersions: [],
  genDocs: [],
};

// ---- Tender 9: fully processed, nothing reviewed; similar title to t1 ---------

const t9GR = 'Tender Requirements.pdf';
const t9: Tender = {
  id: 't9',
  sfdcCrmId: 'OPP-004590',
  ref: 'MHA/ITT/2026/019',
  name: 'National Contact Centre Modernisation - Overseas Offices',
  agency: 'MHA',
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Draft',
  statusReason: 'Pending (Draft)',
  owner: 'John Price',
  createdAt: daysFromNow(-7),
  closingDate: daysFromNow(24),
  stepIdx: 1,
  lastProcessedAt: tsAt(2, '17:25'),
  pack: [
    { id: 'd1', name: t9GR, role: 'General Requirements', pages: 31, status: 'Done', textExtracted: true },
    { id: 'd2', name: 'Overseas Site Specifications.pdf', role: 'Technical Specification', pages: 46, status: 'Done', textExtracted: true },
    { id: 'd3', name: 'Conditions of Contract.pdf', role: 'Legal Conditions', pages: 24, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t9', t9GR, t9GR, daysFromNow(24), ['John Price', undefined, 'Felicia Phan']).slice(0, 10),
  quals: genQuals('t9', t9GR, 'Overseas Site Specifications.pdf'),
  clauses: genClauses('t9', [
    { name: t9GR, firstPage: 5 }, { name: 'Overseas Site Specifications.pdf', firstPage: 8 }, { name: 'Conditions of Contract.pdf', firstPage: 3 },
  ], 31, [], 0, 2),
  bcVersions: [],
  genDocs: [
    { id: 'g1', name: 'Compliance table (Annex A6)', status: 'Not generated', autoFilled: [], manual: [] },
    { id: 'g2', name: 'Cover letter', status: 'Not generated', autoFilled: [], manual: [] },
  ],
};

// ---- Tender 10: processed, then documents changed - results out of date -------

const t10GR = 'Main Tender Document.pdf';
const t10: Tender = {
  id: 't10',
  sfdcCrmId: 'OPP-004518',
  ref: 'SPORT/RFP/2026/044',
  name: 'Stadium Operations Command Platform',
  agency: 'SportSG',
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Draft',
  statusReason: 'In Approval (Draft)',
  owner: 'Dana Lim',
  createdAt: daysFromNow(-22),
  closingDate: daysFromNow(16),
  stepIdx: 1,
  lastProcessedAt: tsAt(5, '13:50'),
  outOfDate: { added: 2, removed: 1 },
  pack: [
    { id: 'd1', name: t10GR, role: 'General Requirements', pages: 39, status: 'Done', textExtracted: true },
    { id: 'd2', name: 'AV and Scoreboard Specs.pdf', role: 'Technical Specification', pages: 58, status: 'Done', textExtracted: true },
    { id: 'd3', name: 'Contract Terms.pdf', role: 'Legal Conditions', pages: 22, status: 'Done', textExtracted: true },
    // added after the last run - stored but not yet analysed
    { id: 'd4', name: 'Clarification Set 2.pdf', role: 'Unclassified', pages: 0, status: 'Uploaded' },
    { id: 'd5', name: 'Revised Price Schedule.xlsx', role: 'Unclassified', pages: 0, status: 'Uploaded' },
  ],
  checklist: genChecklist('t10', t10GR, t10GR, daysFromNow(16), ['Dana Lim', 'John Price']).slice(0, 8),
  quals: genQuals('t10', t10GR, 'AV and Scoreboard Specs.pdf').slice(0, 6),
  clauses: genClauses('t10', [
    { name: t10GR, firstPage: 6 }, { name: 'AV and Scoreboard Specs.pdf', firstPage: 9 },
  ], 27, ['Dana Lim'], 6, 2),
  bcVersions: [],
  genDocs: [
    { id: 'g1', name: 'Compliance table', status: 'Not generated', autoFilled: [], manual: [] },
  ],
};

// ---- Tender 11: created without a GeBIZ ref or customer (both optional) --------

const t11GR = 'Invitation to Quote.pdf';
const t11: Tender = {
  id: 't11',
  ref: '', // optional - not entered yet
  name: 'Library Self-Service Kiosk Replacement',
  agency: '', // optional - not entered yet
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Draft',
  statusReason: 'In Progress (Draft)',
  owner: 'Marcus Chen',
  createdAt: daysFromNow(-6),
  closingDate: daysFromNow(20),
  stepIdx: 1,
  lastProcessedAt: tsAt(3, '10:10'),
  pack: [
    { id: 'd1', name: t11GR, role: 'General Requirements', pages: 17, status: 'Done', textExtracted: true },
    { id: 'd2', name: 'Kiosk Technical Annex.pdf', role: 'Technical Specification', pages: 21, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t11', t11GR, t11GR, daysFromNow(20), ['Marcus Chen']).slice(0, 8),
  quals: genQuals('t11', t11GR, 'Kiosk Technical Annex.pdf').slice(0, 6),
  clauses: genClauses('t11', [
    { name: t11GR, firstPage: 4 }, { name: 'Kiosk Technical Annex.pdf', firstPage: 3 },
  ], 25, [], 0, 2),
  bcVersions: [],
  genDocs: [],
};

// ---- Tender 12: BC layout unrecognised ------------------------------------------

const t12GR = 'RFP and Conditions.pdf';
const t12: Tender = {
  id: 't12',
  sfdcCrmId: 'OPP-004549',
  ref: 'MOE/RFP/2026/065',
  name: 'Campus Access Control Upgrade',
  agency: 'MOE',
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Draft',
  statusReason: 'Pending (Draft)',
  owner: 'John Price',
  createdAt: daysFromNow(-13),
  closingDate: daysFromNow(12),
  stepIdx: 2,
  lastProcessedAt: tsAt(7, '15:05'),
  pack: [
    { id: 'd1', name: t12GR, role: 'General Requirements', pages: 47, status: 'Done', textExtracted: true },
    { id: 'd2', name: 'Door Hardware Schedule.xlsx', role: 'Commercial Conditions', pages: 9, status: 'Done', textExtracted: true },
    { id: 'd3', name: 'Security Policy Extract.pdf', role: 'Legal Conditions', pages: 13, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t12', t12GR, 'Door Hardware Schedule.xlsx', daysFromNow(12), ['John Price', 'Felicia Phan']).slice(0, 8),
  quals: genQuals('t12', t12GR, t12GR).slice(0, 6),
  clauses: genClauses('t12', [
    { name: t12GR, firstPage: 5 }, { name: 'Security Policy Extract.pdf', firstPage: 2 },
  ], 26, ['John Price'], 4, 2),
  bcVersions: [
    {
      v: 1,
      uploadedBy: 'Felicia Phan',
      uploadedAt: tsAt(2, '11:50'),
      fileName: 'MOE_access_control_costing_old_format.xlsx',
      comment: 'Costing from the old departmental workbook',
      layoutUnrecognised: {
        missingAnchors: [
          'Sheet "Basic Info" with cell "CCB / Contract Value"',
          'Sheet "Product Plan" with header row "Quote Line / Category / Description"',
          'Sheet "Resource Plan" with header row "Role / Grade / Team"',
        ],
      },
      data: {
        header: { tcv: 0, productTotal: 0, labourTotal: 0, marginPct: 0, currency: 'SGD', durationMonths: 0, projectStart: daysFromNow(60) },
        products: [],
        resources: [],
        billing: [],
      },
    },
  ],
  genDocs: [],
};

// ---- Tender 13: agency with no agency template in the library ------------------

const t13GR = 'Quotation Requirements.pdf';
const t13: Tender = {
  id: 't13',
  ref: 'CAAS/ITQ/2026/027',
  name: 'Aviation Safety Reporting Portal',
  agency: 'CAAS',
  type: 'Agency',
  projectType: 'Time Based',
  status: 'Draft',
  statusReason: 'In Progress (Draft)',
  owner: 'Dana Lim',
  createdAt: daysFromNow(-10),
  closingDate: daysFromNow(31),
  stepIdx: 1,
  lastProcessedAt: tsAt(4, '09:30'),
  pack: [
    { id: 'd1', name: t13GR, role: 'General Requirements', pages: 29, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t13', t13GR, t13GR, daysFromNow(31), ['Dana Lim']).slice(0, 8),
  quals: genQuals('t13', t13GR, t13GR).slice(0, 6),
  clauses: genClauses('t13', [{ name: t13GR, firstPage: 4 }], 25, [], 0, 2),
  templateSearch: {
    status: 'done',
    ranAt: tsAt(3, '14:15'),
    genericFallback: true,
    matches: [
      { templateId: 'tpl-generic-ct', reason: 'Type: Agency, but no CAAS template exists in the library - generic compliance table offered' },
      { templateId: 'tpl-generic-cl', reason: 'Type: Agency, no CAAS cover letter - generic offered' },
    ],
  },
  bcVersions: [],
  genDocs: [
    { id: 'g1', name: 'Compliance table', status: 'Not generated', autoFilled: [], manual: [] },
  ],
};

// ---- Tenders 14-16: past DRB outcomes and an archived tender -------------------

const t14GR = 'Tender Document.pdf';
const t14: Tender = {
  id: 't14',
  sfdcCrmId: 'OPP-003984',
  ref: 'CPF/ITT/2025/122',
  name: 'Shared Services Helpdesk Platform',
  agency: 'Central Provident Services',
  type: 'Agency',
  projectType: 'Time Based',
  status: 'Won',
  statusReason: 'Won (Won)',
  owner: 'Felicia Phan',
  createdAt: '2025-11-02',
  closingDate: '2025-12-12',
  stepIdx: 5,
  lastProcessedAt: '2025-11-10T10:00:00+08:00',
  drbOutcome: 'Won',
  drbNotes: 'Awarded at second clarification round; margin approved at 14.2%.',
  pack: [
    { id: 'd1', name: t14GR, role: 'General Requirements', pages: 40, status: 'Done', textExtracted: true },
    { id: 'd2', name: 'Service Catalogue.pdf', role: 'Technical Specification', pages: 33, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t14', t14GR, t14GR, '2025-12-12', ['Felicia Phan']).slice(0, 8).map((k) => ({ ...k, status: 'Done' as const })),
  quals: genQuals('t14', t14GR, 'Service Catalogue.pdf').slice(0, 6),
  clauses: genClauses('t14', [{ name: t14GR, firstPage: 5 }, { name: 'Service Catalogue.pdf', firstPage: 4 }], 26, ['Felicia Phan', 'John Price'], 26, 2)
    .map((c) => ({ ...c, compliance: 'Comply' as const })),
  bcVersions: [
    {
      v: 1,
      uploadedBy: 'Felicia Phan',
      uploadedAt: '2025-11-20T09:00:00+08:00',
      fileName: 'CPF_helpdesk_bc_final.xlsx',
      comment: 'DRB-approved version',
      mspoDownloadedAt: '2025-12-01T15:00:00+08:00',
      data: {
        header: { tcv: 3200000, productTotal: 900000, labourTotal: 1820000, marginPct: 14.2, currency: 'SGD', durationMonths: 36, projectStart: '2026-02-01' },
        products: [
          { id: 'p1', ql: 1, category: 'Software', desc: 'ITSM platform subscription', unitCost: 300000, qty: 3, total: 900000 },
        ],
        resources: [
          { id: 'r1', ql: 1, role: 'Service Manager', grade: '6', team: 'Insys - Cloud - SG', mandays: 650, dayRate: 800, total: 520000 },
          { id: 'r2', ql: 1, role: 'Service Desk Analyst', grade: '3', team: 'MY ODC - AD - MY', mandays: 3250, dayRate: 400, total: 1300000 },
        ],
        billing: Array.from({ length: 4 }, (_, i) => ({ id: `b${i + 1}`, date: iso(new Date(2026, 1 + i * 9, 1)), schedule: `Annual billing ${i + 1} of 4`, amount: 800000 })),
      },
    },
  ],
  genDocs: [],
};

const t15: Tender = {
  id: 't15',
  sfdcCrmId: 'OPP-004102',
  ref: 'HMB/RFP/2026/008',
  name: 'Port Authority Service Desk Consolidation',
  agency: 'Harbour & Maritime Board',
  type: 'Agency',
  projectType: 'Time Based',
  status: 'Closed',
  statusReason: 'Lost (Closed)',
  owner: 'Felicia Phan',
  createdAt: '2026-01-10',
  closingDate: '2026-02-02',
  stepIdx: 5,
  lastProcessedAt: '2026-01-15T11:00:00+08:00',
  drbOutcome: 'Lost',
  drbNotes: 'Lost on price; incumbent retained. Debrief notes stored in the repository.',
  pack: [
    { id: 'd1', name: 'RFP Document.pdf', role: 'General Requirements', pages: 35, status: 'Done', textExtracted: true },
  ],
  checklist: genChecklist('t15', 'RFP Document.pdf', 'RFP Document.pdf', '2026-02-02', ['Felicia Phan']).slice(0, 8).map((k) => ({ ...k, status: 'Done' as const })),
  quals: genQuals('t15', 'RFP Document.pdf', 'RFP Document.pdf').slice(0, 6),
  clauses: genClauses('t15', [{ name: 'RFP Document.pdf', firstPage: 5 }], 25, ['Felicia Phan'], 25, 2),
  bcVersions: [
    {
      v: 1,
      uploadedBy: 'Felicia Phan',
      uploadedAt: '2026-01-20T10:00:00+08:00',
      fileName: 'HMB_service_desk_bc.xlsx',
      data: {
        header: { tcv: 1850000, productTotal: 420000, labourTotal: 1150000, marginPct: 15.1, currency: 'SGD', durationMonths: 24, projectStart: '2026-05-01' },
        products: [{ id: 'p1', ql: 1, category: 'Software', desc: 'Service desk tooling', unitCost: 210000, qty: 2, total: 420000 }],
        resources: [{ id: 'r1', ql: 1, role: 'Service Desk Analyst', grade: '3', team: 'PH ODC - MS - PH', mandays: 2875, dayRate: 400, total: 1150000 }],
        billing: Array.from({ length: 8 }, (_, i) => ({ id: `b${i + 1}`, date: iso(new Date(2026, 4 + i * 3, 1)), schedule: `Quarterly billing ${i + 1} of 8`, amount: 231250 })),
      },
    },
  ],
  genDocs: [],
};

const t16: Tender = {
  id: 't16',
  sfdcCrmId: 'OPP-003710',
  ref: 'MER/RFP/2025/201',
  name: 'Regional Bank Contact Centre Replacement',
  agency: 'Meridian Bank',
  type: 'Commercial',
  projectType: 'Milestone Based',
  status: 'Closed',
  statusReason: 'Revised (Closed)',
  owner: 'John Price',
  createdAt: '2025-08-20',
  closingDate: '2025-11-30',
  stepIdx: 5,
  lastProcessedAt: '2025-09-05T10:00:00+08:00',
  archivedInfo: { sizeFrom: '163 MB', sizeTo: '38 MB', at: '2026-01-15' },
  pack: [
    { id: 'd1', name: 'RFP Pack.pdf', role: 'General Requirements', pages: 51, status: 'Done', textExtracted: true },
  ],
  checklist: [],
  quals: [],
  clauses: [],
  bcVersions: [],
  genDocs: [],
};

// ---- Two more won tenders so the Won-TCV cards have data across periods ------

const wonTender = (
  id: string, sfdc: string, ref: string, name: string, agency: string,
  closingDate: string, createdAt: string, tcv: number, marginPct: number,
): Tender => ({
  id,
  sfdcCrmId: sfdc,
  ref,
  name,
  agency,
  type: 'Agency',
  projectType: 'Milestone Based',
  status: 'Won',
  statusReason: 'Won (Won)',
  owner: 'Felicia Phan',
  createdAt,
  closingDate,
  stepIdx: 5,
  lastProcessedAt: `${createdAt}T10:00:00+08:00`,
  drbOutcome: 'Won',
  pack: [
    { id: 'd1', name: 'Tender Document.pdf', role: 'General Requirements', pages: 36, status: 'Done', textExtracted: true },
  ],
  checklist: [],
  quals: [],
  clauses: [],
  bcVersions: [
    {
      v: 1,
      uploadedBy: 'Felicia Phan',
      uploadedAt: `${createdAt}T15:00:00+08:00`,
      fileName: `${ref.replace(/\W+/g, '_')}_bc_final.xlsx`,
      comment: 'DRB-approved version',
      data: {
        header: { tcv, productTotal: Math.round(tcv * 0.35), labourTotal: Math.round(tcv * 0.45), marginPct, currency: 'SGD', durationMonths: 24, projectStart: closingDate },
        products: [{ id: 'p1', ql: 1, category: 'Software', desc: 'Platform licences', unitCost: Math.round(tcv * 0.35), qty: 1, total: Math.round(tcv * 0.35) }],
        resources: [{ id: 'r1', ql: 1, role: 'Project Manager', grade: '7', team: 'Insys - Cloud - SG', mandays: Math.round(tcv * 0.45 / 900), dayRate: 900, total: Math.round(tcv * 0.45 / 900) * 900 }],
        billing: [{ id: 'b1', date: closingDate, schedule: 'Milestone billing 1 of 1', amount: tcv }],
      },
    },
  ],
  genDocs: [],
});

const t17 = wonTender('t17', 'OPP-004201', 'MOH/ITT/2025/204', 'Polyclinic Appointment System Revamp', 'MOH Holdings', '2026-02-27', '2025-12-01', 1900000, 13.8);
const t18 = wonTender('t18', 'OPP-004388', 'CUS/RFP/2026/041', 'Customs Declarations Portal Enhancements', 'Singapore Customs', '2026-08-14', '2026-05-20', 2450000, 15.2);

export const TENDERS: Tender[] = [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15, t16, t17, t18];

// ---- Template and boilerplate libraries -------------------------------------

const LV = (version: string, updated: string, uploadedBy: string) => ({ version, updated, uploadedBy });

export const TEMPLATES: TemplateDoc[] = [
  { id: 'tpl-mha-ct', name: 'MHA compliance table (Annex A6)', agency: 'MHA', type: 'Compliance table', version: '3.1', updated: '2026-08-12', uploadedBy: 'John Price', usedBy: ['t1'],
    history: [LV('3.0', '2026-03-02', 'John Price'), LV('2.4', '2025-09-18', 'Felicia Phan')] },
  { id: 'tpl-mha-cl', name: 'MHA cover letter', agency: 'MHA', type: 'Cover letter', version: '2.0', updated: '2026-06-03', uploadedBy: 'Felicia Phan', usedBy: ['t1'],
    history: [LV('1.3', '2025-11-20', 'Felicia Phan')] },
  { id: 'tpl-atfm-ct', name: 'ATFM compliance matrix', agency: 'ATFM', type: 'Compliance table', version: '1.4', updated: '2026-07-21', uploadedBy: 'John Price', usedBy: ['t2'],
    history: [LV('1.3', '2026-01-14', 'John Price')] },
  { id: 'tpl-generic-ct', name: 'Generic compliance table', agency: 'Generic', type: 'Compliance table', version: '1.2', updated: '2026-05-10', uploadedBy: 'Dana Lim', usedBy: ['t3', 't13'] },
  { id: 'tpl-generic-cl', name: 'Generic cover letter', agency: 'Generic', type: 'Cover letter', version: '1.1', updated: '2026-04-28', uploadedBy: 'Felicia Phan', usedBy: [] },
  { id: 'tpl-generic-profile', name: 'Company profile pack', agency: 'Generic', type: 'Company profile', version: '4.2', updated: '2026-09-01', uploadedBy: 'Felicia Phan', usedBy: ['t1', 't2'],
    history: [LV('4.1', '2026-04-07', 'Felicia Phan'), LV('4.0', '2025-12-01', 'Felicia Phan')] },
  { id: 'tpl-generic-personnel', name: 'Key personnel annex', agency: 'Generic', type: 'Form', version: '1.3', updated: '2026-03-15', uploadedBy: 'John Price', usedBy: [] },
  { id: 'tpl-generic-toc', name: 'Table of contents and document control page', agency: 'Generic', type: 'Document formatting', version: '2.0', updated: '2026-07-14', uploadedBy: 'Felicia Phan', usedBy: ['t1'],
    history: [LV('1.2', '2025-10-03', 'Felicia Phan')] },
  { id: 'tpl-generic-hf', name: 'Headers and footers (tender reference, version, page numbers)', agency: 'Generic', type: 'Document formatting', version: '1.4', updated: '2026-06-22', uploadedBy: 'John Price', usedBy: ['t1', 't2'],
    history: [LV('1.3', '2026-01-19', 'John Price')] },
];

export const BOILERPLATE: Boilerplate[] = [
  { id: 'bp1', name: 'Company background (long form)', type: 'Company background', version: '5.0', owner: 'Felicia Phan', uploadedBy: 'Felicia Phan', updated: '2026-08-20',
    tags: ['Company profile', 'History', 'Capabilities'],
    history: [LV('4.2', '2026-02-11', 'Felicia Phan'), LV('4.1', '2025-08-30', 'Felicia Phan')] },
  { id: 'bp2', name: 'Contact-centre track record pack', type: 'Company background', version: '2.3', owner: 'Felicia Phan', uploadedBy: 'Felicia Phan', updated: '2026-06-17',
    tags: ['Track record', 'Contact centre'],
    history: [LV('2.2', '2026-01-09', 'Felicia Phan')] },
  { id: 'bp6', name: 'Corporate registration details (UEN, registered address, authorised representatives, GST number)', type: 'Company background', version: '3.1', owner: 'Felicia Phan', uploadedBy: 'Felicia Phan', updated: '2026-09-02',
    tags: ['Corporate', 'UEN', 'GST', 'Legal entity'],
    history: [LV('3.0', '2026-01-12', 'Felicia Phan')] },
  { id: 'bp7', name: 'Organisation chart and governance', type: 'Company background', version: '2.2', owner: 'Felicia Phan', uploadedBy: 'Felicia Phan', updated: '2026-07-30',
    tags: ['Organisation', 'Governance', 'Escalation'] },
  { id: 'bp8', name: 'Past project references and case studies', type: 'Company background', version: '4.0', owner: 'John Price', uploadedBy: 'John Price', updated: '2026-08-11',
    tags: ['Track record', 'Case study', 'Public sector'],
    history: [LV('3.4', '2026-03-05', 'John Price'), LV('3.3', '2025-11-17', 'John Price')] },
  { id: 'bp9', name: 'Customer testimonials and reference letters', type: 'Company background', version: '1.6', owner: 'John Price', uploadedBy: 'John Price', updated: '2026-05-26',
    tags: ['References', 'Testimonials'] },
  { id: 'bp10', name: 'Warranty and maintenance terms', type: 'Company background', version: '2.0', owner: 'Felicia Phan', uploadedBy: 'Felicia Phan', updated: '2026-04-08',
    tags: ['Commercial', 'Warranty', 'Maintenance', 'SLA'],
    history: [LV('1.5', '2025-09-22', 'Felicia Phan')] },
  { id: 'bp11', name: 'Business continuity, quality and security policy summaries', type: 'Company background', version: '3.0', owner: 'Kelyn Wong', uploadedBy: 'Kelyn Wong', updated: '2026-06-30',
    tags: ['Policy', 'BCP', 'Quality', 'Security'] },
  { id: 'bp12', name: 'PDPA and data protection statement', type: 'Company background', version: '2.1', owner: 'Kelyn Wong', uploadedBy: 'Kelyn Wong', updated: '2026-03-18',
    tags: ['PDPA', 'Data protection', 'Privacy', 'Legal'],
    history: [LV('2.0', '2025-12-02', 'Kelyn Wong')] },
  { id: 'bp3', name: 'ISO 27001 certificate', type: 'Certification', version: '2026', owner: 'Kelyn Wong', uploadedBy: 'Kelyn Wong', updated: '2026-04-02', expires: '2027-03-31',
    issuer: 'TUV SUD PSB', certNumber: 'ISMS-27001-SG-0421', issued: '2024-04-01',
    history: [LV('2025', '2025-04-01', 'Kelyn Wong')] },
  { id: 'bp4', name: 'bizSAFE Level 3 certificate', type: 'Certification', version: '2025', owner: 'Kelyn Wong', uploadedBy: 'Kelyn Wong', updated: '2025-10-01', expires: daysFromNow(-13), // expired
    issuer: 'Workplace Safety and Health Council', certNumber: 'BZS-L3-208817', issued: '2023-10-06' },
  { id: 'bp5', name: 'ISO 9001 certificate', type: 'Certification', version: '2026', owner: 'Kelyn Wong', uploadedBy: 'Kelyn Wong', updated: '2026-01-15', expires: daysFromNow(26), // expiring soon
    issuer: 'SGS International Certification Services', certNumber: 'SG23/71402', issued: '2023-11-14' },
  { id: 'bp13', name: "Workmen's compensation insurance", type: 'Certification', version: '2026', owner: 'Kelyn Wong', uploadedBy: 'Kelyn Wong', updated: '2026-07-01', expires: '2027-06-30',
    issuer: 'Great Eastern General Insurance', certNumber: 'WICA-0098-55120', issued: '2026-07-01',
    history: [LV('2025', '2025-07-01', 'Kelyn Wong')] },
  { id: 'bp14', name: 'Business registration and tax registration documents (ACRA business profile, GST registration)', type: 'Certification', version: '2026.3', owner: 'Felicia Phan', uploadedBy: 'Felicia Phan', updated: '2026-09-15', expires: '2027-09-14',
    issuer: 'ACRA and IRAS', certNumber: 'UEN 199804567K / GST M2-0123456-7', issued: '2026-09-15',
    history: [LV('2026.2', '2026-06-10', 'Felicia Phan')] },
  { id: 'bp15', name: 'Vendor partnerships and partner tiers', type: 'Certification', version: '2026', owner: 'John Price', uploadedBy: 'John Price', updated: '2026-02-20', expires: '2027-01-31',
    issuer: 'Microsoft, Cisco, Genesys', certNumber: 'Microsoft Solutions Partner 4471902 / Cisco Gold 11873 / Genesys Gold', issued: '2026-02-01' },
  { id: 'cv1', name: 'CV - Tan Wei Ming (Project Manager)', type: 'CV', version: '1.8', owner: 'Priya Nair', uploadedBy: 'Priya Nair', updated: '2026-05-04', role: 'Project Manager', years: 11 },
  { id: 'cv2', name: 'CV - Sarah Koh (Solution Architect)', type: 'CV', version: '2.1', owner: 'Priya Nair', uploadedBy: 'Priya Nair', updated: '2026-05-04', role: 'Solution Architect', years: 12 },
  { id: 'cv3', name: 'CV - Daniel Ong (Analyst Programmer)', type: 'CV', version: '1.2', owner: 'Priya Nair', uploadedBy: 'Priya Nair', updated: '2026-05-04', role: 'Analyst Programmer', years: 6 },
  { id: 'cv4', name: 'CV - Mei Lin Teo (Security Lead, CISSP)', type: 'CV', version: '1.5', owner: 'Priya Nair', uploadedBy: 'Priya Nair', updated: '2026-05-04', role: 'Security Engineer', years: 9 },
  { id: 'cv5', name: 'CV - Ravi Kumar (Service Manager, ITIL 4)', type: 'CV', version: '1.9', owner: 'Priya Nair', uploadedBy: 'Priya Nair', updated: '2026-05-04', role: 'Service Manager', years: 8 },
  { id: 'cv6', name: 'CV - Grace Lim (Test Lead)', type: 'CV', version: '1.1', owner: 'Priya Nair', uploadedBy: 'Priya Nair', updated: '2026-05-04', role: 'Test Lead', years: 7 },
];

/** Tags offered when tagging boilerplate. Tags users create are added to this
 *  list, so the next item can pick them too. */
export const BOILERPLATE_TAGS: string[] = [...new Set([
  'Company profile', 'History', 'Capabilities', 'Corporate', 'UEN', 'GST', 'Legal entity', 'Financial standing',
  'Organisation', 'Governance', 'Escalation', 'Key personnel', 'Track record', 'Case study', 'References',
  'Testimonials', 'Public sector', 'Contact centre', 'Commercial', 'Warranty', 'Maintenance', 'SLA', 'Policy',
  'BCP', 'Disaster recovery', 'Quality', 'Security', 'Cybersecurity', 'PDPA', 'Data protection', 'Privacy',
  'Legal', 'Insurance', 'Health and safety', 'Sustainability', 'Methodology', 'Project management',
  'Service management', 'Training', 'Transition', 'Risk management', 'Cloud',
  ...BOILERPLATE.flatMap((b) => b.tags ?? []),
])].sort((a, b) => a.localeCompare(b));

// ---- Repository ---------------------------------------------------------------

const RV = (v: number, date: string, by: string, note: string) => ({ v, date, by, note });

/** Seed records get a status reason and stored-document list assigned below. */
type RepoSeed = Omit<RepoRecord, 'statusReason' | 'documents'> & { documents?: string[] };

/** Records tied to the live tenders, so lists and detail pages agree. */
const linkedRecords: RepoSeed[] = [
  { id: 'rr1', name: 'National Contact Centre Modernisation Programme', agency: 'MHA', kind: 'Tender', type: 'Agency', status: 'Open', owner: 'John Price', created: daysFromNow(-28), updated: daysFromNow(-7), versions: [RV(1, daysFromNow(-28), 'John Price', 'Tender pack received'), RV(2, daysFromNow(-14), 'John Price', 'Clarification set 1 added')] },
  { id: 'rr2', name: 'NCCM business case', agency: 'MHA', kind: 'Business case', type: 'Agency', status: 'Open', owner: 'Felicia Phan', created: daysFromNow(-25), updated: daysFromNow(-7), versions: [RV(1, daysFromNow(-25), 'Felicia Phan', 'First cut'), RV(2, daysFromNow(-14), 'Felicia Phan', 'Post-clarification'), RV(3, daysFromNow(-7), 'Felicia Phan', 'Final Check fixes')] },
  { id: 'rr3', name: 'Airfield Transport Fleet Maintenance System', agency: 'ATFM', kind: 'Tender', type: 'Agency', status: 'Open', owner: 'John Price', created: daysFromNow(-12), updated: daysFromNow(-8), versions: [RV(1, daysFromNow(-12), 'John Price', 'RFP received')] },
  { id: 'rr4', name: 'ATFM fleet BOM', agency: 'ATFM', kind: 'BOM', type: 'Agency', status: 'Open', owner: 'Chee Wee', created: daysFromNow(-9), updated: daysFromNow(-9), versions: [RV(1, daysFromNow(-9), 'Chee Wee', 'Initial BOM')] },
  { id: 'rr5', name: 'Insurer Document Processing Service', agency: 'Pacific Assurance Group', kind: 'Tender', type: 'Commercial', status: 'Open', owner: 'Dana Lim', created: daysFromNow(-9), updated: daysFromNow(-6), versions: [RV(1, daysFromNow(-9), 'Dana Lim', 'RFP received')] },
  { id: 'rr6', name: 'Shared Services Helpdesk proposal', agency: 'Central Provident Services', kind: 'Proposal', type: 'Agency', status: 'Won', owner: 'Felicia Phan', created: '2025-11-02', updated: '2025-12-14', versions: [RV(1, '2025-11-02', 'Felicia Phan', 'Draft'), RV(2, '2025-12-10', 'Felicia Phan', 'Submitted')] },
  { id: 'rr7', name: 'Shared Services Helpdesk business case', agency: 'Central Provident Services', kind: 'Business case', type: 'Agency', status: 'Won', owner: 'Felicia Phan', created: '2025-11-05', updated: '2025-12-12', versions: [RV(1, '2025-11-05', 'Felicia Phan', 'Draft'), RV(2, '2025-12-12', 'Felicia Phan', 'Approved')] },
  { id: 'rr8', name: 'Port Authority Service Desk proposal', agency: 'Harbour & Maritime Board', kind: 'Proposal', type: 'Agency', status: 'Lost', owner: 'Felicia Phan', created: '2026-01-10', updated: '2026-02-02', versions: [RV(1, '2026-01-10', 'Felicia Phan', 'Draft'), RV(2, '2026-02-01', 'Felicia Phan', 'Submitted')] },
  { id: 'rr9', name: 'Regional Bank Contact Centre Replacement', agency: 'Meridian Bank', kind: 'Tender', type: 'Commercial', status: 'Archived', owner: 'John Price', created: '2025-08-20', updated: '2025-11-30', versions: [RV(1, '2025-08-20', 'John Price', 'Pack received'), RV(2, '2025-10-02', 'John Price', 'Clarifications')], archived: { sizeFrom: '163 MB', sizeTo: '38 MB', at: '2026-01-15' }, restore: { state: 'available', requestedAt: tsAt(1, '08:30') } },
  { id: 'rr10', name: 'Regional Bank business case', agency: 'Meridian Bank', kind: 'Business case', type: 'Commercial', status: 'Won', owner: 'Felicia Phan', created: '2025-09-01', updated: '2025-11-03', versions: [RV(1, '2025-09-01', 'Felicia Phan', 'Draft'), RV(2, '2025-11-03', 'Felicia Phan', 'Final')] },
  { id: 'rr11', name: 'Statutory Board Hotline Refresh tender', agency: 'Utilities Regulatory Office', kind: 'Tender', type: 'Agency', status: 'Closed', owner: 'John Price', created: '2026-02-01', updated: '2026-04-11', versions: [RV(1, '2026-02-01', 'John Price', 'Pack received')] },
  { id: 'rr12', name: 'Hospital Command Centre BOM', agency: 'Eastern Health Cluster', kind: 'BOM', type: 'Agency', status: 'Archived', owner: 'Chee Wee', created: '2026-05-12', updated: '2026-06-11', versions: [RV(1, '2026-05-12', 'Chee Wee', 'Initial BOM')], archived: { sizeFrom: '22 MB', sizeTo: '6 MB', at: '2026-08-01' }, restore: { state: 'requested', requestedAt: tsAt(0, '08:10') } },
];

/** Generated historical records so pagination is exercised at any height. */
const histNames: [string, string, RepoRecord['kind'], RepoRecord['type']][] = [
  ['Immigration Counter Queue System', 'MHA', 'Tender', 'Agency'],
  ['Immigration Counter Queue System proposal', 'MHA', 'Proposal', 'Agency'],
  ['School Bus Fleet Telematics', 'MOE', 'Tender', 'Agency'],
  ['School Bus Fleet Telematics BOM', 'MOE', 'BOM', 'Agency'],
  ['Retail Bank Chat Platform', 'Meridian Bank', 'Tender', 'Commercial'],
  ['Retail Bank Chat Platform business case', 'Meridian Bank', 'Business case', 'Commercial'],
  ['Hospital Bed Management System', 'Eastern Health Cluster', 'Tender', 'Agency'],
  ['Hospital Bed Management proposal', 'Eastern Health Cluster', 'Proposal', 'Agency'],
  ['Logistics Hub WMS Refresh', 'Pacific Assurance Group', 'Tender', 'Commercial'],
  ['Logistics Hub WMS business case', 'Pacific Assurance Group', 'Business case', 'Commercial'],
  ['Utilities Billing Portal Revamp', 'Utilities Regulatory Office', 'Tender', 'Agency'],
  ['Utilities Billing Portal proposal', 'Utilities Regulatory Office', 'Proposal', 'Agency'],
  ['Airport Baggage Analytics Pilot', 'CAAS', 'Tender', 'Agency'],
  ['Airport Baggage Analytics BOM', 'CAAS', 'BOM', 'Agency'],
  ['Insurance Claims OCR Service', 'Pacific Assurance Group', 'Proposal', 'Commercial'],
  ['Town Council Feedback System', 'GovTech', 'Tender', 'Agency'],
  ['Town Council Feedback proposal', 'GovTech', 'Proposal', 'Agency'],
  ['Maritime Port Scheduling System', 'Harbour & Maritime Board', 'Tender', 'Agency'],
  ['Maritime Port Scheduling BOM', 'Harbour & Maritime Board', 'BOM', 'Agency'],
  ['Telco Contact Centre Outsourcing', 'Meridian Bank', 'Tender', 'Commercial'],
  ['Telco Contact Centre business case', 'Meridian Bank', 'Business case', 'Commercial'],
  ['Water Metering IoT Rollout', 'PUB', 'Tender', 'Agency'],
  ['Water Metering IoT proposal', 'PUB', 'Proposal', 'Agency'],
  ['Sports Facility Booking Revamp', 'SportSG', 'Tender', 'Agency'],
  ['Sports Facility Booking business case', 'SportSG', 'Business case', 'Agency'],
  ['Cargo Clearance Analytics', 'CAAS', 'Tender', 'Agency'],
  ['Cargo Clearance Analytics proposal', 'CAAS', 'Proposal', 'Agency'],
  ['Enterprise Service Bus Renewal', 'MOH Holdings', 'Tender', 'Agency'],
  ['Enterprise Service Bus BOM', 'MOH Holdings', 'BOM', 'Agency'],
  ['Digital Signage Network', 'LTA', 'Tender', 'Agency'],
  ['Digital Signage Network proposal', 'LTA', 'Proposal', 'Agency'],
  ['Payroll Outsourcing Transition', 'Central Provident Services', 'Tender', 'Agency'],
];
const histStatuses: RepoRecord['status'][] = ['Won', 'Lost', 'Closed', 'Won', 'Closed', 'Archived', 'Lost', 'Won'];
const histOwners = ['John Price', 'Felicia Phan', 'Dana Lim', 'Marcus Chen', 'Chee Wee'];
const generatedRecords: RepoSeed[] = histNames.map(([name, agency, kind, type], i) => {
  const createdDaysAgo = 120 + i * 17;
  const status = histStatuses[i % histStatuses.length];
  const rec: RepoSeed = {
    id: `rh${i + 1}`,
    name,
    agency,
    kind,
    type,
    status,
    owner: histOwners[i % histOwners.length],
    created: daysFromNow(-createdDaysAgo),
    updated: daysFromNow(-(createdDaysAgo - 30 - (i % 20))),
    versions: [
      RV(1, daysFromNow(-createdDaysAgo), histOwners[i % histOwners.length], kind === 'Tender' ? 'Pack received' : 'Draft'),
      RV(2, daysFromNow(-(createdDaysAgo - 25)), histOwners[(i + 1) % histOwners.length], kind === 'Tender' ? 'Clarifications added' : 'Final'),
    ],
  };
  if (status === 'Archived') {
    const from = 18 + (i % 9) * 11;
    rec.archived = { sizeFrom: `${from} MB`, sizeTo: `${Math.max(3, Math.round(from * 0.24))} MB`, at: daysFromNow(-(createdDaysAgo - 60)) };
  }
  return rec;
});

/** Status reason vocabulary mirrors the tender statuses; most history is closed. */
const reasonFor = (s: RepoRecord['status']): string =>
  s === 'Open' ? 'In Progress (Active)'
    : s === 'Won' ? 'Won (Won)'
      : s === 'Lost' ? 'Lost (Closed)'
        : 'Revised (Closed)'; // Closed and Archived records

/** Plausible stored files per record kind. */
const docsFor = (r: RepoSeed): string[] => {
  const stem = r.name.split(' ').slice(0, 3).join('_').replace(/\W+/g, '_');
  switch (r.kind) {
    case 'Tender':
      return ['Invitation to Tender.pdf', 'Requirement Specifications.pdf', 'Conditions of Contract.pdf', 'Price Schedules.xlsx'];
    case 'Proposal':
      return [`${stem}_proposal.docx`, `${stem}_compliance_table.xlsx`, 'Cover letter.docx'];
    case 'Business case':
      return r.versions.map((v) => `${stem}_v${v.v}.xlsx`);
    case 'BOM':
      return [`${stem}_BOM.xlsx`, 'Vendor quotations.pdf'];
  }
};

export const REPOSITORY: RepoRecord[] = [...linkedRecords, ...generatedRecords].map((r) => ({
  ...r,
  statusReason: reasonFor(r.status),
  documents: r.documents ?? docsFor(r),
}));

// ---- Backup and redundancy (simulated) ---------------------------------------

export const BACKUP = {
  primary: { location: 'S3 ap-southeast-1 (tendrai-repository)', status: 'Healthy', objects: 1482, size: '9.6 GB' },
  versioning: { status: 'Enabled', deleteProtection: 'Object lock (compliance mode, 90 days)' },
  secondCopy: { location: 'S3 ap-southeast-2, separate AWS account (lps-backup)', status: 'Healthy', lag: '14 minutes' },
  lastBackup: tsAt(0, '02:00'),
  lastRestoreTest: { date: daysFromNow(-31), by: 'Kelyn Wong', result: 'Passed - 25 sampled files restored and checksum-verified' },
};

// ---- Audit log seed ---------------------------------------------------------
// Derived from the records above so the log agrees with every list and detail
// page: tender creation, uploads, processing runs, business case versions,
// MSPO generation, template uploads and archive/restore events.

const ROLE_BY_NAME: Record<string, string> = {
  ...Object.fromEntries(USERS.map((u) => [u.name, u.roleLabel])),
  'Dana Lim': 'Bidding Manager',
  'Marcus Chen': 'Bidding Manager',
  'Kelyn Wong': 'Administrator',
};
const SYSTEM = 'TendrAI (system)';

function buildSeedAudit(): AuditEntry[] {
  const out: Omit<AuditEntry, 'id'>[] = [];
  const add = (ts: string, user: string, action: string, detail: string, tender?: string, section?: string) =>
    out.push({ ts: ts.length === 10 ? `${ts}T09:00:00+08:00` : ts, user, role: user === SYSTEM ? 'Automated' : (ROLE_BY_NAME[user] ?? 'User'), action, detail, tender, section });
  const at = (iso: string, mins: number) => new Date(new Date(iso.length === 10 ? `${iso}T09:00:00+08:00` : iso).getTime() + mins * 60000).toISOString();

  for (const t of TENDERS) {
    const ref = t.ref || t.name;
    add(t.createdAt, t.owner, 'Tender created', `${t.name} (${t.type})`, ref, 'Tenders');
    if (t.pack.length) add(at(t.createdAt, 25), t.owner, 'Documents uploaded', `${t.pack.length} document${t.pack.length > 1 ? 's' : ''} added to the tender pack`, ref, 'Documents');
    if (t.lastProcessedAt) {
      add(at(t.lastProcessedAt, -18), t.owner, 'Processing started', 'Processing job queued for the tender pack', ref, 'Documents');
      const failed = t.pack.filter((d) => d.status === 'Failed').length;
      add(t.lastProcessedAt, SYSTEM, 'Processing completed', `${t.clauses.length} clauses, ${t.checklist.length} submission documents, ${t.quals.length} qualification requirements extracted${failed ? `; ${failed} document${failed > 1 ? 's' : ''} failed` : ''}`, ref, 'Documents');
    }
    if (t.processFailed) add(at(t.createdAt, 60 * 24 * 3), SYSTEM, 'Processing failed', 'Analysis service unavailable - no results produced', ref, 'Documents');
    if (t.templateSearch?.ranAt) add(t.templateSearch.ranAt, t.owner, 'Templates matched', `${t.templateSearch.matches.length} suitable template(s) found`, ref, 'Submission');
    for (const v of t.bcVersions) {
      add(v.uploadedAt, v.uploadedBy, 'Business case uploaded', `v${v.v} - ${v.fileName}${v.comment ? ` ("${v.comment}")` : ''}`, ref, 'Business case');
      if (v.mspoDownloadedAt) add(v.mspoDownloadedAt, v.uploadedBy, 'MSPO templates downloaded', `Product and resource plans generated from v${v.v}`, ref, 'MSPO templates');
    }
    for (const c of t.clauses.filter((x) => x.reviewedBy).slice(0, 2)) {
      add(at(t.lastProcessedAt ?? t.createdAt, 60 * 26), c.reviewedBy!, 'Clause updated', `Clause ${c.number}: category confirmed as ${c.category}`, ref, 'Clauses');
    }
    // the compliance / remark changes shown in each clause's change history
    for (const c of t.clauses) {
      for (const h of c.history ?? []) {
        add(h.ts, h.by, 'Clause updated', `Clause ${c.number}: ${h.field === 'Compliance' ? `compliance ${h.from} -> ${h.to}` : `remark "${h.to}"`}`, ref, 'Clauses');
      }
    }
    if (t.status === 'Won' || t.status === 'Closed') add(at(t.closingDate || t.createdAt, 60 * 24 * 14), t.owner, 'Status changed', `Status set to ${t.status} - ${t.statusReason}`, ref, 'Tenders');
  }
  for (const tpl of TEMPLATES) {
    for (const h of [...(tpl.history ?? [])].reverse()) add(h.updated, h.uploadedBy, 'Template uploaded', `${tpl.name} v${h.version}`, undefined, 'Templates');
    add(tpl.updated, tpl.uploadedBy, tpl.history?.length ? 'Template replaced' : 'Template uploaded', `${tpl.name} v${tpl.version}`, undefined, 'Templates');
  }
  for (const b of BOILERPLATE.filter((x) => x.type !== 'CV')) {
    add(b.updated, b.uploadedBy, b.type === 'Certification' ? 'Certification uploaded' : 'Boilerplate uploaded', `${b.name} v${b.version}`, undefined, 'Templates');
  }
  for (const r of REPOSITORY) {
    if (r.archived) add(r.archived.at, 'Felicia Phan', 'Record archived', `${r.name} - compressed ${r.archived.sizeFrom} to ${r.archived.sizeTo}`, undefined, 'Historical data');
    if (r.restore) add(r.restore.requestedAt, 'Felicia Phan', 'Restore requested', r.name, undefined, 'Historical data');
    if (r.restore?.state === 'available') add(at(r.restore.requestedAt, 140), SYSTEM, 'Restore completed', `${r.name} - files available`, undefined, 'Historical data');
  }
  // one timestamp format (UTC ISO) so string sorting is chronological, and
  // nothing derived may land in the future
  const now = Date.now();
  return out
    .map((e) => ({ ...e, ts: new Date(e.ts).toISOString() }))
    .filter((e) => new Date(e.ts).getTime() <= now)
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((e, i) => ({ ...e, id: `seed-${i + 1}` }));
}

export const AUDIT: AuditEntry[] = buildSeedAudit();
