// How sure the AI is about what it produced, shown next to every AI value:
//  - business case lines: the similarity of the matched past business case
//    (or tender passage) the value was drafted from
//  - clause categories: the classifier's score for the category it chose
// The score is shown as a percentage with a band, so people know which AI
// values to check first. A person's confirmation or edit replaces it.

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

/** Band thresholds per kind of AI output. */
export const CONFIDENCE_BANDS = {
  /** similarity of the matched historical business case */
  match: { high: 0.88, medium: 0.8 },
  /** clause category classification */
  classification: { high: 0.9, medium: 0.75 },
} as const;

export function confidenceLevel(score: number, kind: keyof typeof CONFIDENCE_BANDS): ConfidenceLevel {
  const b = CONFIDENCE_BANDS[kind];
  return score >= b.high ? 'High' : score >= b.medium ? 'Medium' : 'Low';
}

/** e.g. "91% match, high" (display only; the stored score is never rounded) */
export function confidenceText(score: number, kind: keyof typeof CONFIDENCE_BANDS): string {
  const pctText = `${Math.round(score * 100)}%`;
  return `${pctText} ${kind === 'match' ? 'match' : 'sure'}, ${confidenceLevel(score, kind).toLowerCase()}`;
}

/** Demo only: a stable classification score per clause id (0.62 - 0.99). The
 *  live classifier returns its own score with each clause. */
export function demoClassificationScore(id: string): number {
  const h = [...id].reduce((n, ch) => Math.imul(n ^ ch.charCodeAt(0), 2654435761) >>> 0, 2166136261);
  return 0.62 + (h % 38) / 100;
}
