// Business Case workspace: sticky summary bar (name, status, live totals),
// sticky sub-tabs with review badges, Final Check panel, two-sponsor DRB
// workflow with confirmation dialogs, draft Save/Discard, figure-state legend
// and the citation source panel.

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Download, HelpCircle, History, Save, Undo2, X } from 'lucide-react';
import type { BusinessCaseState } from '../types';
import { computeSummary, finalChecks } from '../lib/calc';
import { money, pct, ts } from '../lib/format';
import { exportMspoProduct, exportMspoResource } from '../lib/mspo';
import { APPROVALS_REQUIRED, can, useBc, useStore, useTender } from '../state/store';
import { NavCtx } from '../App';
import { DraftCtx, detailedDiff, diffSummary, summaryCellKeys } from '../state/draft';
import { ProvenanceLegendItems, StatusChip } from '../components/common';
import { Banner, Button, ConfirmDialog } from '../ui/ui';
import { TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import { CitationProvider } from '../ui/citation';
import BasicInfoTab from './tabs/BasicInfoTab';
import SummaryTab from './tabs/SummaryTab';
import CashFlowTab from './tabs/CashFlowTab';
import ProductPlanTab from './tabs/ProductPlanTab';
import ResourcePlanTab from './tabs/ResourcePlanTab';
import WorkingTab from './tabs/WorkingTab';
import LabourInputsTab from './tabs/LabourInputsTab';

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

/** Maps the active tab key to the audit-log section name */
const TAB_SECTIONS: Record<string, string> = {
  basic: 'Basic Info',
  summary: 'Summary',
  cashflow: 'Cash Flow',
  product: 'Product Plan',
  resource: 'Resource Plan',
  working: 'Working',
  labour: 'Labour Inputs',
};

/** Reverse lookup: Final Check tab label -> tab key (for "Go to tab") */
const SECTION_TABS: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_SECTIONS).map(([k, v]) => [v, k]),
);

type DialogKind = 'approve' | 'save-void' | null;

