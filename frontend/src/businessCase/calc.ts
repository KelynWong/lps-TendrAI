// Calculation engine mirroring the workbook formulas (all in the quote currency):
//  - Product Plan: cost = qty x unit cost per FY; inflation = cost x ((1+r)^(fyYear-baseFY) - 1),
//    zero when Vendor Commitment = Yes
//  - Resource Plan: cost = man-days x day rate
//  - Summary: Direct Cost by category, Contingency / Inflation at the APPLIED %
//    typed per quote line (bc.appliedRates), PRC taxes for CNY quotes,
//    Other Indirect, Total Cost, Gross Profit, EBITDA
//  - Cash Flow: monthly vendor payments (named vendor columns) / labour /
//    repayments, compound interest on negative positions, ending balance,
//    mismatch amount
//  - Final Check!: cross-tab consistency checks

import type {
  AppliedRates,
  BusinessCaseState,
  Category,
  ProductItem,
  ResourceItem,
  SummaryCategory,
  VendorColumn,
} from './model';
import { FY_COUNT } from './model';
import { ALL_CATEGORIES, PRODUCT_CATEGORIES } from './model';
import { CURRENCIES } from './parameters';

// Applied % defaults from the template
export const CONTINGENCY_PCT = 0.04; // 4.00% all categories
export const INFLATION_PCT_LABOUR = 0.04; // 4.00% internal labour
export const INFLATION_PCT_PRODUCT = 0.02; // 2.00% product categories
export const PRC_HWSW_PCT = 0.0156; // PRC tax on Hardware & Software
export const PRC_OPS_PCT = 0.0072; // PRC tax on Operation / External Service / Internal Labour
export const PRC_STAMP_PCT = 0.0005; // PRC stamp duty
export const FINANCE_RATE_PA = 0.055; // interest on negative cash position
export const MANDAY_PER_MONTH = 18.5; // Labour Inputs reference

export function fyLabel(baseFY: number, i: number): string {
  const y = (baseFY + i) % 100;
  return `${y}/${y + 1}`;
}

export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Default applied-rate grid for n quote lines */
export function defaultAppliedRates(n: number): AppliedRates {
  const per = (v: number) => new Array(n).fill(v);
  const cat = (labour: number, product: number) =>
    Object.fromEntries(
      ALL_CATEGORIES.map((c) => [c, per(c === 'Internal Labour' ? labour : product)]),
    ) as Record<SummaryCategory, number[]>;
  return {
    contingency: cat(CONTINGENCY_PCT, CONTINGENCY_PCT),
    inflation: cat(INFLATION_PCT_LABOUR, INFLATION_PCT_PRODUCT),
    prcHwSw: per(PRC_HWSW_PCT),
    prcOps: per(PRC_OPS_PCT),
    prcStamp: per(PRC_STAMP_PCT),
  };
}

const rateAt = (arr: number[] | undefined, i: number, fallback: number) =>
  arr && arr[i] !== undefined ? arr[i] : fallback;

export function qlIndexOf(bc: BusinessCaseState, qlId: number): number {
  const i = bc.quoteLines.findIndex((q) => q.id === qlId);
  return i < 0 ? 0 : i;
}

// ---- Exchange rates ----------------------------------------------------------
// Every figure is calculated in the quote currency (Basic Info). A product line
// may be priced in its vendor's currency; day rates come from the SGD rate
// card. Both convert at the Basic Info exchange rates: the applied rate where
// BD has set one, otherwise the planning rate (both "to 1 USD").

export const RATE_CARD_CURRENCY = 'SGD';

/** Applied rate (units per 1 USD) for a currency. */
export function fxRate(bc: BusinessCaseState, code: string): number {
  return bc.fxOverrides[code] ?? CURRENCIES.find(([c]) => c === code)?.[2] ?? 1;
}
/** Multiplier from `from` into the quote currency. */
export function toQuote(bc: BusinessCaseState, from: string): number {
  const to = bc.basicInfo.currency;
  return from === to ? 1 : fxRate(bc, to) / fxRate(bc, from);
}
/** Switches the quote currency. Amounts keyed in the quote currency (billing
 *  lines, Cash Flow vendor payments, other indirect costs) convert at the
 *  exchange rates; product lines keep the currency their vendor priced them in
 *  and day rates stay on the SGD rate card, so both simply re-convert. */
