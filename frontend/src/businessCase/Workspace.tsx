// Business case workspace: sticky summary bar (live TCV, total cost, EBITDA
// and Final Check), the seven workbook tabs with review badges, and the save
// bar. Edits stay on a draft until they are saved as the next version.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Check, Download, HelpCircle, History, Save, Undo2 } from 'lucide-react';
import type { BcVersion } from '../types';
import type { BusinessCaseState, Provenance } from './model';
import { confidenceLevel } from '../lib/confidence';
import { computeSummary, withEvenBilling } from './calc';
import { money, pct } from './format';
import { DraftCtx, summaryCellKeys } from './draft';
import { ProvenanceLegendItems } from './cells';
import { versionData } from './workbook';
import { failedChecks, ruleTabs, runFinalChecks, type RuleDef } from '../rules/finalChecks';
import { Banner, Button, ConfirmDialog, TabsBar } from '../ui/ui';
import BasicInfoTab from './tabs/BasicInfoTab';
import SummaryTab from './tabs/SummaryTab';
import CashFlowTab from './tabs/CashFlowTab';
import ProductPlanTab from './tabs/ProductPlanTab';
import ResourcePlanTab from './tabs/ResourcePlanTab';
import WorkingTab from './tabs/WorkingTab';
import LabourInputsTab from './tabs/LabourInputsTab';
import './workspace.css';

/** Briefly highlights a value when it changes (recalculation feedback). */
function useFlash(value: number): string {
  const [cls, setCls] = useState('');
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setCls('');
      const id = requestAnimationFrame(() => setCls('flash'));
      return () => cancelAnimationFrame(id);
    }
  }, [value]);
  return cls;
}

/** tab key -> workbook tab name (also the audit-log section) */
export const TAB_SECTIONS: Record<string, string> = {
  basic: 'Basic Info',
  summary: 'Summary',
  cashflow: 'Cash Flow',
  product: 'Product Plan',
  resource: 'Resource Plan',
  working: 'Working',
  labour: 'Labour Inputs',
};
const SECTION_TABS: Record<string, string> = Object.fromEntries(Object.entries(TAB_SECTIONS).map(([k, v]) => [v, k]));

/** AI-drafted values nobody has confirmed yet, per tab. */
export function unreviewedCounts(bc: BusinessCaseState) {
  const basic =
    Object.values(bc.basicInfo.fieldProv).filter((p) => p.kind !== 'human').length +
    bc.quoteLines.filter((q) => q.provenance.kind !== 'human').length +
    bc.billing.filter((b) => b.provenance.kind !== 'human').length;
  const summary = summaryCellKeys(bc).filter((k) => !bc.confirmedInputs.includes(k)).length;
  const cashflow = bc.vendorCols.filter((c) => !bc.confirmedInputs.includes(`cf:${c.id}`)).length;
  const product = bc.productItems.filter((p) => p.provenance.kind !== 'human').length;
  const resource = bc.resourceItems.filter((r) => r.provenance.kind !== 'human').length;
  const labour = bc.resourceItems.filter((r) => !bc.labourMonthly[r.id]).length;
  // unreviewed AI values the AI itself was least sure of: estimates and weak matches
  const weak = (p: Provenance) => p.kind === 'estimate' || (p.kind === 'grounded' && confidenceLevel(p.citation.similarity, 'match') === 'Low');
  const lowConfidence = [...bc.productItems, ...bc.resourceItems, ...bc.quoteLines, ...bc.billing].filter((x) => weak(x.provenance)).length;
  return { basic, summary, cashflow, product, resource, labour, lowConfidence, total: basic + summary + cashflow + product + resource + labour };
}

