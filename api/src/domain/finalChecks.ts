// Final Check rules engine — server port of frontend/src/rules/finalChecks.ts.
// Rules are data (final_check_rules); failed checks WARN and never block.
import type { BcVersionData, CellRef, CheckRunResult, LineOp, RuleDef } from '../types.js';

type Fmt = 'money' | 'pct' | 'number';

/** Cells of the business case template with a known meaning. Any other cell a
 *  rule names is read from the raw `cells` captured when the workbook was parsed. */
const CELL_CATALOG: { tab: string; ref: string; fmt: Fmt; get: (d: BcVersionData) => number | number[] }[] = [
  { tab: 'Summary', ref: 'B6', fmt: 'money', get: (d) => d.header.tcv },
  { tab: 'Summary', ref: 'B16:B20', fmt: 'money', get: (d) => d.header.productTotal },
  { tab: 'Summary', ref: 'B15', fmt: 'money', get: (d) => d.header.labourTotal },
  { tab: 'Summary', ref: 'C22', fmt: 'pct', get: (d) => d.header.marginPct },
  { tab: 'Basic Info', ref: 'D9', fmt: 'number', get: (d) => d.header.durationMonths },
  { tab: 'Basic Info', ref: 'C31:C42', fmt: 'money', get: (d) => d.billing.map((b) => b.amount) },
  { tab: 'Product Plan', ref: 'B6:B25', fmt: 'number', get: (d) => d.products.map((p) => p.ql) },
  { tab: 'Product Plan', ref: 'F6:F25', fmt: 'money', get: (d) => d.products.map((p) => p.unitCost) },
  { tab: 'Product Plan', ref: 'H6:H25', fmt: 'number', get: (d) => d.products.map((p) => p.qty) },
  { tab: 'Product Plan', ref: 'G6:G25', fmt: 'money', get: (d) => d.products.map((p) => p.total) },
  { tab: 'Resource Plan', ref: 'B8:B27', fmt: 'number', get: (d) => d.resources.map((r) => r.ql) },
  { tab: 'Resource Plan', ref: 'F8:F27', fmt: 'number', get: (d) => d.resources.map((r) => r.mandays) },
  { tab: 'Resource Plan', ref: 'G8:G27', fmt: 'money', get: (d) => d.resources.map((r) => r.total) },
  { tab: 'Labour Inputs', ref: 'F8:F27', fmt: 'money', get: (d) => d.resources.map((r) => r.dayRate) },
];

const norm = (s: string) => s.trim().toUpperCase().replace(/\$/g, '');
const isRange = (ref: string) => norm(ref).includes(':');

function readCell(c: CellRef | undefined, d: BcVersionData): { fmt: Fmt; value: number | number[] } | null {
  if (!c) return null;
  const known = CELL_CATALOG.find((x) => x.tab === c.tab && x.ref === norm(c.ref));
  if (known) return { fmt: known.fmt, value: known.get(d) };
  const tab = d.cells?.[c.tab];
  if (!tab) return null;
  const ref = norm(c.ref);
  if (!isRange(ref)) return ref in tab ? { fmt: 'number', value: tab[ref] } : null;
  const m = /^([A-Z]{1,2})(\d+):([A-Z]{1,2})(\d+)$/.exec(ref);
  if (!m) return null;
  const vals: number[] = [];
  for (let r = +m[2]; r <= +m[4]; r++) {
    const v = tab[`${m[1]}${r}`];
    if (typeof v === 'number') vals.push(v);
  }
  return vals.length ? { fmt: 'number', value: vals } : null;
}

const fmtVal = (fmt: Fmt, v: number) =>
  fmt === 'money' ? `S$${Math.round(v).toLocaleString('en-SG')}` : fmt === 'pct' ? `${v.toFixed(1)}%` : String(v);
const sum = (v: number | number[]) => (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v);
const opText = (op: LineOp, a?: number, b?: number) => (op === 'between' ? `between ${a} and ${b}` : `${op} ${a}`);
const testOp = (x: number, op: LineOp, a = 0, b = 0) =>
  op === '>' ? x > a : op === '>=' ? x >= a : op === '<' ? x < a : op === '<=' ? x <= a : op === '=' ? x === a : x >= a && x <= b;