export function withQuoteCurrency(bc: BusinessCaseState, next: string): BusinessCaseState {
  const prev = bc.basicInfo.currency;
  if (prev === next) return bc;
  const f = fxRate(bc, next) / fxRate(bc, prev);
  const conv = (a: number[]) => a.map((v) => v * f);
  const converted: BusinessCaseState = {
    ...bc,
    basicInfo: { ...bc.basicInfo, currency: next },
    productItems: bc.productItems.map((p) => ({ ...p, currency: p.currency ?? prev })),
    billing: bc.billing.map((b) => ({ ...b, amount: b.amount * f })),
    vendorCols: bc.vendorCols.map((c) => ({ ...c, amounts: conv(c.amounts) })),
    otherIndirect: {
      travelExpense: conv(bc.otherIndirect.travelExpense),
      otherCosts: conv(bc.otherIndirect.otherCosts),
      vendorRebate: conv(bc.otherIndirect.vendorRebate),
    },
  };
  // a billing plan that equalled the TCV keeps equalling it: the TCV is whole
  // currency units per category, so plain conversion would leave a few units
  // over or short. Lines keep their shares; the last one absorbs the remainder.
  const billed = sum(bc.billing.map((b) => b.amount));
  if (!bc.billing.length || Math.abs(billed - computeSummary(bc).total.tcv) >= 1) return converted;
  const tcv = computeSummary(converted).total.tcv;
  let allocated = 0;
  converted.billing = bc.billing.map((b, i) => {
    const amount = i === bc.billing.length - 1 ? tcv - allocated : Math.round((b.amount / billed) * tcv);
    allocated += amount;
    return { ...b, amount };
  });
  return converted;
}

/** The currency a product line is priced in. */
export const lineCurrency = (bc: BusinessCaseState, it: ProductItem) => it.currency ?? bc.basicInfo.currency;
/** A product line's unit cost in the quote currency. */
export const unitCostQuote = (it: ProductItem, bc: BusinessCaseState) => it.unitCost * toQuote(bc, lineCurrency(bc, it));
/** A labour line's day rate in the quote currency. */
export const dayRateQuote = (it: ResourceItem, bc: BusinessCaseState) => it.dayRate * toQuote(bc, RATE_CARD_CURRENCY);

export function productItemCost(it: ProductItem, bc: BusinessCaseState): number[] {
  const unit = unitCostQuote(it, bc);
  return it.qtyByFY.map((q) => q * unit);
}
export function productItemTotal(it: ProductItem, bc: BusinessCaseState): number {
  return sum(productItemCost(it, bc));
}
/** Applied inflation % for a product line: Summary's rate for its category and
 *  quote line, forced to 0 when Vendor Commitment = Yes. */
export function productInflationRate(it: ProductItem, bc: BusinessCaseState): number {
  if (it.vendorCommitment) return 0;
  return rateAt(bc.appliedRates?.inflation?.[it.category], qlIndexOf(bc, it.quoteLine), INFLATION_PCT_PRODUCT);
}
/** Inflation: cost_fy * ((1+r)^fyOffset - 1)  (offset 0 for base FY) */
export function productItemInflation(it: ProductItem, bc: BusinessCaseState): number {
  const r = productInflationRate(it, bc);
  return sum(productItemCost(it, bc).map((c, i) => Math.max(c * (Math.pow(1 + r, i) - 1), 0)));
}

export function resourceItemCost(it: ResourceItem, bc: BusinessCaseState): number[] {
  const rate = dayRateQuote(it, bc);
  return it.mandaysByFY.map((d) => d * rate);
}
export function resourceItemTotal(it: ResourceItem, bc: BusinessCaseState): number {
  return sum(resourceItemCost(it, bc));
}
export function resourceItemInflation(it: ResourceItem, bc: BusinessCaseState): number {
  const r = rateAt(
    bc.appliedRates?.inflation?.['Internal Labour'],
    qlIndexOf(bc, it.quoteLine),
    INFLATION_PCT_LABOUR,
  );
  return sum(resourceItemCost(it, bc).map((c, i) => Math.max(c * (Math.pow(1 + r, i) - 1), 0)));
}

