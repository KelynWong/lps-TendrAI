// The business case in the template's workbook layout, and the data derived
// from it on every save:
//  - BcVersionData (header totals and lines), which the MSPO mapping (business
//    case fields in the web app), the DRB summary and the Final Check rules read
//  - the numeric cells stored on each version (BcVersionData.cells), kept in
//    the same shape as the API's bc_versions.cells (nothing in the app reads
//    them: Final Check and MSPO read business case fields)
//  - the .xlsx download of a version, for people's own reference (the app is
//    the source of truth)
// Cell positions follow the template (Summary B6 TCV, B14 direct cost, B24
// indirect cost, B50 EBITDA; Product Plan lines from row 6; Resource Plan lines
// from row 8 with fiscal years from column I; billing from Basic Info row 31).
// Values are written exactly as the business case holds them, never rounded;
// amounts are in the quote currency (Basic Info), converted at its exchange rates.

import * as XLSX from 'xlsx';
import type { BcVersionData, Tender } from '../types';
import type { BusinessCaseState } from './model';
import { ALL_CATEGORIES, FY_COUNT, PRODUCT_CATEGORIES } from './model';
import { computeSummary, dayRateQuote, fyLabel, lineCurrency, monthlyMandaysFor, productItemTotal, resourceItemTotal, sum, unitCostQuote } from './calc';

type Cell = string | number;
export type WorkbookCells = Record<string, Record<string, Cell>>;

export const WORKBOOK_TABS = ['Basic Info', 'Summary', 'Cash Flow', 'Product Plan', 'Resource Plan', 'Working', 'Labour Inputs'] as const;

const col = (n: number) => XLSX.utils.encode_col(n); // 0 = A

