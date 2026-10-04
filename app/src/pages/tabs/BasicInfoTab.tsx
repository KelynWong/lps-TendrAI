// Basic Info tab - deal information (two fixed columns), quote lines (BD can
// add/remove), billing plan (BD can add lines), exchange rates (BD-editable
// applied rate). All edits land on the draft until Save.

import type { BusinessCaseState, SummaryCategory } from '../../types';
import {
  CONTINGENCY_PCT,
  INFLATION_PCT_LABOUR,
  INFLATION_PCT_PRODUCT,
  PRC_HWSW_PCT,
  PRC_OPS_PCT,
  PRC_STAMP_PCT,
  computeSummary,
} from '../../lib/calc';
import { money, pct } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { DateCell, Fx, NumCell, ProvenanceBadge, TextCell } from '../../components/common';
import {
  CURRENCIES,
  GTM_SUBTEAMS,
  GTM_UNITS,
  PROJECT_TYPES,
  SOLUTION_OFFERINGS,
  withCurrent,
} from '../../data/parameters';

const mapRec = (
  rec: Record<SummaryCategory, number[]>,
  fn: (a: number[], k: string) => number[],
) =>
  Object.fromEntries(Object.entries(rec).map(([k, a]) => [k, fn(a, k)])) as Record<SummaryCategory, number[]>;

