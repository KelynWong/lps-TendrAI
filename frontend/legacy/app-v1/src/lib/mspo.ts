// MSPO template export (FR24): fills the two official MSPO upload templates
// (product plan and resource plan) from the current business case. Column
// layout and sheet names mirror "product plan template for MSPO.xlsx" and
// "resource plan template for MSPO.xlsx"; the "(Do Not Modify)" system
// columns are left blank for MSPO to assign on import.

import * as XLSX from 'xlsx';
import type { BusinessCaseState } from '../types';
import { fyLabel, productItemTotal, resourceItemCost, sum } from './calc';

const PRODUCT_SHEET = 'Sub Grid For Quote Line';
const PRODUCT_HEADERS = [
  '(Do Not Modify) Product Plan',
  '(Do Not Modify) Row Checksum',
  '(Do Not Modify) Modified On',
  'Name',
  'Quote Line',
  'Category',
  'Sub-Category',
  'Vendor Quotation',
  'Commodity/Service descriptions',
  'Vendor Commitment',
  'UoM',
  'Delivery Date',
  'Unit Price',
  'Quantity',
  'Total Cost',
  'Revenue',
  'Margin(%)',
];

const RESOURCE_SHEET = 'Resource Plans For Quoteline';
const RESOURCE_HEADERS = [
  '(Do Not Modify) Resource Plan',
  '(Do Not Modify) Row Checksum',
  '(Do Not Modify) Modified On',
  'Name',
  'Quote Line',
  'Fiscal Year',
  'Resource',
  'Grade',
  'Role',
  'Position Name',
  'Team',
  'Working City',
  'Day Rate',
  'Currency',
  'Fulfill Type',
  'Total MD',
  'Total Amount',
  'Margin(%)',
  'Total Revenue (Quote Currency)',
  'Skill',
];

function workingCity(team: string): string {
  if (team.includes('MY')) return 'Kuala Lumpur';
  if (team.includes('PH')) return 'Manila';
  return 'Singapore';
}

function writeSheet(sheetName: string, rows: (string | number)[][], fileName: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  XLSX.writeFile(wb, fileName);
}

const marginOfBc = (bc: BusinessCaseState) => (qlId: number) =>
  bc.quoteLines.find((q) => q.id === qlId)?.marginPct ?? 0;

/** Downloads the filled MSPO product plan template. */
export function exportMspoProduct(bc: BusinessCaseState) {
  const marginOf = marginOfBc(bc);
  const productRows = bc.productItems.map((p) => {
    const margin = marginOf(p.quoteLine);
    const total = productItemTotal(p);
    return [
      '', '', '',
      p.description,
      `Quote Line ${p.quoteLine}`,
      p.category,
      '',
      p.vendor,
      p.description,
      p.vendorCommitment ? 'Yes' : 'No',
      'Unit',
      bc.basicInfo.projectStart,
      p.unitCost,
      sum(p.qtyByFY),
      Math.round(total),
      Math.round(total * (1 + margin)),
      +(margin * 100).toFixed(1),
    ];
  });
  writeSheet(PRODUCT_SHEET, [PRODUCT_HEADERS, ...productRows], `MSPO_product_plan_${bc.basicInfo.crmId}.xlsx`);
}

/** Downloads the filled MSPO resource plan template. */
export function exportMspoResource(bc: BusinessCaseState) {
  const baseFY = bc.basicInfo.inflationBaseFY;
  const marginOf = marginOfBc(bc);
  // One resource row per labour line per fiscal year with effort in it
  const resourceRows = bc.resourceItems.flatMap((r) => {
    const margin = marginOf(r.quoteLine);
    const costs = resourceItemCost(r);
    return r.mandaysByFY
      .map((md, i) => {
        if (!md) return null;
        return [
          '', '', '',
          r.mspoRole ?? r.role,
          `Quote Line ${r.quoteLine}`,
          `FY${fyLabel(baseFY, i)}`,
          '',
          r.grade,
          r.role,
          r.remarks,
          r.team,
          workingCity(r.team),
          r.dayRate,
          bc.basicInfo.currency,
          'Internal Resources',
          md,
          Math.round(costs[i]),
          +(margin * 100).toFixed(1),
          Math.round(costs[i] * (1 + margin)),
          'General',
        ] as (string | number)[];
      })
      .filter((row): row is (string | number)[] => row !== null);
  });
  writeSheet(RESOURCE_SHEET, [RESOURCE_HEADERS, ...resourceRows], `MSPO_resource_plan_${bc.basicInfo.crmId}.xlsx`);
}