export interface QuoteLineSummary {
  quoteLine: number;
  tcvByCat: Record<SummaryCategory, number>;
  tcv: number;
  directByCat: Record<SummaryCategory, number>;
  directTotal: number;
  grossProfit: number;
  grossMarginPct: number;
  contingencyByCat: Record<SummaryCategory, number>;
  contingencyTotal: number;
  inflationByCat: Record<SummaryCategory, number>;
  inflationTotal: number;
  financeCost: number;
  prcHwSw: number;
  prcOps: number;
  prcStamp: number;
  travelExpense: number;
  otherCosts: number;
  vendorRebate: number;
  otherIndirectTotal: number;
  indirectTotal: number;
  totalCost: number;
  ebitda: number;
  ebitdaPct: number;
}

export interface BcSummary {
  perLine: QuoteLineSummary[];
  total: QuoteLineSummary;
  months: CashFlowMonth[];
  financeCostTotal: number;
  billingTotal: number;
  durationMonths: number;
}

export interface CashFlowMonth {
  label: string; // "Apr-2026"
  iso: string; // first of month
  yearIdx: number; // project year, 1-based (derived)
  opening: number;
  vendorPay: number; // total across vendor columns
  labourPay: number;
  repayment: number; // billing receipts (inflow, positive)
  financeCost: number; // compound interest charged this month
  ending: number; // ending balance after interest (carried to next opening)
  mismatch: number; // funding gap this month (positive when short)
}

const emptyCatRecord = (): Record<SummaryCategory, number> =>
  Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<SummaryCategory, number>;

export function monthsBetween(startIso: string, endIso: string): number {
  const s = new Date(startIso);
  const e = new Date(endIso);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
}

