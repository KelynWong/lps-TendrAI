// Final Check rules as DATA, managed on the "Business case management" page.
// Failed checks WARN and never block: the UI shows results, banners and a
// warning on MSPO download, but every action stays available.
//
// A rule reads workbook cells by tab + cell reference:
//  - compare:    one cell/range must equal another (ranges are summed)
//  - range:      one cell/range must sit between a min and a max
//  - every-line: every cell in a column range must meet a condition
//  - builtin:    fixed logic that can't be expressed as cell comparisons
// The tabs a rule involves are inferred from its cell references.

import type { BcVersionData } from '../types';

export interface RuleResult {
  ok: boolean;
  expected: string;
  actual: string;
  /** the rule reads a cell the demo has no value for - not evaluated */
  skipped?: boolean;
}

export interface CellRef {
  tab: string;
  /** a single cell (B5) or a column range (C31:C42) */
  ref: string;
}

type Fmt = 'money' | 'pct' | 'number';

/** Cells of the business case template the demo can read. The live system
 *  reads any cell from the uploaded workbook. Ranges return one value per line. */
export const CELL_CATALOG: { tab: string; ref: string; label: string; fmt: Fmt; get: (d: BcVersionData) => number | number[] }[] = [
  { tab: 'Summary', ref: 'B5', label: 'Contract value (TCV/CCB)', fmt: 'money', get: (d) => d.header.tcv },
  { tab: 'Summary', ref: 'B14', label: 'Product cost (stated)', fmt: 'money', get: (d) => d.header.productTotal },
  { tab: 'Summary', ref: 'B15', label: 'Internal labour (stated)', fmt: 'money', get: (d) => d.header.labourTotal },
  { tab: 'Summary', ref: 'C22', label: 'Margin %', fmt: 'pct', get: (d) => d.header.marginPct },
  { tab: 'Basic Info', ref: 'D9', label: 'Project duration (months)', fmt: 'number', get: (d) => d.header.durationMonths },
  { tab: 'Basic Info', ref: 'C31:C42', label: 'Billing amounts', fmt: 'money', get: (d) => d.billing.map((b) => b.amount) },
  { tab: 'Product Plan', ref: 'B6:B25', label: 'Quote line per product line', fmt: 'number', get: (d) => d.products.map((p) => p.ql) },
  { tab: 'Product Plan', ref: 'F6:F25', label: 'Unit price per line', fmt: 'money', get: (d) => d.products.map((p) => p.unitCost) },
  { tab: 'Product Plan', ref: 'H6:H25', label: 'Quantity per line (first fiscal year)', fmt: 'number', get: (d) => d.products.map((p) => p.qty) },
  { tab: 'Product Plan', ref: 'G6:G25', label: 'Line totals', fmt: 'money', get: (d) => d.products.map((p) => p.total) },
  { tab: 'Resource Plan', ref: 'B8:B27', label: 'Quote line per labour line', fmt: 'number', get: (d) => d.resources.map((r) => r.ql) },
  { tab: 'Resource Plan', ref: 'F8:F27', label: 'Man-days per line', fmt: 'number', get: (d) => d.resources.map((r) => r.mandays) },
  { tab: 'Resource Plan', ref: 'G8:G27', label: 'Labour line totals', fmt: 'money', get: (d) => d.resources.map((r) => r.total) },
  { tab: 'Labour Inputs', ref: 'F8:F27', label: 'Day rate per line', fmt: 'money', get: (d) => d.resources.map((r) => r.dayRate) },
];

const norm = (s: string) => s.trim().toUpperCase().replace(/\$/g, '');
export const findCell = (c?: CellRef) =>
  c ? CELL_CATALOG.find((x) => x.tab === c.tab && x.ref === norm(c.ref)) : undefined;
export const isRange = (ref: string) => norm(ref).includes(':');

/** Valid cell (B5) or single-column range (C31:C42). */
export function cellRefProblem(ref: string, needRange = false): string | null {
  const r = norm(ref);
  const m = /^([A-Z]{1,2})([1-9]\d*)(?::([A-Z]{1,2})([1-9]\d*))?$/.exec(r);
  if (!m) return `"${ref}" is not a cell like B5 or a range like C31:C42`;
  if (needRange && !m[3]) return 'every-line rules need a column range like F6:F25';
  if (m[3] && m[3] !== m[1]) return `${r} spans two columns - use one column`;
  if (m[4] && +m[4] < +m[2]) return `${r} runs backwards`;
  return null;
}

