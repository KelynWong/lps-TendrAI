// Headline figures from a business case, used by the DRB summary and the
// financial columns of the tender list so both always agree.

import type { BcVersion, BcVersionData, Tender } from '../types';

/** Indirect cost is estimated as the template's 4% contingency on direct cost
 *  (the parsed workbook header carries no separate indirect figure). */
export const INDIRECT_RATE = 0.04;

export function bcFigures(d: BcVersionData) {
  const direct = d.header.productTotal + d.header.labourTotal;
  const indirect = Math.round(direct * INDIRECT_RATE);
  const ebitda = d.header.tcv - direct - indirect;
  return { tcv: d.header.tcv, direct, indirect, ebitda, ebitdaPct: d.header.tcv ? (ebitda / d.header.tcv) * 100 : 0 };
}

/** Latest version whose layout could be read (unreadable uploads carry no figures). */
export function latestParsedBc(t: Tender): BcVersion | undefined {
  return [...t.bcVersions].reverse().find((v) => !v.layoutUnrecognised);
}