export default function BusinessCasePage() {
  const { state, dispatch } = useStore();
  const saved = useBc();
  const tender = useTender();
  const { goToAudit } = useContext(NavCtx);
  const user = state.user!;
  const toast = useToast();
  const [tab, setTab] = useState('basic');
  const [showChecks, setShowChecks] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [ackUnreviewed, setAckUnreviewed] = useState(false);
  const [draft, setDraft] = useState<BusinessCaseState>(saved);
  useEffect(() => setDraft(saved), [saved]);

  useEffect(() => {
    if (!showChecks) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowChecks(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showChecks]);

  const dirty = draft !== saved;
  const draftCtx = useMemo(
    () => ({
      bc: draft,
      update: (fn: (bc: BusinessCaseState) => BusinessCaseState) => setDraft((d) => fn(d)),
      dirty,
    }),
    [draft, dirty],
  );

  const s = computeSummary(draft);
  const checks = finalChecks(draft, s);
  const failing = checks.filter((c) => !c.ok).length;
  const partial = saved.approvals.length > 0 && saved.approvals.length < APPROVALS_REQUIRED;
  const locked = saved.status === 'approved' || saved.status === 'submitted';

  const tcvFlash = useFlash(Math.round(s.total.tcv));
  const ebitdaFlash = useFlash(Math.round(s.total.ebitda));

  const productToReview = draft.productItems.filter((p) => p.provenance.kind !== 'human').length;
  const resourceToReview = draft.resourceItems.filter((r) => r.provenance.kind !== 'human').length;
  // Estimated values on the other tabs that still need a person to verify them
  const basicToReview =
    Object.values(draft.basicInfo.fieldProv).filter((p) => p.kind !== 'human').length +
    draft.quoteLines.filter((q) => q.provenance.kind !== 'human').length +
    draft.billing.filter((b) => b.provenance.kind !== 'human').length;
  const summaryToReview = summaryCellKeys(draft).filter((k) => !draft.confirmedInputs.includes(k)).length;
  const cashflowToReview = draft.vendorCols.filter((c) => !draft.confirmedInputs.includes(`cf:${c.id}`)).length;
  const labourToReview = draft.resourceItems.filter((r) => !draft.labourMonthly[r.id]).length;
  const totalUnreviewed =
    basicToReview + summaryToReview + cashflowToReview + productToReview + resourceToReview + labourToReview;

  const doSave = () => {
    dispatch({ type: 'commit-bc', bc: draft, summary: diffSummary(saved, draft), changes: detailedDiff(saved, draft) });
    toast.push('success', 'Changes saved', diffSummary(saved, draft));
  };
  const save = () => {
    if (partial) setDialog('save-void');
    else doSave();
  };

  const tabs = [
    { key: 'basic', label: 'Basic Info', badge: basicToReview, badgeTitle: `${basicToReview} AI-drafted values (deal info and billing lines) to verify` },
    { key: 'summary', label: 'Summary', badge: summaryToReview, badgeTitle: `${summaryToReview} applied-% and indirect-cost input rows still on AI defaults; editing a row verifies it` },
    { key: 'cashflow', label: 'Cash Flow', badge: cashflowToReview, badgeTitle: `${cashflowToReview} vendor-payment columns drafted from the Product Plan; editing a column verifies it` },
    { key: 'product', label: 'Product Plan', badge: productToReview, badgeTitle: `${productToReview} line items to review` },
    { key: 'resource', label: 'Resource Plan', badge: resourceToReview, badgeTitle: `${resourceToReview} line items to review` },
    { key: 'working', label: 'Working' },
    { key: 'labour', label: 'Labour Inputs', badge: labourToReview, badgeTitle: `${labourToReview} monthly distributions still on the even auto-spread; editing a row verifies it` },
  ];

  return (
    <CitationProvider tenderDoc={{ ref: tender.ref, title: tender.title, fileName: tender.fileName }}>
      <DraftCtx.Provider value={draftCtx}>
        <div className="bc-scope">
          {/* Sticky summary bar: always-visible identity + live totals */}
          <div className="bc-bar">
            <div className="bc-bar-title">
              <div className="sub">
                <b>{draft.basicInfo.projectName}</b> · {draft.basicInfo.crmId}
              </div>
              <div className="sub">
                <StatusChip status={saved.status} />
                {saved.approvedBy && <span className="muted"> approved by {saved.approvedBy}, {ts(saved.approvedAt!)}</span>}
              </div>
            </div>
            <div className="bc-bar-kpis">
              <div className="bc-kpi">
                <span>TCV</span>
                <b className={tcvFlash}>{money(s.total.tcv)}</b>
              </div>
              <div className="bc-kpi">
                <span>Total cost</span>
                <b>{money(s.total.totalCost)}</b>
              </div>
              <div className="bc-kpi">
                <span>EBITDA</span>
                <b className={`${s.total.ebitda >= 0 ? 'pos' : 'neg'} ${ebitdaFlash}`}>
                  {pct(s.total.ebitdaPct)}
                </b>
              </div>
              <button
                className={`check-pill ${failing ? 'bad' : 'good'}`}
                onClick={() => setShowChecks((v) => !v)}
                aria-expanded={showChecks}
              >
                {failing ? <X size={12} aria-hidden /> : <Check size={12} aria-hidden />}
                Final Check: {failing ? `${failing} error${failing > 1 ? 's' : ''}` : 'all OK'}
              </button>
            </div>
          </div>

          {/* Screen-reader announcement for live recalculation */}
          <div className="sr-only" aria-live="polite">
            Totals recalculated. TCV {money(s.total.tcv)}, EBITDA {pct(s.total.ebitdaPct)}.
          </div>

          <TabsBar tabs={tabs} active={tab} onChange={setTab} sticky />

          {locked && (
            <Banner kind="locked">
              This business case is approved and locked. All values are read-only.
              {saved.status === 'approved' && ' Record the tender outcome from the dropdown in the tender header once the result is known.'}
            </Banner>
          )}

          {dirty && (
            <div className="save-bar" role="status">
              <span className="save-dot" aria-hidden /> Unsaved changes: {diffSummary(saved, draft)}
              {partial && (
                <span className="warn-inline">Saving will void the approval by {saved.approvals.join(' and ')}</span>
              )}
              <div className="save-bar-actions">
                <Button variant="ghost" icon={Undo2} onClick={() => setDraft(saved)}>Discard</Button>
                <Button variant="primary" icon={Save} onClick={save}>Save changes</Button>
              </div>
            </div>
          )}

          {!dirty && !locked && partial && (
            <Banner kind="warning">
              {saved.approvals.length} of {APPROVALS_REQUIRED} approvals received (by {saved.approvals.join(', ')}).
              Editing is still open, but saving a change will void the approval.
            </Banner>
          )}

          <div className="actions-row">
            {!locked && can.approve(user.role) && (
              <>
                {saved.approvals.includes(user.name) ? (
                  <span className="approval-pill"><Check size={12} aria-hidden /> You approved · {saved.approvals.length} of {APPROVALS_REQUIRED} received</span>
                ) : (
                  <Button
                    variant="primary"
                    icon={Check}
                    disabled={dirty}
                    title={dirty ? 'Save or discard your changes first' : undefined}
                    onClick={() => { setAckUnreviewed(false); setDialog('approve'); }}
                  >
                    Approve business case ({saved.approvals.length + 1} of {APPROVALS_REQUIRED})
                  </Button>
                )}
              </>
            )}
            {!locked && !can.approve(user.role) && (
              <span className="muted small">
                {APPROVALS_REQUIRED} sponsor approvals lock this business case ({saved.approvals.length} received).
                Only the Executive and Business Sponsors can approve.
              </span>
            )}
            <div className="actions-right">
              <Button
                variant="ghost"
                icon={HelpCircle}
                aria-expanded={showHint}
                onClick={() => setShowHint((v) => !v)}
              >
                {showHint ? 'Hide hint' : 'Hint'}
              </Button>
              <Button
                variant="ghost"
                icon={History}
                title="Open the Audit log filtered to this business case and tab"
                onClick={() => goToAudit({ tender: tender.ref, section: TAB_SECTIONS[tab] })}
              >
                Edit history
              </Button>
              {can.downloadMspo(user.role) && (tab === 'product' || tab === 'resource') && (
                <Button
                  icon={Download}
                  onClick={() => {
                    if (tab === 'product') {
                      exportMspoProduct(draft);
                      toast.push('success', 'MSPO product plan exported', 'Filled product plan template downloaded for MSPO upload');
                    } else {
                      exportMspoResource(draft);
                      toast.push('success', 'MSPO resource plan exported', 'Filled resource plan template downloaded for MSPO upload');
                    }
                  }}
                >
                  Export MSPO template ({tab === 'product' ? 'product plan' : 'resource plan'})
                </Button>
              )}
            </div>
          </div>

          {showHint && (
            <div className="hint-row">
              <ProvenanceLegendItems />
            </div>
          )}

          {showChecks && (
            <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowChecks(false)}>
              <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="fc-title">
                <h2 id="fc-title" className="dialog-title">
                  Final Check <span className="muted" style={{ fontWeight: 400, fontSize: '13px' }}>(template validations, live)</span>
                </h2>
                <div className="dialog-body">
                  <div className="ver-scroll">
                  <table className="grid">
                    <thead><tr><th>Tab</th><th>Checking</th><th>Result</th><th /></tr></thead>
                    <tbody>
                      {checks.map((c, i) => (
                        <tr key={i}>
                          <td>{c.tab}</td>
                          <td>{c.check}<div className="muted small">{c.detail}</div></td>
                          <td>{c.ok ? <span className="ok">OK</span> : <span className="err">Error</span>}</td>
                          <td>
                            {!c.ok && SECTION_TABS[c.tab] && (
                              <Button
                                compact
                                icon={ArrowRight}
                                onClick={() => { setTab(SECTION_TABS[c.tab]); setShowChecks(false); }}
                              >
                                Go to {c.tab}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
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

        <ConfirmDialog
          open={dialog === 'approve'}
          title={saved.approvals.length + 1 >= APPROVALS_REQUIRED ? 'Approve and lock this business case?' : 'Record your approval?'}
          confirmLabel={saved.approvals.length + 1 >= APPROVALS_REQUIRED ? 'Approve and lock' : 'Record approval'}
          confirmDisabled={totalUnreviewed > 0 && !ackUnreviewed}
          onConfirm={() => { setDialog(null); dispatch({ type: 'approve' }); toast.push('success', 'Approval recorded'); }}
          onClose={() => setDialog(null)}
        >
          {saved.approvals.length + 1 >= APPROVALS_REQUIRED ? (
            <>This is the final of {APPROVALS_REQUIRED} approvals. The business case will be locked
              and no further edits are possible.</>
          ) : (
            <>This records approval {saved.approvals.length + 1} of {APPROVALS_REQUIRED}. Editing stays open,
              but any saved change will void the approvals and all {APPROVALS_REQUIRED} approvers must approve again.</>
          )}
          {totalUnreviewed > 0 && (
            <div className="ack-box">
              <b>{totalUnreviewed} AI-suggested value{totalUnreviewed > 1 ? 's have' : ' has'} not been reviewed</b>
              {' '}(see the counts on the tab headers).
              <label className="ack-check">
                <input
                  type="checkbox"
                  checked={ackUnreviewed}
                  onChange={(e) => setAckUnreviewed(e.target.checked)}
                />
                I understand unreviewed AI-suggested values remain in this business case and approve anyway.
              </label>
            </div>
          )}
        </ConfirmDialog>

        <ConfirmDialog
          open={dialog === 'save-void'}
          title="Save and void the existing approval?"
          confirmLabel="Save and void approval"
          danger
          onConfirm={() => { setDialog(null); doSave(); }}
          onClose={() => setDialog(null)}
        >
          This business case is partially approved by {saved.approvals.join(' and ')}. Saving these
          changes makes the approval void - all {APPROVALS_REQUIRED} approvers must approve again
          before it can be locked.
        </ConfirmDialog>
      </DraftCtx.Provider>
    </CitationProvider>
  );
}
