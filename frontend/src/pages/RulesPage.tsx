// Business case management: the company-wide configuration applied to every
// business case version.
//  - Final Check rules: add, edit, enable/disable and delete the checks run on
//    each version (failed checks warn, never block). Rules read business case
//    fields in the web app; the tabs a rule involves are inferred.
//  - MSPO mapping defaults: which business case field (in the web app) fills
//    each MSPO template column. Every tender starts from these and can change
//    individual columns. Exchange rate defaults: copied into each new AI draft.

import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { canDo } from '../config';
import { useStore } from '../state/store';
import { Banner, Button, ConfirmDialog, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import {
  BUILTINS,
  CHECK_FIELDS,
  checkField,
  describeLogic,
  ruleTabs,
  runFinalChecks,
  type LineOp,
  type RuleDef,
} from '../rules/finalChecks';
import { MAP_GROUPS, fieldLabel, fieldsFor, validatePlan, type FieldMapEntry, type MapGroup, type MapSource } from '../mspo/mapping';
import { CURRENCIES } from '../businessCase/parameters';

const BD_ONLY = 'Only the BD team manages Final Check rules, MSPO mapping and exchange rate defaults';

export default function RulesPage() {
  const [tab, setTab] = useState('rules');
  const { state } = useStore();
  const editable = canDo.manageRules(state.role);
  return (
    <div>
      <TabsBar
        tabs={[
          { key: 'rules', label: 'Final Check rules' },
          { key: 'mapping', label: 'MSPO mapping defaults' },
          { key: 'fx', label: 'Exchange rate defaults' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {!editable && (
        <Banner kind="info">View only - the BD team manages Final Check rules, MSPO mapping and exchange rate defaults.</Banner>
      )}
      {tab === 'rules' ? <RulesTab editable={editable} /> : tab === 'mapping' ? <MappingDefaultsTab editable={editable} /> : <FxDefaultsTab editable={editable} />}
    </div>
  );
}

// ---- Final Check rules -----------------------------------------------------------

const OPS: LineOp[] = ['>', '>=', '<', '<=', '=', 'between'];

const blankRule = (): RuleDef => ({
  id: `rule-${Date.now()}`,
  name: '',
  description: '',
  severity: 'warning',
  enabled: true,
  kind: 'compare',
  left: 'billing.amount',
  right: 'summary.tcv',
  tolerance: 1,
});

/** Business case field picker, grouped by tab. Line fields (one value per
 *  line) are summed in compare and range rules. */
function FieldPicker({
  label, value, onChange, linesOnly,
}: {
  label: string;
  value?: string;
  onChange: (key: string) => void;
  linesOnly?: boolean;
}) {
  const known = checkField(value);
  const options = CHECK_FIELDS.filter((f) => !linesOnly || f.lines);
  const tabs = [...new Set(options.map((f) => f.tab))];
  return (
    <div className="cell-picker">
      <span className="cell-picker-label">{label}<span className="req" aria-hidden>*</span></span>
      <select value={known ? value : ''} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value="" disabled>Choose a field</option>}
        {tabs.map((tab) => (
          <optgroup key={tab} label={tab}>
            {options.filter((f) => f.tab === tab).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </optgroup>
        ))}
      </select>
      <span className="small muted">
        {known ? (known.lines ? (linesOnly ? 'Checked line by line' : 'One value per line - the lines are summed') : 'One value for the business case') : 'Choose the business case field to read'}
      </span>
    </div>
  );
}

function RulesTab({ editable }: { editable: boolean }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<RuleDef | null>(null);
  const [deleting, setDeleting] = useState<RuleDef | null>(null);
  const isNew = draft ? !state.rules.some((r) => r.id === draft.id) : false;

  // a saved business case version to test a rule against while editing
  const sample = useMemo(() => {
    for (const t of state.tenders) {
      const v = t.bcVersions[t.bcVersions.length - 1];
      if (v) return { label: `${t.name} v${v.v}`, data: v.data };
    }
    return undefined;
  }, [state.tenders]);

  const set = (patch: Partial<RuleDef>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const problems = (r: RuleDef): string[] => {
    const p: string[] = [];
    if (!r.name.trim()) p.push('a name');
    const fieldOk = (key?: string, lines = false) => { const f = checkField(key); return !!f && (!lines || f.lines); };
    if (r.kind === 'compare' && (!fieldOk(r.left) || !fieldOk(r.right))) p.push('a field on both sides');
    if (r.kind === 'range') {
      if (!fieldOk(r.target)) p.push('a field');
      if (r.min === undefined && r.max === undefined) p.push('a minimum or a maximum');
      if (r.min !== undefined && r.max !== undefined && r.min > r.max) p.push('a minimum below the maximum');
    }
    if (r.kind === 'every-line') {
      if (!fieldOk(r.target, true)) p.push('a line field');
      if (r.value === undefined) p.push('a value to compare against');
      if (r.op === 'between' && r.value2 === undefined) p.push('an upper value');
    }
    if (r.builtin === 'cashflow-no-mismatch' && (r.value === undefined || r.value < 0 || r.value > 100)) p.push('an allowed shortfall between 0 and 100%');
    return p;
  };
  const num =(v: string) => (v.trim() === '' ? undefined : Number(v));

  const save = () => {
    if (!draft) return;
    const rule = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
    dispatch({ type: 'upsert-rule', rule });
    toast.push('success', isNew ? 'Rule added' : 'Rule saved', `${rule.name} applies to every business case version; existing versions are re-checked when viewed.`);
    setDraft(null);
  };

  const sampleResult = draft && sample && problems(draft).length === 0
    ? runFinalChecks(sample.data, [{ ...draft, enabled: true }])[0]
    : undefined;
  const enabledCount = state.rules.filter((r) => r.enabled).length;

  return (
    <section>
      <div className="review-toolbar">
        <span className="muted small">
          {enabledCount} of {state.rules.length} rules are applied to every business case version and to the live draft while it is edited. Failed checks warn - they never block.
        </span>
        <span className="review-toolbar-actions">
          <Button variant="primary" compact icon={Plus} disabled={!editable} title={editable ? undefined : BD_ONLY} onClick={() => setDraft(blankRule())}>Add rule</Button>
        </span>
      </div>
      <table className="grid">
        <thead>
          <tr><th>On</th><th>Rule</th><th>What it checks</th><th>Tabs involved</th><th>Severity</th><th aria-label="Actions" /></tr>
        </thead>
        <tbody>
          {state.rules.map((r) => (
            <tr key={r.id} className={r.enabled ? undefined : 'row-disabled'}>
              <td>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  disabled={!editable}
                  aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name}`}
                  onChange={() => {
                    dispatch({ type: 'upsert-rule', rule: { ...r, enabled: !r.enabled } });
                    toast.push('success', r.enabled ? 'Rule disabled' : 'Rule enabled', r.name);
                  }}
                />
              </td>
              <td><b>{r.name}</b><div className="muted small">{r.description}</div></td>
              <td className="small">{describeLogic(r)}</td>
              <td>{ruleTabs(r).map((t) => <span key={t} className="badge badge-neutral" style={{ marginRight: 4 }}>{t}</span>)}</td>
              <td><span className={`pill ${r.severity === 'error' ? 'pill-lost' : 'pill-review'}`}>{r.severity === 'error' ? 'Fail' : 'Warning'}</span></td>
              <td className="table-actions" style={{ whiteSpace: 'nowrap' }}>
                <IconButton label={`Edit ${r.name}`} icon={Pencil} disabled={!editable} reason={BD_ONLY} onClick={() => setDraft({ ...r })} />
                <IconButton label={`Delete ${r.name}`} icon={Trash2} danger disabled={!editable} reason={BD_ONLY} onClick={() => setDeleting(r)} />
              </td>
            </tr>
          ))}
          {state.rules.length === 0 && (
            <tr><td colSpan={6} className="muted">No rules - business case versions are not checked. Add a rule to start.</td></tr>
          )}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!draft}
        wide
        title={isNew ? 'Add rule' : `Edit ${draft?.name}`}
        confirmLabel={isNew ? 'Add rule' : 'Save rule'}
        confirmDisabled={!draft || problems(draft).length > 0}
        onClose={() => setDraft(null)}
        onConfirm={save}
      >
        {draft && (
          <>
            <div className="rule-head-grid">
              <label>Name<span className="req" aria-hidden>*</span>
                <input autoFocus value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label>Severity<span className="req" aria-hidden>*</span>
                <select value={draft.severity} onChange={(e) => set({ severity: e.target.value as RuleDef['severity'] })}>
                  <option value="error">Fail</option>
                  <option value="warning">Warning</option>
                </select>
              </label>
              <label className="rule-head-full">Description
                <input value={draft.description} placeholder="What the rule protects against, in plain words" onChange={(e) => set({ description: e.target.value })} />
              </label>
            </div>

            <fieldset className="rule-fieldset">
              <legend>Rule type<span className="req" aria-hidden>*</span></legend>
              {draft.kind === 'builtin' ? (
                <p className="small" style={{ margin: 0 }}>
                  Fixed logic: {BUILTINS[draft.builtin!]}. Reads {ruleTabs(draft).join(', ')}.
                  The name, severity{draft.builtin === 'line-totals-consistent' ? ' and tolerance' : draft.builtin === 'cashflow-no-mismatch' ? ' and allowed shortfall' : ''} can be changed.
                </p>
              ) : (
                <div className="rule-kinds">
                  {([
                    ['compare', 'A field must equal another field'],
                    ['range', 'A field must be within a range'],
                    ['every-line', 'Every line must meet a condition'],
                  ] as const).map(([k, label]) => (
                    <label key={k} className="check-inline">
                      <input
                        type="radio"
                        name="rule-kind"
                        checked={draft.kind === k}
                        onChange={() => set(
                          k === 'compare' ? { kind: k, left: 'billing.amount', right: 'summary.tcv', tolerance: 1 }
                            : k === 'range' ? { kind: k, target: 'summary.marginPct', min: undefined, max: undefined }
                              : { kind: k, target: 'resource.dayRate', op: '>', value: 0, value2: undefined },
                        )}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}

              {draft.kind === 'compare' && (
                <div className="rule-operands">
                  <FieldPicker label="Field" value={draft.left} onChange={(k) => set({ left: k })} />
                  <span className="rule-op">must equal</span>
                  <FieldPicker label="Field" value={draft.right} onChange={(k) => set({ right: k })} />
                  <label className="rule-tolerance">Tolerance
                    <input type="number" min={0} value={draft.tolerance ?? ''} onChange={(e) => set({ tolerance: num(e.target.value) })} />
                  </label>
                </div>
              )}
              {draft.kind === 'range' && (
                <div className="rule-operands">
                  <FieldPicker label="Field" value={draft.target} onChange={(k) => set({ target: k })} />
                  <label className="rule-tolerance">Minimum
                    <input type="number" value={draft.min ?? ''} placeholder="None" onChange={(e) => set({ min: num(e.target.value) })} />
                  </label>
                  <label className="rule-tolerance">Maximum
                    <input type="number" value={draft.max ?? ''} placeholder="None" onChange={(e) => set({ max: num(e.target.value) })} />
                  </label>
                </div>
              )}
              {draft.kind === 'every-line' && (
                <div className="rule-operands">
                  <FieldPicker label="Every line of" value={draft.target} linesOnly onChange={(k) => set({ target: k })} />
                  <label className="rule-tolerance">Condition
                    <select value={draft.op} onChange={(e) => set({ op: e.target.value as LineOp })}>
                      {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label className="rule-tolerance">Value
                    <input type="number" value={draft.value ?? ''} onChange={(e) => set({ value: num(e.target.value) })} />
                  </label>
                  {draft.op === 'between' && (
                    <label className="rule-tolerance">and
                      <input type="number" value={draft.value2 ?? ''} onChange={(e) => set({ value2: num(e.target.value) })} />
                    </label>
                  )}
                </div>
              )}
              {draft.kind === 'builtin' && draft.builtin === 'line-totals-consistent' && (
                <div className="rule-operands">
                  <label className="rule-tolerance">Tolerance (S$)
                    <input type="number" min={0} value={draft.tolerance ?? ''} onChange={(e) => set({ tolerance: num(e.target.value) })} />
                  </label>
                </div>
              )}
              {draft.kind === 'builtin' && draft.builtin === 'cashflow-no-mismatch' && (
                <div className="rule-operands">
                  <label className="rule-tolerance">Allowed shortfall (% of TCV)
                    <input type="number" min={0} max={100} step={0.5} value={draft.value ?? ''} onChange={(e) => set({ value: num(e.target.value) })} />
                  </label>
                  <span className="muted small">The check warns only when the largest monthly cash shortfall is above this share of the TCV. 0 warns on any mismatch month.</span>
                </div>
              )}
            </fieldset>

            {problems(draft).length > 0 ? (
              <p className="muted small">To save, add {problems(draft).join(', ')}.</p>
            ) : sampleResult && sample ? (
              <div className="ref-issue" style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-subtle)' }}>
                <b>Test against {sample.label}:</b>{' '}
                {sampleResult.result.skipped
                  ? <span className="muted">Not checked</span>
                  : sampleResult.result.ok
                    ? <span className="ok"><Check size={12} aria-hidden /> Pass</span>
                    : <span className="err">{draft.severity === 'error' ? 'Fail' : 'Warning'}</span>}
                {' '}· expected {sampleResult.result.expected} · actual {sampleResult.result.actual}
                {' '}· tabs involved: {ruleTabs(draft).join(', ')}
              </div>
            ) : null}
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name}?`}
        confirmLabel="Delete rule"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            dispatch({ type: 'delete-rule', id: deleting.id });
            toast.push('success', 'Rule deleted', `${deleting.name} no longer runs on business case versions.`);
          }
          setDeleting(null);
        }}
      >
        <p>
          <b>{deleting?.name}</b> stops running on new versions, and existing business case versions no
          longer show its result. To pause a rule instead, switch it off.
        </p>
      </ConfirmDialog>
    </section>
  );
}

// ---- MSPO mapping defaults ---------------------------------------------------------

function MappingDefaultsTab({ editable }: { editable: boolean }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<MapGroup, FieldMapEntry[]> | null>(null);
  const view = draft ?? state.mspoDefaults;
  const problems = Object.fromEntries(MAP_GROUPS.map(({ plan }) => [plan, validatePlan(plan, view[plan])])) as Record<MapGroup, string[]>;
  const anyProblem = Object.values(problems).some((p) => p.length);
  const adjusted = state.tenders.filter((t) => (t.mspoMapping && Object.keys(t.mspoMapping).length) || t.mspoFyCount !== undefined).length;

  const update = (plan: MapGroup, target: string, patch: Partial<FieldMapEntry>) =>
    setDraft((d) => {
      const base = d ?? state.mspoDefaults;
      return { ...base, [plan]: base[plan].map((e) => (e.target === target ? { ...e, ...patch } : e)) };
    });

  const save = () => {
    if (!draft || anyProblem) return;
    for (const { plan } of MAP_GROUPS) {
      if (JSON.stringify(draft[plan]) !== JSON.stringify(state.mspoDefaults[plan])) {
        dispatch({ type: 'set-mspo-defaults', plan, entries: draft[plan] });
      }
    }
    toast.push('success', 'MSPO mapping defaults saved', 'Every tender uses these defaults. Columns a tender has adjusted keep that tender\'s field.');
    setDraft(null);
  };

  return (
    <section>
      <div className="review-toolbar">
        <span className="muted small">
          Each MSPO template column is filled from a field of the business case in TendrAI (the app
          is the source of truth, not a workbook). Every line of the chosen version is included; each
          tender keys in its MSPO quote line, fiscal years and man-days per month before download.
          {adjusted > 0 && <> {adjusted} tender{adjusted === 1 ? ' has' : 's have'} its own adjustments.</>}
        </span>
        <span className="review-toolbar-actions">
          {draft ? (
            <>
              <Button compact onClick={() => setDraft(null)}>Discard changes</Button>
              <Button compact variant="primary" disabled={anyProblem} title={anyProblem ? 'Fix the problems listed under each plan first' : undefined} onClick={save}>Save defaults</Button>
            </>
          ) : (
            <Button compact icon={Pencil} disabled={!editable} title={editable ? undefined : BD_ONLY} onClick={() => setDraft(state.mspoDefaults)}>Edit defaults</Button>
          )}
        </span>
      </div>
      <div className="mspo-map-stack">
        {MAP_GROUPS.map(({ plan, title }) => (
          <div key={plan}>
            <table className="grid">
              <thead>
                <tr><th colSpan={3}>{title}{plan === 'figures' && <span className="muted small"> - keyed into MSPO, not part of a plan download</span>}</th></tr>
                <tr><th style={{ width: '30%' }}>{plan === 'figures' ? 'Figure' : 'Template column'}</th><th>Source</th><th>Business case field</th></tr>
              </thead>
              <tbody>
                {view[plan].map((e) => (
                  <tr key={e.target}>
                    <td>{e.target}{e.note && <div className="muted small">{e.note}</div>}</td>
                    <td>
                      {draft ? (
                        <select
                          value={e.source}
                          aria-label={`Source for ${e.target}`}
                          onChange={(ev) => {
                            const source = ev.target.value as MapSource;
                            update(plan, e.target, source === 'workbook' ? { source, field: e.field ?? fieldsFor(plan)[0]?.key } : { source });
                          }}
                        >
                          <option value="workbook">Business case</option>
                          <option value="mspo">From MSPO</option>
                          <option value="manual">Manual</option>
                          <option value="calculated">Calculated</option>
                        </select>
                      ) : e.source === 'workbook' ? 'Business case'
                        : <span className={e.source === 'mspo' ? 'badge badge-ai' : e.source === 'calculated' ? 'badge badge-human' : 'badge badge-neutral'}>{e.source === 'mspo' ? 'From MSPO' : e.source === 'calculated' ? 'Calculated' : 'Manual'}</span>}
                    </td>
                    {e.source === 'workbook' ? (
                      <td>
                        {draft ? (
                          <select value={e.field ?? ''} aria-label={`Default business case field for ${e.target}`} onChange={(ev) => update(plan, e.target, { field: ev.target.value })}>
                            {fieldsFor(plan).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        ) : fieldLabel(e.field)}
                      </td>
                    ) : (
                      <td className="muted small">
                        {e.source === 'mspo'
                          ? (e.target.startsWith('Quote Line') ? 'The quote line each tender keys in once' : 'Created in MSPO - keyed in after download')
                          : e.source === 'calculated' ? 'Man-days per month in the months the project runs (from the resource plan split)'
                          : 'Left blank - keyed in after download'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {problems[plan].length > 0 && (
              <ul className="err small" role="alert" style={{ marginTop: 6 }}>
                {problems[plan].map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Exchange rate defaults --------------------------------------------------------

/** Company default exchange rates (to 1 USD). Each new AI-drafted business case
 *  copies them as its applied rates; BD can still adjust a case's own rates on
 *  its Basic Info tab. Existing business cases are not changed. */
function FxDefaultsTab({ editable }: { editable: boolean }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const view = (code: string) => draft?.[code] ?? String(state.fxDefaults[code] ?? '');
  const problems = draft ? Object.entries(draft).filter(([, v]) => !(Number(v) > 0)).map(([code]) => `${code}: enter a rate above 0`) : [];
  const save = () => {
    if (!draft || problems.length) return;
    const rates = Object.fromEntries(Object.entries(draft).map(([code, v]) => [code, Number(v)]));
    dispatch({ type: 'set-fx-defaults', rates: { ...state.fxDefaults, ...rates } });
    toast.push('success', 'Exchange rate defaults saved', 'New AI-drafted business cases use these rates. Existing business cases keep their own.');
    setDraft(null);
  };
  return (
    <section>
      <div className="review-toolbar">
        <span className="muted small">
          Rates are units of each currency to 1 USD. Every new AI-drafted business case copies them as
          its applied rates, used to convert vendor quotes and the SGD rate card into the quote currency.
          Existing business cases keep their own rates (BD adjusts them on the case's Basic Info tab).
        </span>
        <span className="review-toolbar-actions">
          {draft ? (
            <>
              <Button compact onClick={() => setDraft(null)}>Discard changes</Button>
              <Button compact variant="primary" disabled={problems.length > 0} title={problems.length ? problems.join('; ') : undefined} onClick={save}>Save rates</Button>
            </>
          ) : (
            <Button compact icon={Pencil} disabled={!editable} title={editable ? undefined : BD_ONLY} onClick={() => setDraft({})}>Edit rates</Button>
          )}
        </span>
      </div>
      <table className="grid narrow">
        <thead><tr><th>Currency</th><th>Code</th><th className="num">Default rate (to 1 USD)</th><th className="num">Planning rate</th></tr></thead>
        <tbody>
          {CURRENCIES.map(([code, name, planning]) => (
            <tr key={code}>
              <td>{name}</td>
              <td>{code}</td>
              <td className="num">
                {draft ? (
                  <input
                    className="map-cell-input"
                    inputMode="decimal"
                    value={view(code)}
                    aria-label={`Default rate for ${code}`}
                    onChange={(e) => setDraft((d) => ({ ...(d ?? {}), [code]: e.target.value }))}
                  />
                ) : state.fxDefaults[code]}
              </td>
              <td className="num muted">{planning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {problems.length > 0 && (
        <ul className="err small" role="alert" style={{ marginTop: 6 }}>
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </section>
  );
}
