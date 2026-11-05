// Headline figures from a business case, used by the DRB summary, the MSPO
// mapping page and the financial columns of the tender list so all agree.
//
// Every figure is read from the uploaded workbook: the cell comes from the
// "Business case figures" table on the MSPO mapping page (defaults plus this
// tender's overrides), and the value from the raw cells captured at upload.
// Nothing is estimated or recomputed; a figure whose cell is empty or not a
// number is null and shows as "-".

import { effectivePlan, type MspoDefaults } from '../mspo/mapping';
import type { BcVersion, BcVersionData, Tender } from '../types';
import { money, pct } from './format';

/** Display text for a figure; "-" when the workbook cell had no number. */
export const figureMoney = (v: number | null) => (v === null ? '-' : money(v));
/** EBITDA % is a fraction in the workbook; shown the way Excel shows a % cell. */
export const figurePct = (v: number | null) => (v === null ? '-' : pct(v * 100));

export interface BcFigures {
  tcv: number | null;
  indirect: number | null;
  direct: number | null;
  ebitda: number | null;
  /** as stored in the workbook: a fraction (0.05 = 5%), like Excel's % cells */
  ebitdaPct: number | null;
  /** where each figure was read from, e.g. { indirect: 'Summary!B24' } */
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

/** Raw value of one workbook cell, or null when it is empty or not a number. */
export function workbookCell(d: BcVersionData, tab: string | undefined, ref: string | undefined): number | null {
  if (!tab || !ref) return null;
  const v = d.cells?.[tab]?.[ref.trim().toUpperCase()];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function bcFigures(d: BcVersionData, defaults: MspoDefaults, t: Pick<Tender, 'mspoMapping'>): BcFigures {
  const out: BcFigures = { tcv: null, indirect: null, direct: null, ebitda: null, ebitdaPct: null, source: {} };
  for (const e of effectivePlan(defaults, t, 'figures')) {
    const key = FIGURE_KEY[e.target];
    if (!key || e.source !== 'workbook') continue;
    out[key] = workbookCell(d, e.tab, e.from);
    out.source[key] = `${e.tab}!${e.from}`;
  }
  return out;
}

/** Latest version whose layout could be read (unreadable uploads carry no figures). */
export function latestParsedBc(t: Tender): BcVersion | undefined {
  return [...t.bcVersions].reverse().find((v) => !v.layoutUnrecognised);
}
