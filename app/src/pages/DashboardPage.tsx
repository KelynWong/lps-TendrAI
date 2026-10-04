// Dashboard - deal pipeline at a glance, driven by the tenders in state.

import { computeSummary, finalChecks } from '../lib/calc';
import { dateShort, money, pct } from '../lib/format';
import { useStore } from '../state/store';
import { StatusChip } from '../components/common';
import type { TenderRecord } from '../types';

export default function DashboardPage({ goTo }: { goTo: (page: string) => void }) {
  const { state, dispatch } = useStore();
  const active = state.tenders.filter((t) => !t.outcome);
  const recent = state.tenders.filter((t) => t.outcome);

  const open = (t: TenderRecord) => {
    dispatch({ type: 'open-tender', id: t.id });
    goTo('tenders');
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Deal Pipeline</h2>
          <div className="sub">Tender-to-business-case status across active pursuits</div>
        </div>
      </div>

      {active.map((t) => {
        const s = t.bc ? computeSummary(t.bc) : null;
        const failing = t.bc ? finalChecks(t.bc, s!).filter((c) => !c.ok).length : 0;
        const daysLeft = Math.ceil((new Date(t.closingDate).getTime() - Date.now()) / 86400000);
        return (
          <section className="card active-deal" key={t.id} onClick={() => open(t)} role="button" tabIndex={0}>
            <div className="deal-title">
              <b>{t.ref}</b> - {t.title}
              {t.bc ? <StatusChip status={t.bc.status} /> : <span className="status-chip st-processing">Processing</span>}
            </div>
            <div className="sub">
              {t.agency} · closing {dateShort(t.closingDate)} ({daysLeft > 0 ? `${daysLeft} days left` : 'closed'})
            </div>
            {s ? (
              <div className="kpi-row">
                <div className="kpi"><span>TCV</span><b>{money(s.total.tcv)}</b></div>
                <div className="kpi"><span>Direct Cost</span><b>{money(s.total.directTotal)}</b></div>
                <div className="kpi"><span>EBITDA</span><b className={s.total.ebitda >= 0 ? 'pos' : 'neg'}>{money(s.total.ebitda)} ({pct(s.total.ebitdaPct)})</b></div>
                <div className="kpi"><span>Final Check</span><b className={failing ? 'neg' : 'pos'}>{failing ? `${failing} error(s)` : 'All OK'}</b></div>
                <div className="kpi"><span>Quote Lines</span><b>{t.bc!.quoteLines.length}</b></div>
              </div>
            ) : (
              <div className="kpi-row"><div className="kpi"><span>Status</span><b>Generating draft business case…</b></div></div>
            )}
            <div className="muted small">
              Draft generated from a {t.pages}-page tender in {t.processingMinutes} min · click to open →
            </div>
          </section>
        );
      })}

      <section>
        <h3>Recent pursuits</h3>
        <table className="grid">
          <thead><tr><th>Reference</th><th>Title</th><th>Customer</th><th className="num">TCV</th><th>Status</th></tr></thead>
          <tbody>
            {recent.map((t) => {
              const s = t.bc ? computeSummary(t.bc) : null;
              return (
                <tr key={t.id} className="row-click" onClick={() => open(t)}>
                  <td className="mono">{t.ref}</td>
                  <td>{t.title}</td>
                  <td>{t.agency}</td>
                  <td className="num">{s ? money(s.total.tcv) : '-'}</td>
                  <td>
                    {t.outcome === 'Won' && <span className="pill pill-won">Won</span>}
                    {t.outcome === 'Lost' && <span className="pill pill-lost">Lost</span>}
                    {t.outcome === 'Awaiting result' && <span className="pill pill-submitted">Awaiting result</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
