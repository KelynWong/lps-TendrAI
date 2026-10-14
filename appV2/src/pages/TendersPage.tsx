// Tenders: index of pursuits (fixed-height, auto-paginated list) and a detail
// page tying everything together (pack, checklist, qualifications, clauses,
// compliance, templates, business case, DRB) with the workflow stepper.

import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore, useTender } from '../state/store';
import { Pager, SortTh, StatusPill, useAutoPager, useColFilters, useSort } from '../components/common';
import { Button, Banner, ConfirmDialog, IconButton, TabsBar } from '../ui/ui';
import { TenderPackSection, useJobSim, docCounts } from '../components/rfp';
import { BcSection, DrbSummarySection, DrbBcSection } from '../components/bc';
import { money } from '../lib/format';
import { useToast } from '../ui/toast';
import { dateShort, ts } from '../lib/format';
import { failedChecks, runFinalChecks } from '../rules/finalChecks';
import type { Tender, TenderStatusReason } from '../types';

// ---- "Needs attention" summary (list column + detail banners) -----------------

function attentionItems(t: Tender): string[] {
  const items: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (t.processFailed) items.push('Processing failed');
  if (t.outOfDate) items.push('Results out of date');
  const failedDocs = t.pack.filter((d) => d.status === 'Failed').length;
  if (failedDocs) items.push(`${failedDocs} document${failedDocs > 1 ? 's' : ''} failed`);
  if ((t.status === 'Draft' || t.status === 'Active') && t.closingDate && t.closingDate < today) items.push('Closing date passed');
  const lvBc = t.bcVersions[t.bcVersions.length - 1];
  if (lvBc?.layoutUnrecognised) items.push('Business case layout not recognised');
  else if (lvBc && failedChecks(runFinalChecks(lvBc.data)).length) items.push('Final Check failures');
  return items;
}

// ---- Won TCV cards -------------------------------------------------------------

