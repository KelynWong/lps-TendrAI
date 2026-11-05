// "Back to tender": shown on pages reached from inside a tender (View history,
// uploads from the Submission or Qualification tab). Returns to the tender
// and the tab the user left from. Styled like the "All tenders" back link.

import { ArrowLeft } from 'lucide-react';
import { useStore } from '../state/store';

export function BackToTender() {
  const { state, dispatch } = useStore();
  if (!state.returnTo) return null;
  return (
    <button type="button" className="back-link" title={`Return to ${state.returnTo.label}`} onClick={() => dispatch({ type: 'back-to-tender' })}>
      <ArrowLeft size={14} aria-hidden /> Back to tender
    </button>
  );
}