export function Workspace({
  base,
  draft,
  setDraft,
  editable,
  userName,
  rules,
  unsavedSummary,
  onSave,
  onHistory,
  onDownload,
  notice,
  saveWarning,
  saveConfirm,
  actions,
}: {
  /** the version shown: the latest when editing, or one picked on the Versions tab */
  base: BcVersion;
  draft: BusinessCaseState;
  setDraft: (fn: (bc: BusinessCaseState) => BusinessCaseState) => void;
  editable: boolean;
  userName: string;
  rules: RuleDef[];
  /** what the unsaved edits change, or null when the draft equals the version */
  unsavedSummary: string | null;
  onSave: (comment: string) => void;
  onHistory: (section: string) => void;
  onDownload: () => void;
  /** replaces the default read-only banner (e.g. an archived approved version) */
  notice?: ReactNode;
  /** shown in the save bar, e.g. approvals that do not carry over */
  saveWarning?: string;
  /** when set, Save asks for confirmation first (e.g. it voids DRB approvals) */
  saveConfirm?: { title: string; body: ReactNode; confirmLabel: string };
  /** extra buttons in the action row, e.g. the DRB's Approve */
  actions?: ReactNode;
}) {
  const [tab, setTab] = useState('basic');
  const [showChecks, setShowChecks] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [comment, setComment] = useState('');
  const [confirmingSave, setConfirmingSave] = useState(false);
  const dirty = unsavedSummary !== null;
  // every edit keeps the billing plan billing the TCV, evenly split
  const update = useCallback(
    (fn: (bc: BusinessCaseState) => BusinessCaseState) => setDraft((d) => withEvenBilling(fn(d))),
    [setDraft],
  );
  const ctx = useMemo(() => ({ bc: draft, update, dirty, editable, userName }), [draft, update, dirty, editable, userName]);

  const s = computeSummary(draft);
  // Final Check runs live on the draft with the managed rules - warns, never blocks
  const runs = useMemo(() => runFinalChecks(versionData(draft), rules), [draft, rules]);
  const failing = failedChecks(runs);
  const counts = unreviewedCounts(draft);
  const tcvFlash = useFlash(Math.round(s.total.tcv));
  const ebitdaFlash = useFlash(Math.round(s.total.ebitda));

  const tabs = [
    { key: 'basic', label: 'Basic Info', badge: counts.basic, badgeTitle: `${counts.basic} AI-drafted values (deal info, quote lines and billing lines) to verify` },
    { key: 'summary', label: 'Summary', badge: counts.summary, badgeTitle: `${counts.summary} applied-% and indirect-cost inputs still on AI defaults; editing one verifies it` },
    { key: 'cashflow', label: 'Cash Flow', badge: counts.cashflow, badgeTitle: `${counts.cashflow} vendor-payment columns drafted from the Product Plan; editing a column verifies it` },
    { key: 'product', label: 'Product Plan', badge: counts.product, badgeTitle: `${counts.product} line items to review` },
    { key: 'resource', label: 'Resource Plan', badge: counts.resource, badgeTitle: `${counts.resource} line items to review` },
    { key: 'working', label: 'Working' },
    { key: 'labour', label: 'Labour Inputs', badge: counts.labour, badgeTitle: `${counts.labour} monthly distributions still on the even auto-spread; editing a row verifies it` },
  ];

  const save = () => {
    setConfirmingSave(false);
    onSave(comment);
    setComment('');
  };

  return (
    <DraftCtx.Provider value={ctx}>
      <div className="bc-scope">
        <div className="bc-bar">
          <div className="bc-bar-title">
            <div className="sub"><b>{draft.basicInfo.projectName}</b>{draft.basicInfo.crmId && ` · ${draft.basicInfo.crmId}`}</div>
            <div className="sub">
              {editable ? 'Editing' : 'Viewing'} v{base.v} ({base.approvedAt ? 'approved, archived' : base.origin === 'ai-draft' ? 'AI first draft' : `copy of approved v${base.copyOf}`})
              {counts.total > 0 && ` · ${counts.total} AI-drafted value${counts.total === 1 ? '' : 's'} not yet reviewed`}
              {counts.lowConfidence > 0 && ` (${counts.lowConfidence} low-confidence)`}
            </div>
          </div>
          <div className="bc-bar-kpis">
            <div className="bc-kpi"><span>TCV</span><b className={tcvFlash}>{money(s.total.tcv, draft.basicInfo.currency)}</b></div>
            <div className="bc-kpi"><span>Total cost</span><b>{money(s.total.totalCost, draft.basicInfo.currency)}</b></div>
            <div className="bc-kpi"><span>EBITDA</span><b className={`${s.total.ebitda >= 0 ? 'pos' : 'neg'} ${ebitdaFlash}`}>{pct(s.total.ebitdaPct)}</b></div>
            <button className={`check-pill ${failing.length ? 'bad' : 'good'}`} onClick={() => setShowChecks((v) => !v)} aria-expanded={showChecks}>
              {failing.length ? <AlertTriangle size={12} aria-hidden /> : <Check size={12} aria-hidden />}
              Final Check: {failing.length ? `${failing.length} failed` : 'all passed'}
            </button>
          </div>
        </div>
        <div className="sr-only" aria-live="polite">
          Totals recalculated. TCV {money(s.total.tcv, draft.basicInfo.currency)}, EBITDA {pct(s.total.ebitdaPct)}.
        </div>

        <TabsBar tabs={tabs} active={tab} onChange={setTab} sticky />

        {notice ?? (!editable && (
          <Banner kind="info">
            You are viewing v{base.v} read-only. Only the BD team edits the business case, while the tender is open.
          </Banner>
        ))}

        {dirty && (
          <div className="save-bar" role="status">
            <span className="save-dot" aria-hidden /> Unsaved changes: {unsavedSummary}
            {saveWarning && <span className="warn-inline"><AlertTriangle size={12} aria-hidden /> {saveWarning}</span>}
            <div className="save-bar-actions">
              <input type="text" value={comment} placeholder="Comment (optional): what changed" aria-label="Version comment" onChange={(e) => setComment(e.target.value)} />
              <Button variant="ghost" icon={Undo2} onClick={() => setDraft(() => base.bc)}>Discard</Button>
              <Button variant="primary" icon={Save} onClick={() => (saveConfirm ? setConfirmingSave(true) : save())}>Save changes to v{base.v}</Button>
            </div>
          </div>
        )}

        <div className="actions-row">
          <span className="muted small">
            Figures recalculate as you edit. Final Check warns and never blocks; MSPO templates and the DRB use the latest saved version.
          </span>
          <div className="actions-right">
            <Button variant="ghost" icon={HelpCircle} aria-expanded={showHint} onClick={() => setShowHint((v) => !v)}>
              {showHint ? 'Hide hint' : 'Hint'}
            </Button>
            <Button variant="ghost" icon={History} title="Open the Audit log filtered to this tender's business case" onClick={() => onHistory(TAB_SECTIONS[tab])}>
              Edit history
            </Button>
            <Button icon={Download} disabled={dirty} title={dirty ? 'Save or discard your changes first - the download is a saved version' : `Download v${base.v} as an Excel workbook`} onClick={onDownload}>
              Download v{base.v} (.xlsx)
            </Button>
            {actions}
          </div>
        </div>

        {saveConfirm && (
          <ConfirmDialog
            open={confirmingSave}
            title={saveConfirm.title}
            confirmLabel={saveConfirm.confirmLabel}
            danger
            onConfirm={save}
            onClose={() => setConfirmingSave(false)}
          >
            {saveConfirm.body}
          </ConfirmDialog>
        )}

        {showHint && <div className="hint-row"><ProvenanceLegendItems /></div>}

        {showChecks && (
          <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowChecks(false)}>
            <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="fc-title">
              <h2 id="fc-title" className="dialog-title">Final Check <span className="muted small">(on the current draft, live)</span></h2>
              <div className="dialog-body">
                <div className="ver-scroll">
                  <table className="grid">
                    <thead><tr><th>Rule</th><th>Expected</th><th>Actual</th><th>Result</th><th aria-label="Go to tab" /></tr></thead>
                    <tbody>
                      {runs.map(({ rule, result }) => {
                        const target = ruleTabs(rule).map((x) => SECTION_TABS[x]).find(Boolean);
                        return (
                          <tr key={rule.id}>
                            <td><b>{rule.name}</b><div className="muted small">{rule.description}</div></td>
                            <td className="check-value">{result.expected}</td>
                            <td className="check-value">{result.actual}</td>
                            <td>
                              {result.skipped ? <span className="muted">Not checked</span>
                                : result.ok ? <span className="ok">Pass</span>
                                  : <span className="err">{rule.severity === 'error' ? 'Fail' : 'Warning'}</span>}
                            </td>
                            <td>
                              {!result.ok && target && (
                                <Button compact icon={ArrowRight} onClick={() => { setTab(target); setShowChecks(false); }}>
                                  Go to {TAB_SECTIONS[target]}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="dialog-actions">
                <Button variant="primary" onClick={() => setShowChecks(false)}>Close</Button>
              </div>
            </div>
          </div>
        )}

        {tab === 'basic' && <BasicInfoTab />}
        {tab === 'summary' && <SummaryTab />}
        {tab === 'cashflow' && <CashFlowTab />}
        {tab === 'product' && <ProductPlanTab />}
        {tab === 'resource' && <ResourcePlanTab />}
        {tab === 'working' && <WorkingTab />}
        {tab === 'labour' && <LabourInputsTab />}
      </div>
    </DraftCtx.Provider>
  );
}
