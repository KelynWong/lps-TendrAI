// Cash Flow tab - monthly cash position: named vendor-payment columns
// (BD-editable, BD can add vendors), internal labour (from Labour Inputs),
// repayments (from the Billing Plan), compound interest, ending balance and
// mismatch amount.

import { computeSummary, FINANCE_RATE_PA, sum } from '../../lib/calc';
import { money, pct } from '../../lib/format';
import { useState } from 'react';
import { can, useStore } from '../../state/store';
import { confirmInput, useDraft } from '../../state/draft';
import { Plus, X } from 'lucide-react';
import { Fx, NumCell, TextCell } from '../../components/common';
import { Button, ConfirmDialog, IconButton } from '../../ui/ui';

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

  const [onlyReview, setOnlyReview] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [removeCol, setRemoveCol] = useState<string | null>(null);
  const verified = (k: string) => bc.confirmedInputs.includes(k);
  const colVerified = (id: string) => verified(`cf:${id}`);
  const verifiedCount = bc.vendorCols.filter((c) => colVerified(c.id)).length;
  const totalCols = bc.vendorCols.length;
  const toReviewCols = totalCols - verifiedCount;
  const filterOn = onlyReview && toReviewCols > 0;
  const cols = filterOn ? bc.vendorCols.filter((c) => !colVerified(c.id)) : bc.vendorCols;

  const confirmAll = () =>
    update((d) => ({
      ...d,
      // Column key (tracked for the tab badge) plus every cell key (green)
      confirmedInputs: d.vendorCols.reduce(
        (acc, c) =>
          [
            `cf:${c.id}`,
            `cf:${c.id}:name`,
            ...c.amounts.map((_, i) => `cf:${c.id}:${i}`),
          ].reduce(confirmInput, acc),
        d.confirmedInputs,
      ),
    }));

  const deleteCol = (id: string) =>
    update((d) => ({
      ...d,
      vendorCols: d.vendorCols.filter((c) => c.id !== id),
      confirmedInputs: d.confirmedInputs.filter((k) => !k.startsWith(`cf:${id}`)),
    }));

  const setAmount = (colId: string, monthIdx: number, v: number) =>
    update((d) => ({
      ...d,
      vendorCols: d.vendorCols.map((c) =>
        c.id === colId
          ? { ...c, amounts: c.amounts.map((x, i) => (i === monthIdx ? v : x)) }
          : c,
      ),
      // Column key counts for the tab badge; the cell key turns ONLY this cell green
      confirmedInputs: confirmInput(confirmInput(d.confirmedInputs, `cf:${colId}`), `cf:${colId}:${monthIdx}`),
    }));

  const addVendor = () => {
    const id = `v${Date.now()}`;
    update((d) => ({
      ...d,
      vendorCols: [...d.vendorCols, { id, name: 'New vendor', amounts: new Array(duration).fill(0) }],
      // A column a person adds is their own input, not an AI estimate
      confirmedInputs: confirmInput(d.confirmedInputs, `cf:${id}`),
    }));
  };

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
      <div className="review-toolbar">
        <span className="review-progress">{verifiedCount} of {totalCols} vendor columns verified</span>
        {toReviewCols > 0 && (
          <label>
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Show only columns needing review
          </label>
        )}
        {canDeal && toReviewCols > 0 && (
          <Button compact onClick={() => setConfirmAllOpen(true)}>Confirm all in this tab</Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmAllOpen}
        title={`Confirm all ${totalCols - verifiedCount} remaining vendor columns?`}
        confirmLabel="Confirm all vendor columns"
        onConfirm={() => { setConfirmAllOpen(false); confirmAll(); }}
        onClose={() => setConfirmAllOpen(false)}
      >
        Every vendor-payment column drafted from the Product Plan will be marked as verified by you.
        Only do this after reviewing the monthly amounts.
      </ConfirmDialog>
      <ConfirmDialog
        open={removeCol !== null}
        title={`Remove vendor column ${bc.vendorCols.find((c) => c.id === removeCol)?.name ?? ''}?`}
        confirmLabel="Remove column"
        danger
        onConfirm={() => { if (removeCol) deleteCol(removeCol); setRemoveCol(null); }}
        onClose={() => setRemoveCol(null)}
      >
        All monthly payment amounts in this column are removed from the cash flow. Use Discard in
        the save bar to restore unsaved removals.
      </ConfirmDialog>
      <div className="scroll-x">
        <table className="grid tiny sticky-3">
          <thead>
            <tr>
              <th><Fx f={'= DATE(start FY, month n)\nTimeline runs Project Start → Project End'}>Period</Fx></th>
              <th className="num"><Fx f={'= Project year of the Period (derived)'}>Year</Fx></th>
              <th className="num"><Fx f={'= Ending Balance of the previous month'}>Opening Balance</Fx></th>
              {cols.map((c) => (
                <th className={`num vendor-col rate-cell ${verified(`cf:${c.id}:name`) ? 'verified' : ''}`} key={c.id}>
                  <div className="vendor-col-head">
                    <span className="muted small">Pay to vendor</span>
                    {canDeal && (
                      <IconButton
                        danger
                        label={`Remove vendor column ${c.name}`}
                        icon={X}
                        onClick={() => setRemoveCol(c.id)}
                      />
                    )}
                  </div>
                  <TextCell
                    value={c.name}
                    editable={canDeal}
                    onCommit={(v) =>
                      update((d) => ({
                        ...d,
                        vendorCols: d.vendorCols.map((x) => (x.id === c.id ? { ...x, name: v } : x)),
                        confirmedInputs: confirmInput(confirmInput(d.confirmedInputs, `cf:${c.id}`), `cf:${c.id}:name`),
                      }))
                    }
                  />
                </th>
              ))}
              {canDeal && (
                <th className="add-col" onClick={addVendor} title="Add pay-to-vendor column">
                  <button className="add-col-btn" aria-label="Add pay-to-vendor column" onClick={(e) => { e.stopPropagation(); addVendor(); }}>
                    <Plus size={13} aria-hidden />
                  </button>
                </th>
              )}
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
                  <td className={`num rate-cell ${verified(`cf:${c.id}:${idx}`) ? 'verified' : ''}`} key={c.id}>
                    <NumCell
                      value={Math.round(c.amounts[idx] ?? 0)}
                      editable={canDeal}
                      format={(v) => (v ? money(-v) : '-')}
                      onCommit={(v) => setAmount(c.id, idx, v)}
                    />
                  </td>
                ))}
                {canDeal && <td className="add-col" onClick={addVendor} title="Add pay-to-vendor column" />}
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
              {canDeal && <td className="add-col" onClick={addVendor} title="Add pay-to-vendor column" />}
              <td className="num">{money(-sum(months.map((m) => m.labourPay)))}</td>
              <td className="num">{money(sum(months.map((m) => m.repayment)))}</td>
              <td className="num">{money(s.financeCostTotal)}</td>
              <td />
              <td className="num">{money(sum(months.map((m) => m.mismatch)))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
