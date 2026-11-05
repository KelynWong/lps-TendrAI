// Audit log: every user action (and system job result) - who did what, when,
// on which tender and in which part of the app. Newest first; filter by date
// range and by any column.

import { ts } from '../lib/format';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../state/store';
import { Pager, SortTh, usePagedTable, useColFilters, useSort } from '../components/common';
import { Button } from '../ui/ui';
import { BackToTender } from '../components/backToTender';
import type { AuditEntry } from '../types';

/** Long details (several changes saved together) collapse to one line with a
 *  "Show all" toggle; expanded, each change gets its own line. */
function AuditDetail({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  // "N clauses - A; B; C" -> heading "N clauses" + items A, B, C
  const dash = text.indexOf(' - ');
  const lead = dash > 0 && /^\d+ /.test(text) ? text.slice(0, dash) : '';
  const items = (lead ? text.slice(dash + 3) : text).split('; ').filter(Boolean);
  const long = text.length > 90 || items.length > 1;
  if (!long) return <span>{text}</span>;
  return (
    <div className="audit-detail-wrap">
      {open ? (
        <div className="audit-detail-full">
          {lead && <div><b>{lead}</b></div>}
          {items.length > 1 ? <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul> : <div>{text}</div>}
        </div>
      ) : (
        <span className="audit-detail">{text}</span>
      )}
      <button type="button" className="link-btn audit-detail-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <><ChevronUp size={13} aria-hidden /> Show less</> : <><ChevronDown size={13} aria-hidden /> Show all{items.length > 1 ? ` ${items.length} changes` : ''}</>}
      </button>
    </div>
  );
}

export default function AuditPage() {
  const { state, dispatch } = useStore();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { sort, toggle, apply } = useSort({ key: 'ts', dir: -1 }); // newest first
  const cf = useColFilters();
  // filters handed over by a "View history" button, applied once
  const prefill = state.auditPrefill;
  useEffect(() => {
    if (!prefill) return;
    if (prefill.tender) cf.set('tender', { text: '', sel: [prefill.tender], operator: 'contains' });
    if (prefill.section) cf.set('section', { text: '', sel: [prefill.section], operator: 'contains' });
    dispatch({ type: 'clear-audit-prefill' });
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const colAcc = {
    ts: (e: AuditEntry) => e.ts,
    user: (e: AuditEntry) => e.user,
    role: (e: AuditEntry) => e.role,
    tender: (e: AuditEntry) => e.tender ?? '-',
    section: (e: AuditEntry) => e.section ?? '-',
    action: (e: AuditEntry) => e.action,
  };
  const fcol = (k: keyof typeof colAcc) => ({
    filterValues: state.audit.map((e) => String(colAcc[k](e))),
    filter: cf.filters[k],
    onFilter: (f: Parameters<typeof cf.set>[1]) => cf.set(k, f),
  });

  const inRange = state.audit.filter((e) => {
    const day = new Date(e.ts).toISOString().slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  const entries = apply(cf.apply(inRange, colAcc), colAcc);
  const pager = usePagedTable(entries);
  const anyFilter = !!from || !!to || Object.keys(cf.filters).length > 0;

  return (
    <div className="fill-page">
      <div className="audit-filters">
        <BackToTender />
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {anyFilter && (
          <Button compact onClick={() => { setFrom(''); setTo(''); Object.keys(cf.filters).forEach((k) => cf.set(k, null)); }}>
            Clear filters
          </Button>
        )}
        <span className="muted small">{entries.length} of {state.audit.length} entries</span>
      </div>
      <div className="table-viewport">
        <table className="grid">
          <thead>
            <tr>
              <SortTh label="Timestamp" k="ts" sort={sort} onToggle={toggle} />
              <SortTh label="User" k="user" sort={sort} onToggle={toggle} {...fcol('user')} />
              <SortTh label="Role" k="role" sort={sort} onToggle={toggle} {...fcol('role')} />
              <SortTh label="Tender" k="tender" sort={sort} onToggle={toggle} {...fcol('tender')} />
              <SortTh label="Section" k="section" sort={sort} onToggle={toggle} {...fcol('section')} />
              <SortTh label="Action" k="action" sort={sort} onToggle={toggle} {...fcol('action')} />
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {pager.slice.map((e) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{ts(e.ts)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{e.user}</td>
                <td className="muted">{e.role}</td>
                <td className="mono">{e.tender ?? '-'}</td>
                <td>{e.section ?? '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}><b>{e.action}</b></td>
                <td className="audit-detail-cell"><AuditDetail text={e.detail} /></td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={7} className="muted">No entries match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager {...pager} />
    </div>
  );
}
