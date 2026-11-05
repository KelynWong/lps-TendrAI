// MSPO template auto-fill. Each template column (after the three hidden
// "(Do Not Modify)" system columns) has one source:
//  - workbook:   a field of the business case in the web app (the app is the
//                source of truth), e.g. Product Plan > Unit cost. One MSPO row
//                per business case line (product lines once per fiscal year,
//                labour lines once per person per fiscal year).
//  - mspo:       a value created in MSPO first (the quote line is keyed in once
//                per tender and shared by all three plans; per-row MSPO values
//                are keyed in after download)
//  - manual:     keyed in row by row after download (left blank)
//  - calculated: man-days per month on the resource plan
// The source value 'workbook' is kept from the stored mapping vocabulary
// (map_source enum); it is shown as "Business case".

import * as XLSX from 'xlsx';
import type { BcBilling, BcProduct, BcResource, BcVersionData, Tender } from '../types';
import { writeXlsxWithDropdowns, type ListValidation } from '../lib/xlsxDropdown';

export const PRODUCT_SHEET = 'Sub Grid For Quote Line';
export const RESOURCE_SHEET = 'Resource Plans For Quoteline';
export const BILLING_SHEET = 'Billing Plans For Quoteline';

const DNM = (plan: string) => [`(Do Not Modify) ${plan}`, '(Do Not Modify) Row Checksum', '(Do Not Modify) Modified On'];

export type MapSource = 'workbook' | 'mspo' | 'manual' | 'calculated';

/** One mapping row: where a template column's values come from. */
export interface FieldMapEntry {
  target: string; // template column
  source: MapSource;
  /** business case field (workbook source), a key of BC_FIELDS */
  field?: string;
  /** extra transformation, shown under the column name */
  note?: string;
  /** dropdown written into the downloaded template */
  dropdown?: 'category' | 'subcategory';
}

export type MspoPlan = 'product' | 'resource' | 'billing';
/** Every mapping table: the three plans, then the headline figures. */
export type MapGroup = MspoPlan | 'figures';

// ---- Business case fields a column can be filled from -------------------------------

/** What one MSPO row is built from: the version, plus the line it comes from. */
export interface RowContext {
  d: BcVersionData;
  product?: BcProduct;
  /** product row: the quantity in this fiscal year */
  qty?: number;
  resource?: BcResource;
  /** resource row: fiscal year label (FY26), skill, numbered position, man-days in the year */
  fiscalYear?: string;
  skill?: string;
  position?: string;
  mandays?: number;
  billing?: BcBilling;
}

export interface BcField {
  key: string;
  /** shown in the mapping tables, e.g. "Product Plan > Unit cost" */
  label: string;
  /** the plans (and figures table) that may use it */
  groups: MapGroup[];
  get: (c: RowContext) => string | number | null;
}

const ALL: MapGroup[] = ['product', 'resource', 'billing', 'figures'];

/** Every business case field the MSPO mapping can use. Values are passed
 *  through exactly as saved (amounts in the version's quote currency). */
