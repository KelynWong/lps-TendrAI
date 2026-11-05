// Tenders: index of pursuits (fixed-height, auto-paginated list) and a detail
// page tying everything together (pack, checklist, qualifications, clauses,
// compliance, templates, business case, DRB) with the workflow stepper.

import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore, useTender } from '../state/store';
import { Pager, SortTh, StatusPill, usePagedTable, useColFilters, useSort } from '../components/common';
import { Button, Banner, ConfirmDialog, IconButton, TabsBar } from '../ui/ui';
import { TenderPackSection, useJobSim, docCounts } from '../components/rfp';
import { BcSection, DrbSummarySection, DrbBcSection } from '../components/bc';
import { money } from '../lib/format';
import { bcFigures, figureMoney } from '../lib/figures';
import { latestVersion } from '../businessCase/versions';
import { canDo } from '../config';
import { useToast } from '../ui/toast';
import { dateShort, ts } from '../lib/format';
import { failedChecks, runFinalChecks, type RuleDef } from '../rules/finalChecks';
import type { Tender, TenderStatusReason } from '../types';
import { useLeaveGuard } from '../lib/leaveGuard';

// ---- "Needs attention" summary (list column + detail banners) -----------------

function attentionItems(t: Tender, rules: RuleDef[]): string[] {
  const items: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (t.processFailed) items.push('Processing failed');
  if (t.outOfDate) items.push('Results out of date');
  const failedDocs = t.pack.filter((d) => d.status === 'Failed').length;
  if (failedDocs) items.push(`${failedDocs} document${failedDocs > 1 ? 's' : ''} failed`);
  if ((t.status === 'Draft' || t.status === 'Active') && t.closingDate && t.closingDate < today) items.push('Closing date passed');
  const lvBc = t.bcVersions[t.bcVersions.length - 1];
  if (lvBc && failedChecks(runFinalChecks(lvBc.data, rules)).length) items.push('Final Check failures');
  return items;
}

// ---- Won TCV cards -------------------------------------------------------------

