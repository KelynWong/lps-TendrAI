// Basic Info tab - deal information (two fixed columns), quote lines (BD can
// add/remove), billing plan (BD can add lines), exchange rates (BD-editable
// applied rate). All edits land on the draft until Save.

import { useState } from 'react';
import { useStore } from '../../state/store';
import { X } from 'lucide-react';
import type { BusinessCaseState, SummaryCategory } from '../model';
import {
  CONTINGENCY_PCT,
  INFLATION_PCT_LABOUR,
  INFLATION_PCT_PRODUCT,
  PRC_HWSW_PCT,
  PRC_OPS_PCT,
  PRC_STAMP_PCT,
  computeSummary,
  fxRate,
  withQuoteCurrency,
} from '../calc';
import { money as fmtMoney, pct } from '../format';
import { confirmProv, useDraft } from '../draft';
import { AddRowButton, DateCell, Fx, NumCell, ProvenanceBadge, TextCell } from '../cells';
import { Button, ConfirmDialog, IconButton } from '../../ui/ui';
import {
  CURRENCIES,
  GTM_SUBTEAMS,
  GTM_UNITS,
  PROJECT_TYPES,
  SOLUTION_OFFERINGS,
  withCurrent,
} from '../parameters';

const mapRec = (
  rec: Record<SummaryCategory, number[]>,
  fn: (a: number[], k: string) => number[],
) =>
  Object.fromEntries(Object.entries(rec).map(([k, a]) => [k, fn(a, k)])) as Record<SummaryCategory, number[]>;

