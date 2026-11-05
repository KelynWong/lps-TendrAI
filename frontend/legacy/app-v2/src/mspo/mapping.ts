// MSPO template auto-fill. Each template column (after the three hidden
// "(Do Not Modify)" system columns) has one source:
//  - workbook: read from a business case tab, starting at a cell and running
//              down to the last row, across the fiscal-year columns, or both
//  - mspo:     a value created in MSPO first (the quote line is keyed in once
//              per tender and shared by all three plans; per-row MSPO values
//              are keyed in after download)
//  - manual:   keyed in row by row after download (left blank)
// The last row and the number of fiscal-year columns differ per business case,
// so each tender confirms them.

import * as XLSX from 'xlsx';
import type { BcResource, BcVersionData, Tender } from '../types';
import { writeXlsxWithDropdowns, type ListValidation } from '../lib/xlsxDropdown';

export const PRODUCT_SHEET = 'Sub Grid For Quote Line';
export const RESOURCE_SHEET = 'Resource Plans For Quoteline';
export const BILLING_SHEET = 'Billing Plans For Quoteline';

const DNM = (plan: string) => [`(Do Not Modify) ${plan}`, '(Do Not Modify) Row Checksum', '(Do Not Modify) Modified On'];

/** The workbook tabs a template column can be filled from. */
export const BC_TABS = [
  'Basic Info', 'Summary', 'Cash Flow', 'Product Plan', 'Resource Plan', 'Working', 'Labour Inputs',
] as const;

export type MapSource = 'workbook' | 'mspo' | 'manual' | 'calculated';
/** How a workbook range extends from its first cell. */
export type MapSpan = 'single' | 'rows' | 'cols' | 'rows-cols';

export const SPAN_LABEL: Record<MapSpan, string> = {
  single: 'Single cell',
  rows: 'Down to the last row',
  cols: 'Across the fiscal-year columns',
  'rows-cols': 'Down to the last row, across the fiscal years',
};

/** One mapping row: where a template column's values come from. */
export interface FieldMapEntry {
  target: string; // template column
  source: MapSource;
  tab?: string;
  from?: string; // first cell (workbook source)
  span?: MapSpan;
  /** extra transformation, shown under the column name */
  note?: string;
  /** dropdown written into the downloaded template */
  dropdown?: 'category' | 'subcategory';
}

const W = (target: string, tab: string, from: string, span: MapSpan, extra: Partial<FieldMapEntry> = {}): FieldMapEntry =>
  ({ target, source: 'workbook', tab, from, span, ...extra });
const MSPO = (target: string, note?: string): FieldMapEntry => ({ target, source: 'mspo', note });
const MANUAL = (target: string, extra: Partial<FieldMapEntry> = {}): FieldMapEntry => ({ target, source: 'manual', ...extra });
const CALC = (target: string, note?: string): FieldMapEntry => ({ target, source: 'calculated', note });

export const QUOTE_LINE_NOTE = 'Keyed in once per tender - the same quote line for all three plans';
const PER_ROW_MSPO = 'Created in MSPO - key in after download';

/** Product plan columns, in template order. */
export const PRODUCT_FIELD_MAP: FieldMapEntry[] = [
  MSPO('Quote Line (Quote Line) (Quote Line)', QUOTE_LINE_NOTE),
  W('Category', 'Product Plan', 'C6', 'rows', { dropdown: 'category' }),
  MANUAL('Sub-Category', { dropdown: 'subcategory', note: 'Dropdown in the downloaded file, filtered by Category' }),
  MANUAL('Delivery Date'),
  W('Margin(%)', 'Summary', 'C22', 'single'),
  W('Commodity/Service descriptions', 'Product Plan', 'D6', 'rows'),
  W('Unit Price', 'Product Plan', 'F6', 'rows'),
  W('Quantity', 'Product Plan', 'H6', 'rows-cols', { note: 'One MSPO row per fiscal year for each business case line' }),
  W('Vendor Commitment', 'Product Plan', 'E6', 'rows'),
  MSPO('Vendor Quotation', PER_ROW_MSPO),
  MANUAL('UoM'),
];


