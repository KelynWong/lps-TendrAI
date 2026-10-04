// Working tab - cost → sell price derivation per quote line. Quote lines sit
// side by side in a responsive grid so wide screens show two per row.

import { computeSummary } from '../../lib/calc';
import { money, pct } from '../../lib/format';
import { can, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { Fx, NumCell } from '../../components/common';
import { ALL_CATEGORIES } from '../../types';

export default function WorkingTab() {
  const { state } = useStore();
  const { bc, update } = useDraft();
  const user = state.user!;
  const s = computeSummary(bc);
  const locked = bc.status === 'approved' || bc.status === 'submitted';
  const canMargin = !locked && can.editRatesAndMargins(user.role);

  return (
    <div className="tab-body">
      <div className="working-grid">
        {bc.quoteLines.map((q, i) => {
          const l = s.perLine[i];
          return (
            <section className="card working-card" key={q.id}>
              <h3>
                Quote Line {q.id} - {q.solutionOffering}{' '}
                <span className="muted">
                  (margin{' '}
                  <NumCell
                    value={+(q.marginPct * 100).toFixed(1)}
                    editable={canMargin}
                    format={(v) => `${v.toFixed(1)}%`}
                    onCommit={(v) =>
                      update((d) => ({
                        ...d,
                        quoteLines: d.quoteLines.map((x) => (x.id === q.id ? { ...x, marginPct: v / 100 } : x)),
                      }))
                    }
                  />
                  )
                </span>
              </h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">
                      <Fx f={"Internal Labour: = SUM('Resource Plan'! Total Cost)\nOther categories: = SUMIFS('Product Plan'! Total Cost,\n  Quote Line, Category)"}>Direct Cost</Fx>
                    </th>
                    <th className="num"><Fx f={'= Direct Cost × Margin %'}>+ Margin</Fx></th>
                    <th className="num"><Fx f={'= ROUND(Direct Cost × (1 + Margin %), 0)\nFeeds Summary! TCV per category.'}>Sell (TCV)</Fx></th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_CATEGORIES.filter((c) => l.directByCat[c] > 0).map((c) => (
                    <tr key={c}>
                      <td>{c}</td>
                      <td className="num">{money(l.directByCat[c])}</td>
                      <td className="num muted">{money(l.tcvByCat[c] - l.directByCat[c])}</td>
                      <td className="num strong">{money(l.tcvByCat[c])}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{money(l.directTotal)}</td>
                    <td className="num muted">{money(l.tcv - l.directTotal)}</td>
                    <td className="num">{money(l.tcv)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          );
        })}
        <section className="card working-card">
          <h3>Deal Total</h3>
          <div className="kpi-row">
            <div className="kpi">
              <span>TCV</span>
              <b><Fx f={'= Σ quote-line sell totals\nShown on Basic Info and Summary.'}>{money(s.total.tcv)}</Fx></b>
            </div>
            <div className="kpi">
              <span>Gross Margin</span>
              <b><Fx f={'= (TCV − Direct Cost) ÷ TCV'}>{pct(s.total.grossMarginPct)}</Fx></b>
            </div>
            <div className="kpi">
              <span>EBITDA</span>
              <b className={s.total.ebitda >= 0 ? 'pos' : 'neg'}>
                <Fx f={'= Summary! TCV − Total Cost\n(after contingency, inflation,\nfinance cost and other indirects)'}>
                  {money(s.total.ebitda)} ({pct(s.total.ebitdaPct)})
                </Fx>
              </b>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
