// MSPO template auto-fill. Sheet names and column headers mirror the real
// upload templates ("product plan template for MSPO.xlsx" / "resource plan
// template for MSPO.xlsx"). Every template column (except the "(Do Not
// Modify)" system columns) maps to a business case tab + cell range; the
// defaults below are editable per tender in the UI.

import * as XLSX from 'xlsx';
import type { BcVersionData, Tender } from '../types';

export const PRODUCT_SHEET = 'Sub Grid For Quote Line';
export const PRODUCT_HEADERS = [
  '(Do Not Modify) Product Plan', '(Do Not Modify) Row Checksum', '(Do Not Modify) Modified On',
  'Name', 'Quote Line', 'Category', 'Sub-Category', 'Vendor Quotation',
  'Commodity/Service descriptions', 'Vendor Commitment', 'UoM', 'Delivery Date',
  'Unit Price', 'Quantity', 'Total Cost', 'Revenue', 'Margin(%)',
];

export const RESOURCE_SHEET = 'Resource Plans For Quoteline';
export const RESOURCE_HEADERS = [
  '(Do Not Modify) Resource Plan', '(Do Not Modify) Row Checksum', '(Do Not Modify) Modified On',
  'Name', 'Quote Line', 'Fiscal Year', 'Resource', 'Grade', 'Role', 'Position Name',
  'Team', 'Working City', 'Day Rate', 'Currency', 'Fulfill Type', 'Total MD',
  'Total Amount', 'Margin(%)', 'Total Revenue (Quote Currency)', 'Skill',
];

export const BILLING_SHEET = 'Billing Plans For Quoteline';
export const BILLING_HEADERS = [
  '(Do Not Modify) Billing Plan', '(Do Not Modify) Row Checksum', '(Do Not Modify) Modified On',
  'Quote Line', 'Billing Plan Name', 'Target Billing Date', 'Billing Amount', 'Remark',
];

/** The workbook tabs a template column can be filled from. */
export const BC_TABS = [
  'Basic Info', 'Summary', 'Cash Flow', 'Product Plan', 'Resource Plan', 'Working', 'Labour Inputs',
] as const;

/** One editable mapping row: template column <- tab + cell range. The range
 *  runs from `from` to `to`; `to` is empty for a single cell. Within one plan
 *  every multi-row range spans the same number of rows, because each template
 *  column must produce the same number of rows. */
export interface FieldMapEntry {
  target: string; // template column
  tab: string; // business case tab
  from: string; // first cell
  to?: string; // last cell (optional - single cell when absent)
}

const FM = (target: string, tab: string, from: string, to?: string): FieldMapEntry => ({ target, tab, from, to });

/** Default mapping for every product plan column (system columns excluded).
 *  All multi-row ranges span rows 4-23 (20 line rows). */
export const PRODUCT_FIELD_MAP: FieldMapEntry[] = [
  FM('Name', 'Product Plan', 'C4', 'C23'),
  FM('Quote Line', 'Product Plan', 'B4', 'B23'),
  FM('Category', 'Product Plan', 'D4', 'D23'),
  FM('Sub-Category', 'Product Plan', 'E4', 'E23'),
  FM('Vendor Quotation', 'Product Plan', 'F4', 'F23'),
  FM('Commodity/Service descriptions', 'Product Plan', 'C4', 'C23'),
  FM('Vendor Commitment', 'Product Plan', 'G4', 'G23'),
  FM('UoM', 'Product Plan', 'H4', 'H23'),
  FM('Delivery Date', 'Product Plan', 'L4', 'L23'),
  FM('Unit Price', 'Product Plan', 'I4', 'I23'),
  FM('Quantity', 'Product Plan', 'J4', 'J23'),
  FM('Total Cost', 'Product Plan', 'K4', 'K23'),
  FM('Revenue', 'Working', 'F4', 'F23'),
  FM('Margin(%)', 'Summary', 'F5'),
];