const notChecked = (c?: CellRef): Omit<CheckRunResult, 'ruleId'> => ({
  ok: true, skipped: true, expected: '-', actual: `Not checked - no value for ${c?.tab} ${norm(c?.ref ?? '')} in this workbook`,
});

function evaluate(r: RuleDef, d: BcVersionData): Omit<CheckRunResult, 'ruleId'> {
  const tol = r.tolerance ?? 1;
  switch (r.kind) {
    case 'compare': {
      const L = readCell(r.left, d);
      const R = readCell(r.right, d);
      if (!L) return notChecked(r.left);
      if (!R) return notChecked(r.right);
      const a = sum(L.value);
      const b = sum(R.value);
      return { ok: Math.abs(a - b) <= tol, expected: fmtVal(R.fmt, b), actual: fmtVal(L.fmt, a) };
    }
    case 'range': {
      const T = readCell(r.target, d);
      if (!T) return notChecked(r.target);
      const v = sum(T.value);
      const ok = (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
      const expected = r.min !== undefined && r.max !== undefined ? `${fmtVal(T.fmt, r.min)} - ${fmtVal(T.fmt, r.max)}`
        : r.min !== undefined ? `At least ${fmtVal(T.fmt, r.min)}` : `At most ${fmtVal(T.fmt, r.max!)}`;
      return { ok, expected, actual: fmtVal(T.fmt, v) };
    }
    case 'every-line': {
      const T = readCell(r.target, d);
      if (!T) return notChecked(r.target);
      const lines = Array.isArray(T.value) ? T.value : [T.value];
      const bad = lines.filter((x) => !testOp(x, r.op!, r.value, r.value2));
      return { ok: bad.length === 0, expected: `All lines ${opText(r.op!, r.value, r.value2)}`, actual: bad.length ? `${bad.length} of ${lines.length} line(s) fail` : 'All lines pass' };
    }
    case 'builtin':
      return evaluateBuiltin(r.builtin!, d, tol);
  }
}

function evaluateBuiltin(key: NonNullable<RuleDef['builtin']>, d: BcVersionData, tol: number): Omit<CheckRunResult, 'ruleId'> {
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
    default:
      return { ok: true, skipped: true, expected: '-', actual: `Unknown builtin ${String(key)}` };
  }
}

export function runFinalChecks(d: BcVersionData, rules: RuleDef[]): CheckRunResult[] {
  return rules.filter((r) => r.enabled).map((rule) => ({ ruleId: rule.id, ...evaluate(rule, d) }));
}

/** DB row -> RuleDef (definition jsonb holds the kind-specific fields). */
export function ruleFromRow(row: { id: string; name: string; description: string; severity: 'error' | 'warning'; enabled: boolean; kind: RuleKind; definition: Record<string, unknown> }): RuleDef {
  return { id: row.id, name: row.name, description: row.description, severity: row.severity, enabled: row.enabled, kind: row.kind, ...(row.definition as Partial<RuleDef>) };
}
type RuleKind = RuleDef['kind'];

/** RuleDef -> definition jsonb (everything except the top-level columns). */
export function ruleDefinition(r: RuleDef): Record<string, unknown> {
  const { id: _id, name: _n, description: _d, severity: _s, enabled: _e, kind: _k, ...rest } = r;
  void _id; void _n; void _d; void _s; void _e; void _k;
  return JSON.parse(JSON.stringify(rest));
}

export function cellRefProblem(ref: string, needRange = false): string | null {
  const r = norm(ref);
  const m = /^([A-Z]{1,2})([1-9]\d*)(?::([A-Z]{1,2})([1-9]\d*))?$/.exec(r);
  if (!m) return `"${ref}" is not a cell like B5 or a range like C31:C42`;
  if (needRange && !m[3]) return 'every-line rules need a column range like F6:F25';
  if (m[3] && m[3] !== m[1]) return `${r} spans two columns - use one column`;
  if (m[4] && +m[4] < +m[2]) return `${r} runs backwards`;
  return null;
}