export const FY_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** Resource plan columns, in template order. */
export const RESOURCE_FIELD_MAP: FieldMapEntry[] = [
  MSPO('Quote Line Number (Quote Line) (Quote Line)', QUOTE_LINE_NOTE),
  MSPO('IT Code (Resource) (Bookable Resource)', PER_ROW_MSPO),
  W('Role', 'Resource Plan', 'D8', 'rows'),
  W('Skill', 'Resource Plan', 'H8', 'rows'),
  W('Position Name', 'Resource Plan', 'H8', 'rows', { note: 'Skill numbered per row within each fiscal year, e.g. Onsite Desktop L1 -1, -2' }),
  W('Grade', 'Resource Plan', 'E8', 'rows'),
  MSPO('Team Code (Team) (Solution Offering Team)', PER_ROW_MSPO),
  W('Margin(%)', 'Summary', 'C22', 'single'),
  W('Fiscal Year', 'Resource Plan', 'I6', 'cols', { note: 'Business case 26/27 is written as FY26. Rows per line and year = man-days (I8 onward) / (man-days per month x months the project runs in that year)' }),
  ...FY_MONTHS.map((m) => CALC(m, 'Man-days per month in the months the project runs; blank outside the project period')),
];

/** Billing plan columns, in template order. */
export const BILLING_FIELD_MAP: FieldMapEntry[] = [
  MSPO('Quote Line Number (Quote Line) (Quote Line)', QUOTE_LINE_NOTE),
  W('Billing Plan Name', 'Basic Info', 'B31', 'rows'),
  W('Target Billing Date', 'Basic Info', 'A31', 'rows'),
  W('Billing Amount (Before Tax)', 'Basic Info', 'C31', 'rows'),
  W('Remark', 'Basic Info', 'D31', 'rows'),
];

/** Headline figures keyed into MSPO, each one cell on the Summary tab. They
 *  are not part of a plan download. */
export const FIGURES_FIELD_MAP: FieldMapEntry[] = [
  W('TCV', 'Summary', 'B6', 'single'),
  W('Indirect cost', 'Summary', 'B24', 'single'),
  W('Direct cost', 'Summary', 'B14', 'single'),
  W('EBITDA', 'Summary', 'B50', 'single'),
  W('EBITDA (%)', 'Summary', 'C50', 'single'),
];

export type MspoPlan = 'product' | 'resource' | 'billing';
export const MSPO_PLANS: { plan: MspoPlan; title: string; sheet: string; dnm: string }[] = [
  { plan: 'product', title: 'Product plan template', sheet: PRODUCT_SHEET, dnm: 'Product Plan' },
  { plan: 'resource', title: 'Resource plan template', sheet: RESOURCE_SHEET, dnm: 'Resource Plan' },
  { plan: 'billing', title: 'Billing plan template', sheet: BILLING_SHEET, dnm: 'Billing Plan' },
];
/** Every mapping table: the three plans, then the headline figures. */
export type MapGroup = MspoPlan | 'figures';
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
export const headersFor = (plan: MspoPlan, defaults: MspoDefaults = DEFAULT_MSPO_MAPPING) =>
  [...DNM(MSPO_PLANS.find((p) => p.plan === plan)!.dnm), ...defaults[plan].map((e) => e.target)];

// ---- Cell arithmetic -------------------------------------------------------------

export function parseCell(s: string): { col: string; row: number } | null {
  const m = /^([A-Za-z]{1,2})([1-9]\d*)$/.exec(s.trim());
  return m ? { col: m[1].toUpperCase(), row: +m[2] } : null;
}
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const shiftCol = (c: string, by: number) => colName(colNum(c) + by);

/** Last cell of a workbook range for a given row and fiscal-year count. With
 *  no counts (company defaults) it is described in words instead. */
