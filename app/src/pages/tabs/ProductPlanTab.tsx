// Product Plan tab - vendor procurement line items. Quote Line and Solution
// Offering are twin dropdowns over the quote lines defined in Basic Info;
// quantity AND cost are broken down per FY with totals (no inflation columns -
// inflation lives on the Summary tab's applied-% rows).

import { fyLabel, productItemCost, productItemTotal, sum } from '../../lib/calc';
import { money } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { Fx, NumCell, ProvenanceBadge, TextCell } from '../../components/common';
import type { Category, ProductItem } from '../../types';
import { FY_COUNT, PRODUCT_CATEGORIES } from '../../types';

let newSeq = 1;

export default function ProductPlanTab() {
  const { state } = useStore();
  const { bc, update } = useDraft();
  const user = state.user!;
  const locked = bc.status === 'approved' || bc.status === 'submitted';
  const editable = !locked && can.editProducts(user.role);
  const baseFY = bc.basicInfo.inflationBaseFY;

  const upd = (item: ProductItem) =>
    update((d) => ({
      ...d,
      productItems: d.productItems.map((p) =>
        p.id === item.id ? { ...item, provenance: { kind: 'human', confirmedBy: user.name } } : p,
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
          provenance: { kind: 'human', confirmedBy: user.name },
        },
      ],
    }));

  const removeRow = (id: string) =>
    update((d) => ({ ...d, productItems: d.productItems.filter((p) => p.id !== id) }));

  const qlById = (id: number) => bc.quoteLines.find((q) => q.id === id);
  const fyIdx = Array.from({ length: FY_COUNT }, (_, i) => i);
  const grandQty = sum(bc.productItems.map((it) => sum(it.qtyByFY)));
  const grandCostFY = fyIdx.map((i) => sum(bc.productItems.map((it) => productItemCost(it)[i])));
  const grand = sum(bc.productItems.map(productItemTotal));

  return (
    <div className="tab-body scroll-x">
      <table className="grid wide">
        <thead>
          <tr>
            <th rowSpan={2}>QL</th>
            <th rowSpan={2}><Fx f={'= the Solution Offering of the selected\nQuote Line (Basic Info section II).\nPicking an offering reassigns the line.'}>Solution Offering</Fx></th>
            <th rowSpan={2}>Category</th>
            <th rowSpan={2}>Commodity / Service Description</th>
            <th rowSpan={2}>Vendor</th>
            <th rowSpan={2} title="No inflation applied if Vendor Commitment = Yes">Commit</th>
            <th rowSpan={2} className="num">Unit Cost</th>
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
          {bc.productItems.map((it) => {
            const costs = productItemCost(it);
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
                  {it.remarks && <div className="muted small">{it.remarks}</div>}
                </td>
                <td><TextCell value={it.vendor} editable={editable} onCommit={(v) => upd({ ...it, vendor: v })} /></td>
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
                  <NumCell value={it.unitCost} editable={editable} format={(v) => money(v)} onCommit={(v) => upd({ ...it, unitCost: v })} />
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
                <td className="num strong">{money(productItemTotal(it))}</td>
                <td><ProvenanceBadge p={it.provenance} /></td>
                {editable && (
                  <td>
                    <button className="icon-btn" title="Remove line" onClick={() => removeRow(it.id)}>✕</button>
                  </td>
                )}
              </tr>
            );
          })}
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
      {editable && <button className="btn" onClick={addRow}>+ Add line item</button>}
    </div>
  );
}