/** Default mapping for every resource plan column (system columns excluded). */
export const RESOURCE_FIELD_MAP: FieldMapEntry[] = [
  FM('Name', 'Resource Plan', 'C4', 'C23'),
  FM('Quote Line', 'Resource Plan', 'B4', 'B23'),
  FM('Fiscal Year', 'Basic Info', 'B8'),
  FM('Resource', 'Resource Plan', 'C4', 'C23'),
  FM('Grade', 'Resource Plan', 'D4', 'D23'),
  FM('Role', 'Resource Plan', 'C4', 'C23'),
  FM('Position Name', 'Labour Inputs', 'B4', 'B23'),
  FM('Team', 'Resource Plan', 'E4', 'E23'),
  FM('Working City', 'Resource Plan', 'F4', 'F23'),
  FM('Day Rate', 'Labour Inputs', 'F4', 'F23'),
  FM('Currency', 'Basic Info', 'B10'),
  FM('Fulfill Type', 'Resource Plan', 'G4', 'G23'),
  FM('Total MD', 'Resource Plan', 'H4', 'H23'),
  FM('Total Amount', 'Resource Plan', 'I4', 'I23'),
  FM('Margin(%)', 'Summary', 'F5'),
  FM('Total Revenue (Quote Currency)', 'Working', 'G4', 'G23'),
  FM('Skill', 'Labour Inputs', 'C4', 'C23'),
];

/** Default mapping for every billing plan column (system columns excluded).
 *  All multi-row ranges span rows 30-41 (12 billing rows). */
export const BILLING_FIELD_MAP: FieldMapEntry[] = [
  FM('Quote Line', 'Basic Info', 'B30', 'B41'),
  FM('Billing Plan Name', 'Basic Info', 'C30', 'C41'),
  FM('Target Billing Date', 'Basic Info', 'D30', 'D41'),
  FM('Billing Amount', 'Basic Info', 'E30', 'E41'),
  FM('Remark', 'Basic Info', 'F30', 'F41'),
];

const city = (team: string) => (team.includes('MY') ? 'Kuala Lumpur' : team.includes('PH') ? 'Manila' : 'Singapore');
const fy = (iso: string) => {
  const d = new Date(iso);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY${String(y).slice(2)}/${String(y + 1).slice(2)}`;
};

export function buildProductRows(t: Tender, d: BcVersionData): (string | number)[][] {
  const m = d.header.marginPct / 100;
  return d.products.map((p, i) => [
    '', '', '',
    p.desc,
    `Quote Line ${p.ql}`,
    p.category,
    '',
    '',
    t.projectType === 'Usage Based' ? `${p.desc} (estimated volume, subject to actuals)` : p.desc,
    'No',
    t.projectType === 'Time Based' ? 'Month' : 'Unit',
    t.projectType === 'Milestone Based' ? d.billing[Math.min(i, d.billing.length - 1)]?.date ?? d.header.projectStart : d.header.projectStart,
    p.unitCost,
    p.qty,
    Math.round(p.total),
    Math.round(p.total * (1 + m)),
    +(d.header.marginPct).toFixed(1),
  ]);
}

export function buildResourceRows(_t: Tender, d: BcVersionData): (string | number)[][] {
  const m = d.header.marginPct / 100;
  return d.resources.map((r) => [
    '', '', '',
    r.role,
    `Quote Line ${r.ql}`,
    fy(d.header.projectStart),
    '',
    r.grade,
    r.role,
    r.role,
    r.team,
    city(r.team),
    r.dayRate,
    d.header.currency,
    'Internal Resources',
    r.mandays,
    Math.round(r.total),
    +(d.header.marginPct).toFixed(1),
    Math.round(r.total * (1 + m)),
    'General',
  ]);
}

export function buildBillingRows(_t: Tender, d: BcVersionData): (string | number)[][] {
  return d.billing.map((b) => [
    '', '', '',
    'Quote Line 1',
    b.schedule,
    b.date,
    Math.round(b.amount),
    '',
  ]);
}

function download(sheetName: string, headers: string[], rows: (string | number)[][], fileName: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);
  XLSX.writeFile(wb, fileName);
}

const safeRef = (t: Tender) => (t.ref || t.name).replace(/\W+/g, '_');

export function downloadMspoProduct(t: Tender, d: BcVersionData) {
  download(PRODUCT_SHEET, PRODUCT_HEADERS, buildProductRows(t, d), `MSPO_product_plan_${safeRef(t)}.xlsx`);
}

export function downloadMspoResource(t: Tender, d: BcVersionData) {
  download(RESOURCE_SHEET, RESOURCE_HEADERS, buildResourceRows(t, d), `MSPO_resource_plan_${safeRef(t)}.xlsx`);
}

export function downloadMspoBilling(t: Tender, d: BcVersionData) {
  download(BILLING_SHEET, BILLING_HEADERS, buildBillingRows(t, d), `MSPO_billing_plan_${safeRef(t)}.xlsx`);
}
