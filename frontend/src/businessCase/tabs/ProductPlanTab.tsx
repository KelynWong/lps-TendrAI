// Product Plan tab - vendor procurement line items. Quote Line and Solution
// Offering are twin dropdowns over the quote lines defined in Basic Info;
// quantity AND cost are broken down per FY with totals (no inflation columns -
// inflation lives on the Summary tab's applied-% rows).

import { useState } from 'react';
import { X } from 'lucide-react';
import { fyLabel, lineCurrency, productItemCost, productItemTotal, sum, unitCostQuote } from '../calc';
import { CURRENCIES } from '../parameters';
import { money as fmtMoney } from '../format';
import { confirmProv, useDraft } from '../draft';
import { AddRowButton, Fx, NumCell, ProvenanceBadge, TextCell } from '../cells';
import { Button, ConfirmDialog, IconButton } from '../../ui/ui';
import { useToast } from '../../ui/toast';
import type { Category, ProductItem } from '../model';
import { FY_COUNT, PRODUCT_CATEGORIES } from '../model';

let newSeq = 1;

export default function ProductPlanTab() {
  const { bc, update, editable: canEditBc, userName } = useDraft();
  // figures show in the quote currency (Basic Info)
  const money = (v: number, currency = bc.basicInfo.currency) => fmtMoney(v, currency);
  const user = { name: userName };
  const toast = useToast();
  const locked = !canEditBc;
  const editable = !locked;
  const baseFY = bc.basicInfo.inflationBaseFY;
  const [onlyReview, setOnlyReview] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  const confirmed = bc.productItems.filter((p) => p.provenance.kind === 'human').length;
  const totalItems = bc.productItems.length;
  const toReview = totalItems - confirmed;
  const filterOn = onlyReview && toReview > 0;
  const visibleItems = filterOn
    ? bc.productItems.filter((p) => p.provenance.kind !== 'human')
    : bc.productItems;

  // Confirm-all and edits KEEP any citation; edits are flagged as changed
  const confirmAll = () =>
    update((d) => ({
      ...d,
      productItems: d.productItems.map((p) =>
        p.provenance.kind === 'human' ? p : { ...p, provenance: confirmProv(p.provenance, user.name, false) },
      ),
    }));

  const upd = (item: ProductItem) =>
    update((d) => ({
      ...d,
      productItems: d.productItems.map((p) =>
        p.id === item.id ? { ...item, provenance: confirmProv(item.provenance, user.name, true) } : p,
      ),
    }));

  const addRow = () =>
    update((d) => ({
      ...d,
      productItems: [
        ...d.productItems,
        {
          id: `pn${newSeq++}-${Date.now()}`,
          quoteLine: d.quoteLines[0]?.id ?? 1,
          category: 'Software' as Category,
          description: 'New line item',
          vendor: '',
          vendorCommitment: false,
          unitCost: 0,
          qtyByFY: new Array(FY_COUNT).fill(0),
          remarks: '',
          currency: d.basicInfo.currency,
          provenance: { kind: 'human', confirmedBy: user.name },
        },
      ],
    }));

  const removeRow = (id: string) => {
    update((d) => ({ ...d, productItems: d.productItems.filter((p) => p.id !== id) }));
    toast.push('info', 'Line item removed', 'Use Discard in the save bar to restore unsaved removals.');
  };

  const qlById = (id: number) => bc.quoteLines.find((q) => q.id === id);
  const fyIdx = Array.from({ length: FY_COUNT }, (_, i) => i);
  const grandQty = sum(bc.productItems.map((it) => sum(it.qtyByFY)));
  const grandCostFY = fyIdx.map((i) => sum(bc.productItems.map((it) => productItemCost(it, bc)[i])));
  const grand = sum(bc.productItems.map((x) => productItemTotal(x, bc)));

  return (
    <div className="tab-body">
      <div className="review-toolbar">
        <span className="review-progress">{confirmed} of {totalItems} line items confirmed</span>
        {toReview > 0 && (
          <label>
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Show only items needing review
          </label>
        )}
        {editable && toReview > 0 && (
          <Button compact onClick={() => setConfirmAllOpen(true)}>Confirm all in this tab</Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmAllOpen}
        title={`Confirm all ${totalItems - confirmed} remaining line items?`}
        confirmLabel="Confirm all line items"
        onConfirm={() => { setConfirmAllOpen(false); confirmAll(); }}
        onClose={() => setConfirmAllOpen(false)}
      >
        Every AI-suggested line item in this tab will be marked as confirmed by you.
        Only do this after reviewing the figures.
      </ConfirmDialog>
      <div className="scroll-x">
      <table className="grid wide sticky-first">
        <thead>
          <tr>
            <th rowSpan={2}>QL</th>
            <th rowSpan={2}><Fx f={'= the Solution Offering of the selected\nQuote Line (Basic Info section II).\nPicking an offering reassigns the line.'}>Solution Offering</Fx></th>
            <th rowSpan={2}>Category</th>
            <th rowSpan={2}>Commodity / Service Description</th>
            <th rowSpan={2} title="No inflation applied if Vendor Commitment = Yes">Commit</th>
            <th rowSpan={2} className="num">Unit Cost</th>
            <th rowSpan={2}>Remarks</th>
            <th colSpan={FY_COUNT + 1} className="num group-th">Quantity</th>
            <th colSpan={FY_COUNT + 1} className="num group-th">Total Cost</th>
            <th rowSpan={2}>Source</th>
            {editable && <th rowSpan={2} />}
          </tr>
          <tr>
            {fyIdx.map((i) => <th className="num" key={`q${i}`}>FY{fyLabel(baseFY, i)}</th>)}
            <th className="num">Total</th>
            {fyIdx.map((i) => (
              <th className="num" key={`c${i}`}>
                <Fx f={'= Qty × Unit Cost for this FY'}>FY{fyLabel(baseFY, i)}</Fx>
              </th>
            ))}
            <th className="num"><Fx f={'= Σ FY costs; summed into Summary!\nDirect Cost via SUMIFS(QL, Category).'}>Total</Fx></th>
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((it) => {
            const costs = productItemCost(it, bc);
            return (
              <tr key={it.id}>
                <td>
                  {editable ? (
                    <select value={it.quoteLine} onChange={(e) => upd({ ...it, quoteLine: +e.target.value })}>
                      {bc.quoteLines.map((q) => <option key={q.id} value={q.id}>{q.id}</option>)}
                    </select>
                  ) : it.quoteLine}
                </td>
                <td>
                  {editable ? (
                    <select value={it.quoteLine} onChange={(e) => upd({ ...it, quoteLine: +e.target.value })}>
                      {bc.quoteLines.map((q) => (
                        <option key={q.id} value={q.id}>{q.solutionOffering}</option>
                      ))}
                    </select>
                  ) : (
                    qlById(it.quoteLine)?.solutionOffering ?? '-'
                  )}
                </td>
                <td>
                  {editable ? (
                    <select value={it.category} onChange={(e) => upd({ ...it, category: e.target.value as Category })}>
                      {PRODUCT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  ) : it.category}
                </td>
                <td className="desc">
                  <TextCell value={it.description} editable={editable} onCommit={(v) => upd({ ...it, description: v })} />
                </td>
                <td>
                  {editable ? (
                    <input
                      type="checkbox"
                      checked={it.vendorCommitment}
                      onChange={(e) => upd({ ...it, vendorCommitment: e.target.checked })}
                    />
                  ) : it.vendorCommitment ? 'Yes' : 'No'}
                </td>
                <td className="num">
                  <NumCell value={it.unitCost} editable={editable} format={(v) => money(v, lineCurrency(bc, it))} onCommit={(v) => upd({ ...it, unitCost: v })} />
                  <div className="small">
                    {editable ? (
                      <select
                        value={lineCurrency(bc, it)}
                        aria-label={`Currency the vendor priced ${it.description} in`}
                        title="Currency of the vendor quote; converted to the quote currency at the Basic Info exchange rates"
                        onChange={(e) => upd({ ...it, currency: e.target.value })}
                      >
                        {CURRENCIES.map(([code]) => <option key={code}>{code}</option>)}
                      </select>
                    ) : lineCurrency(bc, it)}
                    {lineCurrency(bc, it) !== bc.basicInfo.currency && (
                      <Fx f={`= Unit cost × ${bc.basicInfo.currency} rate ÷ ${lineCurrency(bc, it)} rate\n(Basic Info exchange rates, to 1 USD)`}>
                        <div className="muted">= {money(unitCostQuote(it, bc))}</div>
                      </Fx>
                    )}
                  </div>
                </td>
                <td className="desc">
                  <TextCell value={it.remarks} editable={editable} onCommit={(v) => upd({ ...it, remarks: v })} />
                </td>
                {it.qtyByFY.map((q, i) => (
                  <td className="num" key={`q${i}`}>
                    <NumCell
                      value={q}
                      editable={editable}
                      onCommit={(v) => {
                        const qty = [...it.qtyByFY];
                        qty[i] = v;
                        upd({ ...it, qtyByFY: qty });
                      }}
                    />
                  </td>
                ))}
                <td className="num">{sum(it.qtyByFY).toLocaleString()}</td>
                {costs.map((c, i) => (
                  <td className="num muted" key={`c${i}`}>{money(c)}</td>
                ))}
                <td className="num strong">{money(productItemTotal(it, bc))}</td>
                <td><ProvenanceBadge p={it.provenance} context={it.description} tab="Product Plan" /></td>
                {editable && (
                  <td>
                    <IconButton danger label="Remove line item" icon={X} onClick={() => removeRow(it.id)} />
                  </td>
                )}
              </tr>
            );
          })}
          {editable && (
            <AddRowButton
              colSpan={7 + (FY_COUNT + 1) * 2 + 2}
              label="Add line item"
              onClick={addRow}
            />
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7}>Total</td>
            {fyIdx.map((i) => (
              <td className="num" key={`q${i}`}>{sum(bc.productItems.map((it) => it.qtyByFY[i] ?? 0)).toLocaleString()}</td>
            ))}
            <td className="num">{grandQty.toLocaleString()}</td>
            {grandCostFY.map((c, i) => (
              <td className="num" key={`c${i}`}>{money(c)}</td>
            ))}
            <td className="num">{money(grand)}</td>
            <td colSpan={editable ? 2 : 1} />
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}
