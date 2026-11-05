/* eslint-disable react-refresh/only-export-components */
// Draft layer for the business case workspace: tabs edit a local draft copy;
// nothing reaches the store (or the audit trail) until it is saved as a new
// version.

import { createContext, useContext } from 'react';
import type { BusinessCaseState, Provenance } from './model';
import { ALL_CATEGORIES } from './model';

export interface DraftCtxType {
  /** The draft business case all tabs render and edit */
  bc: BusinessCaseState;
  /** Apply an edit to the draft (pure updater) */
  update: (fn: (bc: BusinessCaseState) => BusinessCaseState) => void;
  /** True when the draft differs from the last saved version */
  dirty: boolean;
  /** the signed-in user may edit (BD team, tender not closed) */
  editable: boolean;
  /** recorded on every value a person confirms or edits */
  userName: string;
}

export const DraftCtx = createContext<DraftCtxType | null>(null);

export function useDraft(): DraftCtxType {
  const ctx = useContext(DraftCtx);
  if (!ctx) throw new Error('useDraft outside provider');
  return ctx;
}

/** Records a manual-input group as verified (idempotent). */
export function confirmInput(list: string[], key: string): string[] {
  return list.includes(key) ? list : [...list, key];
}

/** Every manual-input CELL on the Summary tab that starts as an AI-applied
 *  default. Cell keys end with the quote-line index; 'sum:fin' is the single
 *  editable Finance Cost % in the total column. */
export function summaryCellKeys(bc: BusinessCaseState): string[] {
  const per = (base: string) => bc.quoteLines.map((_, i) => `${base}:${i}`);
  return [
    ...ALL_CATEGORIES.flatMap((c) => per(`sum:cont:${c}`)),
    ...ALL_CATEGORIES.flatMap((c) => per(`sum:infl:${c}`)),
    ...per('sum:prc:prcHwSw'),
    ...per('sum:prc:prcOps'),
    ...per('sum:prc:prcStamp'),
    ...per('sum:oi:travelExpense'),
    ...per('sum:oi:otherCosts'),
    ...per('sum:oi:vendorRebate'),
    'sum:fin',
  ];
}

/** Human confirmation that PRESERVES an underlying citation. `edited` = the
 *  person changed the value; false = they confirmed the cited/estimated value. */
export function confirmProv(prev: Provenance, name: string, edited: boolean): Provenance {
  const citation = prev.kind === 'grounded' ? prev.citation : prev.kind === 'human' ? prev.citation : undefined;
  const wasEdited = edited || (prev.kind === 'human' && prev.edited) || undefined;
  return { kind: 'human', confirmedBy: name, citation, edited: wasEdited };
}

// ---- Detailed change log ---------------------------------------------------
// Save emits one audit entry per change: added / modified / deleted, the tab it
// happened on, which line, and the exact old -> new values.

export interface ChangeEntry {
  section: string;
  action: string;
  detail: string;
}

const n = (v: number) => Math.round(v).toLocaleString();
const p = (v: number) => `${(v * 100).toFixed(2)}%`;
const q = (v: string | number | boolean) => `'${v}'`;

function byId<T extends { id: string | number }>(arr: T[]): Map<string | number, T> {
  return new Map(arr.map((x) => [x.id, x]));
}

