// Final Check rules as DATA, managed on the "Business case management" page.
// Failed checks WARN and never block: the UI shows results, banners and a
// warning on MSPO download, but every action stays available.
//
// A rule reads business case fields in the web app (the app is the source of
// truth, not workbook cells), e.g. Summary > TCV or Basic Info > Billing amounts:
//  - compare:    one field must equal another (line fields are summed)
//  - range:      one field must sit between a min and a max
//  - every-line: every line of a line field must meet a condition
//  - builtin:    fixed logic that can't be expressed as field comparisons
// The tabs a rule involves are inferred from its fields.

import type { BcVersionData } from '../types';

export interface RuleResult {
  ok: boolean;
  expected: string;
  actual: string;
  /** the rule reads a field the app does not know - not evaluated */
  skipped?: boolean;
}

type Fmt = 'money' | 'pct' | 'number';

export interface CheckField {
  /** same keys as the MSPO mapping's BC_FIELDS where both use a field */
  key: string;
  tab: string;
  /** shown in the rules, e.g. "Summary > TCV" */
  label: string;
  fmt: Fmt;
  /** one value per line (Product Plan, Resource Plan or billing lines) */
  lines: boolean;
  get: (d: BcVersionData) => number | number[];
}

/** Business case fields the rules can read. Line fields return one value per line. */
export const CHECK_FIELDS: CheckField[] = [
  { key: 'summary.tcv', tab: 'Summary', label: 'Summary > TCV', fmt: 'money', lines: false, get: (d) => d.header.tcv },
  { key: 'summary.productCost', tab: 'Summary', label: 'Summary > Product cost', fmt: 'money', lines: false, get: (d) => d.header.productTotal },
  { key: 'summary.labourCost', tab: 'Summary', label: 'Summary > Internal labour cost', fmt: 'money', lines: false, get: (d) => d.header.labourTotal },
  { key: 'summary.marginPct', tab: 'Summary', label: 'Summary > Gross margin %', fmt: 'pct', lines: false, get: (d) => d.header.marginPct },
  { key: 'basic.durationMonths', tab: 'Basic Info', label: 'Basic Info > Project duration (months)', fmt: 'number', lines: false, get: (d) => d.header.durationMonths },
  { key: 'billing.amount', tab: 'Basic Info', label: 'Basic Info > Billing amounts', fmt: 'money', lines: true, get: (d) => d.billing.map((b) => b.amount) },
  { key: 'product.quoteLine', tab: 'Product Plan', label: 'Product Plan > Quote line no.', fmt: 'number', lines: true, get: (d) => d.products.map((p) => p.ql) },
  { key: 'product.unitCost', tab: 'Product Plan', label: 'Product Plan > Unit cost', fmt: 'money', lines: true, get: (d) => d.products.map((p) => p.unitCost) },
  { key: 'product.quantity', tab: 'Product Plan', label: 'Product Plan > Quantity (first fiscal year)', fmt: 'number', lines: true, get: (d) => d.products.map((p) => p.qty) },
  { key: 'product.total', tab: 'Product Plan', label: 'Product Plan > Line totals', fmt: 'money', lines: true, get: (d) => d.products.map((p) => p.total) },
  { key: 'resource.quoteLine', tab: 'Resource Plan', label: 'Resource Plan > Quote line no.', fmt: 'number', lines: true, get: (d) => d.resources.map((r) => r.ql) },
  { key: 'resource.mandays', tab: 'Resource Plan', label: 'Resource Plan > Man-days', fmt: 'number', lines: true, get: (d) => d.resources.map((r) => r.mandays) },
  { key: 'resource.total', tab: 'Resource Plan', label: 'Resource Plan > Line totals', fmt: 'money', lines: true, get: (d) => d.resources.map((r) => r.total) },
  { key: 'resource.dayRate', tab: 'Labour Inputs', label: 'Labour Inputs > Day rate', fmt: 'money', lines: true, get: (d) => d.resources.map((r) => r.dayRate) },
];

export const checkField = (key?: string) => CHECK_FIELDS.find((f) => f.key === key);

export type LineOp = '>' | '>=' | '<' | '<=' | '=' | 'between';