export type LineOp = '>' | '>=' | '<' | '<=' | '=' | 'between';

/** Fixed-logic rules shipped with the system. */
export const BUILTINS = {
  'line-totals-consistent': 'Every line total = unit price x quantity (or man-days x day rate)',
  'billing-within-duration': 'Every billing date falls within project start + duration',
  'quote-line-assigned': 'Every product and labour line sits on quote line 1-3',
  'billing-present': 'The billing plan has at least one line',
} as const;
export type BuiltinKey = keyof typeof BUILTINS;

export interface RuleDef {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning';
  enabled: boolean;
  kind: 'compare' | 'range' | 'every-line' | 'builtin';
  // compare
  left?: CellRef;
  right?: CellRef;
  /** allowed difference, in the cells' unit */
  tolerance?: number;
  // range / every-line
  target?: CellRef;
  min?: number;
  max?: number;
  op?: LineOp;
  value?: number;
  value2?: number;
  // builtin
  builtin?: BuiltinKey;
  /** tabs a builtin reads (other kinds infer theirs from cell references) */
  tabs?: string[];
}

/** Tabs a rule involves - drives the side-by-side "View source". */
export function ruleTabs(r: RuleDef): string[] {
  if (r.kind === 'builtin') return r.tabs ?? [];
  const refs = r.kind === 'compare' ? [r.left, r.right] : [r.target];
  return [...new Set(refs.filter(Boolean).map((c) => c!.tab))];
}

const fmtVal = (fmt: Fmt, v: number) =>
  fmt === 'money' ? `S$${Math.round(v).toLocaleString()}` : fmt === 'pct' ? `${v.toFixed(1)}%` : String(v);
const sum = (v: number | number[]) => (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v);
const opText = (op: LineOp, a?: number, b?: number) => (op === 'between' ? `between ${a} and ${b}` : `${op} ${a}`);
const testOp = (x: number, op: LineOp, a = 0, b = 0) =>
  op === '>' ? x > a : op === '>=' ? x >= a : op === '<' ? x < a : op === '<=' ? x <= a : op === '=' ? x === a : x >= a && x <= b;
export const cellText = (c?: CellRef) => {
  if (!c) return '?';
  const known = findCell(c);
  return `${c.tab} ${norm(c.ref)}${known ? ` (${known.label}${isRange(c.ref) ? ', total' : ''})` : ''}`;
};

/** Plain-language summary of what a rule checks (shown in the rules table). */
export function describeLogic(r: RuleDef): string {
  switch (r.kind) {
    case 'compare':
      return `${cellText(r.left)} = ${cellText(r.right)}${r.tolerance ? ` (within ${r.tolerance})` : ''}`;
    case 'range':
      return `${cellText(r.target)} ${r.min !== undefined && r.max !== undefined ? `between ${r.min} and ${r.max}` : r.min !== undefined ? `at least ${r.min}` : `at most ${r.max}`}`;
    case 'every-line': {
      const known = findCell(r.target);
      return `Every cell in ${r.target?.tab} ${norm(r.target?.ref ?? '')}${known ? ` (${known.label})` : ''} ${opText(r.op!, r.value, r.value2)}`;
    }
    case 'builtin':
      return BUILTINS[r.builtin!];
  }
}

const notChecked = (c?: CellRef): RuleResult => ({
  ok: true,
  skipped: true,
  expected: '-',
  actual: `Not checked - no value for ${c?.tab} ${norm(c?.ref ?? '')} in the demo`,
});

