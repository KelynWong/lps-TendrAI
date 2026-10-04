/* eslint-disable react-refresh/only-export-components */
// Draft layer for the business case workspace: tabs edit a local draft copy;
// nothing reaches the store (or the audit trail) until Save is clicked.

import { createContext, useContext } from 'react';
import type { BusinessCaseState } from '../types';

export interface DraftCtxType {
  /** The draft business case all tabs render and edit */
  bc: BusinessCaseState;
  /** Apply an edit to the draft (pure updater) */
  update: (fn: (bc: BusinessCaseState) => BusinessCaseState) => void;
  /** True when the draft differs from the last saved version */
  dirty: boolean;
}

export const DraftCtx = createContext<DraftCtxType | null>(null);

export function useDraft(): DraftCtxType {
  const ctx = useContext(DraftCtx);
  if (!ctx) throw new Error('useDraft outside provider');
  return ctx;
}

/** Human-readable list of the areas that differ between two versions. */
export function diffSummary(a: BusinessCaseState, b: BusinessCaseState): string {
  const areas: [string, (x: BusinessCaseState) => unknown][] = [
    ['Basic Info', (x) => [x.basicInfo, x.fxOverrides]],
    ['Quote Lines', (x) => x.quoteLines],
    ['Billing Plan', (x) => x.billing],
    ['Product Plan', (x) => x.productItems],
    ['Resource Plan', (x) => [x.resourceItems, x.labourMonthly]],
    ['Summary rates', (x) => [x.appliedRates, x.otherIndirect]],
    ['Cash Flow', (x) => x.vendorCols],
  ];
  const changed = areas
    .filter(([, get]) => JSON.stringify(get(a)) !== JSON.stringify(get(b)))
    .map(([name]) => name);
  return changed.length ? changed.join(', ') : 'No changes';
}