export function computeSummary(bc: BusinessCaseState): BcSummary {
  const duration = Math.max(monthsBetween(bc.basicInfo.projectStart, bc.basicInfo.projectEnd), 1);
  const isCNY = bc.basicInfo.currency === 'CNY';

  const perLine: QuoteLineSummary[] = bc.quoteLines.map((ql, qlIdx) => {
    const direct = emptyCatRecord();
    const inflation = emptyCatRecord();
    for (const it of bc.productItems.filter((p) => p.quoteLine === ql.id)) {
      direct[it.category] += productItemTotal(it, bc);
      inflation[it.category] += productItemInflation(it, bc);
    }
    for (const it of bc.resourceItems.filter((r) => r.quoteLine === ql.id)) {
      direct['Internal Labour'] += resourceItemTotal(it, bc);
      inflation['Internal Labour'] += resourceItemInflation(it, bc);
    }
    const directTotal = sum(Object.values(direct));

    // TCV per category = direct cost marked up by the quote line margin (Working tab logic)
    const tcvByCat = emptyCatRecord();
    for (const c of ALL_CATEGORIES) tcvByCat[c] = Math.round(direct[c] * (1 + ql.marginPct));
    const tcv = sum(Object.values(tcvByCat));

    const contingency = emptyCatRecord();
    for (const c of ALL_CATEGORIES) {
      contingency[c] = direct[c] * rateAt(bc.appliedRates?.contingency?.[c], qlIdx, CONTINGENCY_PCT);
    }
    const contingencyTotal = sum(Object.values(contingency));
    const inflationTotal = sum(Object.values(inflation));

    // PRC taxes apply only when the quote currency is CNY (template Summary rows 41-43)
    const prcHwSw = isCNY
      ? (direct['Hardware'] + direct['Software']) * rateAt(bc.appliedRates?.prcHwSw, qlIdx, PRC_HWSW_PCT)
      : 0;
    const prcOps = isCNY
      ? (direct['Internal Labour'] + direct['External Service'] + direct['Telephony Resource'] + direct['Project Real Estate']) *
        rateAt(bc.appliedRates?.prcOps, qlIdx, PRC_OPS_PCT)
      : 0;
    const prcStamp = isCNY
      ? directTotal * rateAt(bc.appliedRates?.prcStamp, qlIdx, PRC_STAMP_PCT)
      : 0;

    const travelExpense = bc.otherIndirect.travelExpense[qlIdx] ?? 0;
    const otherCosts = bc.otherIndirect.otherCosts[qlIdx] ?? 0;
    const vendorRebate = bc.otherIndirect.vendorRebate[qlIdx] ?? 0;

    return {
      quoteLine: ql.id,
      tcvByCat,
      tcv,
      directByCat: direct,
      directTotal,
      grossProfit: tcv - directTotal,
      grossMarginPct: tcv ? (tcv - directTotal) / tcv : 0,
      contingencyByCat: contingency,
      contingencyTotal,
      inflationByCat: inflation,
      inflationTotal,
      financeCost: 0, // allocated below after cash flow
      prcHwSw,
      prcOps,
      prcStamp,
      travelExpense,
      otherCosts,
      vendorRebate,
      otherIndirectTotal: 0,
      indirectTotal: 0,
      totalCost: 0,
      ebitda: 0,
      ebitdaPct: 0,
    };
  });

  const months = computeCashFlow(bc, duration);
  // An explicit Finance Cost % (Summary total column) overrides the compound
  // interest computed from the Cash Flow.
  const financeCostTotal =
    bc.financeOverridePct != null
      ? bc.financeOverridePct * sum(perLine.map((l) => l.tcv))
      : sum(months.map((m) => m.financeCost));
  const grandDirect = sum(perLine.map((l) => l.directTotal));

  for (const l of perLine) {
    // Finance cost allocated by direct-cost proportion
    l.financeCost = grandDirect ? (financeCostTotal * l.directTotal) / grandDirect : 0;
    l.otherIndirectTotal =
      l.financeCost + l.prcHwSw + l.prcOps + l.prcStamp + l.travelExpense + l.otherCosts - l.vendorRebate;
    l.indirectTotal = l.contingencyTotal + l.inflationTotal + l.otherIndirectTotal;
    l.totalCost = l.directTotal + l.indirectTotal;
    l.ebitda = l.tcv - l.totalCost;
    l.ebitdaPct = l.tcv ? l.ebitda / l.tcv : 0;
  }

  const total: QuoteLineSummary = {
    quoteLine: 0,
    tcvByCat: emptyCatRecord(),
    tcv: sum(perLine.map((l) => l.tcv)),
    directByCat: emptyCatRecord(),
    directTotal: grandDirect,
    grossProfit: sum(perLine.map((l) => l.grossProfit)),
    grossMarginPct: 0,
    contingencyByCat: emptyCatRecord(),
    contingencyTotal: sum(perLine.map((l) => l.contingencyTotal)),
    inflationByCat: emptyCatRecord(),
    inflationTotal: sum(perLine.map((l) => l.inflationTotal)),
    financeCost: financeCostTotal,
    prcHwSw: sum(perLine.map((l) => l.prcHwSw)),
    prcOps: sum(perLine.map((l) => l.prcOps)),
    prcStamp: sum(perLine.map((l) => l.prcStamp)),
    travelExpense: sum(perLine.map((l) => l.travelExpense)),
    otherCosts: sum(perLine.map((l) => l.otherCosts)),
    vendorRebate: sum(perLine.map((l) => l.vendorRebate)),
    otherIndirectTotal: sum(perLine.map((l) => l.otherIndirectTotal)),
    indirectTotal: sum(perLine.map((l) => l.indirectTotal)),
    totalCost: sum(perLine.map((l) => l.totalCost)),
    ebitda: sum(perLine.map((l) => l.ebitda)),
    ebitdaPct: 0,
  };
  for (const c of ALL_CATEGORIES) {
    total.tcvByCat[c] = sum(perLine.map((l) => l.tcvByCat[c]));
    total.directByCat[c] = sum(perLine.map((l) => l.directByCat[c]));
    total.contingencyByCat[c] = sum(perLine.map((l) => l.contingencyByCat[c]));
    total.inflationByCat[c] = sum(perLine.map((l) => l.inflationByCat[c]));
  }
  total.grossMarginPct = total.tcv ? total.grossProfit / total.tcv : 0;
  total.ebitdaPct = total.tcv ? total.ebitda / total.tcv : 0;

  return {
    perLine,
    total,
    months,
    financeCostTotal,
    billingTotal: sum(bc.billing.map((b) => b.amount)),
    durationMonths: duration,
  };
}