export const BC_FIELDS: BcField[] = [
  { key: 'product.category', label: 'Product Plan > Category', groups: ['product'], get: (c) => c.product?.category ?? null },
  { key: 'product.description', label: 'Product Plan > Description', groups: ['product'], get: (c) => c.product?.desc ?? null },
  { key: 'product.unitCost', label: 'Product Plan > Unit cost', groups: ['product'], get: (c) => c.product?.unitCost ?? null },
  { key: 'product.quantity', label: 'Product Plan > Quantity in the fiscal year', groups: ['product'], get: (c) => c.qty ?? null },
  { key: 'product.vendorCommitment', label: 'Product Plan > Vendor commitment (Yes/No)', groups: ['product'], get: (c) => (c.product ? (c.product.vendorCommitment ? 'Yes' : 'No') : null) },
  { key: 'product.total', label: 'Product Plan > Line total', groups: ['product'], get: (c) => c.product?.total ?? null },
  { key: 'product.quoteLine', label: 'Product Plan > Quote line no.', groups: ['product'], get: (c) => c.product?.ql ?? null },
  { key: 'resource.role', label: 'Resource Plan > Role', groups: ['resource'], get: (c) => c.resource?.role ?? null },
  { key: 'resource.skill', label: 'Resource Plan > Remarks (Skill)', groups: ['resource'], get: (c) => c.skill ?? null },
  { key: 'resource.position', label: 'Resource Plan > Skill, numbered per person', groups: ['resource'], get: (c) => c.position ?? null },
  { key: 'resource.grade', label: 'Resource Plan > Grade', groups: ['resource'], get: (c) => c.resource?.grade ?? null },
  { key: 'resource.team', label: 'Resource Plan > Team', groups: ['resource'], get: (c) => c.resource?.team ?? null },
  { key: 'resource.fiscalYear', label: 'Resource Plan > Fiscal year (FY26)', groups: ['resource'], get: (c) => c.fiscalYear ?? null },
  { key: 'resource.dayRate', label: 'Labour Inputs > Day rate', groups: ['resource'], get: (c) => c.resource?.dayRate ?? null },
  { key: 'resource.mandays', label: 'Resource Plan > Man-days in the fiscal year', groups: ['resource'], get: (c) => c.mandays ?? null },
  { key: 'billing.schedule', label: 'Basic Info > Billing payment schedule', groups: ['billing'], get: (c) => c.billing?.schedule ?? null },
  { key: 'billing.date', label: 'Basic Info > Target billing date', groups: ['billing'], get: (c) => c.billing?.date ?? null },
  { key: 'billing.amount', label: 'Basic Info > Billing amount', groups: ['billing'], get: (c) => c.billing?.amount ?? null },
  { key: 'summary.tcv', label: 'Summary > TCV', groups: ALL, get: (c) => c.d.header.tcv },
  { key: 'summary.directCost', label: 'Summary > Direct cost', groups: ALL, get: (c) => c.d.header.directCost ?? null },
  { key: 'summary.indirectCost', label: 'Summary > Indirect cost', groups: ALL, get: (c) => c.d.header.indirectCost ?? null },
  { key: 'summary.ebitda', label: 'Summary > EBITDA', groups: ALL, get: (c) => c.d.header.ebitda ?? null },
  { key: 'summary.ebitdaPct', label: 'Summary > EBITDA % (fraction)', groups: ALL, get: (c) => c.d.header.ebitdaPct ?? null },
  { key: 'summary.marginPct', label: 'Summary > Gross margin %', groups: ALL, get: (c) => c.d.header.marginPct },
  { key: 'summary.labourCost', label: 'Summary > Internal labour cost', groups: ALL, get: (c) => c.d.header.labourTotal },
  { key: 'summary.productCost', label: 'Summary > Product cost', groups: ALL, get: (c) => c.d.header.productTotal },
  { key: 'basic.currency', label: 'Basic Info > Quote currency', groups: ALL, get: (c) => c.d.header.currency },
];

export const fieldOf = (key?: string) => BC_FIELDS.find((f) => f.key === key);
export const fieldsFor = (group: MapGroup) => BC_FIELDS.filter((f) => f.groups.includes(group));
export const fieldLabel = (key?: string) => fieldOf(key)?.label ?? 'Choose a field';

// ---- Default mapping ------------------------------------------------------------------

const F = (target: string, field: string, extra: Partial<FieldMapEntry> = {}): FieldMapEntry =>
  ({ target, source: 'workbook', field, ...extra });
const MSPO = (target: string, note?: string): FieldMapEntry => ({ target, source: 'mspo', note });
const MANUAL = (target: string, extra: Partial<FieldMapEntry> = {}): FieldMapEntry => ({ target, source: 'manual', ...extra });
const CALC = (target: string, note?: string): FieldMapEntry => ({ target, source: 'calculated', note });

export const QUOTE_LINE_NOTE = 'Keyed in once per tender - the same quote line for all three plans';
const PER_ROW_MSPO = 'Created in MSPO - key in after download';

/** Product plan columns, in template order. */
export const PRODUCT_FIELD_MAP: FieldMapEntry[] = [
  MSPO('Quote Line (Quote Line) (Quote Line)', QUOTE_LINE_NOTE),
  F('Category', 'product.category', { dropdown: 'category' }),
  MANUAL('Sub-Category', { dropdown: 'subcategory', note: 'Dropdown in the downloaded file, filtered by Category' }),
  MANUAL('Delivery Date'),
  F('Margin(%)', 'summary.marginPct'),
  F('Commodity/Service descriptions', 'product.description'),
  F('Unit Price', 'product.unitCost'),
  F('Quantity', 'product.quantity', { note: 'One MSPO row per fiscal year for each business case line' }),
  F('Vendor Commitment', 'product.vendorCommitment'),
  MSPO('Vendor Quotation', PER_ROW_MSPO),
  MANUAL('UoM'),
];

