// MSPO template export (FR24): builds a 7-tab workbook (values, not formulas)
// from the current business case, matching the template's tab names.

import * as XLSX from 'xlsx';
import type { BusinessCaseState } from '../types';
import { ALL_CATEGORIES, FY_COUNT } from '../types';
import {
  computeSummary,
  fyLabel,
  productItemTotal,
  resourceItemTotal,
  sum,
} from './calc';

export function exportMspoWorkbook(bc: BusinessCaseState) {
  const s = computeSummary(bc);
  const baseFY = bc.basicInfo.inflationBaseFY;
  const wb = XLSX.utils.book_new();
  const aoa = (name: string, rows: (string | number)[][]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  aoa('Basic Info', [
    ['I. Basic Deal Information'],
    ['SFDC CRM ID', bc.basicInfo.crmId, 'Project Name', bc.basicInfo.projectName],
    ['Customer', bc.basicInfo.customer, 'Project Start Date', bc.basicInfo.projectStart],
    ['End Customer', bc.basicInfo.endCustomer, 'Project End Date', bc.basicInfo.projectEnd],
    ['GTM Unit', bc.basicInfo.gtmUnit, 'Project Duration (months)', s.durationMonths],
    ['GTM Sub-team', bc.basicInfo.gtmSubTeam, 'Quote Currency', bc.basicInfo.currency],
    ['Major Solution Offering', bc.basicInfo.majorSolutionOffering, 'Inflation Base Fiscal Year', bc.basicInfo.inflationBaseFY],
    ['TCV (Quote Currency)', Math.round(s.total.tcv), 'EBITDA %', +(s.total.ebitdaPct * 100).toFixed(2)],
    [],
    ['II. Quote Lines'],
    ['Quote Line', 'Solution Offering', 'Project Type', 'Remarks', 'Margin %'],
    ...bc.quoteLines.map((q) => [
      `Quote Line ${q.id}`, q.solutionOffering, q.projectType, q.remarks, +(q.marginPct * 100).toFixed(1),
    ]),
    [],
    ['III. Billing Plan'],
    ['Target Billing Date', 'Payment Schedule', 'Billing Amount'],
    ...bc.billing.map((b) => [b.date, b.schedule, b.amount]),
    ['', 'Total', Math.round(s.billingTotal)],
  ]);

  aoa('Summary', [
    ['', 'Total', ...bc.quoteLines.map((q) => `Quote Line ${q.id}`)],
    ['TCV', Math.round(s.total.tcv), ...s.perLine.map((l) => Math.round(l.tcv))],
    ...ALL_CATEGORIES.map((c) => [
      `Direct Cost - ${c}`,
      Math.round(s.total.directByCat[c]),
      ...s.perLine.map((l) => Math.round(l.directByCat[c])),
    ]),
    ['Direct Cost - Total', Math.round(s.total.directTotal), ...s.perLine.map((l) => Math.round(l.directTotal))],
    ['Gross Profit', Math.round(s.total.grossProfit), ...s.perLine.map((l) => Math.round(l.grossProfit))],
    ['Contingency', Math.round(s.total.contingencyTotal), ...s.perLine.map((l) => Math.round(l.contingencyTotal))],
    ['Inflation', Math.round(s.total.inflationTotal), ...s.perLine.map((l) => Math.round(l.inflationTotal))],
    ['Finance Cost', Math.round(s.financeCostTotal), ...s.perLine.map((l) => Math.round(l.financeCost))],
    ['Travel & Expense', Math.round(s.total.travelExpense), ...s.perLine.map((l) => Math.round(l.travelExpense))],
    ['Other Costs', Math.round(s.total.otherCosts), ...s.perLine.map((l) => Math.round(l.otherCosts))],
    ['Vendor Rebate', -Math.round(s.total.vendorRebate), ...s.perLine.map((l) => -Math.round(l.vendorRebate))],
    ['Total Cost', Math.round(s.total.totalCost), ...s.perLine.map((l) => Math.round(l.totalCost))],
    ['EBITDA', Math.round(s.total.ebitda), ...s.perLine.map((l) => Math.round(l.ebitda))],
    ['EBITDA %', +(s.total.ebitdaPct * 100).toFixed(2), ...s.perLine.map((l) => +(l.ebitdaPct * 100).toFixed(2))],
  ]);

  aoa('Cash Flow', [
    ['Period', 'Year', 'Opening Balance', 'Pay to Vendors', 'Internal Labour', 'Repayment', 'Compound Interest', 'Ending Balance', 'Mismatch Amount'],
    ...s.months.map((m) => [
      m.label,
      m.yearIdx,
      Math.round(m.opening),
      -Math.round(m.vendorPay),
      -Math.round(m.labourPay),
      Math.round(m.repayment),
      Math.round(m.financeCost),
      Math.round(m.ending),
      Math.round(m.mismatch),
    ]),
  ]);

  aoa('Product Plan', [
    ['Quote Line', 'Category', 'Description', 'Vendor', 'Vendor Commitment', 'Unit Cost',
      ...Array.from({ length: FY_COUNT }, (_, i) => `Qty FY${fyLabel(baseFY, i)}`), 'Total Cost', 'Source'],
    ...bc.productItems.map((p) => [
      p.quoteLine, p.category, p.description, p.vendor, p.vendorCommitment ? 'Yes' : 'No', p.unitCost,
      ...p.qtyByFY, Math.round(productItemTotal(p)),
      p.provenance.kind === 'grounded' ? `Cited: ${p.provenance.citation.docId}` : p.provenance.kind === 'estimate' ? 'AI estimate (unverified)' : 'Human-confirmed',
    ]),
    ['', '', '', '', '', 'Total', ...new Array(FY_COUNT).fill(''), Math.round(sum(bc.productItems.map(productItemTotal))), ''],
  ]);

  aoa('Resource Plan', [
    ['Quote Line', 'Team', 'Role', 'Grade', 'Team Code', 'Day Rate',
      ...Array.from({ length: FY_COUNT }, (_, i) => `Man-days FY${fyLabel(baseFY, i)}`), 'Total Cost', 'Source'],
    ...bc.resourceItems.map((r) => [
      r.quoteLine, r.team, r.role, r.grade, r.teamCode, r.dayRate,
      ...r.mandaysByFY, Math.round(resourceItemTotal(r)),
      r.provenance.kind === 'grounded' ? `Cited: ${r.provenance.citation.docId}` : r.provenance.kind === 'estimate' ? 'AI estimate (unverified)' : 'Human-confirmed',
    ]),
    ['', '', '', '', '', 'Total', ...new Array(FY_COUNT).fill(''), Math.round(sum(bc.resourceItems.map(resourceItemTotal))), ''],
  ]);

  aoa('Working', [
    ['Quote Line', 'Category', 'Direct Cost', 'Margin', 'Sell (TCV)'],
    ...s.perLine.flatMap((l, i) =>
      ALL_CATEGORIES.filter((c) => l.directByCat[c] > 0).map((c) => [
        `Quote Line ${bc.quoteLines[i].id}`, c,
        Math.round(l.directByCat[c]),
        Math.round(l.tcvByCat[c] - l.directByCat[c]),
        Math.round(l.tcvByCat[c]),
      ]),
    ),
    ['Total', '', Math.round(s.total.directTotal), Math.round(s.total.tcv - s.total.directTotal), Math.round(s.total.tcv)],
  ]);

  aoa('Labour Inputs', [
    ['LPS Role', 'Grade', 'Day Rate (iRate)', ...Array.from({ length: FY_COUNT }, (_, i) => `Man-days FY${fyLabel(baseFY, i)}`), 'Total'],
    ...bc.resourceItems.map((r) => [r.role, r.grade, r.dayRate, ...r.mandaysByFY, sum(r.mandaysByFY)]),
  ]);

  XLSX.writeFile(wb, `MSPO_${bc.basicInfo.crmId}_ProductResourcePlan.xlsx`);
}
