// Resource Plan tab - internal labour effort. Quote Line / Solution Offering
// twin dropdowns, fixed Team / Role / Grade lists, client-facing Remarks after
// the day rate (synced with Labour Inputs), man-days AND cost per FY with
// totals (no inflation columns - inflation lives on the Summary tab).

import { fyLabel, resourceItemCost, resourceItemTotal, sum, MANDAY_PER_MONTH } from '../../lib/calc';
import { money } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { Fx, NumCell, ProvenanceBadge, TextCell } from '../../components/common';
import type { ResourceItem } from '../../types';
import { FY_COUNT } from '../../types';
import { GRADES, ROLES, TEAMS, withCurrent } from '../../data/parameters';

let newSeq = 1;

export default function ResourcePlanTab() {
  const { state } = useStore();
  const { bc, update } = useDraft();
  const user = state.user!;
  const locked = bc.status === 'approved' || bc.status === 'submitted';
  const editable = !locked && can.editResources(user.role);
  const canRates = !locked && can.editRatesAndMargins(user.role);
  const baseFY = bc.basicInfo.inflationBaseFY;

  const upd = (item: ResourceItem) =>
    update((d) => {
      // Editing FY man-days directly drops any manual monthly distribution
      const prev = d.resourceItems.find((r) => r.id === item.id);
      const mdChanged = prev && prev.mandaysByFY.join(',') !== item.mandaysByFY.join(',');
      const labourMonthly = { ...d.labourMonthly };
      if (mdChanged) delete labourMonthly[item.id];
      return {
        ...d,
        labourMonthly,
        resourceItems: d.resourceItems.map((r) =>
          r.id === item.id ? { ...item, provenance: { kind: 'human', confirmedBy: user.name } } : r,
        ),
      };
    });

  const addRow = () =>
    update((d) => ({
      ...d,
      resourceItems: [
        ...d.resourceItems,
        {
          id: `rn${newSeq++}-${Date.now()}`,
          quoteLine: d.quoteLines[0]?.id ?? 1,
          team: TEAMS[0],
          role: ROLES[0],
          grade: '4',
          teamCode: 'INS-CL-SG',
          dayRate: 600,
          mandaysByFY: new Array(FY_COUNT).fill(0),
          remarks: '',
          mspoRole: 'CONS-II (Consulting)',
          provenance: { kind: 'human', confirmedBy: user.name },
        },
      ],
    }));

  const removeRow = (id: string) =>
    update((d) => ({ ...d, resourceItems: d.resourceItems.filter((r) => r.id !== id) }));

  const qlById = (id: number) => bc.quoteLines.find((q) => q.id === id);
  const fyIdx = Array.from({ length: FY_COUNT }, (_, i) => i);
  const totalMd = sum(bc.resourceItems.map((r) => sum(r.mandaysByFY)));
  const grandCostFY = fyIdx.map((i) => sum(bc.resourceItems.map((r) => resourceItemCost(r)[i])));
  const grand = sum(bc.resourceItems.map(resourceItemTotal));

  const sel = (value: string, options: string[], onChange: (v: string) => void) =>
    editable ? (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    ) : (
      <span>{value}</span>
    );

  return (
    <div className="tab-body scroll-x">
      <table className="grid wide">
        <thead>
          <tr>
            <th rowSpan={2}>QL</th>
            <th rowSpan={2}><Fx f={'= the Solution Offering of the selected\nQuote Line (Basic Info section II).\nPicking an offering reassigns the line.'}>Solution Offering</Fx></th>
            <th rowSpan={2}>Team</th>
            <th rowSpan={2}>Role</th>
            <th rowSpan={2}>Grade</th>
            <th rowSpan={2} className="num">
              <Fx f={'= iRate lookup (Team + Grade), converted\nto the quote currency.\nExecutive Sponsor may override.'}>Day Rate (iRate)</Fx>
            </th>
            <th rowSpan={2}><Fx f={'Client-facing role title.\nSynced with Labour Inputs\n"LPS Role for Client".'}>Remarks</Fx></th>
            <th colSpan={FY_COUNT + 1} className="num group-th">Man-days</th>
            <th colSpan={FY_COUNT + 1} className="num group-th">Total Cost</th>
            <th rowSpan={2}>Source</th>
            {editable && <th rowSpan={2} />}
          </tr>
          <tr>
            {fyIdx.map((i) => <th className="num" key={`m${i}`}>FY{fyLabel(baseFY, i)}</th>)}
            <th className="num"><Fx f={'= SUM(FY man-days)\nDistributed by month on Labour Inputs.'}>Total</Fx></th>
            {fyIdx.map((i) => (
              <th className="num" key={`c${i}`}>
                <Fx f={'= Man-days × Day Rate for this FY'}>FY{fyLabel(baseFY, i)}</Fx>
              </th>
            ))}
            <th className="num"><Fx f={'= Σ FY costs; summed into Summary!\nInternal Labour via SUMIFS(QL).'}>Total</Fx></th>
          </tr>
        </thead>
        <tbody>
          {bc.resourceItems.map((it) => {
            const costs = resourceItemCost(it);
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
                <td>{sel(it.team, withCurrent(it.team, TEAMS), (v) => upd({ ...it, team: v }))}</td>
                <td>{sel(it.role, withCurrent(it.role, ROLES), (v) => upd({ ...it, role: v }))}</td>
                <td>{sel(it.grade, withCurrent(it.grade, GRADES), (v) => upd({ ...it, grade: v }))}</td>
                <td className="num">
                  <NumCell value={it.dayRate} editable={canRates} format={(v) => money(v)} onCommit={(v) => upd({ ...it, dayRate: v })} />
                </td>
                <td className="desc">
                  <TextCell value={it.remarks} editable={editable} onCommit={(v) => upd({ ...it, remarks: v })} />
                </td>
                {it.mandaysByFY.map((d0, i) => (
                  <td className="num" key={`m${i}`}>
                    <NumCell
                      value={d0}
                      editable={editable}
                      onCommit={(v) => {
                        const md = [...it.mandaysByFY];
                        md[i] = v;
                        upd({ ...it, mandaysByFY: md });
                      }}
                    />
                  </td>
                ))}
                <td className="num">{sum(it.mandaysByFY).toLocaleString()}</td>
                {costs.map((c, i) => (
                  <td className="num muted" key={`c${i}`}>{money(c)}</td>
                ))}
                <td className="num strong">{money(resourceItemTotal(it))}</td>
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
            <td colSpan={7}>
              Total · {totalMd.toLocaleString()} man-days (~{Math.round(totalMd / MANDAY_PER_MONTH)} man-months)
            </td>
            {fyIdx.map((i) => (
              <td className="num" key={`m${i}`}>{sum(bc.resourceItems.map((r) => r.mandaysByFY[i] ?? 0)).toLocaleString()}</td>
            ))}
            <td className="num">{totalMd.toLocaleString()}</td>
            {grandCostFY.map((c, i) => (
              <td className="num" key={`c${i}`}>{money(c)}</td>
            ))}
            <td className="num">{money(grand)}</td>
            <td colSpan={editable ? 2 : 1} />
          </tr>
        </tfoot>
      </table>
      {editable && <button className="btn" onClick={addRow}>+ Add labour line</button>}
    </div>
  );
}