export function rangeEnd(e: FieldMapEntry, rows?: number, fyCount?: number): string {
  if (e.source !== 'workbook' || !e.from) return e.source === 'mspo' ? 'From MSPO' : e.source === 'calculated' ? 'Calculated' : 'Manual';
  const a = parseCell(e.from);
  if (!a) return '?';
  const endRow = rows ? `${a.row + rows - 1}` : '[last row]';
  const endCol = fyCount ? shiftCol(a.col, fyCount - 1) : '[last FY column]';
  switch (e.span ?? 'single') {
    case 'single': return 'Single cell';
    case 'rows': return `${a.col}${endRow}`;
    case 'cols': return `${endCol}${a.row}`;
    case 'rows-cols': return `${endCol}${endRow}`;
  }
}

/** Checks a plan's workbook columns have valid first cells. */
export function validatePlan(entries: FieldMapEntry[]): string[] {
  return entries
    .filter((e) => e.source === 'workbook')
    .flatMap((e) => (!e.tab ? [`${e.target}: choose a business case tab`]
      : !e.from || !parseCell(e.from) ? [`${e.target}: "${e.from ?? ''}" is not a cell like C6`]
        : []));
}

/** The mapping a tender actually uses: the company default with this
 *  tender's per-column overrides (tab and first cell). */
export function effectivePlan(
  defaults: MspoDefaults,
  t: Pick<Tender, 'mspoMapping'>,
  plan: MapGroup,
): (FieldMapEntry & { overridden: boolean })[] {
  return defaults[plan].map((d) => {
    const o = t.mspoMapping?.[`${plan}:${d.target}`];
    return o && d.source === 'workbook' ? { ...d, tab: o.tab, from: o.from, overridden: true } : { ...d, overridden: false };
  });
}

// ---- What the parsed business case holds ------------------------------------------

/** Lines the parsed business case actually has for a plan. */
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

/** Fiscal-year columns (I onward) the business case has. */
export const detectedFyCount = (d: BcVersionData) => fiscalPeriods(d).length;

/** A labour line's man-days per fiscal year (Resource Plan I8 onward). Lines
 *  without per-year figures are spread by the months run in each year. */