function WonTcvCards() {
  const { state } = useStore();
  const wins = state.tenders
    .filter((t) => t.status === 'Won' && t.bcVersions.length)
    .map((t) => {
      const d = new Date(t.closingDate || t.createdAt);
      return {
        tcv: t.bcVersions[t.bcVersions.length - 1].data.header.tcv,
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
  const total = inPeriod.reduce((a, w) => a + w.tcv, 0);
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
        <b>{money(total)}</b>
        <div className="muted small">{inPeriod.length} tender{inPeriod.length === 1 ? '' : 's'} won in this period</div>
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
  useJobSim(t); // advances the simulated processing job while the tender is open
  const { failed } = docCounts(t);
  const attention = (t.outOfDate ? 1 : 0) + failed + (t.processFailed ? 1 : 0);
  const bcCount = t.bcVersions.length;

  return (
    <div className="tender-detail">
      <div className="page-head">
        <div className="detail-title-row">
          <button className="back-link" onClick={() => dispatch({ type: 'close-tender' })}>
            <ArrowLeft size={14} aria-hidden /> All tenders
          </button>
          <div>
            <h2>
              {t.name} <StatusPill value={t.statusReason} />
              {state.role === 'bidding-manager' && (
                <IconButton
                  label="Change status"
                  icon={Pencil}
                  onClick={() => { setStatusForm({ status: t.status, statusReason: t.statusReason }); setStatusOpen(true); }}
                />
              )}
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
      ) : (t.status === 'Won' || t.status === 'Closed') && (
        <Banner kind="locked">
          Outcome recorded{t.drbOutcome ? `: ${t.drbOutcome}` : ''}. This tender is closed and
          read-only; its documents and business case stay available in the repository.
        </Banner>
      )}
      <TabsBar
        tabs={isDrb ? [
          { key: 'drb-summary', label: 'Summary' },
          { key: 'drb-bc', label: 'Business case' },
        ] : [
          { key: 'pack', label: 'Tender', badge: attention, badgeTitle: `${attention} item(s) need attention` },
          { key: 'bc', label: `Business case${bcCount ? ` (v${bcCount})` : ''}` },
        ]}
        active={tab}
        onChange={setTab}
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
  form, setForm, duplicateOf,
}: {
  form: TenderForm;
  setForm: React.Dispatch<React.SetStateAction<TenderForm>>;
  duplicateOf?: Tender;
}) {
  const set = (k: keyof TenderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [k]: e.target.value }));
  return (
    <div className="hd-form create-tender-form">
      <label>Title<span className="req" aria-hidden>*</span><input required autoFocus aria-required value={form.name} onChange={set('name')} /></label>
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

  const colAcc = {
    created: (t: Tender) => t.createdAt,
    sfdcCrmId: (t: Tender) => t.sfdcCrmId ?? '',
    ref: (t: Tender) => t.ref,
    name: (t: Tender) => t.name,
    agency: (t: Tender) => t.agency,
    type: (t: Tender) => t.type,
    status: (t: Tender) => t.status,
    statusReason: (t: Tender) => t.statusReason,
    attention: (t: Tender) => attentionItems(t).length,
  };
  const rows = cf.apply(state.tenders, colAcc);
  const sorted = apply(rows, colAcc);
  const pager = useAutoPager(sorted);
  const fcol = (k: keyof typeof colAcc) => ({
    filterValues: state.tenders.map((t) => String(colAcc[k](t))),
    filter: cf.filters[k],
    onFilter: (f: Parameters<typeof cf.set>[1]) => cf.set(k, f),
  });
  const duplicateOf = form.ref.trim()
    ? state.tenders.find((t) => t.ref && t.ref.toLowerCase() === form.ref.trim().toLowerCase() && t.id !== editTender?.id)
    : undefined;

  const subLine = (t: Tender) => {
    if (t.archivedInfo) return `Archived · compressed ${t.archivedInfo.sizeFrom} to ${t.archivedInfo.sizeTo}`;
    if (t.job) return 'Processing in progress';
    if (t.processFailed) return 'Processing failed';
    if (!t.lastProcessedAt) return t.pack.length ? `${t.pack.length} document${t.pack.length > 1 ? 's' : ''} uploaded, not processed` : 'No documents yet';
    const bc = t.bcVersions.length ? ` · Business case v${t.bcVersions.length}` : ' · No business case yet';
    return `${t.clauses.length} clauses extracted${bc}`;
  };

  return (
    <div className="fill-page">
      <div className="filter-row">
        <WonTcvCards />
        <span style={{ marginLeft: 'auto' }}>
          {isBiddingManager && <Button variant="primary" icon={Plus} onClick={() => { setForm(emptyForm); setCreateOpen(true); }}>Create tender</Button>}
        </span>
      </div>
      <div className="table-viewport" ref={pager.viewportRef}>
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
              <SortTh label="Needs attention" k="attention" sort={sort} onToggle={toggle} />
              {isBiddingManager && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {pager.slice.map((t) => {
              const attn = attentionItems(t);
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
                  <td>
                    {attn.length > 0 ? (
                      <span className="attn" title={attn.join('; ')}>
                        <AlertTriangle size={12} aria-hidden /> {attn[0]}{attn.length > 1 ? ` +${attn.length - 1}` : ''}
                      </span>
                    ) : <span className="attn attn-ok">-</span>}
                  </td>
                  {isBiddingManager && (
                    <td className="table-actions" onClick={(event) => event.stopPropagation()}>
                      <IconButton label={`Edit ${t.name}`} icon={Pencil} onClick={() => {
                        setEditTender(t);
                        setForm({ sfdcCrmId: t.sfdcCrmId ?? '', ref: t.ref, name: t.name, agency: t.agency, type: t.type, closingDate: t.closingDate });
                      }} />
                      <IconButton label={`Delete ${t.name}`} icon={Trash2} danger onClick={() => setDeleteTender(t)} />
                    </td>
                  )}
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={isBiddingManager ? 10 : 9} className="muted">No tenders match these filters. Clear the column filters to see all {state.tenders.length} tenders.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager {...pager} />

      <ConfirmDialog
        open={createOpen}
        title="Create tender"
        confirmLabel="Create tender"
        confirmDisabled={!form.name.trim() || !form.agency.trim()}
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
        <TenderFormFields form={form} setForm={setForm} duplicateOf={duplicateOf} />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(editTender)}
        title="Edit tender"
        confirmLabel="Save changes"
        confirmDisabled={!form.name.trim() || !form.agency.trim()}
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
        <TenderFormFields form={form} setForm={setForm} duplicateOf={duplicateOf} />
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
