// Labour Inputs tab - MSPO role mapping (editable) and monthly man-day
// distribution. "LPS Role for Client" is the Resource Plan Remarks column
// (editable here too, same field); iRate shows the Resource Plan day rate
// derived from the line's grade. Month edits store a manual distribution and
// resync the Resource Plan FY totals.

import {
  MANDAY_PER_MONTH,
  monthlyMandaysFor,
  monthsBetween,
  monthsToFY,
  resourceItemTotal,
  sum,
} from '../../lib/calc';
import { money } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { Fx, NumCell, TextCell } from '../../components/common';

export default function LabourInputsTab() {
  const { state } = useStore();
  const { bc, update } = useDraft();
  const user = state.user!;
  const duration = Math.max(monthsBetween(bc.basicInfo.projectStart, bc.basicInfo.projectEnd), 1);
  const nMonths = Math.min(duration, 36);
  const start = new Date(bc.basicInfo.projectStart);
  const monthLabels = Array.from({ length: nMonths }, (_, m) => {
    const d = new Date(start.getFullYear(), start.getMonth() + m, 1);
    return d.toLocaleDateString('en-SG', { month: 'short', year: '2-digit' });
  });
  const locked = bc.status === 'approved' || bc.status === 'submitted';
  const editable = !locked && can.editResources(user.role);

  const setMonth = (resourceId: string, monthIdx: number, v: number) =>
    update((d) => {
      const item = d.resourceItems.find((r) => r.id === resourceId);
      if (!item) return d;
      const months = monthlyMandaysFor(d, item, duration);
      months[monthIdx] = v;
      const mandaysByFY = monthsToFY(months);
      return {
        ...d,
        labourMonthly: { ...d.labourMonthly, [resourceId]: months },
        resourceItems: d.resourceItems.map((r) => (r.id === resourceId ? { ...r, mandaysByFY } : r)),
      };
    });

  const patchItem = (id: string, patch: Record<string, string>) =>
    update((d) => ({
      ...d,
      resourceItems: d.resourceItems.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));

  const totalsByMonth = new Array(nMonths).fill(0);
  const rows = bc.resourceItems.map((r) => {
    const m = monthlyMandaysFor(bc, r, duration).slice(0, nMonths);
    m.forEach((v, i) => (totalsByMonth[i] += v));
    return { r, m };
  });

  return (
    <div className="tab-body">
      <div className="scroll-x">
        <table className="grid tiny">
          <thead>
            <tr>
              <th><Fx f={'Editable MSPO role code for the\nproduct/resource plan upload.'}>MSPO Role Mapping</Fx></th>
              <th><Fx f={"= 'Resource Plan'! Remarks (same field,\neditable on either tab)"}>LPS Role for Client</Fx></th>
              <th className="num"><Fx f={"= 'Resource Plan'! Day Rate, derived\nfrom the line's Grade (iRate lookup)"}>iRate</Fx></th>
              {monthLabels.map((l) => <th className="num" key={l}>{l}</th>)}
              <th className="num"><Fx f={'= SUM(month cells)\nRegrouped into FY totals on the\nResource Plan (12 months per FY).'}>Total Md</Fx></th>
              <th className="num"><Fx f={'= Total man-days × iRate'}>Cost</Fx></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, m }) => (
              <tr key={r.id}>
                <td>
                  <TextCell
                    value={r.mspoRole ?? ''}
                    editable={editable}
                    onCommit={(v) => patchItem(r.id, { mspoRole: v })}
                  />
                </td>
                <td>
                  <TextCell
                    value={r.remarks}
                    editable={editable}
                    onCommit={(v) => patchItem(r.id, { remarks: v })}
                  />
                </td>
                <td className="num" title={`Grade ${r.grade}`}>{r.dayRate.toLocaleString()}</td>
                {m.map((v, i) => (
                  <td className="num muted" key={i}>
                    <NumCell
                      value={Math.round(v * 10) / 10}
                      editable={editable}
                      format={(x) => (x ? x.toFixed(1) : '·')}
                      onCommit={(x) => setMonth(r.id, i, x)}
                    />
                  </td>
                ))}
                <td className="num">{sum(r.mandaysByFY).toLocaleString()}</td>
                <td className="num">{money(resourceItemTotal(r))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total man-days / month (ref: {MANDAY_PER_MONTH} md/month)</td>
              {totalsByMonth.map((v, i) => (
                <td className="num" key={i}>{v ? v.toFixed(0) : '·'}</td>
              ))}
              <td className="num">{sum(bc.resourceItems.map((r) => sum(r.mandaysByFY))).toLocaleString()}</td>
              <td className="num">{money(sum(bc.resourceItems.map(resourceItemTotal)))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