/**
 * Monthly man-day distribution for one labour line (the Labour Inputs grid):
 * a manual distribution if one was keyed in, otherwise each FY's man-days
 * spread evenly across that FY's months.
 */
export function monthlyMandaysFor(
  bc: BusinessCaseState,
  it: ResourceItem,
  duration: number,
): number[] {
  const manual = bc.labourMonthly[it.id];
  if (manual) {
    const out = new Array<number>(duration).fill(0);
    for (let m = 0; m < Math.min(manual.length, duration); m++) out[m] = manual[m] ?? 0;
    return out;
  }
  const out = new Array<number>(duration).fill(0);
  it.mandaysByFY.forEach((md, fy) => {
    const s = fy * 12;
    const e = Math.min(s + 12, duration);
    if (e <= s || !md) return;
    for (let m = s; m < e; m++) out[m] = md / (e - s);
  });
  return out;
}

/**
 * Default vendor-payment columns: the Product Plan allocation grouped by vendor
 * (one-off hardware paid on delivery, recurring items spread across each FY).
 * Used to seed bc.vendorCols; BD then edits/adds columns manually.
 */
export function defaultVendorColumns(bc: BusinessCaseState, duration: number): VendorColumn[] {
  const byVendor = new Map<string, number[]>();
  const monthsPerFY = 12;
  for (const it of bc.productItems) {
    const name = it.vendor || 'Unassigned vendor';
    if (!byVendor.has(name)) byVendor.set(name, new Array<number>(duration).fill(0));
    const arr = byVendor.get(name)!;
    const costs = productItemCost(it, bc);
    const oneOff = it.qtyByFY.filter((q) => q > 0).length === 1 && it.category === 'Hardware';
    costs.forEach((c, fy) => {
      if (!c) return;
      const s = fy * monthsPerFY;
      const e = Math.min(s + monthsPerFY, duration);
      if (e <= s) return;
      if (oneOff) arr[Math.min(s + 2, duration - 1)] += c;
      else for (let m = s; m < e; m++) arr[m] += c / (e - s);
    });
  }
  let i = 0;
  // whole-dollar months that still add up to the vendor's total: round the
  // running total, not each month (rounding each month drifts from the Product Plan)
  const wholeMonths = (amounts: number[]) => {
    let cum = 0;
    return amounts.map((v) => {
      const before = Math.round(cum);
      cum += v;
      return Math.round(cum) - before;
    });
  };
  return [...byVendor.entries()].map(([name, amounts]) => ({
    id: `v${i++}`,
    name,
    amounts: wholeMonths(amounts),
  }));
}

/**
 * Cash flow:
 *  - Vendor payments come from the named vendor columns (BD-editable).
 *  - Internal labour follows the Labour Inputs monthly grid x day rates.
 *  - Repayment: billing milestones land in their calendar month.
 *  - Interest compounds: a negative balance is charged monthly interest which
 *    reduces the ending balance carried into the next month.
 */
export function computeCashFlow(bc: BusinessCaseState, duration: number): CashFlowMonth[] {
  const start = new Date(bc.basicInfo.projectStart);
  const vendor = new Array<number>(duration).fill(0);
  const labour = new Array<number>(duration).fill(0);
  const repay = new Array<number>(duration).fill(0);

  const cols = bc.vendorCols?.length ? bc.vendorCols : defaultVendorColumns(bc, duration);
  for (const col of cols) {
    for (let m = 0; m < duration; m++) vendor[m] += col.amounts[m] ?? 0;
  }
  for (const it of bc.resourceItems) {
    const md = monthlyMandaysFor(bc, it, duration);
    const rate = dayRateQuote(it, bc);
    for (let m = 0; m < duration; m++) labour[m] += md[m] * rate;
  }
  for (const b of bc.billing) {
    const d = new Date(b.date);
    const idx = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    repay[Math.min(Math.max(idx, 0), duration - 1)] += b.amount;
  }

  const out: CashFlowMonth[] = [];
  let balance = 0;
  for (let m = 0; m < duration; m++) {
    const d = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const opening = balance;
    const raw = opening - vendor[m] - labour[m] + repay[m];
    const financeCost = raw < 0 ? (-raw * FINANCE_RATE_PA) / 12 : 0;
    const ending = raw - financeCost;
    balance = ending;
    out.push({
      label: d.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }),
      iso: d.toISOString().slice(0, 10),
      yearIdx: Math.floor(m / 12) + 1,
      opening,
      vendorPay: vendor[m],
      labourPay: labour[m],
      repayment: repay[m],
      financeCost,
      ending,
      mismatch: raw < 0 ? -raw : 0,
    });
  }
  return out;
}

