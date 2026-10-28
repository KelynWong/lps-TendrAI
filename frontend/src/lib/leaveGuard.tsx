// Unsaved-changes guard. A section with unsaved edits registers itself with
// useUnsavedChanges(); anything that would leave it (tabs, navigation, sign
// out) goes through requestLeave(), which asks first when edits are pending.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '../ui/ui';

interface Guard {
  /** what would be lost, e.g. "3 unsaved changes on 2 clauses" */
  what: string;
  discard: () => void;
}

interface LeaveGuardApi {
  setGuard: (g: Guard | null) => void;
  requestLeave: (leave: () => void) => void;
}

const Ctx = createContext<LeaveGuardApi>({ setGuard: () => {}, requestLeave: (leave) => leave() });

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const guard = useRef<Guard | null>(null);
  const [pending, setPending] = useState<{ leave: () => void; what: string } | null>(null);

  const setGuard = useCallback((g: Guard | null) => { guard.current = g; }, []);
  const requestLeave = useCallback((leave: () => void) => {
    if (!guard.current) leave();
    else setPending({ leave, what: guard.current.what });
  }, []);

  // closing or reloading the browser tab
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!guard.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return (
    <Ctx.Provider value={{ setGuard, requestLeave }}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title="Leave without saving?"
        confirmLabel="Discard changes and leave"
        danger
        onClose={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          guard.current?.discard();
          guard.current = null;
          setPending(null);
          p?.leave();
        }}
      >
        <p>You have {pending?.what}. They will be lost if you leave now.</p>
        <p className="muted small">Choose Cancel to stay and save them first.</p>
      </ConfirmDialog>
    </Ctx.Provider>
  );
}

export const useLeaveGuard = () => useContext(Ctx);

/** Registers unsaved edits while `what` is set (null = nothing unsaved). */
export function useUnsavedChanges(what: string | null, discard: () => void) {
  const { setGuard } = useLeaveGuard();
  const discardRef = useRef(discard);
  discardRef.current = discard;
  useEffect(() => {
    setGuard(what ? { what, discard: () => discardRef.current() } : null);
  }, [what, setGuard]);
  useEffect(() => () => setGuard(null), [setGuard]);
}