function WonTcvCards() {
  const { state } = useStore();
  const wins = state.tenders
    .filter((t) => t.status === 'Won' && t.bcVersions.length)
    .map((t) => {
      const d = new Date(t.closingDate || t.createdAt);
      const header = t.bcVersions[t.bcVersions.length - 1].data.header;
      return {
        tcv: header.tcv,
        currency: header.currency,
        year: d.getFullYear(),
        quarter: Math.floor(d.getMonth() / 3) + 1,
      };
    });
  const now = new Date();
  const years = [...new Set([...wins.map((w) => w.year), now.getFullYear()])].sort();
  // start on the most recent period that actually has a win
  const latestWin = [...wins].sort((a, b) => (a.year - b.year) || (a.quarter - b.quarter)).pop();
  const [mode, setMode] = useState<'quarter' | 'year'>('quarter');
  const [year, setYear] = useState(latestWin?.year ?? now.getFullYear());
  const [quarter, setQuarter] = useState(latestWin?.quarter ?? Math.floor(now.getMonth() / 3) + 1);
  const inPeriod = wins.filter((w) => w.year === year && (mode === 'year' || w.quarter === quarter));
  // tenders are quoted in different currencies: one total per currency, never mixed
  const totals = [...new Set(inPeriod.map((w) => w.currency))].sort().map((currency) => ({
    currency,
    tcv: inPeriod.filter((w) => w.currency === currency).reduce((a, w) => a + w.tcv, 0),
    count: inPeriod.filter((w) => w.currency === currency).length,
  }));
  const label = mode === 'year' ? `Full year ${year}` : `Q${quarter} ${year}`;
  return (
    <div className="tcv-stack">
      <div className="tcv-controls">
        <label className="check-inline">Period
          <select value={mode} aria-label="Won TCV period mode" onChange={(e) => setMode(e.target.value as 'quarter' | 'year')}>
            <option value="quarter">By quarter</option>
            <option value="year">Full year</option>
          </select>
        </label>
        <label className="check-inline">Year
          <select value={year} aria-label="Won TCV year" onChange={(e) => setYear(+e.target.value)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        {mode === 'quarter' && (
          <label className="check-inline">Quarter
            <select value={quarter} aria-label="Won TCV quarter" onChange={(e) => setQuarter(+e.target.value)}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="kpi">
        <span>Total Won TCV · {label}</span>
        {totals.length === 0 ? <b>{money(0)}</b> : totals.map((x) => (
          <div key={x.currency}>
            <b>{figureMoney(x.tcv, x.currency)}</b>
            {totals.length > 1 && <span className="muted small"> · {x.count} tender{x.count === 1 ? '' : 's'}</span>}
          </div>
        ))}
        <div className="muted small">{inPeriod.length} tender{inPeriod.length === 1 ? '' : 's'} won in this period{totals.length > 1 ? ', totalled per currency' : ''}</div>
      </div>
    </div>
  );
}

// ---- Detail page ---------------------------------------------------------------

/** Which status reasons belong to which status. */
const STATUS_REASONS: Record<Tender['status'], TenderStatusReason[]> = {
  Draft: ['In Progress (Draft)', 'Pending (Draft)', 'In Approval (Draft)', 'Approved (Draft)', 'Rejected (Draft)'],
  Active: ['In Progress (Active)'],
  Won: ['Won (Won)'],
  Closed: ['Revised (Closed)', 'Lost (Closed)'],
};

/** Outcome and lessons learned, once a tender is Won or Closed. The lessons
 *  travel with the tender's approved business case into Historical data,
 *  where it becomes a source for the AI's next drafts. */
function LessonsPanel({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const canEdit = canDo.recordLessons(state.role);
  const [draft, setDraft] = useState<string | null>(null);
  const filed = state.repository.find((r) => r.tenderId === t.id && r.kind === 'Business case');
  const editing = draft !== null;
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <h3 style={{ margin: 0 }}>Outcome and lessons learned</h3>
          <div className="muted small">
            {t.drbOutcome ? `Outcome: ${t.drbOutcome}. ` : ''}
            {filed
              ? `The approved business case is filed in Historical data as ${filed.refId}, a ${filed.aiSource ?? 'excluded'} source for new AI drafts.`
              : 'No approved business case was filed for this tender.'}
          </div>
        </div>
        {!editing && (
          <Button compact icon={Pencil} disabled={!canEdit} title={canEdit ? undefined : 'The Bidding Manager and BD record lessons learned'} onClick={() => setDraft(t.lessons?.text ?? '')}>
            {t.lessons ? 'Edit lessons' : 'Add lessons'}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="summary-remarks">
          <textarea
            value={draft}
            aria-label="Lessons learned"
            placeholder="What decided the outcome: price, scope, compliance gaps, customer feedback, what to repeat or avoid"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="review-toolbar-actions" style={{ marginTop: 8 }}>
            <Button compact variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              compact
              variant="primary"
              onClick={() => {
                dispatch({ type: 'set-lessons', tenderId: t.id, text: draft });
                toast.push('success', 'Lessons learned saved', filed ? `Also added to ${filed.refId} in Historical data.` : undefined);
                setDraft(null);
              }}
            >
              Save lessons
            </Button>
          </div>
        </div>
      ) : t.lessons ? (
        <p style={{ margin: '8px 0 0', whiteSpace: 'pre-line' }}>
          {t.lessons.text}
          <span className="muted small"> - {t.lessons.by}, {dateShort(t.lessons.at)}</span>
        </p>
      ) : (
        <p className="muted" style={{ margin: '8px 0 0' }}>No lessons recorded yet.</p>
      )}
    </section>
  );
}

function TenderDetail() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const t = useTender()!;
  // Bidding Manager sets the status and status reason (replaces the old DRB
  // outcome control)
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusForm, setStatusForm] = useState<{ status: Tender['status']; statusReason: TenderStatusReason }>({ status: t.status, statusReason: t.statusReason });
  // The DRB (Deal Review Board) sees a read-only Summary + Business case pair;
  // working roles see the tender and business case tabs instead.
  const isDrb = state.role === 'drb';
  const [tab, setTab] = useState(isDrb ? 'drb-summary' : 'pack');
  const { requestLeave } = useLeaveGuard();
  useJobSim(t); // advances the simulated processing job while the tender is open
  const { failed } = docCounts(t);
  const attention = (t.outOfDate ? 1 : 0) + failed + (t.processFailed ? 1 : 0);
  const bcCount = t.bcVersions.length;

  return (
    <div className="tender-detail">
      <div className="page-head">
        <div className="detail-title-row">
          <button className="back-link" onClick={() => requestLeave(() => dispatch({ type: 'close-tender' }))}>
            <ArrowLeft size={14} aria-hidden /> All tenders
          </button>
          <div>
            <h2>
              {t.name} <StatusPill value={t.statusReason} />
              <IconButton
                label="Change status"
                icon={Pencil}
                disabled={state.role !== 'bidding-manager'}
                reason="only the Bidding Manager changes a tender's status"
                onClick={() => { setStatusForm({ status: t.status, statusReason: t.statusReason }); setStatusOpen(true); }}
              />
            </h2>
            <div className="detail-meta">
              <span>Ref: <b className="mono">{t.ref || 'Not set'}</b></span>
              <span>Customer: <b>{t.agency || 'Not set'}</b></span>
              <span className={`badge ${t.type === 'Agency' ? 'pill-agency' : 'pill-commercial'}`}>{t.type}</span>
              <span>Created: <b>{dateShort(t.createdAt)}</b></span>
              {t.lastProcessedAt && <span>Last processed: <b>{ts(t.lastProcessedAt)}</b></span>}
            </div>
          </div>
        </div>
      </div>
      {t.archivedInfo ? (
        <Banner kind="locked">
          This tender is archived (compressed {t.archivedInfo.sizeFrom} to {t.archivedInfo.sizeTo} on {dateShort(t.archivedInfo.at)}).
          Metadata stays searchable; opening the stored files requires a restore from the Historical data page.
        </Banner>
      ) : (t.status === 'Won' || t.status === 'Closed') && !canDo.readOnlyReview(state.role) && (
        <Banner kind="locked">
          Outcome recorded{t.drbOutcome ? `: ${t.drbOutcome}` : ''}. This tender is closed and
          read-only; its documents and business case stay available in the repository.
        </Banner>
      )}
      {(t.status === 'Won' || t.status === 'Closed') && <LessonsPanel t={t} />}
      <TabsBar
        tabs={isDrb ? [
          { key: 'drb-summary', label: 'Summary' },
          { key: 'drb-bc', label: 'Business case' },
        ] : [
          { key: 'pack', label: 'Tender', badge: attention, badgeTitle: `${attention} item(s) need attention` },
          { key: 'bc', label: `Business case${bcCount ? ` (v${bcCount})` : ''}` },
        ]}
        active={tab}
        onChange={(k) => requestLeave(() => setTab(k))}
        sticky
        stickyAtTop
      />
      <div className="tender-tab-content" style={{ paddingTop: 0 }}>
        {tab === 'pack' && !isDrb && <TenderPackSection t={t} />}
        {tab === 'bc' && !isDrb && <BcSection t={t} />}
        {tab === 'drb-summary' && isDrb && <DrbSummarySection t={t} />}
        {tab === 'drb-bc' && isDrb && <DrbBcSection t={t} />}
      </div>

      <ConfirmDialog
        open={statusOpen}
        title="Change tender status"
        confirmLabel="Save status"
        onClose={() => setStatusOpen(false)}
        onConfirm={() => {
          dispatch({ type: 'set-tender-status', tenderId: t.id, status: statusForm.status, statusReason: statusForm.statusReason });
          toast.push('success', 'Status updated', `${t.name} is now ${statusForm.statusReason}.`);
          setStatusOpen(false);
        }}
      >
        <div className="hd-form">
          <label>Status
            <select
              value={statusForm.status}
              aria-label="Tender status"
              onChange={(e) => {
                const status = e.target.value as Tender['status'];
                setStatusForm({ status, statusReason: STATUS_REASONS[status][0] });
              }}
            >
              <option>Draft</option><option>Active</option><option>Won</option><option>Closed</option>
            </select>
          </label>
          <label>Status reason
            <select
              value={statusForm.statusReason}
              aria-label="Tender status reason"
              onChange={(e) => setStatusForm((c) => ({ ...c, statusReason: e.target.value as TenderStatusReason }))}
            >
              {STATUS_REASONS[statusForm.status].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          {(statusForm.status === 'Won' || statusForm.status === 'Closed') && (
            <p className="muted small" style={{ gridColumn: '1 / -1' }}>
              Won and Closed record the outcome: the tender becomes read-only and lives on in Historical data.
            </p>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}

// ---- Create / edit form ----------------------------------------------------------

interface TenderForm {
  sfdcCrmId: string;
  ref: string;
  name: string;
  agency: string;
  type: Tender['type'];
  closingDate: string;
}
const emptyForm: TenderForm = { sfdcCrmId: '', ref: '', name: '', agency: '', type: 'Agency', closingDate: '' };

function TenderFormFields({
  form, setForm, duplicateOf, titleTakenBy,
}: {
  form: TenderForm;
  setForm: React.Dispatch<React.SetStateAction<TenderForm>>;
  duplicateOf?: Tender;
  titleTakenBy?: Tender;
}) {
  const set = (k: keyof TenderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [k]: e.target.value }));
  return (
    <div className="hd-form create-tender-form">
      <label>Title<span className="req" aria-hidden>*</span>
        <input required autoFocus aria-required aria-invalid={!!titleTakenBy} value={form.name} onChange={set('name')} />
        {titleTakenBy && (
          <span className="err small" role="alert">
            A tender with this title already exists. Titles must be unique.
          </span>
        )}
      </label>
      <label>Type<span className="req" aria-hidden>*</span>
        <select value={form.type} aria-required onChange={set('type')}>
          <option value="Agency">Agency</option><option value="Commercial">Commercial</option>
        </select>
      </label>
      <label>Customer / agency<span className="req" aria-hidden>*</span>
        <input required aria-required value={form.agency} onChange={set('agency')} />
      </label>
      <label>GeBIZ reference number
        <input value={form.ref} onChange={set('ref')} placeholder="e.g. MHA/ITT/2026/014" />
        {duplicateOf && (
          <span className="attn" role="status">
            <AlertTriangle size={12} aria-hidden /> Another tender already uses this reference: {duplicateOf.name}
          </span>
        )}
      </label>
      <label>SFDC CRM ID
        <input value={form.sfdcCrmId} onChange={set('sfdcCrmId')} placeholder="Optional" />
      </label>
    </div>
  );
}

// ---- List page ---------------------------------------------------------------------

function TenderList() {
  const { state, dispatch } = useStore();
  const { sort, toggle, apply } = useSort();
  const cf = useColFilters();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTender, setEditTender] = useState<Tender | null>(null);
  const [deleteTender, setDeleteTender] = useState<Tender | null>(null);
  const [form, setForm] = useState<TenderForm>(emptyForm);
  const isBiddingManager = state.role === 'bidding-manager';
  const BM_ONLY = 'only the Bidding Manager edits and deletes tenders';
  // Won TCV, needs attention and the money columns are for Finance and the DRB
  const financials = canDo.viewFinancials(state.role);
  const figuresOf = (t: Tender) => {
    const v = latestVersion(t);
    return v ? bcFigures(v.data, state.mspoDefaults, t) : undefined;
  };

  const colAcc = {
    created: (t: Tender) => t.createdAt,
    sfdcCrmId: (t: Tender) => t.sfdcCrmId ?? '',
    ref: (t: Tender) => t.ref,
    name: (t: Tender) => t.name,
    agency: (t: Tender) => t.agency,
    type: (t: Tender) => t.type,
    status: (t: Tender) => t.status,
    statusReason: (t: Tender) => t.statusReason,
    attention: (t: Tender) => attentionItems(t, state.rules).length,
    tcv: (t: Tender) => figuresOf(t)?.tcv ?? -1,
    indirect: (t: Tender) => figuresOf(t)?.indirect ?? -1,
    direct: (t: Tender) => figuresOf(t)?.direct ?? -1,
    ebitda: (t: Tender) => figuresOf(t)?.ebitda ?? -Infinity,
  };
  const rows = cf.apply(state.tenders, colAcc);
  const sorted = apply(rows, colAcc);
  const pager = usePagedTable(sorted);
  const fcol = (k: keyof typeof colAcc) => ({
    filterValues: state.tenders.map((t) => String(colAcc[k](t))),
    filter: cf.filters[k],
    onFilter: (f: Parameters<typeof cf.set>[1]) => cf.set(k, f),
  });
  // titles must be unique (case and spacing ignored)
  const titleKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const titleTakenBy = form.name.trim()
    ? state.tenders.find((t) => titleKey(t.name) === titleKey(form.name) && t.id !== editTender?.id)
    : undefined;
  const duplicateOf = form.ref.trim()
    ? state.tenders.find((t) => t.ref && t.ref.toLowerCase() === form.ref.trim().toLowerCase() && t.id !== editTender?.id)
    : undefined;

  /** Always states the document count and business case version, prefixed
   *  with the processing state when there is one worth knowing. */
  const subLine = (t: Tender) => {
    const docs = t.pack.length ? `${t.pack.length} document${t.pack.length > 1 ? 's' : ''}` : 'No documents yet';
    const latestBc = t.bcVersions[t.bcVersions.length - 1];
    const bc = latestBc ? `Business case v${latestBc.v}` : 'No business case yet';
    const state = t.archivedInfo ? 'Archived'
      : t.job ? 'Processing in progress'
        : t.processFailed ? 'Processing failed'
          : t.pack.length && !t.lastProcessedAt ? 'Not processed'
            : undefined;
    return [state, docs, bc].filter(Boolean).join(' · ');
  };

  return (
    <div className="fill-page">
      <div className="filter-row">
        {financials && <WonTcvCards />}
        <span style={{ marginLeft: 'auto' }}>
          <Button
            variant="primary"
            icon={Plus}
            disabled={!isBiddingManager}
            title={isBiddingManager ? undefined : 'Only the Bidding Manager creates tenders'}
            onClick={() => { setForm(emptyForm); setCreateOpen(true); }}
          >
            Create tender
          </Button>
        </span>
      </div>
      <div className="table-viewport">
        <table className="grid">
          <thead>
            <tr>
              <SortTh label="Created at" k="created" sort={sort} onToggle={toggle} />
              <SortTh label="SFDC CRM ID" k="sfdcCrmId" sort={sort} onToggle={toggle} {...fcol('sfdcCrmId')} />
              <SortTh label="GeBIZ ref" k="ref" sort={sort} onToggle={toggle} filterValues={state.tenders.map((t) => t.ref)} filter={cf.filters.ref} onFilter={(f) => cf.set('ref', f)} />
              <SortTh label="Title" k="name" sort={sort} onToggle={toggle} filterValues={state.tenders.map((t) => t.name)} filter={cf.filters.name} onFilter={(f) => cf.set('name', f)} />
              <SortTh label="Customer / agency" k="agency" sort={sort} onToggle={toggle} {...fcol('agency')} />
              <SortTh label="Type" k="type" sort={sort} onToggle={toggle} {...fcol('type')} />
              <SortTh label="Status" k="status" sort={sort} onToggle={toggle} {...fcol('status')} />
              <SortTh label="Status reason" k="statusReason" sort={sort} onToggle={toggle} {...fcol('statusReason')} />
              {financials && (
                <>
                  <SortTh label="TCV" k="tcv" sort={sort} onToggle={toggle} num />
                  <SortTh label="Indirect cost" k="indirect" sort={sort} onToggle={toggle} num />
                  <SortTh label="Direct cost" k="direct" sort={sort} onToggle={toggle} num />
                  <SortTh label="EBITDA" k="ebitda" sort={sort} onToggle={toggle} num />
                </>
              )}
              {!financials && <SortTh label="Needs attention" k="attention" sort={sort} onToggle={toggle} />}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {pager.slice.map((t) => {
              const attn = attentionItems(t, state.rules);
              const fig = figuresOf(t);
              return (
                <tr key={t.id} className="row-click" onClick={() => dispatch({ type: 'open-tender', id: t.id })}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateShort(t.createdAt)}</td>
                  <td className="mono">{t.sfdcCrmId || '-'}</td>
                  <td className="mono">{t.ref || '-'}</td>
                  <td><b>{t.name}</b><div className="muted small">{subLine(t)}</div></td>
                  <td>{t.agency || <span className="muted">Not set</span>}</td>
                  <td><span className={`badge ${t.type === 'Agency' ? 'pill-agency' : 'pill-commercial'}`}>{t.type}</span></td>
                  <td><StatusPill value={t.status} /></td>
                  <td><StatusPill value={t.statusReason} /></td>
                  {financials && (
                    <>
                      <td className="num">{figureMoney(fig?.tcv ?? null, latestVersion(t)?.data.header.currency)}</td>
                      <td className="num">{figureMoney(fig?.indirect ?? null, latestVersion(t)?.data.header.currency)}</td>
                      <td className="num">{figureMoney(fig?.direct ?? null, latestVersion(t)?.data.header.currency)}</td>
                      <td className={`num ${fig?.ebitda != null && fig.ebitda < 0 ? 'neg' : ''}`}>{figureMoney(fig?.ebitda ?? null, latestVersion(t)?.data.header.currency)}</td>
                    </>
                  )}
                  {!financials && <td>
                    {attn.length > 0 ? (
                      <span className="attn" title={attn.join('; ')}>
                        <AlertTriangle size={12} aria-hidden /> {attn[0]}{attn.length > 1 ? ` +${attn.length - 1}` : ''}
                      </span>
                    ) : <span className="attn attn-ok">-</span>}
                  </td>}
                  <td className="table-actions" onClick={(event) => event.stopPropagation()}>
                    <IconButton label={`Edit ${t.name}`} icon={Pencil} disabled={!isBiddingManager} reason={BM_ONLY} onClick={() => {
                      setEditTender(t);
                      setForm({ sfdcCrmId: t.sfdcCrmId ?? '', ref: t.ref, name: t.name, agency: t.agency, type: t.type, closingDate: t.closingDate });
                    }} />
                    <IconButton label={`Delete ${t.name}`} icon={Trash2} danger disabled={!isBiddingManager} reason={BM_ONLY} onClick={() => setDeleteTender(t)} />
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={8 + (financials ? 4 : 1) + 1} className="muted">No tenders match these filters. Clear the column filters to see all {state.tenders.length} tenders.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager {...pager} />

      <ConfirmDialog
        open={createOpen}
        title="Create tender"
        confirmLabel="Create tender"
        confirmDisabled={!form.name.trim() || !form.agency.trim() || !!titleTakenBy}
        onClose={() => setCreateOpen(false)}
        onConfirm={() => {
          const id = `t-${Date.now()}`;
          const tender: Tender = {
            id,
            sfdcCrmId: form.sfdcCrmId.trim() || undefined,
            ref: form.ref.trim(),
            name: form.name.trim(),
            agency: form.agency.trim(),
            type: form.type,
            projectType: 'Milestone Based',
            status: 'Draft',
            statusReason: 'In Progress (Draft)' as TenderStatusReason,
            owner: state.user?.name ?? 'Bidding Manager',
            createdAt: new Date().toISOString().slice(0, 10),
            closingDate: form.closingDate,
            stepIdx: 0,
            pack: [],
            checklist: [],
            quals: [],
            clauses: [],
            bcVersions: [],
            genDocs: [],
          };
          dispatch({ type: 'create-tender', tender });
          dispatch({ type: 'open-tender', id });
          setCreateOpen(false);
          setForm(emptyForm);
        }}
      >
        <TenderFormFields form={form} setForm={setForm} duplicateOf={duplicateOf} titleTakenBy={titleTakenBy} />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(editTender)}
        title="Edit tender"
        confirmLabel="Save changes"
        confirmDisabled={!form.name.trim() || !form.agency.trim() || !!titleTakenBy}
        onClose={() => setEditTender(null)}
        onConfirm={() => {
          if (!editTender) return;
          dispatch({
            type: 'update-tender',
            tenderId: editTender.id,
            patch: {
              sfdcCrmId: form.sfdcCrmId.trim() || undefined,
              ref: form.ref.trim(),
              name: form.name.trim(),
              agency: form.agency.trim(),
              type: form.type,
              closingDate: form.closingDate,
            },
          });
          setEditTender(null);
        }}
      >
        <TenderFormFields form={form} setForm={setForm} duplicateOf={duplicateOf} titleTakenBy={titleTakenBy} />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTender)}
        title="Delete tender"
        confirmLabel="Delete tender and all data"
        danger
        onClose={() => setDeleteTender(null)}
        onConfirm={() => {
          if (!deleteTender) return;
          dispatch({ type: 'delete-tender', tenderId: deleteTender.id });
          setDeleteTender(null);
        }}
      >
        <p>
          You are about to delete <b>{deleteTender?.name}</b>
          {deleteTender && (deleteTender.pack.length || deleteTender.bcVersions.length) ? (
            <>, including {deleteTender.pack.length} uploaded document{deleteTender.pack.length === 1 ? '' : 's'}, {deleteTender.clauses.length} extracted clause{deleteTender.clauses.length === 1 ? '' : 's'} and {deleteTender.bcVersions.length} business case version{deleteTender.bcVersions.length === 1 ? '' : 's'}</>
          ) : null}.
        </p>
        <p className="muted small">This action cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}

export default function TendersPage() {
  const { state } = useStore();
  return state.activeTenderId ? <TenderDetail /> : <TenderList />;
}
