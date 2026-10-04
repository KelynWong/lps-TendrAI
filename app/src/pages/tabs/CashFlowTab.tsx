// Cash Flow tab - monthly cash position: named vendor-payment columns
// (BD-editable, BD can add vendors), internal labour (from Labour Inputs),
// repayments (from the Billing Plan), compound interest, ending balance and
// mismatch amount.

import { computeSummary, FINANCE_RATE_PA, sum } from '../../lib/calc';
import { money, pct } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { Fx, NumCell, TextCell } from '../../components/common';

export default function CashFlowTab() {
  const { state } = useStore();
  const { bc, update } = useDraft();
  const user = state.user!;
  const s = computeSummary(bc);
  const months = s.months;
  const duration = months.length;
  const mismatchMonths = months.filter((m) => m.mismatch > 0).length;
  const locked = bc.status === 'approved' || bc.status === 'submitted';
  const canDeal = !locked && can.editDealStructure(user.role); // BD + sponsors

  const cols = bc.vendorCols;

  const setAmount = (colId: string, monthIdx: number, v: number) =>
    update((d) => ({
      ...d,
      vendorCols: d.vendorCols.map((c) =>
        c.id === colId
          ? { ...c, amounts: c.amounts.map((x, i) => (i === monthIdx ? v : x)) }
          : c,
      ),
    }));

  const addVendor = () =>
    update((d) => ({
      ...d,
      vendorCols: [
        ...d.vendorCols,
        { id: `v${Date.now()}`, name: 'New vendor', amounts: new Array(duration).fill(0) },
      ],
    }));

  return (
    <div className="tab-body">
      <div className="kpi-row">
        <div className="kpi">
          <span>Compound Interest (total)</span>
          <b><Fx f={'= Σ monthly compound interest\nRead back by Summary! Finance Cost,\nallocated to quote lines by cost share.'}>{money(s.financeCostTotal)}</Fx></b>
        </div>
        <div className="kpi"><span>Mismatch months</span><b className={mismatchMonths ? 'neg' : 'pos'}>{mismatchMonths}</b></div>
        <div className="kpi"><span>Peak mismatch amount</span><b>{money(Math.max(...months.map((m) => m.mismatch), 0))}</b></div>
        <div className="kpi"><span>Interest rate applied</span><b>{pct(FINANCE_RATE_PA)} p.a.</b></div>
      </div>
      <div className="scroll-x">
        <table className="grid tiny">
          <thead>
            <tr>
              <th><Fx f={'= DATE(start FY, month n)\nTimeline runs Project Start → Project End'}>Period</Fx></th>
              <th className="num"><Fx f={'= Project year of the Period (derived)'}>Year</Fx></th>
              <th className="num"><Fx f={'= Ending Balance of the previous month'}>Opening Balance</Fx></th>
              {cols.map((c) => (
                <th className="num vendor-col" key={c.id}>
                  <div className="muted small">Pay to vendor</div>
                  <TextCell
                    value={c.name}
                    editable={canDeal}
                    onCommit={(v) =>
                      update((d) => ({ ...d, vendorCols: d.vendorCols.map((x) => (x.id === c.id ? { ...x, name: v } : x)) }))
                    }
                  />
                </th>
              ))}
              <th className="num"><Fx f={"= Σ Labour Inputs! man-days (month)\n  × 'Resource Plan'! Day Rate"}>Internal Labour</Fx></th>
              <th className="num"><Fx f={"= SUMIFS('Basic Info'! Billing Amount,\n         Billing Month = Period)"}>Repayment</Fx></th>
              <th className="num"><Fx f={'= Mismatch Amount × 5.5% ÷ 12\nCharged into the Ending Balance,\nso it compounds month on month.'}>Compound Interest</Fx></th>
              <th className="num"><Fx f={'= Opening − Vendors − Labour\n  + Repayment − Interest'}>Ending Balance</Fx></th>
              <th className="num"><Fx f={'= the funding gap before interest\n  (positive when the balance is short)'}>Mismatch Amount</Fx></th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, idx) => (
              <tr key={m.iso} className={m.mismatch > 0 ? 'row-neg' : ''}>
                <td>{m.label}</td>
                <td className="num muted">{m.yearIdx}</td>
                <td className="num">{money(m.opening)}</td>
                {cols.map((c) => (
                  <td className="num" key={c.id}>
                    <NumCell
                      value={Math.round(c.amounts[idx] ?? 0)}
                      editable={canDeal}
                      format={(v) => (v ? money(-v) : '-')}
                      onCommit={(v) => setAmount(c.id, idx, v)}
                    />
                  </td>
                ))}
                <td className="num">{money(-m.labourPay)}</td>
                <td className="num pos">{money(m.repayment)}</td>
                <td className="num muted">{money(m.financeCost)}</td>
                <td className={`num strong ${m.ending < 0 ? 'neg' : ''}`}>{money(m.ending)}</td>
                <td className="num">{m.mismatch ? money(m.mismatch) : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total</td>
              {cols.map((c) => (
                <td className="num" key={c.id}>{money(-sum(c.amounts))}</td>
              ))}
              <td className="num">{money(-sum(months.map((m) => m.labourPay)))}</td>
              <td className="num">{money(sum(months.map((m) => m.repayment)))}</td>
              <td className="num">{money(s.financeCostTotal)}</td>
              <td />
              <td className="num">{money(sum(months.map((m) => m.mismatch)))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {canDeal && <button className="btn" onClick={addVendor}>+ Add pay-to-vendor column</button>}
    </div>
  );
}
