// Summary tab - P&L by quote line with a % breakdown column per quote line
// (share of that line's TCV) and editable applied-% cells (BD) for the
// Contingency, Inflation and PRC tax rows, mirroring the template's yellow
// input cells.

import type { SummaryCategory } from '../../types';
import { computeSummary } from '../../lib/calc';
import { money, pct } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { Fx, NumCell } from '../../components/common';
import { ALL_CATEGORIES } from '../../types';

type PctMode =
  | { kind: 'share' } // value / column TCV
  | { kind: 'hundred' } // fixed 100%
  | { kind: 'edit'; get: (qlIdx: number) => number; set: (qlIdx: number, v: number) => void }
  | { kind: 'none' };

export default function SummaryTab() {
  const { state } = useStore();
  const { bc, update } = useDraft();
  const user = state.user!;
  const s = computeSummary(bc);
  const locked = bc.status === 'approved' || bc.status === 'submitted';
  const canDeal = !locked && can.editDealStructure(user.role); // BD + sponsors
  const canEditIndirect =
    !locked && (can.approve(user.role) || can.editProducts(user.role) || can.editResources(user.role));

  const cols = s.perLine;

  const setRate = (kind: 'contingency' | 'inflation', cat: SummaryCategory, qlIdx: number, v: number) =>
    update((d) => ({
      ...d,
      appliedRates: {
        ...d.appliedRates,
        [kind]: {
          ...d.appliedRates[kind],
          [cat]: d.appliedRates[kind][cat].map((x, i) => (i === qlIdx ? v : x)),
        },
      },
    }));
  const setPrc = (key: 'prcHwSw' | 'prcOps' | 'prcStamp', qlIdx: number, v: number) =>
    update((d) => ({
      ...d,
      appliedRates: { ...d.appliedRates, [key]: d.appliedRates[key].map((x, i) => (i === qlIdx ? v : x)) },
    }));

  const pctCell = (key: string, mode: PctMode, value: number, colTcv: number, qlIdx: number) => {
    switch (mode.kind) {
      case 'hundred':
        return <td className="num pct-col" key={key}>100.00%</td>;
      case 'share':
        return <td className="num pct-col muted" key={key}>{colTcv ? pct(value / colTcv, 2) : '0.00%'}</td>;
      case 'edit':
        return (
          <td className="num pct-col rate-cell" key={key}>
            <NumCell
              value={+(mode.get(qlIdx) * 100).toFixed(2)}
              editable={canDeal}
              format={(v) => `${v.toFixed(2)}%`}
              onCommit={(v) => mode.set(qlIdx, v / 100)}
            />
          </td>
        );
      default:
        return <td className="num pct-col" key={key} />;
    }
  };

  const row = (
    key: string,
    label: React.ReactNode,
    total: React.ReactNode,
    per: (i: number) => React.ReactNode,
    totalValue: number,
    perValue: (i: number) => number,
    mode: PctMode,
    cls = '',
  ) => {
    const totalMode: PctMode =
      mode.kind === 'edit' ? { kind: 'share' } : mode.kind === 'hundred' ? { kind: 'hundred' } : mode;
    return (
      <tr className={cls} key={key}>
        <td>{label}</td>
        <td className="num">{total}</td>
        {pctCell('tp', totalMode, totalValue, s.total.tcv, -1)}
        {cols.flatMap((_, i) => [
          <td className="num" key={`v${i}`}>{per(i)}</td>,
          pctCell(`p${i}`, mode, perValue(i), cols[i].tcv, i),
        ])}
      </tr>
    );
  };

  return (
    <div className="tab-body scroll-x">
      <table className="grid summary-grid">
        <thead>
          <tr>
            <th />
            <th className="num">Total</th>
            <th className="num pct-col">%</th>
            {bc.quoteLines.flatMap((q) => [
              <th className="num" key={q.id} title={q.solutionOffering}>
                QL{q.id} · {q.solutionOffering.length > 18 ? q.solutionOffering.slice(0, 16) + '…' : q.solutionOffering}
              </th>,
              <th className="num pct-col" key={`p${q.id}`}>%</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {row('tcv', 'TCV', <b>{money(s.total.tcv)}</b>, (i) => <b>{money(cols[i].tcv)}</b>,
            s.total.tcv, (i) => cols[i].tcv, { kind: 'hundred' }, 'section-row')}
          {ALL_CATEGORIES.map((c) =>
            row(`tcv-${c}`, `　${c} (sell)`, money(s.total.tcvByCat[c]), (i) => money(cols[i].tcvByCat[c]),
              s.total.tcvByCat[c], (i) => cols[i].tcvByCat[c], { kind: 'share' }),
          )}

          {row('dc', 'Direct Cost', <b>{money(s.total.directTotal)}</b>, (i) => <b>{money(cols[i].directTotal)}</b>,
            s.total.directTotal, (i) => cols[i].directTotal, { kind: 'share' }, 'section-row')}
          {ALL_CATEGORIES.map((c) =>
            row(`dc-${c}`,
              <Fx f={c === 'Internal Labour'
                ? "= SUMIFS('Resource Plan'! Total Cost, Quote Line)"
                : `= SUMIFS('Product Plan'! Total Cost, Quote Line, Category = "${c}")`}>
                {`　${c}`}
              </Fx>,
              money(s.total.directByCat[c]), (i) => money(cols[i].directByCat[c]),
              s.total.directByCat[c], (i) => cols[i].directByCat[c], { kind: 'share' }),
          )}

          {row('gp', 'Gross Profit', <b>{money(s.total.grossProfit)}</b>, (i) => <b>{money(cols[i].grossProfit)}</b>,
            s.total.grossProfit, (i) => cols[i].grossProfit, { kind: 'share' }, 'section-row')}

          {row('ic', 'Indirect Cost', <b>{money(s.total.indirectTotal)}</b>, (i) => <b>{money(cols[i].indirectTotal)}</b>,
            s.total.indirectTotal, (i) => cols[i].indirectTotal, { kind: 'share' }, 'section-row')}

          {row('cont', '　Contingency', money(s.total.contingencyTotal), (i) => money(cols[i].contingencyTotal),
            s.total.contingencyTotal, (i) => cols[i].contingencyTotal, { kind: 'share' })}
          {ALL_CATEGORIES.map((c) =>
            row(`cont-${c}`, `　　Contingency - ${c}`, money(s.total.contingencyByCat[c]), (i) => money(cols[i].contingencyByCat[c]),
              s.total.contingencyByCat[c], (i) => cols[i].contingencyByCat[c],
              { kind: 'edit', get: (i) => bc.appliedRates.contingency[c][i] ?? 0, set: (i, v) => setRate('contingency', c, i, v) }),
          )}

          {row('infl', '　Inflation', money(s.total.inflationTotal), (i) => money(cols[i].inflationTotal),
            s.total.inflationTotal, (i) => cols[i].inflationTotal, { kind: 'share' })}
          {ALL_CATEGORIES.map((c) =>
            row(`infl-${c}`,
              <Fx f={'Applied %: typed per quote line.\n0% is forced on vendor-committed lines\nin the Product Plan.'}>{`　　Inflation - ${c}`}</Fx>,
              money(s.total.inflationByCat[c]), (i) => money(cols[i].inflationByCat[c]),
              s.total.inflationByCat[c], (i) => cols[i].inflationByCat[c],
              { kind: 'edit', get: (i) => bc.appliedRates.inflation[c][i] ?? 0, set: (i, v) => setRate('inflation', c, i, v) }),
          )}

          {row('oic', '　Other Indirect Cost', money(s.total.otherIndirectTotal), (i) => money(cols[i].otherIndirectTotal),
            s.total.otherIndirectTotal, (i) => cols[i].otherIndirectTotal, { kind: 'share' })}
          {row('fin',
            <Fx f={"= 'Cash Flow'! Σ compound interest\n  × this line's share of Direct Cost"}>　　Finance Cost</Fx>,
            money(s.financeCostTotal), (i) => money(cols[i].financeCost),
            s.financeCostTotal, (i) => cols[i].financeCost, { kind: 'share' })}
          {row('prc1',
            <Fx f={'Applies only when Quote Currency = CNY\n= (Hardware + Software direct cost) × applied %'}>　　PRC Tax on Hardware &amp; Software</Fx>,
            money(s.total.prcHwSw), (i) => money(cols[i].prcHwSw),
            s.total.prcHwSw, (i) => cols[i].prcHwSw,
            { kind: 'edit', get: (i) => bc.appliedRates.prcHwSw[i] ?? 0, set: (i, v) => setPrc('prcHwSw', i, v) })}
          {row('prc2',
            <Fx f={'Applies only when Quote Currency = CNY\n= (Labour + External Service + Telephony +\n   Real Estate direct cost) × applied %'}>　　PRC Tax on Operation, External Service &amp; Internal Labour</Fx>,
            money(s.total.prcOps), (i) => money(cols[i].prcOps),
            s.total.prcOps, (i) => cols[i].prcOps,
            { kind: 'edit', get: (i) => bc.appliedRates.prcOps[i] ?? 0, set: (i, v) => setPrc('prcOps', i, v) })}
          {row('prc3',
            <Fx f={'Applies only when Quote Currency = CNY\n= Direct Cost × applied %'}>　　PRC Stamp Duty</Fx>,
            money(s.total.prcStamp), (i) => money(cols[i].prcStamp),
            s.total.prcStamp, (i) => cols[i].prcStamp,
            { kind: 'edit', get: (i) => bc.appliedRates.prcStamp[i] ?? 0, set: (i, v) => setPrc('prcStamp', i, v) })}
          {row('te', '　　Travel & Expense', money(s.total.travelExpense), (i) => (
            <NumCell
              value={cols[i].travelExpense}
              editable={canEditIndirect}
              format={(v) => money(v)}
              onCommit={(v) => update((d) => ({ ...d, otherIndirect: { ...d.otherIndirect, travelExpense: d.otherIndirect.travelExpense.map((x, j) => (j === i ? v : x)) } }))}
            />
          ), s.total.travelExpense, (i) => cols[i].travelExpense, { kind: 'none' })}
          {row('oc', '　　Other Costs', money(s.total.otherCosts), (i) => (
            <NumCell
              value={cols[i].otherCosts}
              editable={canEditIndirect}
              format={(v) => money(v)}
              onCommit={(v) => update((d) => ({ ...d, otherIndirect: { ...d.otherIndirect, otherCosts: d.otherIndirect.otherCosts.map((x, j) => (j === i ? v : x)) } }))}
            />
          ), s.total.otherCosts, (i) => cols[i].otherCosts, { kind: 'none' })}
          {row('vr', '　　Vendor Rebate (credit)', money(-s.total.vendorRebate), (i) => (
            <NumCell
              value={cols[i].vendorRebate}
              editable={canEditIndirect}
              format={(v) => money(-v)}
              onCommit={(v) => update((d) => ({ ...d, otherIndirect: { ...d.otherIndirect, vendorRebate: d.otherIndirect.vendorRebate.map((x, j) => (j === i ? v : x)) } }))}
            />
          ), -s.total.vendorRebate, (i) => -cols[i].vendorRebate, { kind: 'none' })}

          {row('tc', 'Total Cost (Direct + Indirect)', <b>{money(s.total.totalCost)}</b>, (i) => <b>{money(cols[i].totalCost)}</b>,
            s.total.totalCost, (i) => cols[i].totalCost, { kind: 'share' }, 'section-row')}
          {row('eb', 'EBITDA',
            <b className={s.total.ebitda >= 0 ? 'pos' : 'neg'}>{money(s.total.ebitda)}</b>,
            (i) => <b className={cols[i].ebitda >= 0 ? 'pos' : 'neg'}>{money(cols[i].ebitda)}</b>,
            s.total.ebitda, (i) => cols[i].ebitda, { kind: 'share' }, 'section-row ebitda-row')}
        </tbody>
      </table>
    </div>
  );
}
