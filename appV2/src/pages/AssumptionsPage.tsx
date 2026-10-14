// Assumptions to confirm: every guess the demo was built on, in one place.

import { ASSUMPTIONS } from '../config';
import { Banner } from '../ui/ui';

export default function AssumptionsPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Assumptions to confirm</h2>
          <div className="sub">Where the real templates, rules or policies were unavailable, the demo was built to these assumptions. Nothing here was silently invented as fact.</div>
        </div>
      </div>
      <Banner kind="warning">
        Confirm each item below before treating the corresponding behaviour as final. Corrections
        are config-only: Final Check rules live in one rules file, MSPO field mappings in one
        mapping file.
      </Banner>
      <table className="grid">
        <thead><tr><th style={{ width: 180 }}>Area</th><th>Assumption</th></tr></thead>
        <tbody>
          {ASSUMPTIONS.map((a, i) => (
            <tr key={i}>
              <td><b>{a.area}</b></td>
              <td>{a.assumption}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
