// Administrator console: configurable dropdown lists, defaults applied to new
// business cases, the cross-tab formula reference, and failed processing.
// Visible only to the Administrator role.

import { Plus, X } from 'lucide-react';
import { dateShort } from '../lib/format';
import { useStore } from '../state/store';
import { NumCell, TextCell } from '../components/common';
import { Button, IconButton } from '../ui/ui';
import type { AppConfig } from '../types';

/** Add / rename / delete the values of one configurable list */
function ListEditor({
  title,
  note,
  listKey,
  values,
}: {
  title: string;
  note?: string;
  listKey: keyof Pick<AppConfig, 'tenderTypes' | 'outcomeTypes' | 'solutionOfferings' | 'roles' | 'teams'>;
  values: string[];
}) {
  const { dispatch } = useStore();
  const commit = (next: string[], noteText: string) =>
    dispatch({ type: 'update-config', patch: { [listKey]: next } as Partial<AppConfig>, note: noteText });
  return (
    <section className="card admin-card">
      <h3>{title}</h3>
      {note && <p className="muted small">{note}</p>}
      <div className="admin-scroll">
        <table className="grid narrow">
          <tbody>
            {values.map((v, i) => (
              <tr key={i}>
                <td>
                  <TextCell
                    value={v}
                    editable
                    onCommit={(nv) => commit(values.map((x, j) => (j === i ? nv : x)), `${title}: '${v}' renamed to '${nv}'`)}
                  />
                </td>
                <td className="row-actions">
                  <IconButton
                    danger
                    label={`Remove ${v}`}
                    icon={X}
                    onClick={() => commit(values.filter((_, j) => j !== i), `${title}: '${v}' removed`)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button compact icon={Plus} onClick={() => commit([...values, 'New value'], `${title}: value added`)}>
        Add value
      </Button>
    </section>
  );
}

/** Cross-tab links of the business case, as implemented in lib/calc.ts */
const FORMULA_LINKS: [string, string, string][] = [
  ['Basic Info · Quote Lines', 'Define the QL dimension every plan line is assigned to', 'Summary, Product Plan, Resource Plan, Working'],
  ['Basic Info · Billing Plan', 'Σ billing amounts must equal TCV (Final Check); each amount lands in its billing month', 'Cash Flow · Repayment'],
  ['Basic Info · Exchange Rate', 'Applied FX rate per currency (admin default, editable per case)', 'All monetary conversions'],
  ['Product Plan', 'Qty × Unit Cost per FY, summed by category and quote line', 'Summary · Direct Cost; Cash Flow · Pay to vendor'],
  ['Resource Plan', 'Man-days × iRate (day rate by grade), per FY', 'Summary · Internal Labour; Labour Inputs; Cash Flow · Internal Labour'],
  ['Summary · Applied %', 'Contingency / Inflation / PRC tax per quote line on the relevant base', 'Summary · Indirect Cost'],
  ['Working', 'Sell price = Direct Cost × (1 + Margin %) per category', 'TCV; Summary; Basic Info KPIs'],
  ['Cash Flow', 'Opening - vendors - labour + repayment - interest; 5.5% p.a. on mismatch, compounded', 'Summary · Finance Cost'],
  ['Labour Inputs', 'Monthly man-day distribution (manual or even spread)', 'Resource Plan FY totals; Cash Flow · Internal Labour'],
];

export default function AdminPage() {
  const { state, dispatch } = useStore();
  const cfg = state.config;

  const failed = state.historical.filter(
    (d) => d.embeddingStatus === 'Extraction failed' || d.embeddingStatus === 'Duplicate - pending review',
  );
  const processingTenders = state.tenders.filter((t) => !t.bc);

  const patch = (p: Partial<AppConfig>, note: string) => dispatch({ type: 'update-config', patch: p, note });

  return (
    <div className="admin-grid">
      <ListEditor
        title="Tender types"
        note="The Type recorded on every tender (shown and filterable on the Tenders page)."
        listKey="tenderTypes"
        values={cfg.tenderTypes}
      />
      <ListEditor
        title="Tender outcome statuses"
        note="Selectable once a business case is approved."
        listKey="outcomeTypes"
        values={cfg.outcomeTypes}
      />
      <ListEditor
        title="Solution offerings"
        note="Dropdown values for quote lines and the major solution offering."
        listKey="solutionOfferings"
        values={cfg.solutionOfferings}
      />
      <ListEditor
        title="Resource roles"
        note="Dropdown values for Resource Plan line items."
        listKey="roles"
        values={cfg.roles}
      />
      <ListEditor
        title="Delivery teams"
        note="Dropdown values for Resource Plan line items."
        listKey="teams"
        values={cfg.teams}
      />

      <section className="card admin-card">
        <h3>Default exchange rates</h3>
        <p className="muted small">
          Applied rate (to 1 USD) prefilled into NEWLY generated business cases. Existing cases keep
          their own applied rates.
        </p>
        <div className="admin-scroll">
          <table className="grid narrow">
            <thead><tr><th>Code</th><th className="num">Default applied rate</th></tr></thead>
            <tbody>
              {Object.entries(cfg.fxDefaults).map(([code, rate]) => (
                <tr key={code}>
                  <td className="mono">{code}</td>
                  <td className="num">
                    <NumCell
                      value={rate}
                      editable
                      format={(v) => v.toFixed(4)}
                      onCommit={(v) => patch({ fxDefaults: { ...cfg.fxDefaults, [code]: v } }, `Default FX rate ${code}: ${rate.toFixed(4)} -> ${v.toFixed(4)}`)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card admin-card">
        <h3>Default day rates by grade (iRate)</h3>
        <p className="muted small">
          Prefilled into NEWLY generated business cases; BD can adjust per case on the Resource Plan.
        </p>
        <table className="grid narrow">
          <thead><tr><th>Lenovo band</th><th className="num">Default day rate (SEA)</th></tr></thead>
          <tbody>
            {Object.entries(cfg.gradeRates).map(([g, rate]) => (
              <tr key={g}>
                <td>Band {g}</td>
                <td className="num">
                  <NumCell
                    value={rate}
                    editable
                    format={(v) => v.toLocaleString()}
                    onCommit={(v) => patch({ gradeRates: { ...cfg.gradeRates, [g]: v } }, `Default Band ${g} day rate: ${rate.toLocaleString()} -> ${v.toLocaleString()}`)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card admin-card admin-wide">
        <h3>Formulas and tab linkage</h3>
        <p className="muted small">How the business case tabs feed each other (read-only reference).</p>
        <table className="grid">
          <thead><tr><th>Source</th><th>Formula / rule</th><th>Feeds</th></tr></thead>
          <tbody>
            {FORMULA_LINKS.map(([src, rule, feeds]) => (
              <tr key={src}>
                <td>{src}</td>
                <td>{rule}</td>
                <td className="muted">{feeds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card admin-card admin-wide">
        <h3>Failed processing</h3>
        <p className="muted small">
          Historical and tender uploads that did not complete embedding. Non-admin users do not see
          embedding internals on the Historical data page.
        </p>
        <table className="grid">
          <thead><tr><th>Source</th><th>ID</th><th>Title</th><th>Status</th><th>Uploaded</th></tr></thead>
          <tbody>
            {failed.map((d) => (
              <tr key={d.id}>
                <td>Historical upload</td>
                <td className="mono">{d.id}</td>
                <td>{d.title}</td>
                <td><span className="err">{d.embeddingStatus}</span></td>
                <td className="muted">{dateShort(d.uploadDate)} · {d.uploadedBy}</td>
              </tr>
            ))}
            {processingTenders.map((t) => (
              <tr key={t.id}>
                <td>Tender upload</td>
                <td className="mono">{t.ref}</td>
                <td>{t.title}</td>
                <td><span className="warn">Processing</span></td>
                <td className="muted">{dateShort(t.uploadedAt)} · {t.uploadedBy}</td>
              </tr>
            ))}
            {failed.length === 0 && processingTenders.length === 0 && (
              <tr><td colSpan={5} className="muted">No failed or in-flight processing.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
