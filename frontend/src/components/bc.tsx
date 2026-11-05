// Business case sections: the AI-drafted business case workspace, saved
// versions with Final Check (warn, never block), MSPO auto-fill with visible
// mapping, and the read-only DRB views.

import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Inbox,
  Lock,
  Pencil,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { BcVersion, Tender } from '../types';
import { canDo, DRB_APPROVERS } from '../config';
import { dateShort, pct, ts } from '../lib/format';
import { useStore } from '../state/store';
import { failedChecks, ruleTabs, runFinalChecks, type CheckRun } from '../rules/finalChecks';
import {
  MAP_GROUPS,
  MSPO_PLANS,
  buildPlanRows,
  detectedFyCount,
  detectedRows,
  downloadMspoPlan,
  effectivePlan,
  DEFAULT_DAYS_PER_MONTH,
  fiscalPeriods,
  projectPeriod,
  resourceBreakdown,
  rowsOfSplit,
  headersFor,
  fieldLabel,
  fieldsFor,
  type MapGroup,
  type MspoFillOptions,
  type MspoPlan,
} from '../mspo/mapping';
import { Banner, Button, ConfirmDialog, EmptyState, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import { isTenderLocked } from './rfp';
import { bcFigures, figureMoney, figurePct } from '../lib/figures';
import { useUnsavedChanges } from '../lib/leaveGuard';
import type { BusinessCaseState } from '../businessCase/model';
import { detailedDiff, diffSummary } from '../businessCase/draft';
import { approvalBlocked, latestVersion, pendingApprovers } from '../businessCase/versions';
import { downloadBusinessCase, versionData } from '../businessCase/workbook';
import { Workspace, unreviewedCounts } from '../businessCase/Workspace';

function checksLine(runs: CheckRun[]): string {
  const failed = failedChecks(runs);
  return failed.length === 0 ? 'all checks passed' : `${failed.length} check${failed.length > 1 ? 's' : ''} failed`;
}

// ---- Checks panel ------------------------------------------------------------

export function ChecksPanel({ runs }: { runs: CheckRun[] }) {
  return (
    <div>
      <table className="grid">
        <thead><tr><th>Result</th><th>Rule</th><th>Tabs involved</th><th>Expected</th><th>Actual</th></tr></thead>
        <tbody>
          {runs.map(({ rule, result }) => (
            <tr key={rule.id}>
              <td style={{ whiteSpace: 'nowrap' }}>
                {result.skipped
                  ? <span className="muted">Not checked</span>
                  : result.ok
                  ? <span className="ok"><Check size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> Pass</span>
                  : <span className="err"><AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> {rule.severity === 'error' ? 'Fail' : 'Warning'}</span>}
              </td>
              <td><b>{rule.name}</b><div className="muted small">{rule.description}</div></td>
              <td>
                {ruleTabs(rule).map((tab) => <span className="badge badge-neutral" key={tab} style={{ marginRight: 4 }}>{tab}</span>)}
              </td>
              <td className="check-value">{result.expected}</td>
              <td className="check-value">{result.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What each failed check expected and found - shown to the reviewing roles
 *  so they need not expand the version to see why it failed. */
export function FailedChecksList({ runs }: { runs: CheckRun[] }) {
  const failed = failedChecks(runs);
  if (!failed.length) return null;
  return (
    <ul className="failed-checks">
      {failed.map(({ rule, result }) => (
        <li key={rule.id}>
          <b>{rule.name}</b>{rule.severity !== 'error' && <span className="muted"> (warning)</span>}
          {' - '}expected {result.expected}, actual {result.actual}
        </li>
      ))}
    </ul>
  );
}

// ---- MSPO panel --------------------------------------------------------------

const SOURCE_BADGE: Record<'mspo' | 'manual' | 'calculated', { label: string; cls: string }> = {
  calculated: { label: 'Calculated', cls: 'badge badge-human' },
  mspo: { label: 'From MSPO', cls: 'badge badge-ai' },
  manual: { label: 'Manual', cls: 'badge badge-neutral' },
};

/** The per-tender MSPO inputs, kept as typed text while editing. */
interface MspoDetails {
  quoteLine: string;
  fyCount: string;
  daysPerMonth: string;
}
const DETAIL_LABEL: Record<keyof MspoDetails, string> = {
  quoteLine: 'Quote line',
  fyCount: 'Fiscal years',
  daysPerMonth: 'Man-days per month',
};
function mspoDetailProblems(d: MspoDetails): string[] {
  const out: string[] = [];
  if (!d.quoteLine.trim()) out.push('Key in the MSPO quote line');
  const n = Number(d.fyCount);
  if (!d.fyCount.trim() || !Number.isInteger(n) || n < 1 || n > 10) out.push('Fiscal years must be a whole number from 1 to 10');
  const dpm = Number(d.daysPerMonth);
  if (!d.daysPerMonth.trim() || !(dpm > 0) || dpm > 31) out.push('Man-days per month must be more than 0 and at most 31');
  return out;
}

/** Default MSPO source: the latest version the DRB approved, else the latest. */
const defaultMspoVersion = (t: Tender) => [...t.bcVersions].reverse().find((v) => v.approvedAt) ?? latestVersion(t);

function mspoVersionLabel(v: BcVersion, latest: number) {
  if (v.approvedAt) return `v${v.v} - approved ${dateShort(v.approvedAt)}`;
  const n = v.approvals?.length ?? 0;
  return `v${v.v} - ${v.v === latest ? 'working version' : 'not approved'}, ${n} of ${DRB_APPROVERS.length} DRB approvals`;
}

function MspoPanel({ t, unsaved }: { t: Tender; unsaved?: boolean }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [editMapping, setEditMapping] = useState(false);
  const canEdit = canDo.downloadMspo(state.role);
  // the BD team chooses which version fills the templates (default: latest approved)
  const [pickedV, setPickedV] = useState<number | null>(null);
  const version = (pickedV !== null && t.bcVersions.find((v) => v.v === pickedV)) || defaultMspoVersion(t)!;
  const data = version.data;
  const runs = useMemo(() => runFinalChecks(data, state.rules), [data, state.rules]);
  const latestV = latestVersion(t)?.v ?? version.v;
  const failed = failedChecks(runs);

  // per tender: the shared quote line, fiscal years and man-days per month.
  // Edited as a draft and saved once, so the audit log gets one entry per save.
  const saved: MspoDetails = {
    quoteLine: t.mspoQuoteLine ?? '',
    fyCount: String(t.mspoFyCount ?? detectedFyCount(data)),
    daysPerMonth: String(t.mspoDaysPerMonth ?? DEFAULT_DAYS_PER_MONTH),
  };
  const [details, setDetails] = useState<MspoDetails | null>(null);
  const view = details ?? saved;
  const detailProblems = mspoDetailProblems(view);
  const num = (s: string, fallback: number) => (Number.isFinite(parseFloat(s)) && parseFloat(s) > 0 ? parseFloat(s) : fallback);
  const fyCount = Math.min(10, Math.round(num(view.fyCount, +saved.fyCount)));
  const quoteLine = view.quoteLine.trim();
  const daysPerMonth = Math.min(31, num(view.daysPerMonth, +saved.daysPerMonth));
  const setDetail = (k: keyof MspoDetails, v: string) => setDetails((d) => ({ ...(d ?? saved), [k]: v }));
  const saveDetails = () => {
    if (!details || detailProblems.length) return;
    const changes = (Object.keys(DETAIL_LABEL) as (keyof MspoDetails)[])
      .filter((k) => details[k].trim() !== saved[k])
      .map((k) => `${DETAIL_LABEL[k]}: ${saved[k] || '(empty)'} -> ${details[k].trim() || '(empty)'}`);
    if (changes.length) {
      dispatch({ type: 'set-mspo-details', tenderId: t.id, changes, quoteLine: details.quoteLine.trim(), fyCount, daysPerMonth });
      toast.push('success', 'MSPO details saved', `${changes.length} change${changes.length > 1 ? 's' : ''} saved.`);
    }
    setDetails(null);
  };
  const period = projectPeriod(data);
  const fill: MspoFillOptions = { quoteLine, fyCount, daysPerMonth };
  const periods = fiscalPeriods(data).slice(0, fyCount);
  const breakdown = resourceBreakdown(data, fill);
  const figures = bcFigures(data, state.mspoDefaults, t);
  /** the headline figures as they read in this version */
  const figureValue: Record<string, string> = {
    TCV: figureMoney(figures.tcv, data.header.currency),
    'Indirect cost': figureMoney(figures.indirect, data.header.currency),
    'Direct cost': figureMoney(figures.direct, data.header.currency),
    EBITDA: figureMoney(figures.ebitda, data.header.currency),
    'EBITDA (%)': figurePct(figures.ebitdaPct),
  };
  const entriesOf = (plan: MapGroup) => effectivePlan(state.mspoDefaults, t, plan);

  const dl = (plan: MspoPlan) => {
    downloadMspoPlan(plan, t, data, fill, entriesOf(plan));
    const name = `${plan[0].toUpperCase()}${plan.slice(1)} plan`;
    dispatch({ type: 'log', event: { action: 'MSPO template downloaded', detail: `${name} from v${version.v}, quote line ${quoteLine}${failed.length ? ` (${failed.length} Final Check(s) failed)` : ''}`, tenderId: t.id, section: 'MSPO templates' } });
    toast.push(
      failed.length ? 'warning' : 'success',
      `MSPO ${plan} plan downloaded`,
      failed.length
        ? `Generated although ${failed.length} Final Check(s) failed - review before uploading to MSPO.`
        : 'Key in the "From MSPO" and "Manual" columns in the file before uploading it to MSPO.',
    );
  };

  const dlTitle = !canDo.downloadMspo(state.role) ? 'Only the BD team downloads MSPO templates'
      : details ? 'Save or cancel the MSPO details first'
      : !quoteLine ? 'Key in the MSPO quote line first'
        : failed.length ? 'Checks failed - download carries a warning' : undefined;
  const canDl = canEdit && !!quoteLine && !details;

  /** A tender may fill a column from a different business case field. */
  const commitField = (plan: MapGroup, target: string, field: string) => {
    dispatch({ type: 'set-mspo-mapping', tenderId: t.id, key: `${plan}:${target}`, field });
    toast.push('success', 'Mapping updated', `${target} is now filled from ${fieldLabel(field)}.`);
  };
  const anyOverride = (!!t.mspoMapping && Object.keys(t.mspoMapping).length > 0)
    || t.mspoFyCount !== undefined || t.mspoDaysPerMonth !== undefined;

  const linesText = (plan: MspoPlan) => {
    const n = detectedRows(data, plan);
    return `${n} business case line${n === 1 ? '' : 's'}`;
  };
  const editing = !!details;
  const field = (k: keyof MspoDetails, label: string, help: ReactNode, opts: { required?: boolean; type?: 'text' | 'number'; min?: number; max?: number; step?: number; placeholder?: string } = {}) => (
    <label>
      {label}{opts.required && <span className="req" aria-hidden>*</span>}
      <input
        type={opts.type ?? 'number'}
        min={opts.min}
        max={opts.max}
        step={opts.step}
        value={view[k]}
        placeholder={opts.placeholder}
        disabled={!editing}
        aria-required={opts.required}
        onChange={(e) => setDetail(k, e.target.value)}
      />
      <span className="muted small mspo-help">{help}</span>
    </label>
  );

  return (
    <section>
      <div className="hd-form">
        <label>
          Business case version
          <select
            value={version.v}
            aria-label="Business case version that fills the MSPO templates"
            onChange={(e) => setPickedV(Number(e.target.value))}
          >
            {[...t.bcVersions].reverse().map((v) => <option key={v.v} value={v.v}>{mspoVersionLabel(v, latestV)}</option>)}
          </select>
          <span className="muted small mspo-help">Every figure is written exactly as saved in this version.</span>
        </label>
      </div>
      {!version.approvedAt && (
        <Banner kind="warning">
          v{version.v} has not been approved by the DRB ({version.approvals?.length ?? 0} of {DRB_APPROVERS.length} approvals).
          You can still generate the templates from it, but MSPO is normally set up from an approved version.
        </Banner>
      )}
      {unsaved && version.v === latestV && (
        <Banner kind="info">
          The business case has unsaved edits. The MSPO templates use v{version.v} as last saved; save the edits to include them.
        </Banner>
      )}
      {failed.length > 0 && (
        <Banner kind="warning">
          {failed.length} Final Check{failed.length > 1 ? 's' : ''} failed on this version. You can
          still generate the MSPO templates, but the downloads carry this warning.
          {canDo.readOnlyReview(state.role) && <FailedChecksList runs={runs} />}
        </Banner>
      )}
      <div className="mspo-inputs">
        <div className="section-heading">
          <div>
            <h3 style={{ margin: 0 }}>MSPO details</h3>
            <div className="muted small">
              Create the quote line in MSPO first. Every line of v{version.v} is included; the fiscal years follow its project period.
            </div>
          </div>
          <span className="review-toolbar-actions">
            {editing ? (
              <>
                <Button compact onClick={() => setDetails(null)}>Cancel</Button>
                <Button
                  compact
                  variant="primary"
                  disabled={detailProblems.length > 0}
                  title={detailProblems.length ? detailProblems.join('; ') : undefined}
                  onClick={saveDetails}
                >
                  Save changes
                </Button>
              </>
            ) : (
              <Button compact icon={Pencil} disabled={!canEdit} title={canEdit ? undefined : 'Only the BD team edits the MSPO details'} onClick={() => setDetails(saved)}>Edit details</Button>
            )}
          </span>
        </div>
        <div className="muted small mspo-period">
          Project period (Basic Info): <b>{dateShort(period.start.toISOString())}</b> to <b>{dateShort(period.end.toISOString())}</b>, {period.months} months
          {' - '}{fiscalPeriods(data).map((p) => `${p.label} ${p.months.length === 12 ? '(12 months)' : `(${p.months[0]}-${p.months[p.months.length - 1]}, ${p.months.length} months)`}`).join(', ')}
        </div>
        <div className="hd-form mspo-form">
          {field('quoteLine', 'MSPO quote line', 'Written to every row of all three plans', { required: true, type: 'text', placeholder: 'e.g. QL-0012345' })}
          {field('fyCount', 'Fiscal years', periods.map((p) => p.label).join(', '), { required: true, min: 1, max: 10 })}
          {field('daysPerMonth', 'Man-days per month', 'One person, one month (resource plan)', { required: true, min: 1, max: 31, step: 0.5 })}
        </div>
        {editing && detailProblems.length > 0 && (
          <ul className="err small" role="alert" style={{ margin: 0 }}>
            {detailProblems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>

      <div className="review-toolbar">
        <span className="muted small">
          {version.mspoDownloadedAt
            ? <>Last generated from v{version.v} on {ts(version.mspoDownloadedAt)}.</>
            : <>Filled from business case v{version.v}.</>}
          {' '}Then key in the "From MSPO" and "Manual" columns in Excel.
        </span>
        <span className="review-toolbar-actions">
          <Button icon={Download} compact disabled={!canDl} title={dlTitle} onClick={() => dl('product')}>
            Download product plan
          </Button>
          <Button icon={Download} compact disabled={!canDl} title={dlTitle} onClick={() => dl('billing')}>
            Download billing plan
          </Button>
          <Button icon={Download} compact disabled={!canDl} title={dlTitle} onClick={() => dl('resource')}>
            Download resource plan
          </Button>
          <Button
            variant="primary"
            compact
            icon={Pencil}
            disabled={!canEdit}
            title={canEdit ? 'Change which business case field fills each template column' : 'Only the BD team edits the MSPO mapping'}
            onClick={() => setEditMapping((v) => !v)}
          >
            {editMapping ? 'Done editing mapping' : 'Edit mapping'}
          </Button>
        </span>
      </div>

      <details className="mapping-panel" open={editMapping}>
        <summary>Column mapping for this tender{editMapping ? ' - editing' : ''}</summary>
        <p className="muted small" style={{ margin: '0 12px' }}>
          Each template column is filled from a field of the business case in TendrAI. Defaults are
          managed on the Business case management page; change a column's field here for this tender only.
          {anyOverride && (
            <> <button type="button" className="link-btn" disabled={!canEdit} title={canEdit ? undefined : 'Only the BD team edits the MSPO mapping'} onClick={() => dispatch({ type: 'reset-mspo-mapping', tenderId: t.id })}>Reset this tender to the defaults</button></>
          )}
        </p>
        <div className="mspo-map-stack">
          {MAP_GROUPS.map((g) => (
            <table className="grid" key={g.plan}>
              <thead>
                <tr>
                  <th colSpan={3}>
                    {g.title}{' '}
                    <span className="muted small">
                      {g.plan === 'figures' ? `- keyed into MSPO, values from v${version.v}` : `- ${linesText(g.plan)}`}
                    </span>
                  </th>
                </tr>
                <tr><th style={{ width: '32%' }}>{g.plan === 'figures' ? 'Figure' : 'Template column'}</th><th>Source</th><th>{g.plan === 'figures' ? 'Value in this version' : 'Business case field'}</th></tr>
              </thead>
              <tbody>
                {entriesOf(g.plan).map((e) => (
                  <tr key={e.target}>
                    <td>
                      {e.target}
                      {e.overridden && (
                        <span className="badge badge-human" style={{ marginLeft: 6 }}>
                          <Check size={12} aria-hidden /> Edited for this tender
                        </span>
                      )}
                      {e.note && <div className="muted small">{e.note}</div>}
                    </td>
                    {e.source === 'workbook' ? (
                      <>
                        <td>
                          {editMapping && canEdit ? (
                            <select
                              value={e.field ?? ''}
                              aria-label={`Business case field for ${e.target}`}
                              onChange={(ev) => commitField(g.plan, e.target, ev.target.value)}
                            >
                              {fieldsFor(g.plan).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                          ) : <span>{fieldLabel(e.field)}</span>}
                          {e.overridden && editMapping && canEdit && (
                            <IconButton
                              label={`Reset ${e.target} to the default`}
                              icon={RotateCcw}
                              onClick={() => dispatch({ type: 'reset-mspo-mapping', tenderId: t.id, key: `${g.plan}:${e.target}` })}
                            />
                          )}
                        </td>
                        <td className="muted">{g.plan === 'figures' ? figureValue[e.target] ?? '-' : 'One value per row'}</td>
                      </>
                    ) : (
                      <td colSpan={2}>
                        <span className={SOURCE_BADGE[e.source].cls}>{SOURCE_BADGE[e.source].label}</span>
                        <span className="muted small" style={{ marginLeft: 8 }}>
                          {e.target.startsWith('Quote Line')
                            ? (quoteLine ? <>Filled with <b className="mono">{quoteLine}</b></> : 'Filled with the quote line keyed in above')
                            : e.source === 'calculated' ? `${daysPerMonth} per person in the months the project runs; the last row of a line takes any remainder`
                            : e.dropdown === 'subcategory' ? 'Key in after download - dropdown follows the Category'
                              : 'Left blank - key in after download'}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </details>

      <h3>Preview <span className="muted small">(every row of each file, updated as you edit the details; the three "(Do Not Modify)" system columns are in the download as hidden columns)</span></h3>
      {MSPO_PLANS.map((g) => {
        const entries = entriesOf(g.plan);
        const headers = headersFor(g.plan, entries);
        const all = buildPlanRows(g.plan, data, fill, entries);
        return (
          <div key={g.plan} style={{ marginBottom: 12 }}>
            <h4 className="mspo-preview-head">
              {g.title.replace(' template', '')} - {all.length} row{all.length === 1 ? '' : 's'}
              <span className="muted">
                {g.plan === 'product' && fyCount > 1 && ` (${linesText(g.plan)} × fiscal years)`}
                {g.plan === 'resource' && ` from ${linesText(g.plan)} - rows per line and year below`}
              </span>
            </h4>
            {g.plan === 'resource' && <ResourceSplitTable breakdown={breakdown} daysPerMonth={daysPerMonth} />}
            <div className="scroll-x mspo-preview">
              <table className="grid tiny">
                <thead><tr>{headers.slice(3).map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {all.map((row, i) => (
                    <tr key={i}>
                      {row.slice(3).map((v, c) => {
                        const e = entries[c];
                        if (v === '' && e?.source === 'calculated') return <td key={c} className="mspo-blank" />;
                        if (v === '' && e && e.source !== 'workbook') {
                          return <td key={c} className="mspo-blank">{e.source === 'mspo' ? (e.target.startsWith('Quote Line') ? 'quote line?' : 'from MSPO') : 'manual'}</td>;
                        }
                        return <td key={c} className={typeof v === 'number' ? 'num' : ''}>{typeof v === 'number' ? v.toLocaleString() : v}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Rows per labour line and fiscal year: man-days / (man-days per month x months run). */
function ResourceSplitTable({ breakdown, daysPerMonth }: { breakdown: ReturnType<typeof resourceBreakdown>; daysPerMonth: number }) {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="scroll-x" style={{ marginBottom: 8 }}>
      <table className="grid tiny mspo-split">
        <thead>
          <tr>
            <th>Business case line (Skill)</th>
            {breakdown.periods.map((p) => (
              <th key={p.label} className="num">{p.bcLabel} → {p.label}<div className="muted small">{daysPerMonth} × {p.months.length} mo = {fmt(daysPerMonth * p.months.length)} per person</div></th>
            ))}
            <th className="num">MSPO rows</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.lines.map(({ line, skill, years }) => (
            <tr key={line.id}>
              <td>{skill}<div className="muted small">{line.role}, grade {line.grade}</div></td>
              {years.map((y, i) => (
                <td key={i} className="num">
                  {y.mandays > 0 ? (
                    <>
                      {fmt(y.mandays)} md → <b>{rowsOfSplit(y)} row{rowsOfSplit(y) === 1 ? '' : 's'}</b>
                      {y.partialPerMonth > 0 && <div className="muted small">{y.fullRows > 0 ? `${y.fullRows} full + 1 at ` : '1 row at '}{fmt(y.partialPerMonth)}/month</div>}
                    </>
                  ) : <span className="muted">-</span>}
                </td>
              ))}
              <td className="num"><b>{years.reduce((n, y) => n + rowsOfSplit(y), 0)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ---- Business case: AI draft, edits, versions, MSPO ------------------------------

const versionLabel = (v: BcVersion) =>
  v.origin === 'ai-draft' ? 'AI first draft' : `Copy of approved v${v.copyOf}`;

/** One line per DRB member: when they approved this version, or that they have not. */
function ApprovalsCell({ t, v, onApprove }: { t: Tender; v: BcVersion; onApprove: () => void }) {
  const { state } = useStore();
  const blocked = approvalBlocked(t, v);
  const mine = state.user && (v.approvals ?? []).some((a) => a.by === state.user!.name);
  const canApprove = canDo.approveBc(state.role) && !isTenderLocked(t) && !blocked && !mine;
  if (v.origin === 'approved-copy' && !v.edits?.length && !(v.approvals ?? []).length) return <span className="muted small">Not needed until edited</span>;
  return (
    <div className="approvals-cell">
      {DRB_APPROVERS.map((u) => {
        const a = (v.approvals ?? []).find((x) => x.by === u.name);
        return (
          <div key={u.name} className="small">
            {a ? <span className="ok"><Check size={12} aria-hidden /> {u.name}</span> : <span className="muted">{u.name}</span>}
            <span className="muted"> · {a ? ts(a.at) : blocked && !v.approvedAt ? 'not approved' : 'pending'}</span>
          </div>
        );
      })}
      {canApprove && <Button compact icon={Check} onClick={onApprove}>Approve v{v.v}</Button>}
    </div>
  );
}

/** The business case tab. `drb` = the DRB's read-only view: no MSPO tab, and
 *  the Versions tab is where each DRB member approves. */
export function BcSection({ t, drb = false }: { t: Tender; drb?: boolean }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const editable = !drb && canDo.editBc(state.role) && !isTenderLocked(t);
  const [tab, setTab] = useState<'workspace' | 'versions' | 'mspo'>('workspace');
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [approveVersion, setApproveVersion] = useState<BcVersion | null>(null);
  const [ackUnreviewed, setAckUnreviewed] = useState(false);
  /** version picked on the Versions tab (null = the latest) */
  const [viewV, setViewV] = useState<number | null>(null);

  const lv = latestVersion(t);
  // the draft lives here so it survives switching between the tabs
  const [draft, setDraftState] = useState<BusinessCaseState | undefined>(lv?.bc);
  const [draftOf, setDraftOf] = useState(lv?.v);
  if (lv && draftOf !== lv.v) {
    // a new version arrived (saved, drafted, approved or deleted): edit from it
    setDraftOf(lv.v);
    setDraftState(lv.bc);
  }
  const setDraft = useCallback((fn: (bc: BusinessCaseState) => BusinessCaseState) => setDraftState((d) => (d ? fn(d) : d)), []);
  const unsavedSummary = lv && draft && draft !== lv.bc ? diffSummary(lv.bc, draft) : null;
  useUnsavedChanges(unsavedSummary ? `unsaved business case changes (${unsavedSummary})` : null, () => setDraftState(lv?.bc));

  const runs = useMemo(() => (lv ? runFinalChecks(lv.data, state.rules) : []), [lv, state.rules]);

  if (!lv || !draft) {
    const hint = 'The business case unlocks once the tender pack has been processed.';
    return (
      <section>
        <TabsBar
          tabs={[
            { key: 'workspace', label: 'Business case', disabled: true, disabledHint: hint },
            { key: 'versions', label: 'Versions', disabled: true, disabledHint: hint },
            ...(drb ? [] : [{ key: 'mspo', label: 'MSPO templates', disabled: true, disabledHint: hint }]),
          ]}
          active=""
          onChange={() => {}}
        />
        <EmptyState
          icon={Inbox}
          title={t.job ? 'Business case is being drafted' : 'No business case yet'}
          body={t.job
            ? 'The last processing stage drafts the business case from the tender pack and comparable past business cases.'
            : 'Process the tender pack on the Tender pack tab. TendrAI then drafts a first version of the business case for the BD team to review and edit.'}
        />
      </section>
    );
  }

  const viewed = (viewV !== null && t.bcVersions.find((v) => v.v === viewV)) || lv;
  const isLatest = viewed.v === lv.v;
  const partial = lv.approvals?.length && !lv.approvedAt ? lv.approvals : undefined;

  const save = (comment: string) => {
    const changes = detailedDiff(lv.bc, draft);
    dispatch({ type: 'save-bc', tenderId: t.id, bc: draft, summary: diffSummary(lv.bc, draft), comment, changes });
    const f = failedChecks(runFinalChecks(versionData(draft), state.rules)).length;
    toast.push(
      f ? 'warning' : 'success',
      `Business case v${lv.v} saved`,
      `${partial ? `${partial.length} DRB approval(s) voided - v${lv.v} needs approving again. ` : ''}${f ? `${f} Final Check(s) failed - warnings only, nothing is blocked.` : 'All Final Checks passed.'}`,
    );
  };
  const download = (v: BcVersion) => {
    downloadBusinessCase(t, v.v, v.bc);
    dispatch({ type: 'log', event: { action: 'File downloaded', detail: `Business case v${v.v} (.xlsx)`, tenderId: t.id, section: 'Business case' } });
  };
  const view = (v: BcVersion) => {
    setViewV(v.v === lv.v ? null : v.v);
    setTab('workspace');
  };
  const approve = () => {
    if (!approveVersion) return;
    const last = pendingApprovers(approveVersion).length === 1;
    dispatch({ type: 'approve-bc-version', tenderId: t.id, v: approveVersion.v });
    toast.push(
      'success',
      last ? `Business case v${approveVersion.v} approved` : 'Approval recorded',
      last
        ? `All ${DRB_APPROVERS.length} DRB members approved. v${approveVersion.v} is archived read-only, and v${lv.v + 1} is the working copy.`
        : `${(approveVersion.approvals?.length ?? 0) + 1} of ${DRB_APPROVERS.length} DRB approvals on v${approveVersion.v}.`,
    );
    setApproveVersion(null);
  };
  const failed = failedChecks(runs);
  const approveUnreviewed = approveVersion ? unreviewedCounts(approveVersion.bc).total : 0;
  const approveFailed = approveVersion ? failedChecks(runFinalChecks(approveVersion.data, state.rules)).length : 0;

  const notice = viewed.approvedAt ? (
    <Banner
      kind="locked"
      actions={!isLatest && <Button compact onClick={() => setViewV(null)}>View latest (v{lv.v})</Button>}
    >
      v{viewed.v} was approved by all {DRB_APPROVERS.length} DRB members on {ts(viewed.approvedAt)}. It is archived and read-only.
      {!isLatest && ` Changes are made in v${lv.v}.`}
    </Banner>
  ) : !isLatest ? (
    <Banner kind="info" actions={<Button compact onClick={() => setViewV(null)}>View latest (v{lv.v})</Button>}>
      You are viewing v{viewed.v}, an earlier version, read-only.{unsavedSummary ? ' Your unsaved edits to the latest version are kept.' : ''}
    </Banner>
  ) : undefined;

  return (
    <section>
      <TabsBar
        tabs={[
          { key: 'workspace', label: isLatest ? 'Business case' : `Business case (viewing v${viewed.v})` },
          { key: 'versions', label: `Versions (${t.bcVersions.length})` },
          ...(drb ? [] : [{ key: 'mspo', label: 'MSPO templates' }]),
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />

      {tab === 'workspace' && (
        <Workspace
          key={viewed.v}
          base={viewed}
          draft={isLatest ? draft : viewed.bc}
          setDraft={setDraft}
          editable={editable && isLatest && !viewed.approvedAt}
          userName={state.user?.name ?? 'Unknown'}
          rules={state.rules}
          unsavedSummary={isLatest ? unsavedSummary : null}
          onSave={save}
          onDownload={() => download(viewed)}
          onHistory={() => dispatch({ type: 'open-audit', tender: t.ref || t.name, section: 'Business case', returnTo: { tenderId: t.id, packTab: drb ? 'drb-bc' : 'bc', label: t.ref || t.name } })}
          notice={notice}
          saveWarning={partial ? `Saving voids the ${partial.length} of ${DRB_APPROVERS.length} DRB approvals on v${lv.v}` : undefined}
        />
      )}

      {tab === 'versions' && (
        <>
          {failed.length > 0 && (
            <Banner kind="warning">
              Version {lv.v} failed {failed.length} Final Check{failed.length > 1 ? 's' : ''}. This
              warns but does not block: MSPO generation and DRB review stay available.
              {canDo.readOnlyReview(state.role) && <FailedChecksList runs={runs} />}
            </Banner>
          )}
          <table className="grid">
            <thead>
              <tr>
                <th aria-label="Expand checks and saves" /><th>Version</th><th>Last saved</th><th>Changes</th><th>Comment</th><th>Checks</th>
                <th>DRB approvals</th><th>View</th><th aria-label="Download" />
              </tr>
            </thead>
            <tbody>
              {[...t.bcVersions].reverse().map((v) => {
                const r = runFinalChecks(v.data, state.rules);
                const f = failedChecks(r).length;
                const expanded = expandedVersions.has(v.v);
                const saves = v.edits?.length ?? 0;
                return (
                  <Fragment key={v.v}>
                    <tr className={v.v === viewed.v ? 'row-selected' : ''}>
                      <td className="expand-cell">
                        <button
                          className="expand-btn"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} checks for version ${v.v}`}
                          onClick={() => setExpandedVersions((current) => {
                            const next = new Set(current);
                            if (next.has(v.v)) next.delete(v.v); else next.add(v.v);
                            return next;
                          })}
                        >
                          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                        </button>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <b>v{v.v}</b>{' '}
                        {v.origin === 'ai-draft' && <span className="badge badge-ai"><Sparkles size={12} aria-hidden /> AI draft</span>}{' '}
                        {v.approvedAt && <span className="badge badge-human"><Lock size={12} aria-hidden /> Approved, read-only</span>}{' '}
                        {v.v === lv.v && <span className="badge badge-neutral">Latest</span>}
                      </td>
                      <td className="muted">{v.savedBy}<div className="small">{ts(v.savedAt)}</div></td>
                      <td className="muted small">
                        {versionLabel(v)}
                        {v.origin === 'ai-draft' && `: ${v.data.products.length} product lines, ${v.data.resources.length} labour lines, ${v.data.billing.length} billing lines drafted`}
                        <div>{saves ? `${saves} save${saves === 1 ? '' : 's'} - last: ${v.edits![saves - 1].summary}` : 'No edits saved'}</div>
                      </td>
                      <td className="muted">{v.comment ?? '-'}</td>
                      <td>
                        {f === 0 ? <span className="ok"><Check size={13} aria-hidden /> All passed</span> : <span className="err"><AlertTriangle size={13} aria-hidden /> {f} failed</span>}
                      </td>
                      <td>
                        <ApprovalsCell t={t} v={v} onApprove={() => { setAckUnreviewed(false); setApproveVersion(v); }} />
                      </td>
                      <td>
                        <IconButton
                          label={v.v === viewed.v ? `Viewing version ${v.v}` : `View version ${v.v}`}
                          icon={Eye}
                          onClick={() => view(v)}
                        />
                      </td>
                      <td className="table-actions">
                        <IconButton label={`Download version ${v.v} (.xlsx)`} icon={Download} onClick={() => download(v)} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={9}>
                          {saves > 0 && (
                            <table className="grid tiny" style={{ marginBottom: 8 }}>
                              <thead><tr><th>Saved</th><th>By</th><th>Changes</th><th>Comment</th></tr></thead>
                              <tbody>
                                {v.edits!.map((e) => (
                                  <tr key={e.at}>
                                    <td>{ts(e.at)}</td>
                                    <td>{e.by}</td>
                                    <td>{e.summary}{e.voidedApprovals ? <span className="warn-inline">{e.voidedApprovals} DRB approval(s) voided</span> : null}</td>
                                    <td className="muted">{e.comment ?? '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          <ChecksPanel runs={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {tab === 'mspo' && !drb && <MspoPanel t={t} unsaved={!!unsavedSummary} />}

      <ConfirmDialog
        open={approveVersion !== null}
        title={approveVersion && pendingApprovers(approveVersion).length === 1 ? `Approve and archive v${approveVersion.v}?` : `Approve v${approveVersion?.v}?`}
        confirmLabel={approveVersion && pendingApprovers(approveVersion).length === 1 ? 'Approve and archive' : 'Record approval'}
        confirmDisabled={approveUnreviewed > 0 && !ackUnreviewed}
        onClose={() => setApproveVersion(null)}
        onConfirm={approve}
      >
        {approveVersion && (pendingApprovers(approveVersion).length === 1 ? (
          <p>
            You are the last of the {DRB_APPROVERS.length} DRB members to approve. v{approveVersion.v} will be archived and
            read-only for good, and an identical working copy, v{lv.v + 1}, will be created for any later changes.
          </p>
        ) : (
          <p>
            This records approval {(approveVersion.approvals?.length ?? 0) + 1} of {DRB_APPROVERS.length} on v{approveVersion.v}.
            If the BD team saves changes before everyone has approved, the approvals given so far are voided and v{approveVersion.v}
            needs approving again.
          </p>
        ))}
        {approveFailed > 0 && <p className="muted small">{approveFailed} Final Check(s) failed on this version. They warn, and do not block approval.</p>}
        {approveUnreviewed > 0 && (
          <div className="ack-box">
            <b>{approveUnreviewed} AI-drafted value{approveUnreviewed > 1 ? 's have' : ' has'} not been reviewed</b> by the BD team in this version.
            <label className="ack-check">
              <input type="checkbox" checked={ackUnreviewed} onChange={(e) => setAckUnreviewed(e.target.checked)} />
              I understand unreviewed AI-drafted values remain in this version and approve anyway.
            </label>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}

// ---- Read-only DRB views -------------------------------------------------------
// The Deal Review Board sees two tabs: a Summary of the figures that drive the
// go/no-go decision, and the business case itself (read-only), where each DRB
// member approves on the Versions tab.

export function DrbSummarySection({ t }: { t: Tender }) {
  const { state } = useStore();
  const lv = latestVersion(t);
  if (!lv) {
    return <EmptyState icon={Inbox} title="Nothing to review yet" body="The summary appears once the tender pack has been processed and the business case drafted." />;
  }
  const runs = runFinalChecks(lv.data, state.rules);
  const failed = failedChecks(runs);
  const d = lv.data;
  const { tcv, direct, indirect, ebitda, ebitdaPct, source } = bcFigures(d, state.mspoDefaults, t);
  const from = (s?: string) => <div className="muted small">{s ? `Business case ${s}` : 'Not mapped'}</div>;
  const unreviewed = unreviewedCounts(lv.bc).total;
  const approved = [...t.bcVersions].reverse().find((v) => v.approvedAt);
  const approvals = lv.approvals?.length ?? 0;

  return (
    <section>
      <p className="sub" style={{ marginBottom: 10 }}>
        Version {lv.v}, {checksLine(runs)} - {versionLabel(lv)}, last saved by {lv.savedBy} {ts(lv.savedAt)}
        {' · '}
        {lv.origin === 'approved-copy' && !lv.edits?.length ? `unchanged since approved v${lv.copyOf}` : `${approvals} of ${DRB_APPROVERS.length} DRB approvals`}
        {approved && ` · last approved: v${approved.v}, ${ts(approved.approvedAt!)}`}
      </p>
      {unreviewed > 0 && (
        <Banner kind="warning">
          {unreviewed} AI-drafted value{unreviewed === 1 ? ' has' : 's have'} not been reviewed by the BD team in this version.
        </Banner>
      )}
      <div className="kpi-row">
        <div className="kpi"><span>TCV (contract value)</span><b>{figureMoney(tcv, d.header.currency)}</b>{from(source.tcv)}</div>
        <div className="kpi"><span>Direct cost</span><b>{figureMoney(direct, d.header.currency)}</b>{from(source.direct)}</div>
        <div className="kpi"><span>Indirect cost</span><b>{figureMoney(indirect, d.header.currency)}</b>{from(source.indirect)}</div>
        <div className="kpi"><span>EBITDA</span><b className={ebitda !== null && ebitda < 0 ? 'neg' : 'pos'}>{figureMoney(ebitda, d.header.currency)}</b><div className="muted small">{figurePct(ebitdaPct)} of TCV ({source.ebitdaPct ?? 'not mapped'})</div></div>
        <div className="kpi"><span>Final Check</span><b className={failed.length ? 'neg' : 'pos'}>{failed.length ? `${failed.length} failed` : 'All passed'}</b></div>
      </div>
      {failed.length > 0 && (
        <Banner kind="warning">
          Version {lv.v} failed {failed.length} Final Check{failed.length > 1 ? 's' : ''}:
          <FailedChecksList runs={runs} />
        </Banner>
      )}
      <table className="grid narrow">
        <tbody>
          <tr><td>Project type</td><td>{t.projectType}</td></tr>
          <tr><td>Project start</td><td>{dateShort(d.header.projectStart)}</td></tr>
          <tr><td>Duration</td><td>{d.header.durationMonths} months</td></tr>
          <tr><td>Currency</td><td>{d.header.currency}</td></tr>
          <tr><td>Gross margin</td><td className="num">{pct(d.header.marginPct)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

export function DrbBcSection({ t }: { t: Tender }) {
  return <BcSection t={t} drb />;
}