export function workbookCells(bc: BusinessCaseState): WorkbookCells {
  const s = computeSummary(bc);
  const out: WorkbookCells = Object.fromEntries(WORKBOOK_TABS.map((t) => [t, {}]));
  const put = (tab: string, ref: string, v: Cell) => { out[tab][ref] = v; };
  const row = (tab: string, r: number, firstCol: number, values: Cell[]) =>
    values.forEach((v, i) => put(tab, `${col(firstCol + i)}${r}`, v));
  const info = bc.basicInfo;

  // ---- Basic Info: deal information C3:D13, quote lines from row 19, billing from row 31
  const deal: [string, Cell][] = [
    ['SFDC CRM ID', info.crmId], ['Project Name', info.projectName], ['Customer', info.customer],
    ['End Customer', info.endCustomer], ['Project Start Date', info.projectStart], ['Project End Date', info.projectEnd],
    ['Project Duration (months)', s.durationMonths], ['Quote Currency', info.currency], ['Inflation Base Fiscal Year', info.inflationBaseFY],
    ['TCV (Quote Currency)', s.total.tcv], ['EBITDA %', s.total.ebitdaPct],
  ];
  deal.forEach(([label, v], i) => row('Basic Info', 3 + i, 2, [label, v]));
  row('Basic Info', 18, 0, ['Quote Line', 'Solution Offering', 'Project Type', 'Remarks', 'Margin %']);
  bc.quoteLines.forEach((q, i) => row('Basic Info', 19 + i, 0, [q.id, q.solutionOffering, q.projectType, q.remarks, q.marginPct]));
  row('Basic Info', 30, 0, ['Target Billing Date', 'Payment Schedule', 'Billing Amount', 'Remarks']);
  bc.billing.forEach((b, i) => row('Basic Info', 31 + i, 0, [b.date, b.schedule, b.amount, b.remarks]));

  // ---- Summary: totals in column B (C for percentages)
  put('Summary', 'A6', 'TCV'); put('Summary', 'B6', s.total.tcv);
  put('Summary', 'A14', 'Direct Cost'); put('Summary', 'B14', s.total.directTotal);
  ALL_CATEGORIES.forEach((c, i) => { put('Summary', `A${15 + i}`, c); put('Summary', `B${15 + i}`, s.total.directByCat[c]); });
  put('Summary', 'A22', 'Gross Profit'); put('Summary', 'B22', s.total.grossProfit); put('Summary', 'C22', s.total.grossMarginPct * 100);
  put('Summary', 'A24', 'Indirect Cost'); put('Summary', 'B24', s.total.indirectTotal);
  put('Summary', 'A25', 'Contingency'); put('Summary', 'B25', s.total.contingencyTotal);
  put('Summary', 'A26', 'Inflation'); put('Summary', 'B26', s.total.inflationTotal);
  put('Summary', 'A27', 'Finance Cost'); put('Summary', 'B27', s.total.financeCost);
  put('Summary', 'A28', 'Other Indirect'); put('Summary', 'B28', s.total.otherIndirectTotal - s.total.financeCost);
  put('Summary', 'A30', 'Total Cost'); put('Summary', 'B30', s.total.totalCost);
  put('Summary', 'A50', 'EBITDA'); put('Summary', 'B50', s.total.ebitda); put('Summary', 'C50', s.total.ebitdaPct);
  if (bc.summaryRemarks) { put('Summary', 'A52', 'Remarks'); put('Summary', 'B52', bc.summaryRemarks); }

  // ---- Product Plan: lines from row 6, quantity per FY from column H
  const fys = Array.from({ length: FY_COUNT }, (_, i) => fyLabel(info.inflationBaseFY, i));
  row('Product Plan', 5, 1, ['Quote Line', 'Category', 'Description', 'Vendor Commitment', `Unit Cost (${info.currency})`, `Total (${info.currency})`, ...fys.map((f) => `Qty ${f}`), 'Vendor', 'Remarks', 'Line Currency', 'Unit Cost (Line Currency)']);
  bc.productItems.forEach((p, i) => row('Product Plan', 6 + i, 1, [
    p.quoteLine, p.category, p.description, p.vendorCommitment ? 'Yes' : 'No', unitCostQuote(p, bc), productItemTotal(p, bc), ...p.qtyByFY, p.vendor, p.remarks, lineCurrency(bc, p), p.unitCost,
  ]));

  // ---- Resource Plan: FY headings in row 6 from column I, lines from row 8
  fys.forEach((f, i) => put('Resource Plan', `${col(8 + i)}6`, f));
  row('Resource Plan', 7, 1, ['Quote Line', 'Team', 'Role', 'Grade', 'Man-days', 'Total', 'Remarks (Skill)']);
  bc.resourceItems.forEach((r, i) => row('Resource Plan', 8 + i, 1, [
    r.quoteLine, r.team, r.role, r.grade, sum(r.mandaysByFY), resourceItemTotal(r, bc), r.remarks, ...r.mandaysByFY,
  ]));

  // ---- Labour Inputs: day rate in column F, monthly man-days from column G
  row('Labour Inputs', 7, 1, ['Role', 'Grade', 'Team', 'LPS Role for Client', 'Day Rate', ...s.months.map((m) => m.label)]);
  bc.resourceItems.forEach((r, i) => row('Labour Inputs', 8 + i, 1, [
    r.role, r.grade, r.team, r.remarks, dayRateQuote(r, bc), ...monthlyMandaysFor(bc, r, s.durationMonths),
  ]));

  // ---- Working: direct cost x (1 + margin) per quote line
  row('Working', 5, 0, ['Quote Line', 'Direct Cost', 'Margin %', 'TCV']);
  s.perLine.forEach((l, i) => row('Working', 6 + i, 0, [l.quoteLine, l.directTotal, bc.quoteLines[i]?.marginPct ?? 0, l.tcv]));

  // ---- Cash Flow: one row per project month from row 6, totals below
  row('Cash Flow', 5, 0, ['Month', 'Opening', 'Vendor Payment', 'Internal Labour', 'Repayment', 'Finance Cost', 'Ending', 'Mismatch']);
  s.months.forEach((m, i) => row('Cash Flow', 6 + i, 0, [m.label, m.opening, m.vendorPay, m.labourPay, m.repayment, m.financeCost, m.ending, m.mismatch]));
  const totalRow = 6 + s.months.length;
  row('Cash Flow', totalRow, 0, ['Total', '', sum(s.months.map((m) => m.vendorPay)), sum(s.months.map((m) => m.labourPay)), sum(s.months.map((m) => m.repayment)), sum(s.months.map((m) => m.financeCost))]);
  return out;
}

