// Summary tab - P&L by quote line with a % breakdown column per quote line
// (share of that line's TCV) and editable applied-% cells (BD) for the
// Contingency, Inflation and PRC tax rows, mirroring the template's yellow
// input cells. Input rows start amber (AI-applied default); editing any cell
// in a row (or Confirm all) marks the row verified and turns it green.

import { useState } from 'react';
import type { SummaryCategory } from '../../types';
import { computeSummary } from '../../lib/calc';
import { money, pct } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { confirmInput, summaryCellKeys, useDraft } from '../../state/draft';
import { Fx, NumCell } from '../../components/common';
import { Button, ConfirmDialog } from '../../ui/ui';
import { ALL_CATEGORIES } from '../../types';

type PctMode =
  | { kind: 'share' } // value / column TCV
  | { kind: 'hundred' } // fixed 100%
  // ckey = cell-key base; the quote-line index is appended per cell
  | { kind: 'edit'; ckey: string; get: (qlIdx: number) => number; set: (qlIdx: number, v: number) => void }
  | { kind: 'fin' } // Finance Cost: % editable in the Total column only
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

  const [onlyReview, setOnlyReview] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const allKeys = summaryCellKeys(bc);
  const verified = (k: string) => bc.confirmedInputs.includes(k);
  const verifiedCount = allKeys.filter(verified).length;
  const totalInputs = allKeys.length;
  const toReview = totalInputs - verifiedCount;
  const filterOn = onlyReview && toReview > 0;
  /** A row stays visible under the filter while ANY of its cells is unverified */
  const rowCells = (base: string) => bc.quoteLines.map((_, i) => `${base}:${i}`);
  const showRow = (base: string) => !filterOn || rowCells(base).some((k) => !verified(k));
  const confirmAll = () =>
    update((d) => ({ ...d, confirmedInputs: summaryCellKeys(d).reduce(confirmInput, d.confirmedInputs) }));

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
      confirmedInputs: confirmInput(d.confirmedInputs, `sum:${kind === 'contingency' ? 'cont' : 'infl'}:${cat}:${qlIdx}`),
    }));
  const setPrc = (key: 'prcHwSw' | 'prcOps' | 'prcStamp', qlIdx: number, v: number) =>
    update((d) => ({
      ...d,
      appliedRates: { ...d.appliedRates, [key]: d.appliedRates[key].map((x, i) => (i === qlIdx ? v : x)) },
      confirmedInputs: confirmInput(d.confirmedInputs, `sum:prc:${key}:${qlIdx}`),
    }));

  const pctCell = (key: string, mode: PctMode, value: number, colTcv: number, qlIdx: number) => {
    switch (mode.kind) {
      case 'hundred':
        return <td className="num pct-col" key={key}>100.00%</td>;
      case 'share':
        return <td className="num pct-col muted" key={key}>{colTcv ? pct(value / colTcv, 2) : '0.00%'}</td>;
      case 'edit': {
        const cellKey = `${mode.ckey}:${qlIdx}`;
        return (
          <td className={`num pct-col rate-cell ${verified(cellKey) ? 'verified' : ''}`} key={key}>
            <NumCell
              value={+(mode.get(qlIdx) * 100).toFixed(2)}
              editable={canDeal}
              format={(v) => `${v.toFixed(2)}%`}
              onCommit={(v) => mode.set(qlIdx, v / 100)}
            />
          </td>
        );
      }
      case 'fin': {
        // Editable only in the Total column; per-quote-line % cells stay blank
        if (qlIdx !== -1) return <td className="num pct-col" key={key} />;
        const effective = bc.financeOverridePct ?? (s.total.tcv ? s.financeCostTotal / s.total.tcv : 0);
        return (
          <td className={`num pct-col rate-cell ${verified('sum:fin') ? 'verified' : ''}`} key={key}>
            <NumCell
              value={+(effective * 100).toFixed(2)}
              editable={canDeal}
              format={(v) => `${v.toFixed(2)}%`}
              onCommit={(v) =>
                update((d) => ({
                  ...d,
                  financeOverridePct: v / 100,
                  confirmedInputs: confirmInput(d.confirmedInputs, 'sum:fin'),
                }))
              }
            />
          </td>
        );
      }
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
    // Applied-% rows show NO share % in the Total column (blank, as in the
    // template); the Finance row keeps its editable total %.
    const totalMode: PctMode =
      mode.kind === 'edit' ? { kind: 'none' } : mode.kind === 'hundred' ? { kind: 'hundred' } : mode;
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

  /** Money input cell for the Other Indirect rows: amber until verified, then green */
  const oiCell = (ckey: string, value: number, format: (v: number) => string, commit: (v: number) => void) => (
    <span className={`rate-wrap ${verified(ckey) ? 'verified' : ''}`}>
      <NumCell value={value} editable={canEditIndirect} format={format} onCommit={commit} />
    </span>
  );

  return (
    <div className="tab-body">
      <div className="review-toolbar">
        <span className="review-progress">{verifiedCount} of {totalInputs} input cells verified</span>
        {toReview > 0 && (
          <label>
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Show only rows needing review
          </label>
        )}
        {(canDeal || canEditIndirect) && toReview > 0 && (
          <Button compact onClick={() => setConfirmAllOpen(true)}>Confirm all in this tab</Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmAllOpen}
        title={`Confirm all ${toReview} remaining input cells?`}
        confirmLabel="Confirm all input cells"
        onConfirm={() => { setConfirmAllOpen(false); confirmAll(); }}
        onClose={() => setConfirmAllOpen(false)}
      >
        Every applied-% and indirect-cost input cell on this tab will be marked as verified by you,
        keeping the AI-applied defaults. Only do this after reviewing the rates.
      </ConfirmDialog>
      <div className="scroll-x">
      <table className="grid summary-grid sticky-sum">
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
          {!filterOn && row('tcv', 'TCV', <b>{money(s.total.tcv)}</b>, (i) => <b>{money(cols[i].tcv)}</b>,
            s.total.tcv, (i) => cols[i].tcv, { kind: 'hundred' }, 'section-row')}
          {!filterOn && ALL_CATEGORIES.map((c) =>
            row(`tcv-${c}`, `　${c} (sell)`, money(s.total.tcvByCat[c]), (i) => money(cols[i].tcvByCat[c]),
              s.total.tcvByCat[c], (i) => cols[i].tcvByCat[c], { kind: 'share' }),
          )}

          {!filterOn && row('dc', 'Direct Cost', <b>{money(s.total.directTotal)}</b>, (i) => <b>{money(cols[i].directTotal)}</b>,
            s.total.directTotal, (i) => cols[i].directTotal, { kind: 'share' }, 'section-row')}
          {!filterOn && ALL_CATEGORIES.map((c) =>
            row(`dc-${c}`,
              <Fx f={c === 'Internal Labour'
                ? "= SUMIFS('Resource Plan'! Total Cost, Quote Line)"
                : `= SUMIFS('Product Plan'! Total Cost, Quote Line, Category = "${c}")`}>
                {`　${c}`}
              </Fx>,
              money(s.total.directByCat[c]), (i) => money(cols[i].directByCat[c]),
              s.total.directByCat[c], (i) => cols[i].directByCat[c], { kind: 'share' }),
          )}

          {!filterOn && row('gp', 'Gross Profit', <b>{money(s.total.grossProfit)}</b>, (i) => <b>{money(cols[i].grossProfit)}</b>,
            s.total.grossProfit, (i) => cols[i].grossProfit, { kind: 'share' }, 'section-row')}

          {!filterOn && row('ic', 'Indirect Cost', <b>{money(s.total.indirectTotal)}</b>, (i) => <b>{money(cols[i].indirectTotal)}</b>,
            s.total.indirectTotal, (i) => cols[i].indirectTotal, { kind: 'none' }, 'section-row')}

          {ALL_CATEGORIES.some((c) => showRow(`sum:cont:${c}`)) &&
            row('cont', '　Contingency', money(s.total.contingencyTotal), (i) => money(cols[i].contingencyTotal),
              s.total.contingencyTotal, (i) => cols[i].contingencyTotal, { kind: 'none' })}
          {ALL_CATEGORIES.filter((c) => showRow(`sum:cont:${c}`)).map((c) =>
            row(`cont-${c}`, `　　Contingency - ${c}`, money(s.total.contingencyByCat[c]), (i) => money(cols[i].contingencyByCat[c]),
              s.total.contingencyByCat[c], (i) => cols[i].contingencyByCat[c],
              { kind: 'edit', ckey: `sum:cont:${c}`, get: (i) => bc.appliedRates.contingency[c][i] ?? 0, set: (i, v) => setRate('contingency', c, i, v) }),
          )}

          {ALL_CATEGORIES.some((c) => showRow(`sum:infl:${c}`)) &&
            row('infl', '　Inflation', money(s.total.inflationTotal), (i) => money(cols[i].inflationTotal),
              s.total.inflationTotal, (i) => cols[i].inflationTotal, { kind: 'none' })}
          {ALL_CATEGORIES.filter((c) => showRow(`sum:infl:${c}`)).map((c) =>
            row(`infl-${c}`,
              <Fx f={'Applied %: typed per quote line.\n0% is forced on vendor-committed lines\nin the Product Plan.'}>{`　　Inflation - ${c}`}</Fx>,
              money(s.total.inflationByCat[c]), (i) => money(cols[i].inflationByCat[c]),
              s.total.inflationByCat[c], (i) => cols[i].inflationByCat[c],
              { kind: 'edit', ckey: `sum:infl:${c}`, get: (i) => bc.appliedRates.inflation[c][i] ?? 0, set: (i, v) => setRate('inflation', c, i, v) }),
          )}

          {!filterOn && row('oic', '　Other Indirect Cost', money(s.total.otherIndirectTotal), (i) => money(cols[i].otherIndirectTotal),
            s.total.otherIndirectTotal, (i) => cols[i].otherIndirectTotal, { kind: 'none' })}
          {(!filterOn || !verified('sum:fin')) && row('fin',
            <Fx f={"= 'Cash Flow'! Σ compound interest\n  × this line's share of Direct Cost"}>　　Finance Cost</Fx>,
            money(s.financeCostTotal), (i) => money(cols[i].financeCost),
            s.financeCostTotal, (i) => cols[i].financeCost, { kind: 'fin' })}
          {showRow('sum:prc:prcHwSw') && row('prc1',
            <Fx f={'Applies only when Quote Currency = CNY\n= (Hardware + Software direct cost) × applied %'}>　　PRC Tax on Hardware &amp; Software</Fx>,
            money(s.total.prcHwSw), (i) => money(cols[i].prcHwSw),
            s.total.prcHwSw, (i) => cols[i].prcHwSw,
            { kind: 'edit', ckey: 'sum:prc:prcHwSw', get: (i) => bc.appliedRates.prcHwSw[i] ?? 0, set: (i, v) => setPrc('prcHwSw', i, v) })}
          {showRow('sum:prc:prcOps') && row('prc2',
            <Fx f={'Applies only when Quote Currency = CNY\n= (Labour + External Service + Telephony +\n   Real Estate direct cost) × applied %'}>　　PRC Tax on Operation, External Service &amp; Internal Labour</Fx>,
            money(s.total.prcOps), (i) => money(cols[i].prcOps),
            s.total.prcOps, (i) => cols[i].prcOps,
            { kind: 'edit', ckey: 'sum:prc:prcOps', get: (i) => bc.appliedRates.prcOps[i] ?? 0, set: (i, v) => setPrc('prcOps', i, v) })}
          {showRow('sum:prc:prcStamp') && row('prc3',
            <Fx f={'Applies only when Quote Currency = CNY\n= Direct Cost × applied %'}>　　PRC Stamp Duty</Fx>,
            money(s.total.prcStamp), (i) => money(cols[i].prcStamp),
            s.total.prcStamp, (i) => cols[i].prcStamp,
            { kind: 'edit', ckey: 'sum:prc:prcStamp', get: (i) => bc.appliedRates.prcStamp[i] ?? 0, set: (i, v) => setPrc('prcStamp', i, v) })}
          {showRow('sum:oi:travelExpense') && row('te', '　　Travel & Expense', money(s.total.travelExpense), (i) =>
            oiCell(`sum:oi:travelExpense:${i}`, cols[i].travelExpense, (v) => money(v), (v) =>
              update((d) => ({ ...d, otherIndirect: { ...d.otherIndirect, travelExpense: d.otherIndirect.travelExpense.map((x, j) => (j === i ? v : x)) }, confirmedInputs: confirmInput(d.confirmedInputs, `sum:oi:travelExpense:${i}`) }))),
            s.total.travelExpense, (i) => cols[i].travelExpense, { kind: 'none' })}
          {showRow('sum:oi:otherCosts') && row('oc', '　　Other Costs', money(s.total.otherCosts), (i) =>
            oiCell(`sum:oi:otherCosts:${i}`, cols[i].otherCosts, (v) => money(v), (v) =>
              update((d) => ({ ...d, otherIndirect: { ...d.otherIndirect, otherCosts: d.otherIndirect.otherCosts.map((x, j) => (j === i ? v : x)) }, confirmedInputs: confirmInput(d.confirmedInputs, `sum:oi:otherCosts:${i}`) }))),
            s.total.otherCosts, (i) => cols[i].otherCosts, { kind: 'none' })}
          {showRow('sum:oi:vendorRebate') && row('vr', '　　Vendor Rebate (credit)', money(-s.total.vendorRebate), (i) =>
            oiCell(`sum:oi:vendorRebate:${i}`, cols[i].vendorRebate, (v) => money(-v), (v) =>
              update((d) => ({ ...d, otherIndirect: { ...d.otherIndirect, vendorRebate: d.otherIndirect.vendorRebate.map((x, j) => (j === i ? v : x)) }, confirmedInputs: confirmInput(d.confirmedInputs, `sum:oi:vendorRebate:${i}`) }))),
            -s.total.vendorRebate, (i) => -cols[i].vendorRebate, { kind: 'none' })}

          {!filterOn && row('tc', 'Total Cost (Direct + Indirect)', <b>{money(s.total.totalCost)}</b>, (i) => <b>{money(cols[i].totalCost)}</b>,
            s.total.totalCost, (i) => cols[i].totalCost, { kind: 'share' }, 'section-row')}
          {!filterOn && row('eb', 'EBITDA',
            <b className={s.total.ebitda >= 0 ? 'pos' : 'neg'}>{money(s.total.ebitda)}</b>,
            (i) => <b className={cols[i].ebitda >= 0 ? 'pos' : 'neg'}>{money(cols[i].ebitda)}</b>,
            s.total.ebitda, (i) => cols[i].ebitda, { kind: 'share' }, 'section-row ebitda-row')}
        </tbody>
      </table>
      </div>
    </div>
  );
}
