// Business case sections: version upload + Final Check (warn, never block),
// version diff, MSPO auto-fill with visible mapping, the read-only DRB view,
// and tender document generation.

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  Inbox,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { BcVersion, BcVersionData, Tender } from '../types';
import { canDo } from '../config';
import { dateShort, money, pct, ts } from '../lib/format';
import { useStore } from '../state/store';
import { TextCell } from './common';
import { failedChecks, ruleTabs, runFinalChecks, type CheckRun } from '../rules/finalChecks';
import {
  BC_TABS,
  MAP_GROUPS,
  MSPO_PLANS,
  SPAN_LABEL,
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
  parseCell,
  rangeEnd,
  type MapGroup,
  type MspoFillOptions,
  type MspoPlan,
} from '../mspo/mapping';
import { Banner, Button, ConfirmDialog, EmptyState, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import { ProgressStages } from './ProgressStages';
import { SpreadsheetDocumentViewer, useCitation } from '../ui/citation';
import { isTenderLocked } from './rfp';
import { UploadDialog, type StagedFile } from './upload';
import { bcFigures } from '../lib/figures';

const latest = (t: Tender): BcVersion | undefined => t.bcVersions[t.bcVersions.length - 1];

function checksLine(runs: CheckRun[]): string {
  const failed = failedChecks(runs);
  return failed.length === 0 ? 'all checks passed' : `${failed.length} check${failed.length > 1 ? 's' : ''} failed`;
}

// ---- Checks panel ------------------------------------------------------------

export function ChecksPanel({ runs, version }: { runs: CheckRun[]; version?: BcVersion }) {
  const { show } = useCitation();
  // The viewer opens one pane per involved workbook tab (e.g. "Billing plan
  // equals CCB" shows Basic Info beside Summary), not the whole workbook.
  const showCheckCitation = (rule: CheckRun['rule']) => show({
    docId: `BC-${version?.v ?? 'current'}`,
    title: `Business case - ${version?.fileName ?? 'uploaded workbook'}`,
    fileName: version?.fileName ?? 'uploaded workbook',
    documentUrl: version?.documentUrl ?? '/mock-documents/MHA_business_case_demo.xlsm',
    similarity: 1,
    source: 'historical',
    tab: ruleTabs(rule).join(' · '),
    context: rule.name,
    excerpt: rule.description,
    references: ruleTabs(rule).map((tab) => ({ location: tab, excerpt: `${rule.name}: ${rule.description}` })),
  });
  return (
    <div>
      <table className="grid">
        <thead><tr><th>Result</th><th>Rule</th><th>Tabs involved</th><th>Expected</th><th>Actual</th><th>Source</th></tr></thead>
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
              <td>
                <button className="link-btn" type="button" onClick={() => showCheckCitation(rule)}>View source</button>
              </td>
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

/** The per-business-case MSPO inputs, kept as typed text while editing. */
interface MspoDetails {
  quoteLine: string;
  fyCount: string;
  daysPerMonth: string;
  product: string;
  resource: string;
  billing: string;
}
const DETAIL_LABEL: Record<keyof MspoDetails, string> = {
  quoteLine: 'Quote line',
  fyCount: 'Fiscal years',
  daysPerMonth: 'Man-days per month',
  product: 'Product plan last row',
  resource: 'Resource plan last row',
  billing: 'Billing plan last row',
};
/** The product/resource/billing fields hold the workbook row where each plan ends. */
function mspoDetailProblems(d: MspoDetails, firstRow: Record<MspoPlan, number>): string[] {
  const out: string[] = [];
  if (!d.quoteLine.trim()) out.push('Key in the MSPO quote line');
  const whole = (k: keyof MspoDetails, max: number) => {
    const n = Number(d[k]);
    if (!d[k].trim() || !Number.isInteger(n) || n < 1 || n > max) out.push(`${DETAIL_LABEL[k]} must be a whole number from 1 to ${max}`);
  };
  whole('fyCount', 10);
  const dpm = Number(d.daysPerMonth);
  if (!d.daysPerMonth.trim() || !(dpm > 0) || dpm > 31) out.push('Man-days per month must be more than 0 and at most 31');
  for (const plan of ['product', 'resource', 'billing'] as MspoPlan[]) {
    const n = Number(d[plan]);
    const first = firstRow[plan];
    if (!d[plan].trim() || !Number.isInteger(n) || n < first || n > first + 499) {
      out.push(`${DETAIL_LABEL[plan]} must be a row from ${first} (the first line) to ${first + 499}`);
    }
  }
  return out;
}

function MspoPanel({ t, data, runs, version }: { t: Tender; data: BcVersionData; runs: CheckRun[]; version?: BcVersion }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [editMapping, setEditMapping] = useState(false);
  const layoutBad = version?.layoutUnrecognised;
  const canEdit = canDo.downloadMspo(state.role) && !layoutBad;
  const failed = failedChecks(runs);

  // per business case: where each range ends, and the shared quote line.
  // Edited as a draft and saved once, so the audit log gets one entry per save.
  /** workbook row of each plan's first line, e.g. Product Plan C6 -> 6 */
  const firstRowOf = (plan: MspoPlan) => {
    const e = effectivePlan(state.mspoDefaults, t, plan).find((x) => x.source === 'workbook' && (x.span === 'rows' || x.span === 'rows-cols'));
    return (e?.from ? parseCell(e.from)?.row : undefined) ?? 1;
  };
  const firstRow: Record<MspoPlan, number> = { product: firstRowOf('product'), resource: firstRowOf('resource'), billing: firstRowOf('billing') };
  const endRow = (plan: MspoPlan, lines: number) => String(firstRow[plan] + lines - 1);
  const saved: MspoDetails = {
    quoteLine: t.mspoQuoteLine ?? '',
    fyCount: String(t.mspoFyCount ?? detectedFyCount(data)),
    daysPerMonth: String(t.mspoDaysPerMonth ?? DEFAULT_DAYS_PER_MONTH),
    product: endRow('product', t.mspoRows?.product ?? detectedRows(data, 'product')),
    resource: endRow('resource', t.mspoRows?.resource ?? detectedRows(data, 'resource')),
    billing: endRow('billing', t.mspoRows?.billing ?? detectedRows(data, 'billing')),
  };
  const [details, setDetails] = useState<MspoDetails | null>(null);
  const view = details ?? saved;
  const detailProblems = mspoDetailProblems(view, firstRow);
  const num = (s: string, fallback: number) => (Number.isFinite(parseFloat(s)) && parseFloat(s) > 0 ? parseFloat(s) : fallback);
  const fyCount = Math.min(10, Math.round(num(view.fyCount, +saved.fyCount)));
  /** lines = last row - first row + 1 (falls back to the saved value while the box is invalid) */
  const rowsOf = (plan: MspoPlan) => {
    const typed = Math.round(Number(view[plan]));
    const end = Number.isFinite(typed) && typed >= firstRow[plan] ? typed : +saved[plan];
    return Math.min(500, end - firstRow[plan] + 1);
  };
  const quoteLine = view.quoteLine.trim();
  const daysPerMonth = Math.min(31, num(view.daysPerMonth, +saved.daysPerMonth));
  const setDetail = (k: keyof MspoDetails, v: string) => setDetails((d) => ({ ...(d ?? saved), [k]: v }));
  const saveDetails = () => {
    if (!details || detailProblems.length) return;
    const changes = (Object.keys(DETAIL_LABEL) as (keyof MspoDetails)[])
      .filter((k) => details[k].trim() !== saved[k])
      .map((k) => `${DETAIL_LABEL[k]}: ${saved[k] || '(empty)'} -> ${details[k].trim() || '(empty)'}`);
    if (changes.length) {
      dispatch({
        type: 'set-mspo-details',
        tenderId: t.id,
        changes,
        quoteLine: details.quoteLine.trim(),
        fyCount,
        daysPerMonth,
        rows: { product: rowsOf('product'), resource: rowsOf('resource'), billing: rowsOf('billing') },
      });
      toast.push('success', 'MSPO details saved', `${changes.length} change${changes.length > 1 ? 's' : ''} saved.`);
    }
    setDetails(null);
  };
  const period = projectPeriod(data);
  const fill: MspoFillOptions = {
    quoteLine,
    fyCount,
    daysPerMonth,
    rows: { product: rowsOf('product'), resource: rowsOf('resource'), billing: rowsOf('billing') },
  };
  const periods = fiscalPeriods(data).slice(0, fyCount);
  const breakdown = resourceBreakdown(data, fill);
  const figures = bcFigures(data);
  /** the headline figures as they read in this version */
  const figureValue: Record<string, string> = {
    TCV: money(figures.tcv),
    'Indirect cost': money(figures.indirect),
    'Direct cost': money(figures.direct),
    EBITDA: money(figures.ebitda),
    'EBITDA (%)': pct(figures.ebitdaPct),
  };

  const dl = (plan: MspoPlan) => {
    downloadMspoPlan(plan, t, data, fill, state.mspoDefaults);
    const name = `${plan[0].toUpperCase()}${plan.slice(1)} plan`;
    dispatch({ type: 'log', event: { action: 'MSPO template downloaded', detail: `${name} from v${version?.v ?? '-'}, quote line ${quoteLine}${failed.length ? ` (${failed.length} Final Check(s) failed)` : ''}`, tenderId: t.id, section: 'MSPO templates' } });
    toast.push(
      failed.length ? 'warning' : 'success',
      `MSPO ${plan} plan downloaded`,
      failed.length
        ? `Generated although ${failed.length} Final Check(s) failed - review before uploading to MSPO.`
        : 'Key in the "From MSPO" and "Manual" columns in the file before uploading it to MSPO.',
    );
  };

  const dlTitle = !canDo.downloadMspo(state.role) ? 'Only the BD team downloads MSPO templates'
    : layoutBad ? 'Blocked: the uploaded workbook does not match a known template layout'
      : details ? 'Save or cancel the business case details first'
      : !quoteLine ? 'Key in the MSPO quote line first'
        : failed.length ? 'Checks failed - download carries a warning' : undefined;
  const canDl = canEdit && !!quoteLine && !details;

  /** A tender may change a workbook column's tab and first cell; where the
   *  range ends always follows from the rows and fiscal years below. */
  const commitFrom = (plan: MapGroup, target: string, tab: string, fromStr: string) => {
    const from = parseCell(fromStr);
    if (!from) {
      toast.push('error', 'Invalid cell reference', `"${fromStr}" is not a cell like C6.`);
      return;
    }
    dispatch({ type: 'set-mspo-mapping', tenderId: t.id, key: `${plan}:${target}`, tab, from: `${from.col}${from.row}` });
    toast.push('success', 'Mapping updated', `${target} is now filled from ${tab} starting at ${from.col}${from.row}.`);
  };
  const anyOverride = (!!t.mspoMapping && Object.keys(t.mspoMapping).length > 0)
    || (!!t.mspoRows && Object.values(t.mspoRows).some((v) => v !== undefined))
    || t.mspoFyCount !== undefined || t.mspoDaysPerMonth !== undefined;

  /** e.g. "5 lines (rows 6-10)" */
  const linesText = (plan: MspoPlan) => {
    const n = rowsOf(plan);
    return `${n} line${n === 1 ? '' : 's'} (rows ${firstRow[plan]}-${firstRow[plan] + n - 1})`;
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
      {!layoutBad && failed.length > 0 && (
        <Banner kind="warning">
          {failed.length} Final Check{failed.length > 1 ? 's' : ''} failed on this version. You can
          still generate the MSPO templates, but the downloads carry this warning.
          {canDo.readOnlyReview(state.role) && <FailedChecksList runs={runs} />}
        </Banner>
      )}
      {layoutBad && (
        <Banner kind="error">
          <b>MSPO generation is blocked for this version.</b> The uploaded workbook does not match a
          known business case template layout - these anchors were not found:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {layoutBad.missingAnchors.map((a) => <li key={a}>{a}</li>)}
          </ul>
          Upload a version based on the current template to continue. Failed Final Checks only warn,
          but an unreadable layout cannot be mapped to the MSPO templates at all.
        </Banner>
      )}
      {!layoutBad && <>
        <div className="mspo-inputs">
          <div className="section-heading">
            <div>
              <h3 style={{ margin: 0 }}>Business case details</h3>
              <div className="muted small">
                Create the quote line in MSPO first. Last rows and fiscal years are read from v{version?.v ?? '-'}; correct them if this workbook differs.
              </div>
            </div>
            {canEdit && (
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
                  <Button compact icon={Pencil} onClick={() => setDetails(saved)}>Edit details</Button>
                )}
              </span>
            )}
          </div>
          <div className="muted small mspo-period">
            Project period (Basic Info D7-D9): <b>{dateShort(period.start.toISOString())}</b> to <b>{dateShort(period.end.toISOString())}</b>, {period.months} months
            {' - '}{fiscalPeriods(data).map((p) => `${p.label} ${p.months.length === 12 ? '(12 months)' : `(${p.months[0]}-${p.months[p.months.length - 1]}, ${p.months.length} months)`}`).join(', ')}
          </div>
          <div className="hd-form mspo-form">
            {field('quoteLine', 'MSPO quote line', 'Written to every row of all three plans', { required: true, type: 'text', placeholder: 'e.g. QL-0012345' })}
            {field('fyCount', 'Fiscal years', periods.map((p) => p.label).join(', '), { required: true, min: 1, max: 10 })}
            {field('daysPerMonth', 'Man-days per month', 'One person, one month (resource plan)', { required: true, min: 1, max: 31, step: 0.5 })}
            {MSPO_PLANS.map((g) => (
              <Fragment key={g.plan}>
                {field(g.plan, `Last row - ${g.plan} plan`, linesText(g.plan), { required: true, min: firstRow[g.plan], max: firstRow[g.plan] + 499 })}
              </Fragment>
            ))}
          </div>
          {editing && detailProblems.length > 0 && (
            <ul className="err small" role="alert" style={{ margin: 0 }}>
              {detailProblems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>

        <div className="review-toolbar">
          <span className="muted small">
            {version?.mspoDownloadedAt
              ? <>Last generated from v{version.v} on {ts(version.mspoDownloadedAt)}.</>
              : <>Filled from business case v{version?.v ?? '-'}.</>}
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
              title={canEdit ? 'Change which business case tab and first cell fills each template column' : 'Only the BD team edits the MSPO mapping'}
              onClick={() => setEditMapping((v) => !v)}
            >
              {editMapping ? 'Done editing mapping' : 'Edit mapping'}
            </Button>
          </span>
        </div>

        <details className="mapping-panel" open={editMapping}>
          <summary>Column mapping for this tender{editMapping ? ' - editing' : ''}</summary>
          <p className="muted small" style={{ margin: '0 12px' }}>
            Defaults are managed on the Business case management page. Each range runs from its first
            cell to the last row and fiscal-year column keyed in above. Change a column's tab or first
            cell here for this tender only.
            {anyOverride && canEdit && (
              <> <button type="button" className="link-btn" onClick={() => dispatch({ type: 'reset-mspo-mapping', tenderId: t.id })}>Reset this tender to the defaults</button></>
            )}
          </p>
          <div className="mspo-map-stack">
            {MAP_GROUPS.map((g) => (
              <table className="grid" key={g.plan}>
                <thead>
                  <tr>
                    <th colSpan={4}>
                      {g.title}{' '}
                      <span className="muted small">
                        {g.plan === 'figures'
                          ? `- single cells keyed into MSPO, values from v${version?.v ?? '-'}`
                          : `- ${rowsOf(g.plan)} business case line${rowsOf(g.plan) === 1 ? '' : 's'}`}
                      </span>
                    </th>
                  </tr>
                  <tr><th style={{ width: '32%' }}>{g.plan === 'figures' ? 'Figure' : 'Template column'}</th><th>Source / tab</th><th>{g.plan === 'figures' ? 'Cell' : 'From cell'}</th><th>{g.plan === 'figures' ? 'Value' : 'To cell'}</th></tr>
                </thead>
                <tbody>
                  {effectivePlan(state.mspoDefaults, t, g.plan).map((e) => {
                    const end = g.plan === 'figures' ? figureValue[e.target] ?? 'Single cell' : rangeEnd(e, rowsOf(g.plan), fyCount);
                    return (
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
                                  value={e.tab}
                                  aria-label={`Business case tab for ${e.target}`}
                                  onChange={(ev) => commitFrom(g.plan, e.target, ev.target.value, e.from ?? '')}
                                >
                                  {BC_TABS.map((tab) => <option key={tab}>{tab}</option>)}
                                </select>
                              ) : <span className="muted">{e.tab}</span>}
                            </td>
                            <td className="mono">
                              <TextCell value={e.from ?? ''} editable={editMapping && canEdit} onCommit={(v) => commitFrom(g.plan, e.target, e.tab ?? 'Basic Info', v)} />
                            </td>
                            <td className="mono">
                              <span className="muted" title={SPAN_LABEL[e.span ?? 'single']}>{end}</span>
                              {e.overridden && editMapping && canEdit && (
                                <IconButton
                                  label={`Reset ${e.target} to the default`}
                                  icon={RotateCcw}
                                  onClick={() => dispatch({ type: 'reset-mspo-mapping', tenderId: t.id, key: `${g.plan}:${e.target}` })}
                                />
                              )}
                            </td>
                          </>
                        ) : (
                          <td colSpan={3}>
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
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </details>

        <h3>Preview <span className="muted small">(every row of each file, updated as you edit the details; the three "(Do Not Modify)" system columns are in the download as hidden columns)</span></h3>
        {MSPO_PLANS.map((g) => {
          const headers = headersFor(g.plan, state.mspoDefaults);
          const all = buildPlanRows(g.plan, data, fill, state.mspoDefaults);
          const shown = all;
          const entries = state.mspoDefaults[g.plan];
          return (
            <div key={g.plan} style={{ marginBottom: 12 }}>
              <h4 className="mspo-preview-head">
                {g.title.replace(' template', '')} - {all.length} row{all.length === 1 ? '' : 's'}
                <span className="muted">
                  {g.plan === 'product' && fyCount > 1 && ` (${rowsOf(g.plan)} business case lines × fiscal years)`}
                  {g.plan === 'resource' && ` from ${rowsOf(g.plan)} business case lines - rows per line and year below`}
                </span>
              </h4>
              {g.plan === 'resource' && <ResourceSplitTable breakdown={breakdown} daysPerMonth={daysPerMonth} />}
              <div className="scroll-x mspo-preview">
                <table className="grid tiny">
                  <thead><tr>{headers.slice(3).map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {shown.map((row, i) => (
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
      </>}
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


// ---- Best-effort Excel parsing for uploads -----------------------------------

async function parseUpload(file: File, fallback: BcVersionData): Promise<{ data: BcVersionData; parsed: boolean }> {
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const prodSheet = wb.Sheets['Product Plan'];
    const resSheet = wb.Sheets['Resource Plan'];
    if (!prodSheet || !resSheet) throw new Error('expected sheets missing');
    const prows = XLSX.utils.sheet_to_json<Record<string, unknown>>(prodSheet);
    const rrows = XLSX.utils.sheet_to_json<Record<string, unknown>>(resSheet);
    const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)) || 0);
    const products = prows.map((r, i) => ({
      id: `p${i + 1}`,
      ql: num(r['Quote Line'] ?? r['QL'] ?? 1) || 1,
      category: String(r['Category'] ?? 'Software'),
      desc: String(r['Description'] ?? r['Commodity/Service descriptions'] ?? `Line ${i + 1}`),
      unitCost: num(r['Unit Cost'] ?? r['Unit Price']),
      qty: num(r['Quantity'] ?? r['Qty'] ?? 1),
      total: num(r['Total'] ?? r['Total Cost']),
    }));
    const resources = rrows.map((r, i) => ({
      id: `r${i + 1}`,
      ql: num(r['Quote Line'] ?? 1) || 1,
      role: String(r['Role'] ?? `Role ${i + 1}`),
      grade: String(r['Grade'] ?? '4'),
      team: String(r['Team'] ?? 'Insys - Cloud - SG'),
      mandays: num(r['Man-days'] ?? r['Total MD']),
      dayRate: num(r['Day Rate'] ?? r['iRate']),
      total: num(r['Total'] ?? r['Total Amount']),
    }));
    if (products.length === 0 && resources.length === 0) throw new Error('no rows');
    return {
      parsed: true,
      data: {
        header: {
          ...fallback.header,
          productTotal: products.reduce((a, p) => a + p.total, 0),
          labourTotal: resources.reduce((a, r) => a + r.total, 0),
        },
        products: products.length ? products : fallback.products,
        resources: resources.length ? resources : fallback.resources,
        billing: fallback.billing,
      },
    };
  } catch {
    // Not a parseable business case workbook: use mock parsed data (stated assumption)
    return { data: fallback, parsed: false };
  }
}

// ---- Versions + upload --------------------------------------------------------

export function BcSection({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const canUpload = canDo.uploadBc(state.role) && !isTenderLocked(t);
  const [tab, setTab] = useState<'versions' | 'mspo'>('versions');
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [deleteVersion, setDeleteVersion] = useState<BcVersion | null>(null);

  const lv = latest(t);
  const selected = lv;
  // checks cannot run when the workbook layout was not recognised
  const runs = useMemo(() => (selected && !selected.layoutUnrecognised ? runFinalChecks(selected.data, state.rules) : []), [selected, state.rules]);

  if (!lv || !selected) {
    const hint = 'Versions and MSPO templates will unlock once business case has been uploaded.';
    return (
      <section>
        <TabsBar
          tabs={[
            { key: 'versions', label: 'Versions', disabled: true, disabledHint: hint },
            { key: 'mspo', label: 'MSPO templates', disabled: true, disabledHint: hint },
          ]}
          active=""
          onChange={() => {}}
        />
        <UploadZone t={t} />
        <EmptyState icon={Inbox} title="No business case uploaded yet" body="Only Excel format is accepted. Each upload of the business case is a new version and is checked automatically against rules set." />
      </section>
    );
  }

  const failed = failedChecks(runs);

  return (
    <section>
      <TabsBar
        tabs={[
          { key: 'versions', label: `Versions (${t.bcVersions.length})` },
          { key: 'mspo', label: 'MSPO templates' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />
      {/* the MSPO tab carries its own warning right above the download buttons */}
      {tab !== 'mspo' && (selected.layoutUnrecognised ? (
        <Banner kind="error">
          Version {selected.v} could not be matched to a known template layout, so the Final Check
          rules did not run and MSPO generation is blocked. See the MSPO templates tab for the
          anchors that were not found, or upload a version based on the current template.
        </Banner>
      ) : failed.length > 0 && (
        <Banner kind="warning">
          Version {selected.v} failed {failed.length} Final Check{failed.length > 1 ? 's' : ''}. This
          warns but does not block: MSPO generation and DRB review stay available.
          {canDo.readOnlyReview(state.role) && <FailedChecksList runs={runs} />}
        </Banner>
      ))}

      {tab === 'versions' && (
        <>
          <UploadZone t={t} />
          <table className="grid">
            <thead><tr><th aria-label="Expand checks" /><th>Version</th><th>Uploaded</th><th>File</th><th>Comment</th><th>Checks</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {[...t.bcVersions].reverse().map((v) => {
                const bad = !!v.layoutUnrecognised;
                const r = bad ? [] : runFinalChecks(v.data, state.rules);
                const f = failedChecks(r).length;
                const expanded = expandedVersions.has(v.v);
                return (
                  <Fragment key={v.v}>
                  <tr key={`${v.v}-summary`} className={v.v === selected.v ? 'row-selected' : ''}>
                    <td className="expand-cell">
                      {!bad && (
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
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <b>v{v.v}</b> {v.v === lv.v && <span className="badge badge-human"><Check size={12} aria-hidden /> Latest</span>}
                    </td>
                    <td className="muted">{v.uploadedBy}<div className="small">{ts(v.uploadedAt)}</div></td>
                    <td className="mono small">{v.fileName}</td>
                    <td className="muted">{v.comment ?? '-'}</td>
                    <td>
                      {bad
                        ? <span className="err"><AlertTriangle size={13} aria-hidden /> Layout not recognised</span>
                        : f === 0 ? <span className="ok"><Check size={13} aria-hidden /> All passed</span> : <span className="err"><AlertTriangle size={13} aria-hidden /> {f} failed</span>}
                    </td>
                    <td className="table-actions">
                      {canUpload && (
                        <IconButton label={`Delete version ${v.v}`} icon={Trash2} danger onClick={() => setDeleteVersion(v)} />
                      )}
                    </td>
                  </tr>
                  {expanded && !bad && (
                    <tr key={`${v.v}-checks`}>
                      <td colSpan={7}><ChecksPanel runs={r} version={v} /></td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {tab === 'mspo' && <MspoPanel t={t} data={lv.data} runs={lv.layoutUnrecognised ? [] : runFinalChecks(lv.data, state.rules)} version={lv} />}

      <ConfirmDialog
        open={deleteVersion !== null}
        title={`Delete business case version ${deleteVersion?.v}?`}
        confirmLabel="Delete version"
        danger
        onClose={() => setDeleteVersion(null)}
        onConfirm={() => {
          if (deleteVersion) {
            dispatch({ type: 'delete-bc-version', tenderId: t.id, v: deleteVersion.v });
            toast.push('success', `Version ${deleteVersion.v} deleted`, `${deleteVersion.fileName} and its check results were removed. Other versions are unaffected.`);
          }
          setDeleteVersion(null);
        }}
      >
        <p>
          You are about to delete <b>v{deleteVersion?.v}</b> ({deleteVersion?.fileName}),
          uploaded by {deleteVersion?.uploadedBy}. Its file and Final Check results are removed;
          other versions are unaffected.
        </p>
        <p className="muted small">This action cannot be undone.</p>
      </ConfirmDialog>
    </section>
  );
}

function UploadZone({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const allowed = canDo.uploadBc(state.role) && !isTenderLocked(t);
  const toast = useToast();
  const lv = latest(t);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);

  const onFile = async (file: File) => {
    setProcessing(file.name);
    const fallbackBase: BcVersionData = lv
      ? JSON.parse(JSON.stringify(lv.data))
      : {
          header: { tcv: 1000000, productTotal: 400000, labourTotal: 500000, marginPct: 12, currency: 'SGD', durationMonths: 12, projectStart: new Date().toISOString().slice(0, 10) },
          products: [{ id: 'p1', ql: 1, category: 'Software', desc: 'Platform licence', unitCost: 200000, qty: 2, total: 400000 }],
          resources: [{ id: 'r1', ql: 1, role: 'Project Manager', grade: '7', team: 'Insys - Cloud - SG', mandays: 510, dayRate: 980, total: 499800 }],
          billing: [{ id: 'b1', date: new Date().toISOString().slice(0, 10), schedule: 'Single billing', amount: 1000000 }],
        };
    // Demo note: a workbook we cannot parse is treated like the real system
    // treats an unknown template layout - the version is stored, but checks do
    // not run and MSPO generation is blocked (banner names the anchors).
    if (lv && !lv.layoutUnrecognised) {
      fallbackBase.products[0].qty += 10;
      fallbackBase.products[0].total = fallbackBase.products[0].qty * fallbackBase.products[0].unitCost;
      fallbackBase.header.productTotal = fallbackBase.products.reduce((a: number, p: { total: number }) => a + p.total, 0);
    }
    const { data, parsed } = await parseUpload(file, fallbackBase);
    const version: BcVersion = {
      v: (lv?.v ?? 0) + 1,
      uploadedBy: state.user?.name ?? 'Unknown',
      uploadedAt: new Date().toISOString(),
      fileName: file.name,
      documentUrl: URL.createObjectURL(file),
      comment: comment.trim() || undefined,
      parsedFromFile: parsed,
      layoutUnrecognised: parsed ? undefined : {
        missingAnchors: [
          'Sheet "Product Plan" with header row "Quote Line / Category / Description"',
          'Sheet "Resource Plan" with header row "Role / Grade / Team"',
        ],
      },
      data: parsed ? data : { header: { tcv: 0, productTotal: 0, labourTotal: 0, marginPct: 0, currency: 'SGD', durationMonths: 0, projectStart: new Date().toISOString().slice(0, 10) }, products: [], resources: [], billing: [] },
    };
    window.setTimeout(() => {
      dispatch({ type: 'upload-bc', tenderId: t.id, version });
      setProcessing(null);
      setComment('');
      if (!parsed) {
        toast.push('warning', `Business case v${version.v} stored, layout not recognised`, 'The workbook does not match a known template layout. Final Check did not run and MSPO generation is blocked for this version.');
        return;
      }
      const f = failedChecks(runFinalChecks(data, state.rules)).length;
      toast.push(
        f ? 'warning' : 'success',
        `Business case v${version.v} uploaded`,
        `Parsed in seconds (no AI pipeline) · ${f ? `${f} Final Check(s) failed - warnings only, nothing is blocked` : 'all Final Checks passed'}.`,
      );
    }, 1800);
  };

  return (
    <div className="bc-upload-action">
      {processing ? (
        <ProgressStages
          stages={[
            { label: `Reading ${processing}`, ms: 500 },
            { label: 'Parsing workbook tabs (Product Plan, Resource Plan, Basic Info)', ms: 700 },
            { label: `Running ${state.rules.filter((r) => r.enabled).length} Final Check rules`, ms: 500 },
          ]}
        />
      ) : (
        <div className="bc-upload-row">
          <Button
            compact
            icon={FileUp}
            disabled={!allowed}
            title={allowed ? undefined : isTenderLocked(t) ? 'This tender is closed - no new business case versions can be added' : 'Only the BD team uploads business cases'}
            onClick={() => { setComment(''); setOpen(true); }}
          >
            {lv ? 'Upload new version' : 'Upload business case'}
          </Button>
        </div>
      )}
      <UploadDialog
        open={open}
        title={lv ? `Upload business case v${lv.v + 1}` : 'Upload business case'}
        multiple={false}
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
        hint="One Excel workbook (.xlsx or .xlsm). Each upload becomes a new version."
        confirmLabel="Confirm upload"
        onFilesChange={setStaged}
        confirmDisabled={staged.some((f) => !/\.(xlsx|xlsm)$/i.test(f.file.name))}
        extra={(
          <>
            {staged.some((f) => !/\.(xlsx|xlsm)$/i.test(f.file.name)) && (
              <p className="err small" role="alert">The business case must be an Excel workbook (.xlsx or .xlsm). Remove this file and add the workbook.</p>
            )}
            <div className="hd-form">
              <label>
                Comment <span className="muted">(optional)</span>
                <input type="text" value={comment} placeholder="What changed in this version" onChange={(e) => setComment(e.target.value)} />
              </label>
            </div>
          </>
        )}
        onClose={() => setOpen(false)}
        onConfirm={(files) => {
          setOpen(false);
          if (files[0]) onFile(files[0].file);
        }}
      />
    </div>
  );
}


// ---- Read-only DRB views -------------------------------------------------------
// The Deal Review Board sees two tabs: a Summary of the figures that drive the
// go/no-go decision, and the latest uploaded business case workbook itself.

/** Latest version the DRB can actually review (parseable layout). */
function drbVersion(t: Tender): BcVersion | undefined {
  return [...t.bcVersions].reverse().find((v) => !v.layoutUnrecognised);
}

export function DrbSummarySection({ t }: { t: Tender }) {
  const { state } = useStore();
  const lv = drbVersion(t);
  const skipped = latest(t)?.layoutUnrecognised ? latest(t) : undefined;
  if (!lv) {
    return <EmptyState icon={Inbox} title="Nothing to review yet" body={t.bcVersions.length ? 'The only uploaded version could not be matched to a known template layout, so there is nothing the DRB can review yet.' : 'The summary appears once the BD team has uploaded a business case version.'} />;
  }
  const runs = runFinalChecks(lv.data, state.rules);
  const failed = failedChecks(runs);
  const d = lv.data;
  const { direct, indirect, ebitda, ebitdaPct } = bcFigures(d);

  return (
    <section>
      <p className="sub" style={{ marginBottom: 10 }}>
        Version {lv.v}, {checksLine(runs)} - uploaded by {lv.uploadedBy}, {ts(lv.uploadedAt)}
      </p>
      {skipped && (
        <Banner kind="warning">
          Version {skipped.v} (the newest upload) could not be matched to a known template layout,
          so this summary shows version {lv.v} instead.
        </Banner>
      )}
      <div className="kpi-row">
        <div className="kpi"><span>TCV (contract value)</span><b>{money(d.header.tcv)}</b></div>
        <div className="kpi"><span>Direct cost</span><b>{money(direct)}</b><div className="muted small">Product + internal labour</div></div>
        <div className="kpi"><span>Indirect cost</span><b>{money(indirect)}</b><div className="muted small">4% contingency (estimate)</div></div>
        <div className="kpi"><span>EBITDA</span><b className={ebitda >= 0 ? 'pos' : 'neg'}>{money(ebitda)}</b><div className="muted small">{pct(ebitdaPct)} of TCV</div></div>
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
          <tr><td>Stated margin</td><td className="num">{pct(d.header.marginPct)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

export function DrbBcSection({ t }: { t: Tender }) {
  const { state } = useStore();
  const lv = drbVersion(t);
  if (!lv) {
    return <EmptyState icon={Inbox} title="No business case to show yet" body="The workbook appears here once the BD team has uploaded a business case version." />;
  }
  const runs = lv.layoutUnrecognised ? [] : runFinalChecks(lv.data, state.rules);
  return (
    <section>
      <p className="sub" style={{ marginBottom: 10 }}>
        Version {lv.v}, {checksLine(runs)} - uploaded by {lv.uploadedBy}, {ts(lv.uploadedAt)} · {lv.fileName}
      </p>
      {failedChecks(runs).length > 0 && (
        <Banner kind="warning">
          Failed Final Checks on version {lv.v}:
          <FailedChecksList runs={runs} />
        </Banner>
      )}
      <div className="drb-bc-viewer">
        <SpreadsheetDocumentViewer
          src={lv.documentUrl ?? '/mock-documents/MHA_business_case_demo.xlsm'}
          fileName={lv.fileName}
          initialSheet="Summary"
        />
      </div>
    </section>
  );
}
