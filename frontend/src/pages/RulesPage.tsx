// Business case management: the company-wide configuration applied to every
// business case upload.
//  - Final Check rules: add, edit, enable/disable and delete the checks run on
//    each upload (failed checks warn, never block). Rules point at workbook
//    cells by tab + cell reference; the tabs a rule involves are inferred.
//  - MSPO mapping defaults: which workbook tab and cells fill each MSPO
//    template column. Every tender starts from these; a tender can set its own
//    row count and adjust individual columns.

import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { canDo } from '../config';
import { useStore } from '../state/store';
import { Banner, Button, ConfirmDialog, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import {
  BUILTINS,
  CELL_CATALOG,
  cellRefProblem,
  describeLogic,
  findCell,
  ruleTabs,
  runFinalChecks,
  type CellRef,
  type LineOp,
  type RuleDef,
} from '../rules/finalChecks';
import { BC_TABS, MAP_GROUPS, SPAN_LABEL, rangeEnd, validatePlan, type FieldMapEntry, type MapGroup, type MapSource, type MapSpan } from '../mspo/mapping';

const BD_ONLY = 'Only the BD team manages Final Check rules and MSPO mapping defaults';

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
        ]}
        active={tab}
        onChange={setTab}
      />
      {!editable && (
        <Banner kind="info">View only - the BD team manages Final Check rules and MSPO mapping defaults.</Banner>
      )}
      {tab === 'rules' ? <RulesTab editable={editable} /> : <MappingDefaultsTab editable={editable} />}
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
  left: { tab: 'Basic Info', ref: 'C31:C42' },
  right: { tab: 'Summary', ref: 'B6' },
  tolerance: 1,
});

/** Tab + cell (or range) picker. Suggests the template cells the system
 *  knows for the chosen tab and names what the reference holds. */
