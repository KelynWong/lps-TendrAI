// Headline figures from a business case, used by the DRB summary, the MSPO
// mapping page and the financial columns of the tender list so all agree.
//
// Every figure is read from a saved business case version: the field comes
// from the "Business case figures" table on the MSPO mapping page (defaults
// plus this tender's overrides), and the value from the version as saved.
// Nothing is re-estimated or rounded; a figure with no value is null and shows
// as "-".

import { effectivePlan, fieldOf, type MspoDefaults } from '../mspo/mapping';
import type { BcVersionData, Tender } from '../types';
import { money, pct } from './format';

/** Display text for a figure; "-" when there is no value. */
export const figureMoney = (v: number | null, currency = 'SGD') => (v === null ? '-' : money(v, currency === 'SGD' ? 'S$' : `${currency} `));
/** EBITDA % is a fraction in the business case; shown the way Excel shows a % cell. */
export const figurePct = (v: number | null) => (v === null ? '-' : pct(v * 100));

export interface BcFigures {
  tcv: number | null;
  indirect: number | null;
  direct: number | null;
  ebitda: number | null;
  /** as stored: a fraction (0.05 = 5%), like the template's % cells */
  ebitdaPct: number | null;
  /** which business case field each figure was read from, e.g. { indirect: 'Summary > Indirect cost' } */
  source: Partial<Record<FigureKey, string>>;
}
type FigureKey = 'tcv' | 'indirect' | 'direct' | 'ebitda' | 'ebitdaPct';

/** mapping-table target -> figure */
const FIGURE_KEY: Record<string, FigureKey> = {
  TCV: 'tcv',
  'Indirect cost': 'indirect',
  'Direct cost': 'direct',
  EBITDA: 'ebitda',
  'EBITDA (%)': 'ebitdaPct',
};

export function bcFigures(d: BcVersionData, defaults: MspoDefaults, t: Pick<Tender, 'mspoMapping'>): BcFigures {
  const out: BcFigures = { tcv: null, indirect: null, direct: null, ebitda: null, ebitdaPct: null, source: {} };
  for (const e of effectivePlan(defaults, t, 'figures')) {
    const key = FIGURE_KEY[e.target];
    const field = fieldOf(e.field);
    if (!key || e.source !== 'workbook' || !field) continue;
    const v = field.get({ d });
    out[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    out.source[key] = field.label;
  }
  return out;
}