export const FY_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** Resource plan columns, in template order. */
export const RESOURCE_FIELD_MAP: FieldMapEntry[] = [
  MSPO('Quote Line Number (Quote Line) (Quote Line)', QUOTE_LINE_NOTE),
  MSPO('IT Code (Resource) (Bookable Resource)', PER_ROW_MSPO),
  F('Role', 'resource.role'),
  F('Skill', 'resource.skill'),
  F('Position Name', 'resource.position', { note: 'Skill numbered per row within each fiscal year, e.g. Onsite Desktop L1 -1, -2' }),
  F('Grade', 'resource.grade'),
  MSPO('Team Code (Team) (Solution Offering Team)', PER_ROW_MSPO),
  F('Margin(%)', 'summary.marginPct'),
  F('Fiscal Year', 'resource.fiscalYear', { note: 'Business case 26/27 is written as FY26. Rows per line and year = man-days / (man-days per month x months the project runs in that year)' }),
  ...FY_MONTHS.map((m) => CALC(m, 'Man-days per month in the months the project runs; blank outside the project period')),
];

/** Billing plan columns, in template order. */
export const BILLING_FIELD_MAP: FieldMapEntry[] = [
  MSPO('Quote Line Number (Quote Line) (Quote Line)', QUOTE_LINE_NOTE),
  F('Billing Plan Name', 'billing.schedule'),
  F('Target Billing Date', 'billing.date'),
  F('Billing Amount (Before Tax)', 'billing.amount'),
  MANUAL('Remark'),
];

/** Headline figures keyed into MSPO. They are not part of a plan download. */
export const FIGURES_FIELD_MAP: FieldMapEntry[] = [
  F('TCV', 'summary.tcv'),
  F('Indirect cost', 'summary.indirectCost'),
  F('Direct cost', 'summary.directCost'),
  F('EBITDA', 'summary.ebitda'),
  F('EBITDA (%)', 'summary.ebitdaPct'),
];

export const MSPO_PLANS: { plan: MspoPlan; title: string; sheet: string; dnm: string }[] = [
  { plan: 'product', title: 'Product plan template', sheet: PRODUCT_SHEET, dnm: 'Product Plan' },
  { plan: 'resource', title: 'Resource plan template', sheet: RESOURCE_SHEET, dnm: 'Resource Plan' },
  { plan: 'billing', title: 'Billing plan template', sheet: BILLING_SHEET, dnm: 'Billing Plan' },
];
export const MAP_GROUPS: { plan: MapGroup; title: string }[] = [
  ...MSPO_PLANS,
  { plan: 'figures', title: 'Business case figures' },
];
export type MspoDefaults = Record<MapGroup, FieldMapEntry[]>;
export const DEFAULT_MSPO_MAPPING: MspoDefaults = {
  product: PRODUCT_FIELD_MAP,
  resource: RESOURCE_FIELD_MAP,
  billing: BILLING_FIELD_MAP,
  figures: FIGURES_FIELD_MAP,
};

/** Template headers: the three hidden system columns, then the mapped columns. */
export const headersFor = (plan: MspoPlan, entries: FieldMapEntry[]) =>
  [...DNM(MSPO_PLANS.find((p) => p.plan === plan)!.dnm), ...entries.map((e) => e.target)];

const colName = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Checks every business case column has a field this plan can use. */
export function validatePlan(plan: MapGroup, entries: FieldMapEntry[]): string[] {
  return entries
    .filter((e) => e.source === 'workbook')
    .flatMap((e) => (!e.field ? [`${e.target}: choose a business case field`]
      : !fieldOf(e.field)?.groups.includes(plan) ? [`${e.target}: ${fieldLabel(e.field)} is not available on this plan`]
        : []));
}

/** The mapping a tender actually uses: the company default with this
 *  tender's per-column field overrides. */