export function detailedDiff(a: BusinessCaseState, b: BusinessCaseState): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  // amounts in the quote currency; unit costs in the line's currency; day rates in the SGD rate card
  const sym = (code: string) => (code === 'SGD' ? 'S$' : `${code} `);
  const cur = sym(b.basicInfo.currency);
  const lineCur = (p: { currency?: string }) => sym(p.currency ?? b.basicInfo.currency);
  const push = (section: string, action: string, detail: string) => out.push({ section, action, detail });

  // ---- Basic Info fields ----
  const biLabels: [keyof typeof a.basicInfo, string][] = [
    ['crmId', 'SFDC CRM ID'], ['projectName', 'Project Name'], ['customer', 'Customer'],
    ['endCustomer', 'End Customer'], ['gtmUnit', 'GTM Unit'], ['gtmSubTeam', 'GTM Sub-team'],
    ['majorSolutionOffering', 'Major Solution Offering'], ['projectStart', 'Project Start Date'],
    ['projectEnd', 'Project End Date'], ['currency', 'Quote Currency'], ['inflationBaseFY', 'Inflation Base FY'],
  ];
  for (const [k, label] of biLabels) {
    if (k === 'fieldProv') continue;
    if (a.basicInfo[k] !== b.basicInfo[k]) {
      push('Basic Info', 'Field modified', `${label}: ${q(String(a.basicInfo[k]))} -> ${q(String(b.basicInfo[k]))}`);
    }
  }
  // Field confirmed without a value change (badge flipped to human)
  for (const [k, label] of biLabels) {
    if (k === 'fieldProv') continue;
    const pa = a.basicInfo.fieldProv?.[k as string];
    const pb = b.basicInfo.fieldProv?.[k as string];
    if (pa && pb && pa.kind !== 'human' && pb.kind === 'human' && a.basicInfo[k] === b.basicInfo[k]) {
      push('Basic Info', 'Value confirmed', `${label} confirmed`);
    }
  }
  for (const code of new Set([...Object.keys(a.fxOverrides), ...Object.keys(b.fxOverrides)])) {
    if (a.fxOverrides[code] !== b.fxOverrides[code]) {
      push('Basic Info', 'Field modified', `Applied FX rate ${code}: ${(a.fxOverrides[code] ?? 0).toFixed(4)} -> ${(b.fxOverrides[code] ?? 0).toFixed(4)}`);
    }
  }
  for (const g of new Set([...Object.keys(a.gradeRateOverrides ?? {}), ...Object.keys(b.gradeRateOverrides ?? {})])) {
    if (a.gradeRateOverrides?.[g] !== b.gradeRateOverrides?.[g]) {
      push('Resource Plan', 'Field modified', `Band ${g} day rate (iRate): ${n(a.gradeRateOverrides?.[g] ?? 0)} -> ${n(b.gradeRateOverrides?.[g] ?? 0)}`);
    }
  }

  // ---- Quote lines (margin belongs to Working) ----
  const qa = byId(a.quoteLines);
  const qb = byId(b.quoteLines);
  for (const [id, x] of qb) {
    const o = qa.get(id);
    if (!o) {
      push('Basic Info', 'Quote line added', `Quote Line ${id}: ${x.solutionOffering} (${x.projectType}), margin ${p(x.marginPct)}`);
      continue;
    }
    if (o.solutionOffering !== x.solutionOffering) push('Basic Info', 'Field modified', `Quote Line ${id} Solution Offering: ${q(o.solutionOffering)} -> ${q(x.solutionOffering)}`);
    if (o.projectType !== x.projectType) push('Basic Info', 'Field modified', `Quote Line ${id} Project Type: ${q(o.projectType)} -> ${q(x.projectType)}`);
    if (o.remarks !== x.remarks) push('Basic Info', 'Field modified', `Quote Line ${id} Remarks: ${q(o.remarks)} -> ${q(x.remarks)}`);
    if (o.marginPct !== x.marginPct) push('Working', 'Field modified', `Quote Line ${id} margin: ${p(o.marginPct)} -> ${p(x.marginPct)}`);
    if (
      o.provenance.kind !== 'human' && x.provenance.kind === 'human' &&
      o.solutionOffering === x.solutionOffering && o.projectType === x.projectType && o.remarks === x.remarks
    ) {
      push('Basic Info', 'Quote line confirmed', `Quote Line ${id}: ${x.solutionOffering}`);
    }
  }
  for (const [id, o] of qa) {
    if (!qb.has(id)) push('Basic Info', 'Quote line deleted', `Quote Line ${id}: ${o.solutionOffering} (${o.projectType}), including its product and labour lines`);
  }

  if (a.summaryRemarks !== b.summaryRemarks) {
    push('Summary', 'Field modified', `Remarks: ${q(a.summaryRemarks || '(empty)')} -> ${q(b.summaryRemarks || '(empty)')}`);
  }
  if (a.billingFrequency !== b.billingFrequency) {
    push('Basic Info', 'Field modified', `Billing frequency: ${a.billingFrequency} -> ${b.billingFrequency} (TCV re-divided evenly)`);
  }

  // ---- Billing plan ----
  const ba = byId(a.billing);
  const bb = byId(b.billing);
  for (const [id, x] of bb) {
    const o = ba.get(id);
    if (!o) {
      push('Basic Info', 'Billing line added', `${q(x.schedule)} on ${x.date}, ${cur}${n(x.amount)}`);
      continue;
    }
    if (o.date !== x.date) push('Basic Info', 'Field modified', `Billing ${q(x.schedule)} date: ${o.date} -> ${x.date}`);
    if (o.schedule !== x.schedule) push('Basic Info', 'Field modified', `Billing schedule: ${q(o.schedule)} -> ${q(x.schedule)}`);
    if (o.amount !== x.amount) push('Basic Info', 'Field modified', `Billing ${q(x.schedule)} amount: ${cur}${n(o.amount)} -> ${cur}${n(x.amount)}`);
  }
  for (const [id, o] of ba) {
    if (!bb.has(id)) push('Basic Info', 'Billing line deleted', `${q(o.schedule)} on ${o.date}, ${cur}${n(o.amount)}`);
  }

  // ---- Product Plan ----
  const pa = byId(a.productItems);
  const pb = byId(b.productItems);
  for (const [id, x] of pb) {
    const o = pa.get(id);
    if (!o) {
      push('Product Plan', 'Line item added', `${q(x.description)} (${x.category}, QL${x.quoteLine}, vendor ${q(x.vendor)}): unit cost ${lineCur(x)}${n(x.unitCost)}, qty [${x.qtyByFY.join(', ')}]`);
      continue;
    }
    const f: string[] = [];
    if (o.description !== x.description) f.push(`description ${q(o.description)} -> ${q(x.description)}`);
    if (o.vendor !== x.vendor) f.push(`vendor ${q(o.vendor)} -> ${q(x.vendor)}`);
    if (o.category !== x.category) f.push(`category ${q(o.category)} -> ${q(x.category)}`);
    if (o.quoteLine !== x.quoteLine) f.push(`quote line QL${o.quoteLine} -> QL${x.quoteLine}`);
    if (o.unitCost !== x.unitCost) f.push(`unit cost ${lineCur(o)}${n(o.unitCost)} -> ${lineCur(x)}${n(x.unitCost)}`);
    if ((o.currency ?? b.basicInfo.currency) !== (x.currency ?? b.basicInfo.currency)) f.push(`currency ${o.currency ?? b.basicInfo.currency} -> ${x.currency ?? b.basicInfo.currency}`);
    if (o.vendorCommitment !== x.vendorCommitment) f.push(`vendor commitment ${o.vendorCommitment ? 'Yes' : 'No'} -> ${x.vendorCommitment ? 'Yes' : 'No'}`);
    x.qtyByFY.forEach((v, i) => { if ((o.qtyByFY[i] ?? 0) !== v) f.push(`FY${i + 1} qty ${n(o.qtyByFY[i] ?? 0)} -> ${n(v)}`); });
    if (f.length) {
      push('Product Plan', 'Line item modified', `${q(x.description)}: ${f.join('; ')}`);
    } else if (o.provenance.kind !== 'human' && x.provenance.kind === 'human') {
      push('Product Plan', 'Line item confirmed', q(x.description));
    }
  }
  for (const [id, o] of pa) {
    if (!pb.has(id)) push('Product Plan', 'Line item deleted', `${q(o.description)} (${o.category}, QL${o.quoteLine}, total ${lineCur(o)}${n(o.unitCost * o.qtyByFY.reduce((s, v) => s + v, 0))})`);
  }

  // ---- Resource Plan ----
  const ra = byId(a.resourceItems);
  const rb = byId(b.resourceItems);
  for (const [id, x] of rb) {
    const o = ra.get(id);
    if (!o) {
      push('Resource Plan', 'Line item added', `${q(x.role)} (${x.team}, grade ${x.grade}, QL${x.quoteLine}): day rate S$${n(x.dayRate)}, man-days [${x.mandaysByFY.join(', ')}]`);
      continue;
    }
    const f: string[] = [];
    if (o.role !== x.role) f.push(`role ${q(o.role)} -> ${q(x.role)}`);
    if (o.team !== x.team) f.push(`team ${q(o.team)} -> ${q(x.team)}`);
    if (o.grade !== x.grade) f.push(`grade ${q(o.grade)} -> ${q(x.grade)}`);
    if (o.quoteLine !== x.quoteLine) f.push(`quote line QL${o.quoteLine} -> QL${x.quoteLine}`);
    if (o.dayRate !== x.dayRate) f.push(`day rate S$${n(o.dayRate)} -> S$${n(x.dayRate)}`);
    if (o.remarks !== x.remarks) f.push(`client role title ${q(o.remarks)} -> ${q(x.remarks)}`);
    if ((o.mspoRole ?? '') !== (x.mspoRole ?? '')) f.push(`MSPO role ${q(o.mspoRole ?? '')} -> ${q(x.mspoRole ?? '')}`);
    x.mandaysByFY.forEach((v, i) => { if ((o.mandaysByFY[i] ?? 0) !== v) f.push(`FY${i + 1} man-days ${o.mandaysByFY[i] ?? 0} -> ${v}`); });
    if (f.length) {
      push('Resource Plan', 'Line item modified', `${q(x.role)}: ${f.join('; ')}`);
    } else if (o.provenance.kind !== 'human' && x.provenance.kind === 'human') {
      push('Resource Plan', 'Line item confirmed', q(x.role));
    }
  }
  for (const [id, o] of ra) {
    if (!rb.has(id)) push('Resource Plan', 'Line item deleted', `${q(o.role)} (${o.team}, QL${o.quoteLine}, total at rate card S$${n(o.dayRate * o.mandaysByFY.reduce((s, v) => s + v, 0))})`);
  }

  // ---- Labour Inputs monthly grid ----
  for (const id of new Set([...Object.keys(a.labourMonthly), ...Object.keys(b.labourMonthly)])) {
    if (JSON.stringify(a.labourMonthly[id]) !== JSON.stringify(b.labourMonthly[id])) {
      const item = b.resourceItems.find((r) => r.id === id) ?? a.resourceItems.find((r) => r.id === id);
      push('Labour Inputs', 'Monthly distribution modified', `Man-day spread edited for ${q(item?.role ?? id)}; Resource Plan FY totals resynced`);
    }
  }

  // ---- Summary applied rates + other indirects ----
  for (const kind of ['contingency', 'inflation'] as const) {
    for (const cat of Object.keys(b.appliedRates[kind])) {
      const av = a.appliedRates[kind][cat as keyof typeof b.appliedRates.contingency] ?? [];
      const bv = b.appliedRates[kind][cat as keyof typeof b.appliedRates.contingency] ?? [];
      bv.forEach((v, i) => {
        if ((av[i] ?? v) !== v) push('Summary', 'Applied % modified', `${kind === 'contingency' ? 'Contingency' : 'Inflation'} - ${cat} (QL${b.quoteLines[i]?.id ?? i + 1}): ${p(av[i] ?? 0)} -> ${p(v)}`);
      });
    }
  }
  const prcLabels: ['prcHwSw' | 'prcOps' | 'prcStamp', string][] = [
    ['prcHwSw', 'PRC Tax on Hardware & Software'],
    ['prcOps', 'PRC Tax on Operation, External Service & Internal Labour'],
    ['prcStamp', 'PRC Stamp Duty'],
  ];
  for (const [k, label] of prcLabels) {
    b.appliedRates[k].forEach((v, i) => {
      if ((a.appliedRates[k][i] ?? v) !== v) push('Summary', 'Applied % modified', `${label} (QL${b.quoteLines[i]?.id ?? i + 1}): ${p(a.appliedRates[k][i] ?? 0)} -> ${p(v)}`);
    });
  }
  const oiLabels: ['travelExpense' | 'otherCosts' | 'vendorRebate', string][] = [
    ['travelExpense', 'Travel & Expense'], ['otherCosts', 'Other Costs'], ['vendorRebate', 'Vendor Rebate'],
  ];
  for (const [k, label] of oiLabels) {
    b.otherIndirect[k].forEach((v, i) => {
      if ((a.otherIndirect[k][i] ?? v) !== v) push('Summary', 'Field modified', `${label} (QL${b.quoteLines[i]?.id ?? i + 1}): ${cur}${n(a.otherIndirect[k][i] ?? 0)} -> ${cur}${n(v)}`);
    });
  }

  // ---- Cash Flow vendor columns ----
  const monthLabel = (i: number) => {
    const s = new Date(b.basicInfo.projectStart);
    return new Date(s.getFullYear(), s.getMonth() + i, 1).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
  };
  const va = byId(a.vendorCols);
  const vb = byId(b.vendorCols);
  for (const [id, x] of vb) {
    const o = va.get(id);
    if (!o) {
      push('Cash Flow', 'Vendor column added', `Pay-to-vendor column ${q(x.name)}`);
      continue;
    }
    if (o.name !== x.name) push('Cash Flow', 'Field modified', `Vendor column renamed ${q(o.name)} -> ${q(x.name)}`);
    const months: string[] = [];
    x.amounts.forEach((v, i) => { if ((o.amounts[i] ?? 0) !== v) months.push(`${monthLabel(i)}: ${cur}${n(o.amounts[i] ?? 0)} -> ${cur}${n(v)}`); });
    if (months.length) {
      const shown = months.slice(0, 3).join('; ') + (months.length > 3 ? ` (+${months.length - 3} more months)` : '');
      push('Cash Flow', 'Payments modified', `${q(x.name)}: ${shown}`);
    }
  }
  for (const [id, o] of va) {
    if (!vb.has(id)) push('Cash Flow', 'Vendor column deleted', `Pay-to-vendor column ${q(o.name)}`);
  }

  return out;
}

/** Human-readable list of the areas that differ between two versions. */
export function diffSummary(a: BusinessCaseState, b: BusinessCaseState): string {
  const areas: [string, (x: BusinessCaseState) => unknown][] = [
    ['Basic Info', (x) => [x.basicInfo, x.fxOverrides]],
    ['Quote Lines', (x) => x.quoteLines],
    ['Billing Plan', (x) => x.billing],
    ['Product Plan', (x) => x.productItems],
    ['Resource Plan', (x) => [x.resourceItems, x.labourMonthly]],
    ['Summary rates', (x) => [x.appliedRates, x.otherIndirect]],
    ['Cash Flow', (x) => x.vendorCols],
  ];
  const changed = areas
    .filter(([, get]) => JSON.stringify(get(a)) !== JSON.stringify(get(b)))
    .map(([name]) => name);
  return changed.length ? changed.join(', ') : 'No changes';
}
