/* eslint-disable react-refresh/only-export-components */
// App-wide state: tenders (each carrying its business case and submission form),
// current user, and the append-only audit trail.
//
// Business-case EDITS happen on a local draft (state/draft.tsx) and reach the
// store only through 'commit-bc' when the user clicks Save. Workflow actions
// (submit / approve / reject / form upload) act on the saved version directly.

import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type {
  AuditEntry,
  BusinessCaseState,
  HistoricalDoc,
  Role,
  TenderRecord,
  UserInfo,
} from '../types';
import {
  HISTORICAL_DOCS,
  SEED_AUDIT,
  buildGeneratedBusinessCase,
  buildSeedTenders,
} from '../data/fixtures';

/** Distinct DRB approvals required to lock a business case */
export const APPROVALS_REQUIRED = 2;

export interface AppState {
  user: UserInfo | null; // null = not signed in
  tenders: TenderRecord[];
  activeTenderId: string | null;
  audit: AuditEntry[];
  historical: HistoricalDoc[];
}

type Action =
  | { type: 'login'; user: UserInfo }
  | { type: 'logout' }
  | { type: 'open-tender'; id: string }
  | { type: 'close-tender' }
  | { type: 'upload-tender'; fileName: string; sizeLabel: string; pages: number }
  | { type: 'generation-complete'; id: string }
  | { type: 'upload-submission-form'; fileName: string }
  | { type: 'commit-bc'; bc: BusinessCaseState; summary: string }
  | { type: 'submit-drb' }
  | { type: 'approve' }
  | { type: 'reject'; reason: string }
  | { type: 'mark-submitted' }
  | { type: 'add-historical'; doc: HistoricalDoc }
  | { type: 'update-historical'; doc: HistoricalDoc }
  | { type: 'historical-embedded'; id: string };

// ---- Permission model (stakeholder matrix in the requirement spec) ---------

export const can = {
  editProducts: (r: Role) =>
    ['executive-sponsor', 'business-sponsor', 'presales', 'bd-team'].includes(r),
  editResources: (r: Role) =>
    ['executive-sponsor', 'business-sponsor', 'delivery', 'bd-team'].includes(r),
  editRatesAndMargins: (r: Role) => r === 'executive-sponsor',
  /** BD maintains deal structure: quote lines, billing plan, FX rates, vendor columns */
  editDealStructure: (r: Role) =>
    ['executive-sponsor', 'business-sponsor', 'bd-team'].includes(r),
  approve: (r: Role) => ['executive-sponsor', 'business-sponsor'].includes(r),
  uploadTender: (r: Role) => r === 'bidding-manager',
  submitForDrb: (r: Role) => r === 'bidding-manager',
  downloadMspo: (r: Role) => ['bd-team', 'executive-sponsor', 'business-sponsor'].includes(r),
};

let auditSeq = 100;
function entry(user: UserInfo, action: string, detail: string): AuditEntry {
  return {
    id: `a${auditSeq++}`,
    ts: new Date().toISOString(),
    user: user.name,
    role: user.roleLabel,
    action,
    detail,
  };
}

function entryT(user: UserInfo, action: string, detail: string, tender: string): AuditEntry {
  return { ...entry(user, action, detail), tender };
}

function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Untitled Tender';
}

