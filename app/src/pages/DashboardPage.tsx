// Dashboard - deal pipeline at a glance, driven by the tenders in state.

import { Inbox, Trophy } from 'lucide-react';
import { computeSummary, finalChecks, sum } from '../lib/calc';
import { dateShort, money, pct } from '../lib/format';
import { useStore } from '../state/store';
import { StatusChip } from '../components/common';
import { Button, EmptyState } from '../ui/ui';
import type { TenderRecord } from '../types';

export default function DashboardPage({ goTo }: { goTo: (page: string) => void }) {
  const { state, dispatch } = useStore();
  const active = state.tenders.filter((t) => !t.outcome);
  const recent = state.tenders
    .filter((t) => t.outcome)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate))
    .slice(0, 10); // latest 10

  const open = (t: TenderRecord) => {
    dispatch({ type: 'open-tender', id: t.id });
    goTo('tenders');
  };

  // ---- Won TCV overview (quarter + full year, by closing date) -------------
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.floor(now.getMonth() / 3);
  const won = state.tenders.filter((t) => t.outcome === 'Won' && t.bc);
  const tcvOf = (t: TenderRecord) => computeSummary(t.bc!).total.tcv;
  const wonYear = won.filter((t) => new Date(t.closingDate).getFullYear() === year);
  const wonQuarter = wonYear.filter((t) => Math.floor(new Date(t.closingDate).getMonth() / 3) === quarter);
  const wonYearTcv = sum(wonYear.map(tcvOf));
  const wonQuarterTcv = sum(wonQuarter.map(tcvOf));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Deal Pipeline</h2>
          <div className="sub">Tender-to-business-case status across active pursuits</div>
        </div>
      </div>

      {/* Overview summary */}
      <div className="kpi-row">
        <div className="kpi kpi-won">
          <span><Trophy size={12} aria-hidden /> Won TCV · Q{quarter + 1} {year}</span>
          <b>{money(wonQuarterTcv)}</b>
          <div className="muted small">{wonQuarter.length} tender{wonQuarter.length === 1 ? '' : 's'} won this quarter</div>
        </div>
        <div className="kpi kpi-won">
          <span><Trophy size={12} aria-hidden /> Won TCV · FY{year}</span>
          <b>{money(wonYearTcv)}</b>
          <div className="muted small">{wonYear.length} tender{wonYear.length === 1 ? '' : 's'} won this year</div>
        </div>
      </div>


      {active.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="No active pursuits"
          body="Upload a tender requirement document to start a pursuit; the draft business case appears here while it is in review."
          action={<Button variant="primary" onClick={() => goTo('tenders')}>Go to Tenders</Button>}
        />
      )}
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
                <div className="kpi"><span>Direct cost</span><b>{money(s.total.directTotal)}</b></div>
                <div className="kpi"><span>Indirect cost</span><b>{money(s.total.indirectTotal)}</b></div>
                <div className="kpi"><span>EBITDA</span><b className={s.total.ebitda >= 0 ? 'pos' : 'neg'}>{money(s.total.ebitda)} ({pct(s.total.ebitdaPct)})</b></div>
                <div className="kpi"><span>Final Check</span><b className={failing ? 'neg' : 'pos'}>{failing ? failing + ' error(s)' : 'All OK'}</b></div>
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
        <h3>Recent pursuits <span className="muted small">(latest 10)</span></h3>
        <table className="grid">
          <thead><tr><th>Reference</th><th>Title</th><th>Customer</th><th className="num">TCV</th><th className="num">Direct cost</th><th className="num">Indirect cost</th><th className="num">EBITDA</th><th>Status</th></tr></thead>
          <tbody>
            {recent.map((t) => {
              const s = t.bc ? computeSummary(t.bc) : null;
              return (
                <tr key={t.id} className="row-click" onClick={() => open(t)}>
                  <td className="mono">{t.ref}</td>
                  <td>{t.title}</td>
                  <td>{t.agency}</td>
                  <td className="num">{s ? money(s.total.tcv) : '-'}</td>
                  <td className="num">{s ? money(s.total.directTotal) : '-'}</td>
                  <td className="num">{s ? money(s.total.indirectTotal) : '-'}</td>
                  <td className="num">{s ? pct(s.total.ebitdaPct) : '-'}</td>
                  <td>
                    {t.outcome === 'Won' && <span className="pill pill-won">Won</span>}
                    {t.outcome === 'Lost' && <span className="pill pill-lost">Lost</span>}
                    {t.outcome && t.outcome !== 'Won' && t.outcome !== 'Lost' && <span className="pill pill-submitted">{t.outcome}</span>}
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