export function lineFyMandays(r: BcResource, periods: FiscalPeriod[]): number[] {
  if (r.fyMandays) return periods.map((_, i) => r.fyMandays![i] ?? 0);
  const total = periods.reduce((n, p) => n + p.months.length, 0);
  return periods.map((p) => Math.round((r.mandays * p.months.length / total) * 100) / 100);
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

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitLineYear(mandays: number, months: string[], daysPerMonth: number): LineYearSplit {
  if (mandays <= 0 || !months.length || daysPerMonth <= 0) return { mandays, months, heads: 0, fullRows: 0, partialPerMonth: 0 };
  const capacity = daysPerMonth * months.length;
  const heads = mandays / capacity;
  const fullRows = Math.floor(heads + 1e-9);
  const rest = mandays - fullRows * capacity;
  return { mandays, months, heads, fullRows, partialPerMonth: rest > 0.01 ? round2(rest / months.length) : 0 };
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
/** Skill = the Resource Plan remarks column (H). */
export const skillOf = (r: BcResource) => r.skill ?? SKILL_BY_ROLE[r.role] ?? r.role;

export interface MspoFillOptions {
  /** the MSPO quote line, shared by all three plans */
  quoteLine: string;
  rows: Partial<Record<MspoPlan, number>>;
  fyCount: number;
  /** man-days one person works in a month */
  daysPerMonth: number;
}

/** Per labour line, per fiscal year: the man-days and the rows they become. */
export function resourceBreakdown(d: BcVersionData, o: Pick<MspoFillOptions, 'rows' | 'fyCount' | 'daysPerMonth'>) {
  const periods = fiscalPeriods(d).slice(0, o.fyCount);
  const lines = d.resources.slice(0, o.rows.resource ?? d.resources.length);
  return {
    periods,
    lines: lines.map((r) => {
      const md = lineFyMandays(r, periods);
      return { line: r, skill: skillOf(r), years: periods.map((p, i) => splitLineYear(md[i], p.months, o.daysPerMonth)) };
    }),
  };
}

type Row = Record<string, string | number>;

function productRows(d: BcVersionData, o: MspoFillOptions): Row[] {
  const lines = d.products.slice(0, o.rows.product ?? d.products.length);
  const out: Row[] = [];
  for (const p of lines) {
    splitAcrossYears(p.qty, o.fyCount).forEach((qty) => {
      if (qty <= 0) return;
      out.push({
        'Quote Line (Quote Line) (Quote Line)': o.quoteLine,
        Category: p.category,
        'Margin(%)': +d.header.marginPct.toFixed(1),
        'Commodity/Service descriptions': p.desc,
        'Unit Price': p.unitCost,
        Quantity: qty,
        'Vendor Commitment': 'No',
      });
    });
  }
  return out;
}

function resourceRows(d: BcVersionData, o: MspoFillOptions): Row[] {
  const { periods, lines } = resourceBreakdown(d, o);
  // Position Name = Skill numbered -1, -2 ... within each skill and fiscal year
  const seen: Record<string, number> = {};
  const out: Row[] = [];
  for (const { line, skill, years } of lines) {
    years.forEach((s, i) => {
      const fy = periods[i].label;
      const perRow = [...Array(s.fullRows).fill(o.daysPerMonth), ...(s.partialPerMonth > 0 ? [s.partialPerMonth] : [])];
      for (const perMonth of perRow) {
        const key = `${skill}|${fy}`;
        seen[key] = (seen[key] ?? 0) + 1;
        out.push({
          'Quote Line Number (Quote Line) (Quote Line)': o.quoteLine,
          Role: line.role,
          Skill: skill,
          'Position Name': `${skill} -${seen[key]}`,
          Grade: line.grade,
          'Margin(%)': +d.header.marginPct.toFixed(2),
          'Fiscal Year': fy,
          ...Object.fromEntries(s.months.map((m) => [m, perMonth])),
        });
      }
    });
  }
  return out;
}

function billingRows(d: BcVersionData, o: MspoFillOptions): Row[] {
  return d.billing.slice(0, o.rows.billing ?? d.billing.length).map((b) => ({
    'Quote Line Number (Quote Line) (Quote Line)': o.quoteLine,
    'Billing Plan Name': b.schedule,
    'Target Billing Date': b.date,
    'Billing Amount (Before Tax)': Math.round(b.amount),
    Remark: '',
  }));
}

/** Rows as arrays in template column order (system columns blank). */
export function buildPlanRows(plan: MspoPlan, d: BcVersionData, o: MspoFillOptions, defaults: MspoDefaults = DEFAULT_MSPO_MAPPING): (string | number)[][] {
  const rows = plan === 'product' ? productRows(d, o) : plan === 'resource' ? resourceRows(d, o) : billingRows(d, o);
  return rows.map((r) => ['', '', '', ...defaults[plan].map((e) => r[e.target] ?? '')]);
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

export function downloadMspoPlan(plan: MspoPlan, t: Tender, d: BcVersionData, o: MspoFillOptions, defaults: MspoDefaults = DEFAULT_MSPO_MAPPING) {
  const meta = MSPO_PLANS.find((p) => p.plan === plan)!;
  const headers = headersFor(plan, defaults);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...buildPlanRows(plan, d, o, defaults)]);
  // the three system columns stay in the file, hidden
  sheet['!cols'] = headers.map((h, i) => (i < 3 ? { hidden: true } : { wch: Math.min(48, Math.max(12, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, meta.sheet);
  const fileName = `MSPO_${plan}_plan_${safeRef(t)}.xlsx`;

  const catIdx = defaults[plan].findIndex((e) => e.dropdown === 'category');
  const subIdx = defaults[plan].findIndex((e) => e.dropdown === 'subcategory');
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