function evaluate(r: RuleDef, d: BcVersionData): RuleResult {
  const tol = r.tolerance ?? 1;
  switch (r.kind) {
    case 'compare': {
      const L = findCell(r.left);
      const R = findCell(r.right);
      if (!L) return notChecked(r.left);
      if (!R) return notChecked(r.right);
      const a = sum(L.get(d));
      const b = sum(R.get(d));
      return { ok: Math.abs(a - b) <= tol, expected: fmtVal(R.fmt, b), actual: fmtVal(L.fmt, a) };
    }
    case 'range': {
      const T = findCell(r.target);
      if (!T) return notChecked(r.target);
      const v = sum(T.get(d));
      const ok = (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
      const expected = r.min !== undefined && r.max !== undefined ? `${fmtVal(T.fmt, r.min)} - ${fmtVal(T.fmt, r.max)}`
        : r.min !== undefined ? `At least ${fmtVal(T.fmt, r.min)}` : `At most ${fmtVal(T.fmt, r.max!)}`;
      return { ok, expected, actual: fmtVal(T.fmt, v) };
    }
    case 'every-line': {
      const T = findCell(r.target);
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
      return evaluateBuiltin(r.builtin!, d, tol);
  }
}

function evaluateBuiltin(key: BuiltinKey, d: BcVersionData, tol: number): RuleResult {
  switch (key) {
    case 'line-totals-consistent': {
      const bad = [
        ...d.products.filter((p) => Math.abs(p.unitCost * p.qty - p.total) > tol).map((p) => p.desc),
        ...d.resources.filter((r) => Math.abs(r.mandays * r.dayRate - r.total) > tol).map((r) => r.role),
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
  }
}

const C = (tab: string, ref: string): CellRef => ({ tab, ref });

/** The rule set shipped with the system (mirrors the Excel template's Final Check list). */
export const DEFAULT_RULES: RuleDef[] = [
  { id: 'billing-equals-ccb', enabled: true, kind: 'compare', left: C('Basic Info', 'C31:C42'), right: C('Summary', 'B5'), tolerance: 1, severity: 'error',
    name: 'Billing plan equals CCB', description: 'The sum of the billing plan must equal the contract value (CCB/TCV) stated on the Summary tab.' },
  { id: 'product-total-reconciles', enabled: true, kind: 'compare', left: C('Product Plan', 'G6:G25'), right: C('Summary', 'B14'), tolerance: 1, severity: 'error',
    name: 'Product Plan reconciles with Summary', description: 'The Product Plan line totals must add up to the product cost stated on the Summary tab.' },
  { id: 'labour-total-reconciles', enabled: true, kind: 'compare', left: C('Resource Plan', 'G8:G27'), right: C('Summary', 'B15'), tolerance: 1, severity: 'error',
    name: 'Resource Plan reconciles with Summary', description: 'The Resource Plan line totals must add up to the internal labour cost stated on the Summary tab.' },
  { id: 'line-totals-consistent', enabled: true, kind: 'builtin', builtin: 'line-totals-consistent', tabs: ['Product Plan', 'Resource Plan'], tolerance: 1, severity: 'error',
    name: 'Line totals equal unit x quantity', description: 'Every Product Plan line total must equal unit price x quantity; every labour line total must equal man-days x day rate.' },
  { id: 'irate-resolvable', enabled: true, kind: 'every-line', target: C('Labour Inputs', 'F8:F27'), op: '>', value: 0, severity: 'error',
    name: 'Every labour line has a day rate', description: 'Each labour line must carry a resolvable iRate (day rate above zero) for its team and grade.' },
  { id: 'quote-line-assigned', enabled: true, kind: 'builtin', builtin: 'quote-line-assigned', tabs: ['Basic Info', 'Product Plan', 'Resource Plan'], severity: 'warning',
    name: 'Every line belongs to a defined quote line', description: 'Product and labour lines must be assigned to quote line 1-3 as defined on Basic Info.' },
  { id: 'billing-within-duration', enabled: true, kind: 'builtin', builtin: 'billing-within-duration', tabs: ['Basic Info', 'Cash Flow'], severity: 'warning',
    name: 'Billing dates fall within the project duration', description: 'No billing milestone may fall outside project start plus the contract duration.' },
  { id: 'mandays-nonzero', enabled: true, kind: 'every-line', target: C('Resource Plan', 'F8:F27'), op: '>', value: 0, severity: 'warning',
    name: 'No zero-effort labour lines', description: 'A labour line with zero man-days is usually a leftover row and should be removed.' },
  { id: 'margin-range', enabled: true, kind: 'range', target: C('Summary', 'C22'), min: 10, max: 45, severity: 'warning',
    name: 'Margin within guardrails', description: 'Stated margin should be between 10% and 45%; outside that range the DRB expects an explanation.' },
  { id: 'has-billing-plan', enabled: true, kind: 'builtin', builtin: 'billing-present', tabs: ['Basic Info'], severity: 'error',
    name: 'Billing plan is present', description: 'At least one billing milestone must exist.' },
];

export interface CheckRun {
  rule: RuleDef;
  result: RuleResult;
}

/** Runs the enabled rules against a parsed business case. */
export function runFinalChecks(d: BcVersionData, rules: RuleDef[] = DEFAULT_RULES): CheckRun[] {
  return rules.filter((r) => r.enabled).map((rule) => ({ rule, result: evaluate(rule, d) }));
}

export const failedChecks = (runs: CheckRun[]) => runs.filter((r) => !r.result.ok);