/** What the Final Check rules, MSPO plans and DRB figures read from a version. */
export function versionData(bc: BusinessCaseState): BcVersionData {
  const s = computeSummary(bc);
  const cells = workbookCells(bc);
  const numeric = Object.fromEntries(
    Object.entries(cells).map(([tab, refs]) => [
      tab,
      Object.fromEntries(Object.entries(refs).filter((e): e is [string, number] => typeof e[1] === 'number')),
    ]),
  );
  return {
    header: {
      tcv: s.total.tcv,
      productTotal: sum(PRODUCT_CATEGORIES.map((c) => s.total.directByCat[c])),
      labourTotal: s.total.directByCat['Internal Labour'],
      marginPct: s.total.grossMarginPct * 100,
      currency: bc.basicInfo.currency,
      durationMonths: s.durationMonths,
      projectStart: bc.basicInfo.projectStart,
      directCost: s.total.directTotal,
      indirectCost: s.total.indirectTotal,
      ebitda: s.total.ebitda,
      ebitdaPct: s.total.ebitdaPct,
    },
    products: bc.productItems.map((p) => ({
      id: p.id,
      ql: p.quoteLine,
      category: p.category,
      desc: p.description,
      unitCost: unitCostQuote(p, bc), // quote currency, so unit x quantity = total
      qty: sum(p.qtyByFY),
      fyQty: [...p.qtyByFY],
      vendorCommitment: p.vendorCommitment,
      total: productItemTotal(p, bc),
    })),
    resources: bc.resourceItems.map((r) => ({
      id: r.id,
      ql: r.quoteLine,
      role: r.role,
      skill: r.remarks || undefined,
      grade: r.grade,
      team: r.team,
      mandays: sum(r.mandaysByFY),
      fyMandays: [...r.mandaysByFY],
      dayRate: dayRateQuote(r, bc), // quote currency
      total: resourceItemTotal(r, bc),
    })),
    billing: bc.billing.map((b) => ({ id: b.id, date: b.date, schedule: b.schedule, amount: b.amount })),
    cashFlow: {
      vendorTotal: sum(s.months.map((m) => m.vendorPay)),
      labourTotal: sum(s.months.map((m) => m.labourPay)),
      repaymentTotal: sum(s.months.map((m) => m.repayment)),
      mismatchMonths: s.months.filter((m) => m.mismatch > 0).length,
      peakMismatch: Math.max(0, ...s.months.map((m) => m.mismatch)),
    },
    cells: numeric,
  };
}

/** Downloads one version as an .xlsx in the template's tab order. */
export function downloadBusinessCase(t: Pick<Tender, 'ref' | 'name'>, v: number, bc: BusinessCaseState) {
  const cells = workbookCells(bc);
  const wb = XLSX.utils.book_new();
  for (const tab of WORKBOOK_TABS) {
    const ws: XLSX.WorkSheet = {};
    let maxR = 0;
    let maxC = 0;
    for (const [ref, value] of Object.entries(cells[tab])) {
      ws[ref] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: value };
      const { r, c } = XLSX.utils.decode_cell(ref);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    XLSX.utils.book_append_sheet(wb, ws, tab);
  }
  XLSX.writeFile(wb, `Business_case_${(t.ref || t.name).replace(/\W+/g, '_')}_v${v}.xlsx`);
}