function CellPicker({
  label, value, onChange, needRange, id,
}: {
  label: string;
  value?: CellRef;
  onChange: (c: CellRef) => void;
  needRange?: boolean;
  id: string;
}) {
  const v = value ?? { tab: 'Summary', ref: '' };
  const known = findCell(v);
  const problem = v.ref.trim() ? cellRefProblem(v.ref, needRange) : null;
  const options = CELL_CATALOG.filter((c) => c.tab === v.tab && (!needRange || c.ref.includes(':')));
  return (
    <div className="cell-picker">
      <span className="cell-picker-label">{label}<span className="req" aria-hidden>*</span></span>
      <div className="cell-picker-row">
        <select value={v.tab} aria-label={`${label}: tab`} onChange={(e) => onChange({ tab: e.target.value, ref: '' })}>
          {BC_TABS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input
          className="map-cell-input cell-picker-ref"
          list={`${id}-cells`}
          value={v.ref}
          placeholder={needRange ? 'e.g. F6:F25' : 'e.g. B5 or C31:C42'}
          aria-label={`${label}: cell or range`}
          aria-invalid={!!problem}
          onChange={(e) => onChange({ tab: v.tab, ref: e.target.value.toUpperCase() })}
        />
        <datalist id={`${id}-cells`}>
          {options.map((c) => <option key={c.ref} value={c.ref}>{c.label}</option>)}
        </datalist>
      </div>
      <span className={`small ${problem ? 'err' : 'muted'}`}>
        {problem
          ?? (known ? `${known.label}${v.ref.includes(':') && !needRange ? ' - range is summed' : ''}`
            : v.ref.trim() ? 'Read from the uploaded workbook (no demo value - shown as "Not checked")' : `Suggestions: ${options.map((c) => c.ref).join(', ') || 'none for this tab'}`)}
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

  // a real parsed business case to test a rule against while editing
  const sample = useMemo(() => {
    for (const t of state.tenders) {
      const v = [...t.bcVersions].reverse().find((x) => !x.layoutUnrecognised);
      if (v) return { label: `${t.name} v${v.v}`, data: v.data };
    }
    return undefined;
  }, [state.tenders]);

  const set = (patch: Partial<RuleDef>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const problems = (r: RuleDef): string[] => {
    const p: string[] = [];
    if (!r.name.trim()) p.push('a name');
    const refOk = (c?: CellRef, range = false) => !!c && !!c.ref.trim() && !cellRefProblem(c.ref, range);
    if (r.kind === 'compare' && (!refOk(r.left) || !refOk(r.right))) p.push('valid cells on both sides');
    if (r.kind === 'range') {
      if (!refOk(r.target)) p.push('a valid cell');
      if (r.min === undefined && r.max === undefined) p.push('a minimum or a maximum');
      if (r.min !== undefined && r.max !== undefined && r.min > r.max) p.push('a minimum below the maximum');
    }
    if (r.kind === 'every-line') {
      if (!refOk(r.target, true)) p.push('a valid column range');
      if (r.value === undefined) p.push('a value to compare against');
      if (r.op === 'between' && r.value2 === undefined) p.push('an upper value');
    }
    return p;
  };
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  const save = () => {
    if (!draft) return;
    const rule = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
    dispatch({ type: 'upsert-rule', rule });
    toast.push('success', isNew ? 'Rule added' : 'Rule saved', `${rule.name} applies to business case uploads; existing versions are re-checked when viewed.`);
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
          {enabledCount} of {state.rules.length} rules are applied to every business case upload. Failed checks warn - they never block.
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
            <tr><td colSpan={6} className="muted">No rules - business case uploads are not checked. Add a rule to start.</td></tr>
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
                  The name, severity{draft.builtin === 'line-totals-consistent' ? ' and tolerance' : ''} can be changed.
                </p>
              ) : (
                <div className="rule-kinds">
                  {([
                    ['compare', 'A cell must equal another cell'],
                    ['range', 'A cell must be within a range'],
                    ['every-line', 'Every line must meet a condition'],
                  ] as const).map(([k, label]) => (
                    <label key={k} className="check-inline">
                      <input
                        type="radio"
                        name="rule-kind"
                        checked={draft.kind === k}
                        onChange={() => set(
                          k === 'compare' ? { kind: k, left: { tab: 'Basic Info', ref: 'C31:C42' }, right: { tab: 'Summary', ref: 'B6' }, tolerance: 1 }
                            : k === 'range' ? { kind: k, target: { tab: 'Summary', ref: 'C22' }, min: undefined, max: undefined }
                              : { kind: k, target: { tab: 'Labour Inputs', ref: 'F4:F23' }, op: '>', value: 0, value2: undefined },
                        )}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}

              {draft.kind === 'compare' && (
                <div className="rule-operands">
                  <CellPicker id="left" label="Value in" value={draft.left} onChange={(c) => set({ left: c })} />
                  <span className="rule-op">must equal</span>
                  <CellPicker id="right" label="Value in" value={draft.right} onChange={(c) => set({ right: c })} />
                  <label className="rule-tolerance">Tolerance
                    <input type="number" min={0} value={draft.tolerance ?? ''} onChange={(e) => set({ tolerance: num(e.target.value) })} />
                  </label>
                </div>
              )}
              {draft.kind === 'range' && (
                <div className="rule-operands">
                  <CellPicker id="target" label="Value in" value={draft.target} onChange={(c) => set({ target: c })} />
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
                  <CellPicker id="lines" label="Every cell in" value={draft.target} needRange onChange={(c) => set({ target: c })} />
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
            toast.push('success', 'Rule deleted', `${deleting.name} no longer runs on business case uploads.`);
          }
          setDeleting(null);
        }}
      >
        <p>
          <b>{deleting?.name}</b> stops running on uploads, and existing business case versions no
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
  const problems = Object.fromEntries(MAP_GROUPS.map(({ plan }) => [plan, validatePlan(view[plan])])) as Record<MapGroup, string[]>;
  const anyProblem = Object.values(problems).some((p) => p.length);
  const adjusted = state.tenders.filter((t) => (t.mspoMapping && Object.keys(t.mspoMapping).length) || (t.mspoRows && Object.values(t.mspoRows).some((v) => v !== undefined)) || t.mspoFyCount !== undefined).length;

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
    toast.push('success', 'MSPO mapping defaults saved', 'New business cases use these defaults. Columns a tender has adjusted keep that tender\'s value.');
    setDraft(null);
  };

  return (
    <section>
      <div className="review-toolbar">
        <span className="muted small">
          Every tender starts from these defaults. The last row and the number of fiscal-year columns
          vary per business case, so each tender keys them in (with its MSPO quote line) before download.
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
                <tr><th colSpan={5}>{title}{plan === 'figures' && <span className="muted small"> - single cells keyed into MSPO, not part of a plan download</span>}</th></tr>
                <tr><th style={{ width: '30%' }}>{plan === 'figures' ? 'Figure' : 'Template column'}</th><th>Source</th><th>Business case tab</th><th>From cell</th><th>Runs to</th></tr>
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
                            update(plan, e.target, source === 'workbook'
                              ? { source, tab: e.tab ?? 'Basic Info', from: e.from ?? '', span: e.span ?? 'rows' }
                              : { source });
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
                      <>
                        <td>
                          {draft ? (
                            <select value={e.tab} aria-label={`Default tab for ${e.target}`} onChange={(ev) => update(plan, e.target, { tab: ev.target.value })}>
                              {BC_TABS.map((tab) => <option key={tab}>{tab}</option>)}
                            </select>
                          ) : <span className="muted">{e.tab}</span>}
                        </td>
                        <td className="mono">
                          {draft
                            ? <input className="map-cell-input" value={e.from ?? ''} aria-label={`Default first cell for ${e.target}`} onChange={(ev) => update(plan, e.target, { from: ev.target.value.toUpperCase() })} />
                            : e.from}
                        </td>
                        <td>
                          {draft ? (
                            <select value={e.span ?? 'single'} aria-label={`Range for ${e.target}`} onChange={(ev) => update(plan, e.target, { span: ev.target.value as MapSpan })}>
                              {(Object.keys(SPAN_LABEL) as MapSpan[]).map((k) => <option key={k} value={k}>{SPAN_LABEL[k]}</option>)}
                            </select>
                          ) : <span className="muted">{SPAN_LABEL[e.span ?? 'single']}{(e.span ?? 'single') !== 'single' && <> <span className="mono">({rangeEnd(e)})</span></>}</span>}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="muted small">
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