function reducer(state: AppState, a: Action): AppState {
  if (a.type === 'login') {
    return {
      ...state,
      user: a.user,
      audit: [...state.audit, entry(a.user, 'Signed in', `${a.user.email} authenticated`)],
    };
  }
  if (a.type === 'logout') return { ...state, user: null };
  if (!state.user) return state; // every other action requires a signed-in user
  const user = state.user;

  const log = (action: string, detail: string): AuditEntry[] => [
    ...state.audit,
    entry(user, action, detail),
  ];

  if (a.type === 'open-tender') return { ...state, activeTenderId: a.id };
  if (a.type === 'close-tender') return { ...state, activeTenderId: null };

  if (a.type === 'upload-tender') {
    const n = state.tenders.length + 12;
    const t: TenderRecord = {
      id: `t-${Date.now()}`,
      ref: `ITT/2026/0${n}`,
      title: titleFromFileName(a.fileName),
      agency: 'To be confirmed from tender document',
      sector: 'Agency',
      pages: a.pages,
      fileName: a.fileName,
      fileSize: a.sizeLabel,
      uploadedBy: user.name,
      uploadedAt: new Date().toISOString(),
      closingDate: new Date(Date.now() + 28 * 86400000).toISOString(),
      processingMinutes: 14 + Math.floor(Math.random() * 6),
      bc: null, // pipeline running
    };
    return {
      ...state,
      tenders: [t, ...state.tenders],
      activeTenderId: t.id,
      audit: [
        ...state.audit,
        entryT(user, 'Tender uploaded', `${a.fileName} (${a.sizeLabel}, ~${a.pages} pages) uploaded; processing started`, t.ref),
      ],
    };
  }

  if (a.type === 'generation-complete') {
    const t = state.tenders.find((x) => x.id === a.id);
    if (!t || t.bc) return state;
    return {
      ...state,
      tenders: state.tenders.map((x) =>
        x.id === a.id ? { ...x, bc: buildGeneratedBusinessCase(t.title) } : x,
      ),
      audit: [
        ...state.audit,
        {
          id: `a${auditSeq++}`,
          ts: new Date().toISOString(),
          user: 'system',
          role: 'Pipeline',
          action: 'Draft generated',
          detail: `Draft business case generated for ${t.ref}: 10 product lines, 10 labour lines, billing plan drafted`,
          tender: t.ref,
        },
      ],
    };
  }

  // ---- Historical data store (no active tender required) -------------------
  if (a.type === 'add-historical') {
    return {
      ...state,
      historical: [a.doc, ...state.historical],
      audit: log('Historical document uploaded', `${a.doc.id}: ${a.doc.title} (${a.doc.docType}, ${a.doc.sector}); embedding started`),
    };
  }
  if (a.type === 'update-historical') {
    return {
      ...state,
      historical: state.historical.map((d) => (d.id === a.doc.id ? a.doc : d)),
      audit: log('Historical document updated', `${a.doc.id}: metadata edited; prior version archived, re-embedding`),
    };
  }
  if (a.type === 'historical-embedded') {
    return {
      ...state,
      historical: state.historical.map((d) =>
        d.id === a.id
          ? { ...d, embeddingStatus: 'Embedded', chunks: d.chunks || 120 + Math.floor(Math.random() * 300) }
          : d,
      ),
    };
  }

  // ---- Everything below acts on the ACTIVE tender's business case ----------
  const tender = state.tenders.find((t) => t.id === state.activeTenderId);
  if (!tender || !tender.bc) return state;
  const bc = tender.bc;
  const locked = bc.status === 'approved' || bc.status === 'submitted';

  const logT = (action: string, detail: string): AuditEntry[] => [
    ...state.audit,
    entryT(user, action, detail, tender.ref),
  ];

  const withBc = (nextBc: BusinessCaseState, audit: AuditEntry[]): AppState => ({
    ...state,
    tenders: state.tenders.map((t) => (t.id === tender.id ? { ...t, bc: nextBc } : t)),
    audit,
  });
  const withTender = (patch: Partial<TenderRecord>, audit: AuditEntry[]): AppState => ({
    ...state,
    tenders: state.tenders.map((t) => (t.id === tender.id ? { ...t, ...patch } : t)),
    audit,
  });

  switch (a.type) {
    case 'commit-bc': {
      if (locked) return state;
      let audit = logT('Business case saved', `Changes saved: ${a.summary}`);
      let next = a.bc;
      // Saving after a partial approval voids it (the user confirmed in the UI)
      if (bc.approvals.length > 0 && bc.approvals.length < APPROVALS_REQUIRED) {
        next = { ...a.bc, approvals: [] };
        audit = [
          ...audit,
          entryT(
            user,
            'Approvals reset',
            `Saved changes voided the partial approval by ${bc.approvals.join(' and ')}; sponsors must approve again`,
            tender.ref,
          ),
        ];
      }
      return withBc(next, audit);
    }

    case 'upload-submission-form':
      return withTender(
        { submissionFormName: a.fileName, submissionFilledAt: new Date().toISOString() },
        logT('Submission form uploaded', `${a.fileName} - auto-filled from approved business case ${bc.basicInfo.crmId}`),
      );

    case 'submit-drb':
      return withBc(
        { ...bc, status: 'in_drb', approvals: [] },
        logT('Submitted for DRB', `${tender.ref} business case submitted for Deal Review Board approval`),
      );
    case 'approve': {
      if (bc.approvals.includes(user.name)) return state; // one vote per person
      const approvals = [...bc.approvals, user.name];
      if (approvals.length >= APPROVALS_REQUIRED) {
        return withBc(
          {
            ...bc,
            approvals,
            status: 'approved',
            approvedBy: approvals.join(' and '),
            approvedAt: new Date().toISOString(),
          },
          logT('Business case APPROVED', `Second approval by ${user.name}; ${tender.ref} locked from further edits and submission form enabled`),
        );
      }
      return withBc(
        { ...bc, approvals },
        logT('Approval recorded', `${user.name} approved ${tender.ref} (${approvals.length} of ${APPROVALS_REQUIRED}); saving further edits will void it`),
      );
    }
    case 'reject':
      return withBc({ ...bc, status: 'draft', approvals: [] }, logT('Business case rejected', a.reason));
    case 'mark-submitted':
      return withBc(
        { ...bc, status: 'submitted' },
        logT('Tender submission form generated', `Prefilled form downloaded for ${tender.ref}`),
      );
    default:
      return state;
  }
}

const initial: AppState = {
  user: null, // sign in via the login screen
  tenders: buildSeedTenders(),
  activeTenderId: null,
  audit: SEED_AUDIT,
  historical: HISTORICAL_DOCS,
};

const Ctx = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

/** Active tender - only call from components rendered inside a tender detail view. */
export function useTender(): TenderRecord {
  const { state } = useStore();
  const t = state.tenders.find((x) => x.id === state.activeTenderId);
  if (!t) throw new Error('no active tender');
  return t;
}

/** Active tender's SAVED business case - only call where the pipeline has completed. */
export function useBc(): BusinessCaseState {
  const t = useTender();
  if (!t.bc) throw new Error('business case not generated yet');
  return t.bc;
}