export function effectivePlan(
  defaults: MspoDefaults,
  t: Pick<Tender, 'mspoMapping'>,
  plan: MapGroup,
): (FieldMapEntry & { overridden: boolean })[] {
  return defaults[plan].map((d) => {
    const o = t.mspoMapping?.[`${plan}:${d.target}`];
    return o && d.source === 'workbook' ? { ...d, field: o.field, overridden: true } : { ...d, overridden: false };
  });
}

/** Lines the business case version has for a plan (one or more MSPO rows each). */
export function detectedRows(d: BcVersionData, plan: MspoPlan): number {
  return plan === 'product' ? d.products.length : plan === 'resource' ? d.resources.length : d.billing.length;
}

// ---- Project period and fiscal years (Apr-Mar) -------------------------------------

export const DEFAULT_DAYS_PER_MONTH = 18.5;

/** One fiscal year the project overlaps. */
export interface FiscalPeriod {
  /** MSPO label: business case "26/27" is "FY26" */
  label: string;
  /** business case column heading, e.g. "26/27" */
  bcLabel: string;
  /** months of this FY inside the project period, in FY order (Apr first) */
  months: string[];
}

/** Project start (Basic Info D7), end (D8) and duration in months (D9). */
export function projectPeriod(d: BcVersionData) {
  const [y, m, day] = d.header.projectStart.slice(0, 10).split('-').map(Number);
  const start = new Date(y, m - 1, day || 1);
  const months = Math.max(1, d.header.durationMonths);
  const end = new Date(start.getFullYear(), start.getMonth() + months, start.getDate() - 1);
  return { start, end, months };
}

/** Fiscal years the project spans, with the months it runs in each. */
export function fiscalPeriods(d: BcVersionData): FiscalPeriod[] {
  const { start, months } = projectPeriod(d);
  const out: FiscalPeriod[] = [];
  for (let i = 0; i < months; i++) {
    const dt = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const fy = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;
    const label = `FY${String(fy).slice(2)}`;
    let p = out[out.length - 1];
    if (!p || p.label !== label) {
      p = { label, bcLabel: `${String(fy).slice(2)}/${String(fy + 1).slice(2)}`, months: [] };
      out.push(p);
    }
    p.months.push(FY_MONTHS[(dt.getMonth() + 9) % 12]);
  }
  return out;
}

/** Fiscal years the business case spans. */
export const detectedFyCount = (d: BcVersionData) => fiscalPeriods(d).length;

/** A labour line's man-days per fiscal year (Resource Plan). Lines
 *  without per-year figures are spread by the months run in each year. */
export function lineFyMandays(r: BcResource, periods: FiscalPeriod[]): number[] {
  if (r.fyMandays) return periods.map((_, i) => r.fyMandays![i] ?? 0);
  const total = periods.reduce((n, p) => n + p.months.length, 0);
  return periods.map((p) => (r.mandays * p.months.length) / total);
}

/** How one labour line in one fiscal year becomes MSPO rows: man-days divided
 *  by (days per month x months run that year) gives the headcount; each full
 *  head is one row at the days-per-month rate, a remainder is one more row
 *  carrying the leftover man-days spread over the same months. */
export interface LineYearSplit {
  mandays: number;
  months: string[];
  heads: number;
  fullRows: number;
  /** man-days per month on the extra partial row (0 when none) */
  partialPerMonth: number;
}


export function splitLineYear(mandays: number, months: string[], daysPerMonth: number): LineYearSplit {
  if (mandays <= 0 || !months.length || daysPerMonth <= 0) return { mandays, months, heads: 0, fullRows: 0, partialPerMonth: 0 };
  const capacity = daysPerMonth * months.length;
  const heads = mandays / capacity;
  const fullRows = Math.floor(heads + 1e-9);
  const rest = mandays - fullRows * capacity;
  return { mandays, months, heads, fullRows, partialPerMonth: rest > 1e-9 ? rest / months.length : 0 };
}
export const rowsOfSplit = (s: LineYearSplit) => s.fullRows + (s.partialPerMonth > 0 ? 1 : 0);

/** Splits a quantity across fiscal years (whole units; remainder in the first year). */
function splitAcrossYears(qty: number, years: number): number[] {
  const base = Math.floor(qty / years);
  return Array.from({ length: years }, (_, i) => base + (i === 0 ? qty - base * years : 0));
}