export default function BasicInfoTab() {
  const { state } = useStore();
  const { bc, update } = useDraft();
  const user = state.user!;
  const s = computeSummary(bc);
  const locked = bc.status === 'approved' || bc.status === 'submitted';
  const canEdit = !locked && (can.editProducts(user.role) || can.editResources(user.role));
  const canDeal = !locked && can.editDealStructure(user.role); // BD + sponsors
  const canMargin = !locked && can.editRatesAndMargins(user.role);

  const info = bc.basicInfo;
  const patchInfo = (patch: Partial<BusinessCaseState['basicInfo']>) =>
    update((d) => ({
      ...d,
      basicInfo: { ...d.basicInfo, ...patch, provenance: { kind: 'human', confirmedBy: user.name } },
    }));

  const select = (value: string, options: string[], onChange: (v: string) => void, enabled = canEdit) =>
    enabled ? (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    ) : (
      <span>{value}</span>
    );

  const addQuoteLine = () =>
    update((d) => {
      const id = Math.max(0, ...d.quoteLines.map((q) => q.id)) + 1;
      const push = (a: number[], v: number) => [...a, v];
      return {
        ...d,
        quoteLines: [
          ...d.quoteLines,
          { id, solutionOffering: SOLUTION_OFFERINGS[0], projectType: 'Milestone Based' as const, remarks: '', marginPct: 0.25 },
        ],
        otherIndirect: {
          travelExpense: push(d.otherIndirect.travelExpense, 0),
          otherCosts: push(d.otherIndirect.otherCosts, 0),
          vendorRebate: push(d.otherIndirect.vendorRebate, 0),
        },
        appliedRates: {
          contingency: mapRec(d.appliedRates.contingency, (a) => push(a, CONTINGENCY_PCT)),
          inflation: mapRec(d.appliedRates.inflation, (a, k) =>
            push(a, k === 'Internal Labour' ? INFLATION_PCT_LABOUR : INFLATION_PCT_PRODUCT),
          ),
          prcHwSw: push(d.appliedRates.prcHwSw, PRC_HWSW_PCT),
          prcOps: push(d.appliedRates.prcOps, PRC_OPS_PCT),
          prcStamp: push(d.appliedRates.prcStamp, PRC_STAMP_PCT),
        },
      };
    });

  const removeQuoteLine = (id: number) =>
    update((d) => {
      const idx = d.quoteLines.findIndex((q) => q.id === id);
      if (idx < 0 || d.quoteLines.length <= 1) return d;
      const cut = (a: number[]) => a.filter((_, i) => i !== idx);
      return {
        ...d,
        quoteLines: d.quoteLines.filter((q) => q.id !== id),
        productItems: d.productItems.filter((p) => p.quoteLine !== id),
        resourceItems: d.resourceItems.filter((r) => r.quoteLine !== id),
        otherIndirect: {
          travelExpense: cut(d.otherIndirect.travelExpense),
          otherCosts: cut(d.otherIndirect.otherCosts),
          vendorRebate: cut(d.otherIndirect.vendorRebate),
        },
        appliedRates: {
          contingency: mapRec(d.appliedRates.contingency, cut),
          inflation: mapRec(d.appliedRates.inflation, cut),
          prcHwSw: cut(d.appliedRates.prcHwSw),
          prcOps: cut(d.appliedRates.prcOps),
          prcStamp: cut(d.appliedRates.prcStamp),
        },
      };
    });

  const addBilling = () =>
    update((d) => ({
      ...d,
      billing: [
        ...d.billing,
        {
          id: `b${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          schedule: 'New billing milestone',
          amount: 0,
          remarks: '',
          provenance: { kind: 'human', confirmedBy: user.name },
        },
      ],
    }));

  const row = (label: string, control: React.ReactNode) => (
    <div className="info-row" key={label}>
      <label>{label}</label>
      {control}
    </div>
  );

  const text = (value: string, key: keyof typeof info) => (
    <TextCell value={value} editable={canEdit} onCommit={(v) => patchInfo({ [key]: v })} />
  );

  return (
    <div className="tab-body">
      <section>
        <h3>I. Basic Deal Information <ProvenanceBadge p={info.provenance} /></h3>
        <div className="info-grid">
          <div className="info-col">
            {row('SFDC CRM ID', text(info.crmId, 'crmId'))}
            {row('Customer', text(info.customer, 'customer'))}
            {row('End Customer', text(info.endCustomer, 'endCustomer'))}
            {row('GTM Unit', select(info.gtmUnit, withCurrent(info.gtmUnit, GTM_UNITS), (v) =>
              patchInfo({ gtmUnit: v, gtmSubTeam: (GTM_SUBTEAMS[v] ?? [''])[0] }),
            ))}
            {row('GTM Sub-team', select(info.gtmSubTeam, withCurrent(info.gtmSubTeam, GTM_SUBTEAMS[info.gtmUnit] ?? []), (v) =>
              patchInfo({ gtmSubTeam: v }),
            ))}
            {row('Major Solution Offering', select(info.majorSolutionOffering, withCurrent(info.majorSolutionOffering, SOLUTION_OFFERINGS), (v) =>
              patchInfo({ majorSolutionOffering: v }),
            ))}
            {row('TCV (Quote Currency)', (
              <Fx f={'= Summary! TCV Total\n= Σ quote-line sell prices\n  (Working: Direct Cost × (1 + Margin %))'}>
                <span className="computed strong">{money(s.total.tcv)}</span>
              </Fx>
            ))}
          </div>
          <div className="info-col">
            {row('Project Name', text(info.projectName, 'projectName'))}
            {row('Project Start Date', (
              <DateCell value={info.projectStart} editable={canEdit} onCommit={(v) => patchInfo({ projectStart: v })} />
            ))}
            {row('Project End Date', (
              <DateCell value={info.projectEnd} editable={canEdit} onCommit={(v) => patchInfo({ projectEnd: v })} />
            ))}
            {row('Project Duration (months)', (
              <Fx f={'= DATEDIF(Project Start, Project End, "m") + 1\nDrives the Cash Flow timeline and the\nLabour Inputs monthly grid.'}>
                <span className="computed">{s.durationMonths}</span>
              </Fx>
            ))}
            {row('Quote Currency', select(info.currency, CURRENCIES.map(([code]) => code), (v) => patchInfo({ currency: v })))}
            {row('Inflation Base Fiscal Year', (
              <NumCell
                value={info.inflationBaseFY}
                editable={canEdit}
                format={(v) => String(v)}
                onCommit={(v) => patchInfo({ inflationBaseFY: Math.round(v) })}
              />
            ))}
            {row('EBITDA %', (
              <Fx f={'= Summary! EBITDA %\n= (TCV − Total Cost) ÷ TCV'}>
                <span className="computed strong">{pct(s.total.ebitdaPct)}</span>
              </Fx>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3>II. Quote Lines (Sub-projects)</h3>
        <table className="grid">
          <thead>
            <tr>
              <th>Quote Line</th><th>Solution Offering</th><th>Project Type</th><th>Remarks</th>
              <th className="num">Margin % {canMargin ? '' : '(exec only)'}</th>
              <th className="num"><Fx f={'= Working! Σ category sell prices\n= Direct Cost × (1 + Margin %)'}>TCV</Fx></th>
              <th className="num"><Fx f={'= Summary! EBITDA(QL) ÷ TCV(QL)'}>EBITDA %</Fx></th>
              {canDeal && <th />}
            </tr>
          </thead>
          <tbody>
            {bc.quoteLines.map((q, i) => (
              <tr key={q.id}>
                <td>Quote Line {q.id}</td>
                <td>
                  {select(q.solutionOffering, withCurrent(q.solutionOffering, SOLUTION_OFFERINGS), (v) =>
                    update((d) => ({ ...d, quoteLines: d.quoteLines.map((x) => (x.id === q.id ? { ...x, solutionOffering: v } : x)) })),
                  )}
                </td>
                <td>
                  {select(q.projectType, [...PROJECT_TYPES], (v) =>
                    update((d) => ({ ...d, quoteLines: d.quoteLines.map((x) => (x.id === q.id ? { ...x, projectType: v as typeof q.projectType } : x)) })),
                  )}
                </td>
                <td className="muted">
                  <TextCell
                    value={q.remarks}
                    editable={canEdit}
                    onCommit={(v) => update((d) => ({ ...d, quoteLines: d.quoteLines.map((x) => (x.id === q.id ? { ...x, remarks: v } : x)) }))}
                  />
                </td>
                <td className="num">
                  <NumCell
                    value={+(q.marginPct * 100).toFixed(1)}
                    editable={canMargin}
                    format={(v) => `${v.toFixed(1)}%`}
                    onCommit={(v) => update((d) => ({ ...d, quoteLines: d.quoteLines.map((x) => (x.id === q.id ? { ...x, marginPct: v / 100 } : x)) }))}
                  />
                </td>
                <td className="num">{money(s.perLine[i].tcv)}</td>
                <td className="num">{pct(s.perLine[i].ebitdaPct)}</td>
                {canDeal && (
                  <td>
                    <button
                      className="icon-btn"
                      title="Remove quote line (also removes its product and labour lines)"
                      onClick={() => removeQuoteLine(q.id)}
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Total</td>
              <td className="num">{money(s.total.tcv)}</td>
              <td className="num">{pct(s.total.ebitdaPct)}</td>
              {canDeal && <td />}
            </tr>
          </tfoot>
        </table>
        {canDeal && <button className="btn" onClick={addQuoteLine}>+ Add quote line</button>}
      </section>

      <section>
        <h3>III. Billing Plan</h3>
        <table className="grid">
          <thead>
            <tr>
              <th>Target Billing Date</th><th>Payment Schedule</th>
              <th className="num">Billing Amount</th><th>Source</th>
              {canDeal && <th />}
            </tr>
          </thead>
          <tbody>
            {bc.billing.map((b) => (
              <tr key={b.id}>
                <td>
                  <DateCell
                    value={b.date}
                    editable={canEdit}
                    onCommit={(v) => update((d) => ({ ...d, billing: d.billing.map((x) => (x.id === b.id ? { ...x, date: v, provenance: { kind: 'human', confirmedBy: user.name } } : x)) }))}
                  />
                </td>
                <td>
                  <TextCell
                    value={b.schedule}
                    editable={canEdit}
                    onCommit={(v) => update((d) => ({ ...d, billing: d.billing.map((x) => (x.id === b.id ? { ...x, schedule: v, provenance: { kind: 'human', confirmedBy: user.name } } : x)) }))}
                  />
                </td>
                <td className="num">
                  <NumCell
                    value={b.amount}
                    editable={canEdit}
                    format={(v) => money(v)}
                    onCommit={(v) => update((d) => ({ ...d, billing: d.billing.map((x) => (x.id === b.id ? { ...x, amount: v, provenance: { kind: 'human', confirmedBy: user.name } } : x)) }))}
                  />
                </td>
                <td><ProvenanceBadge p={b.provenance} /></td>
                {canDeal && (
                  <td>
                    <button className="icon-btn" title="Remove milestone" onClick={() => update((d) => ({ ...d, billing: d.billing.filter((x) => x.id !== b.id) }))}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <Fx f={'= SUM(Billing Amounts)\nFinal Check: must equal TCV.\nEach amount lands in the Cash Flow\nRepayment column of its billing month.'}>Total</Fx>
                {Math.abs(s.billingTotal - s.total.tcv) >= 1 && <span className="warn-inline">WARNING: Total Billing Amount ≠ TCV</span>}
              </td>
              <td className="num">{money(s.billingTotal)}</td>
              <td colSpan={canDeal ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
        {canDeal && <button className="btn" onClick={addBilling}>+ Add billing line</button>}
      </section>

      <section>
        <h3>IV. Exchange Rate</h3>
        <table className="grid narrow">
          <thead>
            <tr>
              <th>Currency</th><th>Code</th>
              <th className="num">Applied Rate (to 1 USD)</th>
              <th className="num"><Fx f={'The fiscal-year planning rate prefilled\nas the default applied rate.'}>Planning Rate</Fx></th>
            </tr>
          </thead>
          <tbody>
            {CURRENCIES.map(([code, name, planning]) => (
              <tr key={code} className={code === info.currency ? 'strong' : ''}>
                <td>{name}</td><td>{code}</td>
                <td className="num">
                  <NumCell
                    value={bc.fxOverrides[code] ?? planning}
                    editable={canDeal}
                    format={(v) => v.toFixed(4)}
                    onCommit={(v) => update((d) => ({ ...d, fxOverrides: { ...d.fxOverrides, [code]: v } }))}
                  />
                </td>
                <td className="num muted">{planning.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