export default function BasicInfoTab() {
  const { bc, update, editable: canEditBc, userName } = useDraft();
  const { state } = useStore();
  // figures show in the quote currency (Basic Info)
  const money = (v: number, currency = bc.basicInfo.currency) => fmtMoney(v, currency);
  const user = { name: userName };
  const s = computeSummary(bc);
  const locked = !canEditBc;
  // Only the BD team edits the business case; every other role views it.
  const canEdit = !locked;
  const canDeal = !locked; // BD only

  const [removeQl, setRemoveQl] = useState<number | null>(null);
  const [onlyReview, setOnlyReview] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const info = bc.basicInfo;

  // AI-drafted values on this tab: deal-information fields + quote lines + billing lines
  const fieldsToReview = Object.values(info.fieldProv).filter((p) => p.kind !== 'human').length;
  const qlToReview = bc.quoteLines.filter((q) => q.provenance.kind !== 'human').length;
  const billingToReview = bc.billing.filter((b) => b.provenance.kind !== 'human').length;
  const toReview = fieldsToReview + qlToReview + billingToReview;
  const totalItems = Object.keys(info.fieldProv).length + bc.quoteLines.length + bc.billing.length;
  // Manual (Salesforce) fields cannot be blanket-confirmed: they must be typed
  const manualPending = Object.values(info.fieldProv).filter((p) => p.kind === 'manual').length;
  const aiToReview = toReview - manualPending;
  const filterOn = onlyReview && toReview > 0;
  const visibleBilling = filterOn
    ? bc.billing.filter((b) => b.provenance.kind !== 'human')
    : bc.billing;
  const visibleQls = filterOn
    ? bc.quoteLines.filter((q) => q.provenance.kind !== 'human')
    : bc.quoteLines;
  const confirmAll = () =>
    update((d) => ({
      ...d,
      basicInfo: {
        ...d.basicInfo,
        fieldProv: Object.fromEntries(
          Object.entries(d.basicInfo.fieldProv).map(([k, p]) => [
            k,
            p.kind === 'human' || p.kind === 'manual' ? p : confirmProv(p, user.name, false),
          ]),
        ),
      },
      quoteLines: d.quoteLines.map((q) =>
        q.provenance.kind === 'human' ? q : { ...q, provenance: confirmProv(q.provenance, user.name, false) },
      ),
      billing: d.billing.map((b) =>
        b.provenance.kind === 'human' ? b : { ...b, provenance: confirmProv(b.provenance, user.name, false) },
      ),
    }));
  /** Edit one quote line field, confirming its provenance (citation kept) */
  const patchQl = (id: number, patch: Partial<BusinessCaseState['quoteLines'][number]>) =>
    update((d) => ({
      ...d,
      quoteLines: d.quoteLines.map((x) =>
        x.id === id ? { ...x, ...patch, provenance: confirmProv(x.provenance, user.name, true) } : x,
      ),
    }));
  // Editing a field confirms that field (and keeps its citation, marked edited)
  const patchInfo = (patch: Partial<BusinessCaseState['basicInfo']>) =>
    update((d) => ({
      ...d,
      basicInfo: {
        ...d.basicInfo,
        ...patch,
        fieldProv: {
          ...d.basicInfo.fieldProv,
          ...Object.fromEntries(
            Object.keys(patch)
              .filter((k) => d.basicInfo.fieldProv[k])
              .map((k) => [k, confirmProv(d.basicInfo.fieldProv[k], user.name, true)]),
          ),
        },
      },
    }));

  const select = (value: string, options: string[], onChange: (v: string) => void, enabled = canEdit) =>
    enabled ? (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    ) : (
      <span>{value}</span>
    );

  const addQuoteLine = () =>
    update((d) => {
      const id = Math.max(0, ...d.quoteLines.map((q) => q.id)) + 1;
      const push = (a: number[], v: number) => [...a, v];
      return {
        ...d,
        quoteLines: [
          ...d.quoteLines,
          { id, solutionOffering: SOLUTION_OFFERINGS[0] ?? 'New offering', projectType: 'Milestone Based' as const, remarks: '', marginPct: 0.25, provenance: { kind: 'human' as const, confirmedBy: user.name } },
        ],
        otherIndirect: {
          travelExpense: push(d.otherIndirect.travelExpense, 0),
          otherCosts: push(d.otherIndirect.otherCosts, 0),
          vendorRebate: push(d.otherIndirect.vendorRebate, 0),
        },
        appliedRates: {
          contingency: mapRec(d.appliedRates.contingency, (a) => push(a, CONTINGENCY_PCT)),
          inflation: mapRec(d.appliedRates.inflation, (a, k) =>
            push(a, k === 'Internal Labour' ? INFLATION_PCT_LABOUR : INFLATION_PCT_PRODUCT),
          ),
          prcHwSw: push(d.appliedRates.prcHwSw, PRC_HWSW_PCT),
          prcOps: push(d.appliedRates.prcOps, PRC_OPS_PCT),
          prcStamp: push(d.appliedRates.prcStamp, PRC_STAMP_PCT),
        },
      };
    });

  const removeQuoteLine = (id: number) =>
    update((d) => {
      const idx = d.quoteLines.findIndex((q) => q.id === id);
      if (idx < 0 || d.quoteLines.length <= 1) return d;
      const cut = (a: number[]) => a.filter((_, i) => i !== idx);
      return {
        ...d,
        quoteLines: d.quoteLines.filter((q) => q.id !== id),
        productItems: d.productItems.filter((p) => p.quoteLine !== id),
        resourceItems: d.resourceItems.filter((r) => r.quoteLine !== id),
        otherIndirect: {
          travelExpense: cut(d.otherIndirect.travelExpense),
          otherCosts: cut(d.otherIndirect.otherCosts),
          vendorRebate: cut(d.otherIndirect.vendorRebate),
        },
        appliedRates: {
          contingency: mapRec(d.appliedRates.contingency, cut),
          inflation: mapRec(d.appliedRates.inflation, cut),
          prcHwSw: cut(d.appliedRates.prcHwSw),
          prcOps: cut(d.appliedRates.prcOps),
          prcStamp: cut(d.appliedRates.prcStamp),
        },
      };
    });

  // ---- Billing plan: TCV divided evenly across the billing lines -----------
  const FREQ_MONTHS = { Monthly: 1, Quarterly: 3, Yearly: 12 } as const;

  const addMonthsIso = (iso: string, m: number) => {
    const d0 = new Date(iso);
    return new Date(d0.getFullYear(), d0.getMonth() + m, 1).toISOString().slice(0, 10);
  };

  /** Spread the TCV evenly over the lines (the last line absorbs rounding) */
  const divideEvenly = (lines: BusinessCaseState['billing'], tcv: number) => {
    if (!lines.length) return lines;
    const base = Math.floor(tcv / lines.length);
    return lines.map((b, i) => ({
      ...b,
      amount: i === lines.length - 1 ? tcv - base * (lines.length - 1) : base,
    }));
  };

  /** Changing the cadence regenerates the lines over the project duration */
  const setFrequency = (freq: BusinessCaseState['billingFrequency']) =>
    update((d) => {
      const sNow = computeSummary(d);
      const per = FREQ_MONTHS[freq];
      const count = Math.max(1, Math.ceil(sNow.durationMonths / per));
      const start = new Date(d.basicInfo.projectStart);
      const lines = Array.from({ length: count }, (_, i) => ({
        id: `b${Date.now()}-${i}`,
        date: new Date(start.getFullYear(), start.getMonth() + i * per, 1).toISOString().slice(0, 10),
        schedule: `${freq} billing ${i + 1} of ${count}`,
        amount: 0,
        remarks: '',
        provenance: { kind: 'human' as const, confirmedBy: user.name },
      }));
      return { ...d, billingFrequency: freq, billing: divideEvenly(lines, Math.round(sNow.total.tcv)) };
    });

  /** Adding a line re-divides the TCV equally across all lines */
  const addBilling = () =>
    update((d) => {
      const sNow = computeSummary(d);
      const last = d.billing[d.billing.length - 1];
      const lines = [
        ...d.billing,
        {
          id: `b${Date.now()}`,
          date: last ? addMonthsIso(last.date, FREQ_MONTHS[d.billingFrequency]) : d.basicInfo.projectStart,
          schedule: `${d.billingFrequency} billing ${d.billing.length + 1}`,
          amount: 0,
          remarks: '',
          provenance: { kind: 'human' as const, confirmedBy: user.name },
        },
      ];
      return { ...d, billing: divideEvenly(lines, Math.round(sNow.total.tcv)) };
    });

  /** Removing a line re-divides the TCV equally across the remaining lines */
  const removeBilling = (id: string) =>
    update((d) => {
      const sNow = computeSummary(d);
      return { ...d, billing: divideEvenly(d.billing.filter((x) => x.id !== id), Math.round(sNow.total.tcv)) };
    });

  /** One deal-information row; provKey attaches that field's own badge. */
  const row = (label: string, control: React.ReactNode, provKey?: string) => {
    const prov = provKey ? info.fieldProv[provKey] : undefined;
    // Under the needs-review filter only unconfirmed AI-filled fields remain
    if (filterOn && (!prov || prov.kind === 'human')) return null;
    return (
      <div className="info-row" key={label}>
        <label>{label}</label>
        <span className="info-val">
          {control}
          {prov && <ProvenanceBadge p={prov} context={label} tab="Basic Info" />}
        </span>
      </div>
    );
  };

  const text = (value: string, key: keyof typeof info) => (
    <TextCell value={value} editable={canEdit} onCommit={(v) => patchInfo({ [key]: v })} />
  );

  return (
    <div className="tab-body">
      <div className="review-toolbar">
        <span className="review-progress">{totalItems - toReview} of {totalItems} AI-drafted values confirmed</span>
        {toReview > 0 && (
          <label>
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Show only items needing review
          </label>
        )}
        {canEdit && aiToReview > 0 && (
          <Button compact onClick={() => setConfirmAllOpen(true)}>Confirm all in this tab</Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmAllOpen}
        title={`Confirm all ${aiToReview} remaining AI-drafted values?`}
        confirmLabel="Confirm all values"
        onConfirm={() => { setConfirmAllOpen(false); confirmAll(); }}
        onClose={() => setConfirmAllOpen(false)}
      >
        Every AI-filled deal-information field, quote line and billing line will be marked as
        confirmed by you. Citations are kept.
        {manualPending > 0 && ` ${manualPending} Manual (Salesforce) field${manualPending > 1 ? 's are' : ' is'} skipped: those must be keyed in by hand.`}
        {' '}Only do this after reviewing the values.
      </ConfirmDialog>
      {(!filterOn || fieldsToReview > 0) && (
      <section>
        <h3>I. Basic Deal Information</h3>
        <div className="info-grid">
          <div className="info-col">
            {row('SFDC CRM ID', text(info.crmId, 'crmId'), 'crmId')}
            {row('Customer', text(info.customer, 'customer'), 'customer')}
            {row('End Customer', text(info.endCustomer, 'endCustomer'), 'endCustomer')}
            {row('GTM Unit', select(info.gtmUnit, withCurrent(info.gtmUnit, GTM_UNITS), (v) =>
              patchInfo({ gtmUnit: v, gtmSubTeam: (GTM_SUBTEAMS[v] ?? [''])[0] }),
            ), 'gtmUnit')}
            {row('GTM Sub-team', select(info.gtmSubTeam, withCurrent(info.gtmSubTeam, GTM_SUBTEAMS[info.gtmUnit] ?? []), (v) =>
              patchInfo({ gtmSubTeam: v }),
            ), 'gtmSubTeam')}
            {row('Major Solution Offering', select(info.majorSolutionOffering, withCurrent(info.majorSolutionOffering, SOLUTION_OFFERINGS), (v) =>
              patchInfo({ majorSolutionOffering: v }),
            ), 'majorSolutionOffering')}
            {row('TCV (Quote Currency)', (
              <Fx f={'= Summary! TCV Total\n= Σ quote-line sell prices\n  (Working: Direct Cost × (1 + Margin %))'}>
                <span className="computed strong">{money(s.total.tcv)}</span>
              </Fx>
            ))}
          </div>
          <div className="info-col">
            {row('Project Name', text(info.projectName, 'projectName'), 'projectName')}
            {row('Project Start Date', (
              <DateCell value={info.projectStart} editable={canEdit} onCommit={(v) => patchInfo({ projectStart: v })} />
            ), 'projectStart')}
            {row('Project End Date', (
              <DateCell value={info.projectEnd} editable={canEdit} onCommit={(v) => patchInfo({ projectEnd: v })} />
            ), 'projectEnd')}
            {row('Project Duration (months)', (
              <Fx f={'= DATEDIF(Project Start, Project End, "m") + 1\nDrives the Cash Flow timeline and the\nLabour Inputs monthly grid.'}>
                <span className="computed">{s.durationMonths}</span>
              </Fx>
            ))}
            {row('Quote Currency', select(info.currency, CURRENCIES.map(([code]) => code), (v) => {
              // amounts keyed in the old quote currency convert at the exchange rates
              update((d) => withQuoteCurrency(d, v));
              patchInfo({ currency: v });
            }), 'currency')}
            {row('Inflation Base Fiscal Year', (
              <NumCell
                value={info.inflationBaseFY}
                editable={canEdit}
                format={(v) => String(v)}
                onCommit={(v) => patchInfo({ inflationBaseFY: Math.round(v) })}
              />
            ))}
            {row('EBITDA %', (
              <Fx f={'= Summary! EBITDA %\n= (TCV − Total Cost) ÷ TCV'}>
                <span className="computed strong">{pct(s.total.ebitdaPct)}</span>
              </Fx>
            ))}
          </div>
        </div>
      </section>
      )}

      {(!filterOn || qlToReview > 0) && (
      <section>
        <h3>II. Quote Lines (Sub-projects)</h3>
        <table className="grid">
          <thead>
            <tr>
              <th>Quote Line</th><th>Solution Offering</th><th>Project Type</th><th>Remarks</th><th>Source</th>
              {canDeal && <th />}
            </tr>
          </thead>
          <tbody>
            {visibleQls.map((q) => (
              <tr key={q.id}>
                <td>Quote Line {q.id}</td>
                <td>
                  {select(q.solutionOffering, withCurrent(q.solutionOffering, SOLUTION_OFFERINGS), (v) =>
                    patchQl(q.id, { solutionOffering: v }),
                  )}
                </td>
                <td>
                  {select(q.projectType, [...PROJECT_TYPES], (v) =>
                    patchQl(q.id, { projectType: v as typeof q.projectType }),
                  )}
                </td>
                <td className="muted">
                  <TextCell
                    value={q.remarks}
                    editable={canEdit}
                    onCommit={(v) => patchQl(q.id, { remarks: v })}
                  />
                </td>
                <td><ProvenanceBadge p={q.provenance} context={`Quote Line ${q.id}: ${q.solutionOffering}`} tab="Basic Info" /></td>
                {canDeal && (
                  <td>
                    <IconButton danger label="Remove quote line" icon={X} onClick={() => setRemoveQl(q.id)} />
                  </td>
                )}
              </tr>
            ))}
          {canDeal && (
            <AddRowButton colSpan={5 + (canDeal ? 1 : 0)} label="Add quote line" onClick={addQuoteLine} />
          )}
          </tbody>
        </table>
      </section>
      )}

      {(!filterOn || billingToReview > 0) && (
      <section>
        <div className="billing-head">
          <h3>III. Billing Plan</h3>
          <label className="outcome-picker">
            Billing frequency
            <select
              value={bc.billingFrequency}
              disabled={!canDeal}
              title={canDeal ? 'Regenerates the billing lines: the TCV is divided evenly across the project duration' : 'Only the BD team sets the billing frequency'}
              onChange={(e) => setFrequency(e.target.value as BusinessCaseState['billingFrequency'])}
            >
              <option>Monthly</option>
              <option>Quarterly</option>
              <option>Yearly</option>
            </select>
          </label>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th>Target Billing Date</th><th>Payment Schedule</th>
              <th className="num">Billing Amount</th><th>Remarks</th><th>Source</th>
              {canDeal && <th />}
            </tr>
          </thead>
          <tbody>
            {visibleBilling.map((b) => (
              <tr key={b.id}>
                <td>
                  <DateCell
                    value={b.date}
                    editable={canEdit}
                    onCommit={(v) => update((d) => ({ ...d, billing: d.billing.map((x) => (x.id === b.id ? { ...x, date: v, provenance: confirmProv(x.provenance, user.name, true) } : x)) }))}
                  />
                </td>
                <td>
                  <TextCell
                    value={b.schedule}
                    editable={canEdit}
                    onCommit={(v) => update((d) => ({ ...d, billing: d.billing.map((x) => (x.id === b.id ? { ...x, schedule: v, provenance: confirmProv(x.provenance, user.name, true) } : x)) }))}
                  />
                </td>
                <td className="num">
                  <NumCell
                    value={b.amount}
                    editable={canEdit}
                    format={(v) => money(v)}
                    onCommit={(v) => update((d) => ({ ...d, billing: d.billing.map((x) => (x.id === b.id ? { ...x, amount: v, provenance: confirmProv(x.provenance, user.name, true) } : x)) }))}
                  />
                </td>
                <td>
                  <TextCell
                    value={b.remarks}
                    editable={canEdit}
                    onCommit={(v) => update((d) => ({ ...d, billing: d.billing.map((x) => (x.id === b.id ? { ...x, remarks: v, provenance: confirmProv(x.provenance, user.name, true) } : x)) }))}
                  />
                </td>
                <td><ProvenanceBadge p={b.provenance} tab="Basic Info" /></td>
                {canDeal && (
                  <td>
                    <IconButton danger label="Remove billing line (re-divides the TCV across the rest)" icon={X} onClick={() => removeBilling(b.id)} />
                  </td>
                )}
              </tr>
            ))}
          {canDeal && (
            <AddRowButton colSpan={5 + (canDeal ? 1 : 0)} label="Add billing line" onClick={addBilling} />
          )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <Fx f={'= SUM(Billing Amounts)\nFinal Check: must equal TCV.\nEach amount lands in the Cash Flow\nRepayment column of its billing month.'}>Total</Fx>
                {Math.abs(s.billingTotal - s.total.tcv) >= 1 && <span className="warn-inline">WARNING: Total Billing Amount ≠ TCV</span>}
              </td>
              <td className="num">{money(s.billingTotal)}</td>
              <td colSpan={canDeal ? 3 : 2} />
            </tr>
          </tfoot>
        </table>
      </section>
      )}

      {!filterOn && (
      <section>
        <h3>IV. Exchange Rate</h3>
        <table className="grid narrow">
          <thead>
            <tr>
              <th>Currency</th><th>Code</th>
              <th className="num"><Fx f={'Used to convert every product line priced in\nanother currency, and the SGD rate card day\nrates, into the quote currency.'}>Applied Rate (to 1 USD)</Fx></th>
              <th className="num"><Fx f={'The company default rate (Business case management),\ncopied as the applied rate when the case was drafted.'}>Company default</Fx></th>
            </tr>
          </thead>
          <tbody>
            {CURRENCIES.map(([code, name, planning]) => (
              <tr key={code} className={code === info.currency ? 'strong' : ''}>
                <td>{name}</td><td>{code}</td>
                <td className="num">
                  <NumCell
                    value={fxRate(bc, code)}
                    editable={canDeal}
                    format={(v) => v.toFixed(4)}
                    onCommit={(v) => update((d) => ({ ...d, fxOverrides: { ...d.fxOverrides, [code]: v } }))}
                  />
                </td>
                <td className="num muted">{(state.fxDefaults[code] ?? planning).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      )}
      <ConfirmDialog
        open={removeQl !== null}
        title={`Remove Quote Line ${removeQl}?`}
        confirmLabel="Remove quote line"
        danger
        onConfirm={() => { if (removeQl !== null) removeQuoteLine(removeQl); setRemoveQl(null); }}
        onClose={() => setRemoveQl(null)}
      >
        This also removes every product and labour line item assigned to this quote line.
        The change stays in your draft until you select Save changes.
      </ConfirmDialog>
    </div>
  );
}
