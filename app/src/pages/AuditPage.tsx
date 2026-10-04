// Audit log: who uploaded, reviewed, edited or corrected what, when.
// Filterable by date range, action type and tender.

import { useMemo, useState } from 'react';
import { ts } from '../lib/format';
import { useStore } from '../state/store';
import { Pager, SortTh, usePager, useSort } from '../components/common';

export default function AuditPage() {
  const { state } = useStore();
  const [action, setAction] = useState('');
  const [tender, setTender] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const actions = useMemo(
    () => [...new Set(state.audit.map((e) => e.action))].sort(),
    [state.audit],
  );
  const tenders = useMemo(
    () => [...new Set(state.audit.map((e) => e.tender).filter(Boolean))] as string[],
    [state.audit],
  );

  const { sort, toggle, apply } = useSort({ key: 'ts', dir: -1 }); // newest first

  const filtered0 = state.audit.filter((e) => {
    if (action && e.action !== action) return false;
    if (tender && e.tender !== tender) return false;
    const day = e.ts.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  const entries = apply(filtered0, {
    ts: (e) => e.ts,
    user: (e) => e.user,
    role: (e) => e.role,
    tender: (e) => e.tender ?? '',
    action: (e) => e.action,
  });
  const pager = usePager(entries, 10);

  const clear = () => { setAction(''); setTender(''); setFrom(''); setTo(''); };
  const filtered = action || tender || from || to;

  return (
    <div>
      <div className="audit-filters">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Action
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label>
          Tender
          <select value={tender} onChange={(e) => setTender(e.target.value)}>
            <option value="">All tenders</option>
            {tenders.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {filtered && <button className="btn small" onClick={clear}>Clear filters</button>}
        <span className="muted small">{entries.length} of {state.audit.length} entries</span>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <SortTh label="Timestamp" k="ts" sort={sort} onToggle={toggle} />
            <SortTh label="User" k="user" sort={sort} onToggle={toggle} />
            <SortTh label="Role" k="role" sort={sort} onToggle={toggle} />
            <SortTh label="Tender" k="tender" sort={sort} onToggle={toggle} />
            <SortTh label="Action" k="action" sort={sort} onToggle={toggle} />
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {pager.slice.map((e) => (
            <tr key={e.id}>
              <td className="mono muted">{ts(e.ts)}</td>
              <td>{e.user}</td>
              <td className="muted">{e.role}</td>
              <td className="mono">{e.tender ?? '-'}</td>
              <td><b>{e.action}</b></td>
              <td>{e.detail}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={6} className="muted">No entries match the current filters.</td></tr>
          )}
        </tbody>
      </table>
      <Pager {...pager} />
    </div>
  );
}