/** Fixed-logic rules shipped with the system. */
export const BUILTINS = {
  'line-totals-consistent': 'Every line total = unit price x quantity (or man-days x day rate)',
  'billing-within-duration': 'Every billing date falls within project start + duration',
  'quote-line-assigned': 'Every product and labour line sits on quote line 1-3',
  'billing-present': 'The billing plan has at least one line',
  'cashflow-reconciles': 'Cash Flow vendor payments, internal labour and repayments equal the Product Plan, Resource Plan and billing totals',
  'cashflow-no-mismatch': 'The largest monthly cash shortfall (negative cash position, interest charged) is within the allowed % of the TCV',
} as const;
export type BuiltinKey = keyof typeof BUILTINS;

export interface RuleDef {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning';
  enabled: boolean;
  kind: 'compare' | 'range' | 'every-line' | 'builtin';
  // compare: field keys (CHECK_FIELDS)
  left?: string;
  right?: string;
  /** allowed difference, in the fields' unit */
  tolerance?: number;
  // range / every-line: a field key (CHECK_FIELDS)
  target?: string;
  min?: number;
  max?: number;
  op?: LineOp;
  /** every-line: the value to compare against; cashflow-no-mismatch: the
   *  allowed shortfall as a % of the TCV */
  value?: number;
  value2?: number;
  // builtin
  builtin?: BuiltinKey;
  /** tabs a builtin reads (other kinds infer theirs from their fields) */
  tabs?: string[];
}

/** Tabs a rule involves - drives the side-by-side "View source". */
export function ruleTabs(r: RuleDef): string[] {
  if (r.kind === 'builtin') return r.tabs ?? [];
  const keys = r.kind === 'compare' ? [r.left, r.right] : [r.target];
  return [...new Set(keys.map((k) => checkField(k)?.tab).filter((t): t is string => !!t))];
}

/** Display text for a check value; money shows in the business case's quote currency. */
const fmtMoney = (v: number, currency = 'SGD') => `${currency === 'SGD' ? 'S$' : `${currency} `}${Math.round(v).toLocaleString()}`;
const fmtVal = (fmt: Fmt, v: number, currency = 'SGD') =>
  fmt === 'money' ? fmtMoney(v, currency) : fmt === 'pct' ? `${v.toFixed(1)}%` : String(v);
const sum = (v: number | number[]) => (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v);
const opText = (op: LineOp, a?: number, b?: number) => (op === 'between' ? `between ${a} and ${b}` : `${op} ${a}`);
const testOp = (x: number, op: LineOp, a = 0, b = 0) =>
  op === '>' ? x > a : op === '>=' ? x >= a : op === '<' ? x < a : op === '<=' ? x <= a : op === '=' ? x === a : x >= a && x <= b;
export const fieldText = (key?: string) => {
  const f = checkField(key);
  return f ? `${f.label}${f.lines ? ' (total)' : ''}` : `Unknown field ${key ?? '?'}`;
};

/** Plain-language summary of what a rule checks (shown in the rules table). */
export function describeLogic(r: RuleDef): string {
  switch (r.kind) {
    case 'compare':
      return `${fieldText(r.left)} = ${fieldText(r.right)}${r.tolerance ? ` (within ${r.tolerance})` : ''}`;
    case 'range':
      return `${fieldText(r.target)} ${r.min !== undefined && r.max !== undefined ? `between ${r.min} and ${r.max}` : r.min !== undefined ? `at least ${r.min}` : `at most ${r.max}`}`;
    case 'every-line':
      return `Every line of ${checkField(r.target)?.label ?? r.target} ${opText(r.op!, r.value, r.value2)}`;
    case 'builtin':
      return r.builtin === 'cashflow-no-mismatch'
        ? `Largest monthly cash shortfall at most ${r.value ?? 0}% of Summary > TCV`
        : BUILTINS[r.builtin!];
  }
}

const notChecked = (key?: string): RuleResult => ({
  ok: true,
  skipped: true,
  expected: '-',
  actual: `Not checked - ${key ?? 'a field'} is not a business case field`,
});

