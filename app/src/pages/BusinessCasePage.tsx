// Business Case workspace: the 7 sub-tabs of the template plus the Final Check
// panel, the two-sponsor DRB workflow and MSPO export. All tab edits land on a
// local DRAFT; nothing is stored until Save is clicked (with a confirmation
// when saving would void a partial approval).

import { useEffect, useMemo, useState } from 'react';
import type { BusinessCaseState } from '../types';
import { computeSummary, finalChecks } from '../lib/calc';
import { money, pct, ts } from '../lib/format';
import { exportMspoWorkbook } from '../lib/mspo';
import { APPROVALS_REQUIRED, can, useBc, useStore } from '../state/store';
import { DraftCtx, diffSummary } from '../state/draft';
import { ProvenanceLegend } from '../components/common';
import BasicInfoTab from './tabs/BasicInfoTab';
import SummaryTab from './tabs/SummaryTab';
import CashFlowTab from './tabs/CashFlowTab';
import ProductPlanTab from './tabs/ProductPlanTab';
import ResourcePlanTab from './tabs/ResourcePlanTab';
import WorkingTab from './tabs/WorkingTab';
import LabourInputsTab from './tabs/LabourInputsTab';

const TABS = [
  { key: 'basic', label: 'Basic Info', el: <BasicInfoTab /> },
  { key: 'summary', label: 'Summary', el: <SummaryTab /> },
  { key: 'cashflow', label: 'Cash Flow', el: <CashFlowTab /> },
  { key: 'product', label: 'Product Plan', el: <ProductPlanTab /> },
  { key: 'resource', label: 'Resource Plan', el: <ResourcePlanTab /> },
  { key: 'working', label: 'Working', el: <WorkingTab /> },
  { key: 'labour', label: 'Labour Inputs', el: <LabourInputsTab /> },
];

export default function BusinessCasePage() {
  const { state, dispatch } = useStore();
  const saved = useBc();
  const user = state.user!;
  const [tab, setTab] = useState('basic');
  const [showChecks, setShowChecks] = useState(false);
  const [draft, setDraft] = useState<BusinessCaseState>(saved);
  // Resync the draft whenever the saved version changes (after Save / workflow)
  useEffect(() => setDraft(saved), [saved]);

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

  const save = () => {
    if (partial) {
      const ok = window.confirm(
        `This business case is half approved by ${saved.approvals.join(' and ')}. ` +
          'Saving these changes will make the approval void and both sponsors must approve again. Save anyway?',
      );
      if (!ok) return;
    }
    dispatch({ type: 'commit-bc', bc: draft, summary: diffSummary(saved, draft) });
  };

  return (
    <DraftCtx.Provider value={draftCtx}>
      <div className="page-head">
        <div>
          <div className="sub">
            {draft.basicInfo.customer} · {draft.basicInfo.crmId}
            {saved.approvedBy && <span className="muted"> · approved by {saved.approvedBy} ({ts(saved.approvedAt!)})</span>}
          </div>
        </div>
        <div className="head-kpis">
          <div className="kpi"><span>TCV</span><b>{money(s.total.tcv)}</b></div>
          <div className="kpi"><span>EBITDA</span><b className={s.total.ebitda >= 0 ? 'pos' : 'neg'}>{pct(s.total.ebitdaPct)}</b></div>
          <div className="kpi">
            <span>Final Check</span>
            <button className={`check-pill ${failing ? 'bad' : 'good'}`} onClick={() => setShowChecks((v) => !v)}>
              {failing ? `${failing} error${failing > 1 ? 's' : ''}` : 'All OK'} ▾
            </button>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="save-bar">
          <span className="save-dot" /> Unsaved changes: {diffSummary(saved, draft)}
          <button className="btn primary" onClick={save}>Save changes</button>
          <button className="btn" onClick={() => setDraft(saved)}>Discard</button>
          {partial && (
            <span className="warn-inline">Saving will void the approval by {saved.approvals.join(' and ')}</span>
          )}
        </div>
      )}

      {!dirty && saved.status === 'in_drb' && partial && (
        <div className="approval-banner">
          ⚠ {saved.approvals.length} of {APPROVALS_REQUIRED} approvals received (by {saved.approvals.join(', ')}).
          Editing is still open, but saving a change will void the approval.
        </div>
      )}

      <div className="actions-row">
        {saved.status === 'draft' && can.submitForDrb(user.role) && (
          <button className="btn primary" disabled={dirty} title={dirty ? 'Save or discard changes first' : ''} onClick={() => dispatch({ type: 'submit-drb' })}>
            Submit for DRB approval
          </button>
        )}
        {saved.status === 'in_drb' && can.approve(user.role) && (
          <>
            {saved.approvals.includes(user.name) ? (
              <span className="approval-pill">✓ You approved · awaiting second approval</span>
            ) : (
              <button
                className="btn approve"
                disabled={dirty}
                title={dirty ? 'Save or discard changes first' : ''}
                onClick={() => dispatch({ type: 'approve' })}
              >
                ✓ Approve business case ({saved.approvals.length + 1} of {APPROVALS_REQUIRED}
                {saved.approvals.length + 1 >= APPROVALS_REQUIRED ? ' · locks edits' : ''})
              </button>
            )}
            <button
              className="btn danger"
              disabled={dirty}
              onClick={() => dispatch({ type: 'reject', reason: 'Returned to draft for rework: margin below threshold' })}
            >
              ✕ Reject / return to draft
            </button>
          </>
        )}
        {can.downloadMspo(user.role) && (
          <button className="btn" onClick={() => exportMspoWorkbook(draft)} title="Export populated MSPO templates for manual upload">
            ⬇ Export MSPO templates (.xlsx)
          </button>
        )}
        <ProvenanceLegend />
      </div>

      {showChecks && (
        <div className="checks-panel">
          <h3>Final Check! <span className="muted">(template validations, live)</span></h3>
          <table className="grid">
            <thead><tr><th>Tab</th><th>Checking</th><th>Result</th></tr></thead>
            <tbody>
              {checks.map((c, i) => (
                <tr key={i}>
                  <td>{c.tab}</td>
                  <td>{c.check}<div className="muted small">{c.detail}</div></td>
                  <td>{c.ok ? <span className="ok">OK</span> : <span className="err">Error! Please double check!</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="subtabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      {TABS.find((t) => t.key === tab)?.el}
    </DraftCtx.Provider>
  );
}