const SKILL_BY_ROLE: Record<string, string> = {
  'Project Manager': 'Project Management',
  'System Architect': 'Solution Architecture',
  'Analyst Programmer': 'Application Development',
  'Technical Engineer': 'Infrastructure Engineering',
  'Security Analyst': 'Security Operations',
  'Operation Manager': 'Service Operations',
  'Service Manager': 'Service Management',
  'Service Desk Analyst': 'Service Desk',
};
/** Skill = the Resource Plan remarks (client-facing role title). */
export const skillOf = (r: BcResource) => r.skill ?? SKILL_BY_ROLE[r.role] ?? r.role;


export interface MspoFillOptions {
  /** the MSPO quote line, shared by all three plans */
  quoteLine: string;
  fyCount: number;
  /** man-days one person works in a month */
  daysPerMonth: number;
}

/** Per labour line, per fiscal year: the man-days and the rows they become. */
export function resourceBreakdown(d: BcVersionData, o: Pick<MspoFillOptions, 'fyCount' | 'daysPerMonth'>) {
  const periods = fiscalPeriods(d).slice(0, o.fyCount);
  return {
    periods,
    lines: d.resources.map((r) => {
      const md = lineFyMandays(r, periods);
      return { line: r, skill: skillOf(r), years: periods.map((p, i) => splitLineYear(md[i], p.months, o.daysPerMonth)) };
    }),
  };
}

/** One MSPO row: what its mapped fields read, plus the per-month man-days. */
interface PlanRow {
  ctx: RowContext;
  months?: string[];
  perMonth?: number;
}

function productRows(d: BcVersionData, o: MspoFillOptions): PlanRow[] {
  const out: PlanRow[] = [];
  for (const p of d.products) {
    // quantities per fiscal year as planned; older data without them is split
    const perYear = p.fyQty ? Array.from({ length: o.fyCount }, (_, i) => p.fyQty![i] ?? 0) : splitAcrossYears(p.qty, o.fyCount);
    perYear.forEach((qty) => {
      if (qty > 0) out.push({ ctx: { d, product: p, qty } });
    });
  }
  return out;
}

function resourceRows(d: BcVersionData, o: MspoFillOptions): PlanRow[] {
  const { periods, lines } = resourceBreakdown(d, o);
  // Position Name = Skill numbered -1, -2 ... within each skill and fiscal year
  const seen: Record<string, number> = {};
  const out: PlanRow[] = [];
  for (const { line, skill, years } of lines) {
    years.forEach((s, i) => {
      const fy = periods[i].label;
      const perRow = [...Array(s.fullRows).fill(o.daysPerMonth), ...(s.partialPerMonth > 0 ? [s.partialPerMonth] : [])];
      for (const perMonth of perRow) {
        const key = `${skill}|${fy}`;
        seen[key] = (seen[key] ?? 0) + 1;
        out.push({
          ctx: { d, resource: line, fiscalYear: fy, skill, position: `${skill} -${seen[key]}`, mandays: s.mandays },
          months: s.months,
          perMonth,
        });
      }
    });
  }
  return out;
}

const billingRows = (d: BcVersionData): PlanRow[] => d.billing.map((b) => ({ ctx: { d, billing: b } }));

/** Rows as arrays in template column order (system columns blank). Each
 *  business case column reads its mapped field, exactly as saved. */
export function buildPlanRows(plan: MspoPlan, d: BcVersionData, o: MspoFillOptions, entries: FieldMapEntry[]): (string | number)[][] {
  const rows = plan === 'product' ? productRows(d, o) : plan === 'resource' ? resourceRows(d, o) : billingRows(d);
  return rows.map((r) => ['', '', '', ...entries.map((e): string | number => {
    if (e.source === 'workbook') return fieldOf(e.field)?.get(r.ctx) ?? '';
    if (e.source === 'mspo') return e.target.startsWith('Quote Line') ? o.quoteLine : '';
    if (e.source === 'calculated') return r.months?.includes(e.target) && r.perMonth !== undefined ? r.perMonth : '';
    return '';
  })]);
}

// ---- Product category lists (dropdowns in the downloaded template) ---------------