function evaluate(r: RuleDef, d: BcVersionData): RuleResult {
  const tol = r.tolerance ?? 1;
  switch (r.kind) {
    case 'compare': {
      const L = checkField(r.left);
      const R = checkField(r.right);
      if (!L) return notChecked(r.left);
      if (!R) return notChecked(r.right);
      const a = sum(L.get(d));
      const b = sum(R.get(d));
      return { ok: Math.abs(a - b) <= tol, expected: fmtVal(R.fmt, b, d.header.currency), actual: fmtVal(L.fmt, a, d.header.currency) };
    }
    case 'range': {
      const T = checkField(r.target);
      if (!T) return notChecked(r.target);
      const v = sum(T.get(d));
      const ok = (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
      const expected = r.min !== undefined && r.max !== undefined ? `${fmtVal(T.fmt, r.min, d.header.currency)} - ${fmtVal(T.fmt, r.max, d.header.currency)}`
        : r.min !== undefined ? `At least ${fmtVal(T.fmt, r.min, d.header.currency)}` : `At most ${fmtVal(T.fmt, r.max!, d.header.currency)}`;
      return { ok, expected, actual: fmtVal(T.fmt, v, d.header.currency) };
    }
    case 'every-line': {
      const T = checkField(r.target);
      if (!T) return notChecked(r.target);
      const raw = T.get(d);
      const lines = Array.isArray(raw) ? raw : [raw];
      const bad = lines.filter((x) => !testOp(x, r.op!, r.value, r.value2));
      return {
        ok: bad.length === 0,
        expected: `All lines ${opText(r.op!, r.value, r.value2)}`,
        actual: bad.length ? `${bad.length} of ${lines.length} line(s) fail` : 'All lines pass',
      };
    }
    case 'builtin':
      return evaluateBuiltin(r, d, tol);
  }
}

function evaluateBuiltin(r: RuleDef, d: BcVersionData, tol: number): RuleResult {
  switch (r.builtin!) {
    case 'line-totals-consistent': {
      const bad = [
        ...d.products.filter((p) => Math.abs(p.unitCost * p.qty - p.total) > tol).map((p) => p.desc),
        ...d.resources.filter((x) => Math.abs(x.mandays * x.dayRate - x.total) > tol).map((x) => x.role),
      ];
      return { ok: bad.length === 0, expected: 'All lines consistent', actual: bad.length ? `${bad.length} inconsistent: ${bad.slice(0, 2).join(', ')}` : 'All lines consistent' };
    }
    case 'billing-within-duration': {
      const start = new Date(d.header.projectStart);
      const end = new Date(start.getFullYear(), start.getMonth() + d.header.durationMonths, 1);
      const bad = d.billing.filter((b) => new Date(b.date) < start || new Date(b.date) > end);
      return { ok: bad.length === 0, expected: `All dates within ${d.header.durationMonths} months of start`, actual: bad.length ? `${bad.length} date(s) outside the duration` : 'All within duration' };
    }
    case 'quote-line-assigned': {
      const bad = [...d.products, ...d.resources].filter((l) => l.ql < 1 || l.ql > 3);
      return { ok: bad.length === 0, expected: 'QL 1-3 on every line', actual: bad.length ? `${bad.length} line(s) outside QL 1-3` : 'All assigned' };
    }
    case 'billing-present':
      return { ok: d.billing.length > 0, expected: 'One or more billing lines', actual: `${d.billing.length} line(s)` };
    case 'cashflow-reconciles': {
      if (!d.cashFlow) return { ok: true, skipped: true, expected: '-', actual: 'Not checked - this version has no Cash Flow tab' };
      const products = d.products.reduce((a, p) => a + p.total, 0);
      const labour = d.resources.reduce((a, x) => a + x.total, 0);
      const billed = d.billing.reduce((a, b) => a + b.amount, 0);
      const bad = [
        Math.abs(d.cashFlow.vendorTotal - products) > tol ? 'vendor payments' : '',
        Math.abs(d.cashFlow.labourTotal - labour) > tol ? 'internal labour' : '',
        Math.abs(d.cashFlow.repaymentTotal - billed) > tol ? 'repayments' : '',
      ].filter(Boolean);
      return { ok: bad.length === 0, expected: 'All three totals reconcile', actual: bad.length ? `Off: ${bad.join(', ')}` : 'All three totals reconcile' };
    }
    case 'cashflow-no-mismatch': {
      if (!d.cashFlow) return { ok: true, skipped: true, expected: '-', actual: 'Not checked - this version has no Cash Flow tab' };
      const { mismatchMonths: n, peakMismatch: peak } = d.cashFlow;
      const pct = r.value ?? 0;
      const allowed = (d.header.tcv * pct) / 100;
      const share = d.header.tcv > 0 ? (peak / d.header.tcv) * 100 : 0;
      return {
        ok: peak <= allowed,
        expected: pct ? `Largest shortfall at most ${pct}% of TCV (${fmtMoney(allowed, d.header.currency)})` : 'No mismatch months',
        actual: n ? `Largest shortfall ${fmtMoney(peak, d.header.currency)} (${share.toFixed(1)}% of TCV), ${n} month(s) with a mismatch` : 'No mismatch months',
      };
    }
  }
}

/** The rule set shipped with the system (mirrors the Excel template's Final Check list). */
export const DEFAULT_RULES: RuleDef[] = [
  { id: 'billing-equals-ccb', enabled: true, kind: 'compare', left: 'billing.amount', right: 'summary.tcv', tolerance: 1, severity: 'error',
    name: 'Billing plan equals CCB', description: 'The sum of the billing plan must equal the contract value (CCB/TCV) stated on the Summary tab.' },
  { id: 'product-total-reconciles', enabled: true, kind: 'compare', left: 'product.total', right: 'summary.productCost', tolerance: 1, severity: 'error',
    name: 'Product Plan reconciles with Summary', description: 'The Product Plan line totals must add up to the product cost stated on the Summary tab.' },
  { id: 'labour-total-reconciles', enabled: true, kind: 'compare', left: 'resource.total', right: 'summary.labourCost', tolerance: 1, severity: 'error',
    name: 'Resource Plan reconciles with Summary', description: 'The Resource Plan line totals must add up to the internal labour cost stated on the Summary tab.' },
  { id: 'line-totals-consistent', enabled: true, kind: 'builtin', builtin: 'line-totals-consistent', tabs: ['Product Plan', 'Resource Plan'], tolerance: 1, severity: 'error',
    name: 'Line totals equal unit x quantity', description: 'Every Product Plan line total must equal unit price x quantity; every labour line total must equal man-days x day rate.' },
  { id: 'irate-resolvable', enabled: true, kind: 'every-line', target: 'resource.dayRate', op: '>', value: 0, severity: 'error',
    name: 'Every labour line has a day rate', description: 'Each labour line must carry a resolvable iRate (day rate above zero) for its team and grade.' },
  { id: 'quote-line-assigned', enabled: true, kind: 'builtin', builtin: 'quote-line-assigned', tabs: ['Basic Info', 'Product Plan', 'Resource Plan'], severity: 'warning',
    name: 'Every line belongs to a defined quote line', description: 'Product and labour lines must be assigned to quote line 1-3 as defined on Basic Info.' },
  { id: 'billing-within-duration', enabled: true, kind: 'builtin', builtin: 'billing-within-duration', tabs: ['Basic Info', 'Cash Flow'], severity: 'warning',
    name: 'Billing dates fall within the project duration', description: 'No billing milestone may fall outside project start plus the contract duration.' },
  { id: 'mandays-nonzero', enabled: true, kind: 'every-line', target: 'resource.mandays', op: '>', value: 0, severity: 'warning',
    name: 'No zero-effort labour lines', description: 'A labour line with zero man-days is usually a leftover row and should be removed.' },
  { id: 'margin-range', enabled: true, kind: 'range', target: 'summary.marginPct', min: 10, max: 45, severity: 'warning',
    name: 'Margin within guardrails', description: 'Stated margin should be between 10% and 45%; outside that range the DRB expects an explanation.' },
  { id: 'has-billing-plan', enabled: true, kind: 'builtin', builtin: 'billing-present', tabs: ['Basic Info'], severity: 'error',
    name: 'Billing plan is present', description: 'At least one billing milestone must exist.' },
  { id: 'cashflow-reconciles', enabled: true, kind: 'builtin', builtin: 'cashflow-reconciles', tabs: ['Cash Flow', 'Product Plan', 'Resource Plan', 'Basic Info'], tolerance: 1, severity: 'error',
    name: 'Cash Flow reconciles with the plans', description: 'Total vendor payments must equal the Product Plan, internal labour the Resource Plan, and repayments the billing plan.' },
  { id: 'cashflow-no-mismatch', enabled: true, kind: 'builtin', builtin: 'cashflow-no-mismatch', tabs: ['Cash Flow', 'Summary'], value: 15, severity: 'warning',
    name: 'No large cash flow mismatch', description: 'A month with a negative cash position is charged finance interest. Small, short gaps from paying vendors upfront are normal; the DRB expects a shortfall above the allowed % of the TCV to be explained.' },
];

export interface CheckRun {
  rule: RuleDef;
  result: RuleResult;
}

/** Runs the enabled rules against a saved business case version. */
export function runFinalChecks(d: BcVersionData, rules: RuleDef[] = DEFAULT_RULES): CheckRun[] {
  return rules.filter((r) => r.enabled).map((rule) => ({ rule, result: evaluate(rule, d) }));
}

export const failedChecks = (runs: CheckRun[]) => runs.filter((r) => !r.result.ok);
