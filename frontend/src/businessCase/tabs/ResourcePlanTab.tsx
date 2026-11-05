// Resource Plan tab - internal labour effort. Quote Line / Solution Offering
// twin dropdowns, fixed Team / Role / Grade lists, client-facing Remarks after
// the day rate (synced with Labour Inputs), man-days AND cost per FY with
// totals (no inflation columns - inflation lives on the Summary tab).

import { useState } from 'react';
import { X } from 'lucide-react';
import { dayRateQuote, fyLabel, RATE_CARD_CURRENCY, resourceItemCost, resourceItemTotal, sum, MANDAY_PER_MONTH } from '../calc';
import { money as fmtMoney } from '../format';
import { confirmProv, useDraft } from '../draft';
import { AddRowButton, Fx, NumCell, ProvenanceBadge, TextCell } from '../cells';
import { Button, ConfirmDialog, IconButton } from '../../ui/ui';
import { useToast } from '../../ui/toast';
import type { ResourceItem } from '../model';
import { FY_COUNT } from '../model';
import { GRADES, GRADE_RATES, ROLES, TEAMS, withCurrent } from '../parameters';

let newSeq = 1;

export default function ResourcePlanTab() {
  const { bc, update, editable: canEditBc, userName } = useDraft();
  // figures show in the quote currency (Basic Info)
  const money = (v: number, currency = bc.basicInfo.currency) => fmtMoney(v, currency);
  const user = { name: userName };
  const toast = useToast();
  const locked = !canEditBc;
  const editable = !locked;
  const canRates = !locked;
  const baseFY = bc.basicInfo.inflationBaseFY;
  const [onlyReview, setOnlyReview] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  /** iRate depends on grade only (role is irrelevant); overrides win */
  const rateFor = (grade: string) => bc.gradeRateOverrides[grade] ?? GRADE_RATES[grade] ?? 0;

  /** Editing a grade's rate updates the card AND every line of that grade */
  const setGradeRate = (grade: string, v: number) =>
    update((d) => ({
      ...d,
      gradeRateOverrides: { ...d.gradeRateOverrides, [grade]: v },
      resourceItems: d.resourceItems.map((r) => (r.grade === grade ? { ...r, dayRate: v } : r)),
    }));

  const confirmed = bc.resourceItems.filter((r) => r.provenance.kind === 'human').length;
  const totalItems = bc.resourceItems.length;
  const toReview = totalItems - confirmed;
  const filterOn = onlyReview && toReview > 0;
  const visibleItems = filterOn
    ? bc.resourceItems.filter((r) => r.provenance.kind !== 'human')
    : bc.resourceItems;

  // Confirm-all and edits KEEP any citation; edits are flagged as changed
  const confirmAll = () =>
    update((d) => ({
      ...d,
      resourceItems: d.resourceItems.map((r) =>
        r.provenance.kind === 'human' ? r : { ...r, provenance: confirmProv(r.provenance, user.name, false) },
      ),
    }));

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
          r.id === item.id ? { ...item, provenance: confirmProv(item.provenance, user.name, true) } : r,
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
          role: ROLES[0] ?? 'New role',
          grade: '4',
          teamCode: 'INS-CL-SG',
          dayRate: bc.gradeRateOverrides['4'] ?? GRADE_RATES['4'],
          mandaysByFY: new Array(FY_COUNT).fill(0),
          remarks: '',
          mspoRole: 'CONS-II (Consulting)',
          provenance: { kind: 'human', confirmedBy: user.name },
        },
      ],
    }));

  const removeRow = (id: string) => {
    update((d) => ({ ...d, resourceItems: d.resourceItems.filter((r) => r.id !== id) }));
    toast.push('info', 'Labour line removed', 'Use Discard in the save bar to restore unsaved removals.');
  };

  const qlById = (id: number) => bc.quoteLines.find((q) => q.id === id);
  const fyIdx = Array.from({ length: FY_COUNT }, (_, i) => i);
  const totalMd = sum(bc.resourceItems.map((r) => sum(r.mandaysByFY)));
  const grandCostFY = fyIdx.map((i) => sum(bc.resourceItems.map((r) => resourceItemCost(r, bc)[i])));
  const grand = sum(bc.resourceItems.map((x) => resourceItemTotal(x, bc)));

  const sel = (value: string, options: string[], onChange: (v: string) => void) =>
    editable ? (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    ) : (
      <span>{value}</span>
    );

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
        Every AI-suggested labour line in this tab will be marked as confirmed by you.
        Only do this after reviewing the man-days and rates.
      </ConfirmDialog>
      <div className="scroll-x">
      <table className="grid wide sticky-first">
        <thead>
          <tr>
            <th rowSpan={2}>QL</th>
            <th rowSpan={2}><Fx f={'= the Solution Offering of the selected\nQuote Line (Basic Info section II).\nPicking an offering reassigns the line.'}>Solution Offering</Fx></th>
            <th rowSpan={2}>Team</th>
            <th rowSpan={2}>Role</th>
            <th rowSpan={2}>Grade</th>
            <th rowSpan={2} className="num">
              <Fx f={'= SGD rate card iRate (Team + Grade),\nconverted to the quote currency at the\nBasic Info exchange rates. BD may override.'}>Day Rate (iRate)</Fx>
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
          {visibleItems.map((it) => {
            const costs = resourceItemCost(it, bc);
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
                <td>{sel(it.grade, withCurrent(it.grade, GRADES), (v) => upd({ ...it, grade: v, dayRate: rateFor(v) }))}</td>
                <td className="num">
                  <NumCell value={it.dayRate} editable={canRates} title={canRates ? 'SGD rate card day rate (iRate)' : 'Only the BD team edits day rates'} format={(v) => money(v, RATE_CARD_CURRENCY)} onCommit={(v) => upd({ ...it, dayRate: v })} />
                  {bc.basicInfo.currency !== RATE_CARD_CURRENCY && <div className="small muted">= {money(dayRateQuote(it, bc))}</div>}
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
                <td className="num strong">{money(resourceItemTotal(it, bc))}</td>
                <td><ProvenanceBadge p={it.provenance} context={it.role + (it.remarks ? " (" + it.remarks + ")" : "")} tab="Resource Plan" /></td>
                {editable && (
                  <td>
                    <IconButton danger label="Remove labour line" icon={X} onClick={() => removeRow(it.id)} />
                  </td>
                )}
              </tr>
            );
          })}
          {editable && (
            <AddRowButton
              colSpan={7 + (FY_COUNT + 1) * 2 + 2}
              label="Add labour line"
              onClick={addRow}
            />
          )}
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
      </div>

      {/* Rate card: iRate by grade, like Basic Info's exchange-rate table */}
      <section>
        <h3>Day Rate by Grade (iRate)</h3>
        <p className="muted small">
          The day rate depends on the Lenovo band/grade only, never the role. Changing a line's
          grade applies the rate below; editing an applied rate updates every line of that grade.
        </p>
        <table className="grid narrow">
          <thead>
            <tr>
              <th>Lenovo band</th>
              <th className="num">Applied Day Rate (SEA)</th>
            </tr>
          </thead>
          <tbody>
            {GRADES.map((g) => (
              <tr key={g}>
                <td>Band {g}</td>
                <td className="num">
                  <NumCell
                    value={rateFor(g)}
                    editable={editable}
                    format={(v) => v.toLocaleString()}
                    onCommit={(v) => setGradeRate(g, v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