/** Regroup a monthly man-day distribution into FY totals (keeps Resource Plan in sync). */
export function monthsToFY(months: number[]): number[] {
  const out = new Array<number>(FY_COUNT).fill(0);
  months.forEach((v, m) => {
    out[Math.min(Math.floor(m / 12), FY_COUNT - 1)] += v;
  });
  return out.map((v) => Math.round(v * 10) / 10);
}

// ---- Final Check! ----------------------------------------------------------

export interface CheckResult {
  tab: string;
  check: string;
  ok: boolean;
  detail: string;
}

export function finalChecks(bc: BusinessCaseState, s: BcSummary): CheckResult[] {
  const productTotal = sum(bc.productItems.map((p) => productItemTotal(p, bc)));
  const resourceTotal = sum(bc.resourceItems.map((r) => resourceItemTotal(r, bc)));
  const productCatTotal = sum(
    PRODUCT_CATEGORIES.map((c: Category) => s.total.directByCat[c]),
  );
  const cfVendor = sum(s.months.map((m) => m.vendorPay));
  const cfLabour = sum(s.months.map((m) => m.labourPay));
  const cfRepay = sum(s.months.map((m) => m.repayment));
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const mismatchMonths = s.months.filter((m) => m.mismatch > 0).length;

  return [
    {
      tab: 'Basic Info',
      check: 'Total Billing Amount should be equal to TCV (before tax)',
      ok: near(s.billingTotal, s.total.tcv),
      detail: `Billing ${Math.round(s.billingTotal).toLocaleString()} vs TCV ${Math.round(s.total.tcv).toLocaleString()}`,
    },
    {
      tab: 'Product Plan',
      check: 'Total cost in Product Plan should equal the total cost in Summary',
      ok: near(productTotal, productCatTotal),
      detail: `${Math.round(productTotal).toLocaleString()} vs ${Math.round(productCatTotal).toLocaleString()}`,
    },
    {
      tab: 'Resource Plan',
      check: 'Total cost in Resource Plan should equal the total cost in Summary',
      ok: near(resourceTotal, s.total.directByCat['Internal Labour']),
      detail: `${Math.round(resourceTotal).toLocaleString()} vs ${Math.round(s.total.directByCat['Internal Labour']).toLocaleString()}`,
    },
    {
      tab: 'Resource Plan',
      check: 'Each line: team selected and iRate resolvable for team + grade',
      ok: bc.resourceItems.every((r) => r.dayRate > 0 && r.teamCode !== 'N/A'),
      detail: bc.resourceItems.every((r) => r.dayRate > 0) ? 'All iRates resolved' : 'Missing iRate',
    },
    {
      tab: 'Cash Flow',
      check: 'Total payment to vendors should equal the total cost in Product Plan',
      ok: near(cfVendor, productTotal),
      detail: `${Math.round(cfVendor).toLocaleString()} vs ${Math.round(productTotal).toLocaleString()}`,
    },
    {
      tab: 'Cash Flow',
      check: 'Total internal labour should equal the total cost in Resource Plan',
      ok: near(cfLabour, resourceTotal),
      detail: `${Math.round(cfLabour).toLocaleString()} vs ${Math.round(resourceTotal).toLocaleString()}`,
    },
    {
      tab: 'Cash Flow',
      check: 'Total repayment should equal Total Billing Amount',
      ok: near(cfRepay, s.billingTotal),
      detail: `${Math.round(cfRepay).toLocaleString()} vs ${Math.round(s.billingTotal).toLocaleString()}`,
    },
    {
      tab: 'Cash Flow',
      check: 'Is this Quote with any cash flow mismatch?',
      ok: mismatchMonths === 0,
      detail: mismatchMonths ? `${mismatchMonths} month(s) with a mismatch amount - interest charged` : 'No mismatch months',
    },
  ];
}