export const PRODUCT_CATEGORIES: Record<string, string[]> = {
  Hardware: [
    'Servers and supporting equipment (服务器及配套)',
    'Network and supporting equipment (网络设备及配套)',
    'Sensor and IOT device (传感器及物联网设备)',
    'Tools (工具)',
    'PC and Supporting equipment (PC及配套)',
    'Hardware maintenance (硬件维保)',
    'Consumable materials (耗材)',
  ],
  Software: ['License (授权)', 'Maintenance (维护)'],
  'Telephony Resource': ['Telephony (语音数据通信)'],
  'External Service': [
    'Contractor Staffing (外包)',
    'Service Outsourcing (业务外包)',
    'Consulting Svcs (咨询服务)',
    'Insurance (保险)',
    'Medical Svcs (医疗服务)',
    'Education & Training Svcs (教育与培训服务)',
    'Relocation Svcs (搬迁服务)',
    'Data Center',
    'Call Center',
    'HR Info Systems (人力资源信息系统)',
  ],
  'Project Real Estate': [
    'Construction & Project Mgt (项目建设管理)',
    'Furniture Svcs (家具服务)',
    'Security Equipment & Service (安全设备)',
    'Facility Mgt Svcs (物业管理)',
    'Leasing& Utilities (租赁)',
  ],
};

// ---- Download -----------------------------------------------------------------------

const safeRef = (t: Tender) => (t.ref || t.name).replace(/\W+/g, '_');
/** Rows given dropdowns, leaving room for lines added after download. */
const DROPDOWN_ROWS = 500;

export function downloadMspoPlan(plan: MspoPlan, t: Tender, d: BcVersionData, o: MspoFillOptions, entries: FieldMapEntry[]) {
  const meta = MSPO_PLANS.find((p) => p.plan === plan)!;
  const headers = headersFor(plan, entries);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...buildPlanRows(plan, d, o, entries)]);
  // the three system columns stay in the file, hidden
  sheet['!cols'] = headers.map((h, i) => (i < 3 ? { hidden: true } : { wch: Math.min(48, Math.max(12, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, meta.sheet);
  const fileName = `MSPO_${plan}_plan_${safeRef(t)}.xlsx`;

  const catIdx = entries.findIndex((e) => e.dropdown === 'category');
  const subIdx = entries.findIndex((e) => e.dropdown === 'subcategory');
  if (catIdx < 0 && subIdx < 0) {
    XLSX.writeFile(wb, fileName);
    return;
  }
  // a hidden "Lists" sheet holds the category and sub-category lists; each
  // category's sub-categories are a named range so the Sub-Category dropdown
  // can follow the Category chosen on the same row (INDIRECT)
  const cats = Object.keys(PRODUCT_CATEGORIES);
  const listRows: string[][] = [];
  const height = Math.max(cats.length, ...cats.map((c) => PRODUCT_CATEGORIES[c].length));
  for (let r = 0; r < height; r++) listRows.push([cats[r] ?? '', ...cats.map((c) => PRODUCT_CATEGORIES[c][r] ?? '')]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(listRows), 'Lists');
  const nameOf = (c: string) => c.replace(/[^A-Za-z0-9]+/g, '_');
  wb.Workbook = {
    Sheets: [{ name: meta.sheet, Hidden: 0 }, { name: 'Lists', Hidden: 1 }],
    Names: [
      { Name: 'Categories', Ref: `Lists!$A$1:$A$${cats.length}` },
      ...cats.map((c, i) => {
        const col = colName(i + 2);
        return { Name: nameOf(c), Ref: `Lists!$${col}$1:$${col}$${PRODUCT_CATEGORIES[c].length}` };
      }),
    ],
  };
  const validations: ListValidation[] = [];
  const last = DROPDOWN_ROWS + 1;
  if (catIdx >= 0) {
    const col = colName(4 + catIdx);
    validations.push({ sqref: `${col}2:${col}${last}`, formula: 'Categories' });
  }
  if (subIdx >= 0 && catIdx >= 0) {
    const col = colName(4 + subIdx);
    const catCol = colName(4 + catIdx);
    validations.push({ sqref: `${col}2:${col}${last}`, formula: `INDIRECT(SUBSTITUTE(SUBSTITUTE(${catCol}2," ","_"),"&","_"))` });
  }
  writeXlsxWithDropdowns(wb, fileName, validations);
}
