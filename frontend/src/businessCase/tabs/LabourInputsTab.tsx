// Labour Inputs tab - MSPO role mapping (editable) and monthly man-day
// distribution. "LPS Role for Client" is the Resource Plan Remarks column
// (editable here too, same field); iRate shows the Resource Plan day rate
// derived from the line's grade. Month edits store a manual distribution and
// resync the Resource Plan FY totals.

import {
  dayRateQuote,
  MANDAY_PER_MONTH,
  monthlyMandaysFor,
  monthsBetween,
  monthsToFY,
  resourceItemTotal,
  sum,
} from '../calc';
import { useState } from 'react';
import { money as fmtMoney } from '../format';
import { confirmInput, useDraft } from '../draft';
import { Fx, NumCell, TextCell } from '../cells';
import { Button, ConfirmDialog } from '../../ui/ui';

export default function LabourInputsTab() {
  const { bc, update, editable: canEditBc } = useDraft();
  // figures show in the quote currency (Basic Info)
  const money = (v: number, currency = bc.basicInfo.currency) => fmtMoney(v, currency);
  const duration = Math.max(monthsBetween(bc.basicInfo.projectStart, bc.basicInfo.projectEnd), 1);
  const nMonths = Math.min(duration, 36);
  const start = new Date(bc.basicInfo.projectStart);
  const monthLabels = Array.from({ length: nMonths }, (_, m) => {
    const d = new Date(start.getFullYear(), start.getMonth() + m, 1);
    return d.toLocaleDateString('en-SG', { month: 'short', year: '2-digit' });
  });
  const locked = !canEditBc;
  const editable = !locked;

  const [onlyReview, setOnlyReview] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  // A line is verified once it has a manual monthly distribution; until then
  // the months are the automatic even spread (an estimate).
  const lineVerified = (id: string) => !!bc.labourMonthly[id];
  const verifiedCount = bc.resourceItems.filter((r) => lineVerified(r.id)).length;
  const totalLines = bc.resourceItems.length;
  const toReview = totalLines - verifiedCount;
  const filterOn = onlyReview && toReview > 0;
  const cellVerified = (id: string, i: number) => bc.confirmedInputs.includes(`lab:${id}:${i}`);

  const confirmAll = () =>
    update((d) => {
      const labourMonthly = { ...d.labourMonthly };
      let confirmedInputs = d.confirmedInputs;
      for (const r of d.resourceItems) {
        if (!labourMonthly[r.id]) labourMonthly[r.id] = monthlyMandaysFor(d, r, duration);
        confirmedInputs = labourMonthly[r.id]
          .map((_, i) => `lab:${r.id}:${i}`)
          .reduce(confirmInput, confirmedInputs);
      }
      return { ...d, labourMonthly, confirmedInputs };
    });

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
        // Only the edited month cell turns green
        confirmedInputs: confirmInput(d.confirmedInputs, `lab:${resourceId}:${monthIdx}`),
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
  const visibleRows = filterOn ? rows.filter(({ r }) => !lineVerified(r.id)) : rows;

  return (
    <div className="tab-body">
      <div className="review-toolbar">
        <span className="review-progress">{verifiedCount} of {totalLines} monthly distributions verified</span>
        {toReview > 0 && (
          <label>
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Show only rows needing review
          </label>
        )}
        {editable && toReview > 0 && (
          <Button compact onClick={() => setConfirmAllOpen(true)}>Confirm all in this tab</Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmAllOpen}
        title={`Confirm all ${totalLines - verifiedCount} remaining monthly distributions?`}
        confirmLabel="Confirm all distributions"
        onConfirm={() => { setConfirmAllOpen(false); confirmAll(); }}
        onClose={() => setConfirmAllOpen(false)}
      >
        The current even monthly spread of each remaining line will be kept as its verified
        distribution. Only do this after reviewing the phasing.
      </ConfirmDialog>
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
            {visibleRows.map(({ r, m }) => (
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
                <td className="num" title={`Grade ${r.grade}`}>{money(dayRateQuote(r, bc))}</td>
                {m.map((v, i) => (
                  <td className={`num rate-cell ${cellVerified(r.id, i) ? 'verified' : ''}`} key={i}>
                    <NumCell
                      value={Math.round(v * 10) / 10}
                      editable={editable}
                      format={(x) => (x ? x.toFixed(1) : '·')}
                      onCommit={(x) => setMonth(r.id, i, x)}
                    />
                  </td>
                ))}
                <td className="num">{sum(r.mandaysByFY).toLocaleString()}</td>
                <td className="num">{money(resourceItemTotal(r, bc))}</td>
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
              <td className="num">{money(sum(bc.resourceItems.map((x) => resourceItemTotal(x, bc))))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
