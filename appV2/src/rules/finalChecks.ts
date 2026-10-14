// Final Check rules. ADDING A RULE MEANS ADDING ONE ENTRY HERE - nothing else.
// Failed checks WARN and never block: the UI shows results, banners and a
// warning on MSPO download, but every action stays available.

import type { BcVersionData } from '../types';

export interface RuleResult {
  ok: boolean;
  expected: string;
  actual: string;
}

export interface FinalCheckRule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning';
  /** business case tabs/cells the rule refers to (used for the jump link) */
  tabs: string[];
  check: (d: BcVersionData) => RuleResult;
}

const S = (n: number) => `S$${Math.round(n).toLocaleString()}`;
const near = (a: number, b: number) => Math.abs(a - b) < 1; // tolerance: S$1 (assumption)

const productSum = (d: BcVersionData) => d.products.reduce((a, p) => a + p.total, 0);
const labourSum = (d: BcVersionData) => d.resources.reduce((a, r) => a + r.total, 0);
const billingSum = (d: BcVersionData) => d.billing.reduce((a, b) => a + b.amount, 0);

export const FINAL_CHECK_RULES: FinalCheckRule[] = [
  {
    id: 'billing-equals-ccb',
    name: 'Billing plan equals CCB',
    description: 'The sum of the billing plan must equal the contract value (CCB/TCV) stated on the Summary tab.',
    severity: 'error',
    tabs: ['Basic Info', 'Summary'],
    check: (d) => ({ ok: near(billingSum(d), d.header.tcv), expected: S(d.header.tcv), actual: S(billingSum(d)) }),
  },
  {
    id: 'product-total-reconciles',
    name: 'Product Plan reconciles with Summary',
    description: 'The Product Plan line totals must add up to the product cost stated on the Summary tab.',
    severity: 'error',
    tabs: ['Product Plan', 'Summary'],
    check: (d) => ({ ok: near(productSum(d), d.header.productTotal), expected: S(d.header.productTotal), actual: S(productSum(d)) }),
  },
  {
    id: 'labour-total-reconciles',
    name: 'Resource Plan reconciles with Summary',
    description: 'The Resource Plan line totals must add up to the internal labour cost stated on the Summary tab.',
    severity: 'error',
    tabs: ['Resource Plan', 'Summary'],
    check: (d) => ({ ok: near(labourSum(d), d.header.labourTotal), expected: S(d.header.labourTotal), actual: S(labourSum(d)) }),
  },
  {
    id: 'line-totals-consistent',
    name: 'Line totals equal unit x quantity',
    description: 'Every Product Plan line total must equal unit cost x quantity; every labour line total must equal man-days x day rate.',
    severity: 'error',
    tabs: ['Product Plan', 'Resource Plan'],
    check: (d) => {
      const bad = [
        ...d.products.filter((p) => !near(p.unitCost * p.qty, p.total)).map((p) => p.desc),
        ...d.resources.filter((r) => !near(r.mandays * r.dayRate, r.total)).map((r) => r.role),
      ];
      return { ok: bad.length === 0, expected: 'All lines consistent', actual: bad.length ? `${bad.length} inconsistent: ${bad.slice(0, 2).join(', ')}` : 'All lines consistent' };
    },
  },
  {
    id: 'irate-resolvable',
    name: 'Every labour line has a day rate',
    description: 'Each Resource Plan line must carry a resolvable iRate (day rate above zero) for its team and grade.',
    severity: 'error',
    tabs: ['Resource Plan', 'Labour Inputs'],
    check: (d) => {
      const bad = d.resources.filter((r) => r.dayRate <= 0);
      return { ok: bad.length === 0, expected: 'Day rate > 0 on every line', actual: bad.length ? `${bad.length} line(s) missing a rate: ${bad.map((r) => r.role).join(', ')}` : 'All rates resolved' };
    },
  },
  {
    id: 'quote-line-assigned',
    name: 'Every line belongs to a defined quote line',
    description: 'Product and labour lines must be assigned to quote line 1-3 as defined on Basic Info.',
    severity: 'warning',
    tabs: ['Basic Info', 'Product Plan', 'Resource Plan'],
    check: (d) => {
      const bad = [...d.products, ...d.resources].filter((l) => l.ql < 1 || l.ql > 3);
      return { ok: bad.length === 0, expected: 'QL 1-3 on every line', actual: bad.length ? `${bad.length} line(s) outside QL 1-3` : 'All assigned' };
    },
  },
  {
    id: 'billing-within-duration',
    name: 'Billing dates fall within the project duration',
    description: 'No billing milestone may fall outside project start plus the contract duration.',
    severity: 'warning',
    tabs: ['Basic Info', 'Cash Flow'],
    check: (d) => {
      const start = new Date(d.header.projectStart);
      const end = new Date(start.getFullYear(), start.getMonth() + d.header.durationMonths, 1);
      const bad = d.billing.filter((b) => new Date(b.date) < start || new Date(b.date) > end);
      return { ok: bad.length === 0, expected: `All dates within ${d.header.durationMonths} months of start`, actual: bad.length ? `${bad.length} date(s) outside the duration` : 'All within duration' };
    },
  },
  {
    id: 'mandays-nonzero',
    name: 'No zero-effort labour lines',
    description: 'A labour line with zero man-days is usually a leftover row and should be removed.',
    severity: 'warning',
    tabs: ['Resource Plan'],
    check: (d) => {
      const bad = d.resources.filter((r) => r.mandays <= 0);
      return { ok: bad.length === 0, expected: 'Man-days > 0 on every line', actual: bad.length ? `${bad.length} zero-effort line(s)` : 'All lines have effort' };
    },
  },
  {
    id: 'margin-range',
    name: 'Margin within guardrails',
    description: 'Stated margin should be between 10% and 45%; outside that range the DRB expects an explanation.',
    severity: 'warning',
    tabs: ['Summary', 'Working'],
    check: (d) => ({
      ok: d.header.marginPct >= 10 && d.header.marginPct <= 45,
      expected: '10% - 45%',
      actual: `${d.header.marginPct.toFixed(1)}%`,
    }),
  },
  {
    id: 'has-billing-plan',
    name: 'Billing plan is present',
    description: 'At least one billing milestone must exist.',
    severity: 'error',
    tabs: ['Basic Info'],
    check: (d) => ({ ok: d.billing.length > 0, expected: 'One or more billing lines', actual: `${d.billing.length} line(s)` }),
  },
];

export interface CheckRun {
  rule: FinalCheckRule;
  result: RuleResult;
}

export function runFinalChecks(d: BcVersionData): CheckRun[] {
  return FINAL_CHECK_RULES.map((rule) => ({ rule, result: rule.check(d) }));
}

export const failedChecks = (runs: CheckRun[]) => runs.filter((r) => !r.result.ok);
