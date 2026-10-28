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
  AppConfig,
  AuditEntry,
  BusinessCaseState,
  HistoricalDoc,
  Role,
  TenderRecord,
  UserInfo,
} from '../types';
import type { ChangeEntry } from './draft';
import {
  DEFAULT_CONFIG,
  HISTORICAL_DOCS,
  SEED_AUDIT,
  buildGeneratedBusinessCase,
  buildSeedTenders,
} from '../data/fixtures';

/** Distinct DRB approvals required to lock a business case
 *  (Eng Chuan Puay, Thomas Low and Ethan Lim) */
export const APPROVALS_REQUIRED = 3;

export interface AppState {
  user: UserInfo | null; // null = not signed in
  tenders: TenderRecord[];
  activeTenderId: string | null;
  audit: AuditEntry[];
  historical: HistoricalDoc[];
  /** Admin-configurable lists and defaults */
  config: AppConfig;
}

type Action =
  | { type: 'login'; user: UserInfo }
  | { type: 'logout' }
  | { type: 'open-tender'; id: string }
  | { type: 'close-tender' }
  | { type: 'upload-tender'; files: string[]; sizeLabel: string; pages: number; tenderType: string }
  | { type: 'generation-complete'; id: string }
  | { type: 'upload-submission-form'; fileName: string }
  | { type: 'update-submission-field'; label: string; value: string }
  | { type: 'commit-bc'; bc: BusinessCaseState; summary: string; changes: ChangeEntry[] }
  | { type: 'submit-drb' }
  | { type: 'approve' }
  | { type: 'reject'; reason: string }
  | { type: 'mark-submitted' }
  | { type: 'set-outcome'; outcome: string }
  | { type: 'update-config'; patch: Partial<AppConfig>; note: string }
  | { type: 'add-historical'; docs: HistoricalDoc[]; linkedTo?: string }
  | { type: 'update-historical'; doc: HistoricalDoc; linkedTo?: string; replacedWith?: string }
  | { type: 'archive-historical'; id: string }
  | { type: 'historical-embedded'; id: string };

// ---- Permission model (stakeholder matrix in the requirement spec) ---------

export const can = {
  // ONLY Business Development edits the business case; every other role is
  // read-only there (sponsors approve, the Bidding Manager uploads).
  editProducts: (r: Role) => r === 'bd-team',
  editResources: (r: Role) => r === 'bd-team',
  editRatesAndMargins: (r: Role) => r === 'bd-team',
  editDealStructure: (r: Role) => r === 'bd-team',
  approve: (r: Role) => ['executive-sponsor', 'business-sponsor'].includes(r),
  uploadTender: (r: Role) => r === 'bidding-manager',
  submitForDrb: (r: Role) => r === 'bidding-manager',
  downloadMspo: (r: Role) => ['bd-team', 'executive-sponsor', 'business-sponsor'].includes(r),
  /** Administrator console: configurable lists, defaults, failed processing */
  admin: (r: Role) => r === 'admin',
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

function entryT(user: UserInfo, action: string, detail: string, tender: string, section?: string): AuditEntry {
  return { ...entry(user, action, detail), tender, section };
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

  if (a.type === 'open-tender') return { ...state, activeTenderId: a.id };
  if (a.type === 'close-tender') return { ...state, activeTenderId: null };

  if (a.type === 'upload-tender') {
    const n = state.tenders.length + 12;
    const t: TenderRecord = {
      id: `t-${Date.now()}`,
      ref: `ITT/2026/0${n}`,
      title: titleFromFileName(a.files[0] ?? 'tender'),
      agency: 'To be confirmed from tender document',
      sector: a.tenderType,
      pages: a.pages,
      fileName: a.files[0] ?? '',
      fileSize: a.sizeLabel,
      files: a.files,
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
        entryT(
          user,
          'Tender uploaded',
          `${a.files.length} document${a.files.length > 1 ? 's' : ''} (${a.files.join(', ')}; ${a.sizeLabel}, ~${a.pages} pages) uploaded; processing started`,
          t.ref,
        ),
      ],
    };
  }

  if (a.type === 'generation-complete') {
    const t = state.tenders.find((x) => x.id === a.id);
    if (!t || t.bc) return state;
    // New business cases pick up the admin-configured defaults
    const gen = buildGeneratedBusinessCase(t.title);
    const bcWithDefaults: BusinessCaseState = {
      ...gen,
      fxOverrides: { ...state.config.fxDefaults },
      gradeRateOverrides: { ...state.config.gradeRates },
      resourceItems: gen.resourceItems.map((r) => ({
        ...r,
        dayRate: state.config.gradeRates[r.grade] ?? r.dayRate,
      })),
    };
    return {
      ...state,
      tenders: state.tenders.map((x) =>
        x.id === a.id ? { ...x, bc: bcWithDefaults } : x,
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
    const group = a.docs[0]?.group;
    const entries: AuditEntry[] = a.docs.map((doc) => ({
      ...entry(user, 'Historical document uploaded', `${doc.id}: ${doc.title} (${doc.docType}, ${doc.sector}); embedding started`),
      section: 'Historical data',
    }));
    if (group && (a.docs.length > 1 || a.linkedTo)) {
      const ids = [...(a.linkedTo ? [a.linkedTo] : []), ...a.docs.map((d) => d.id)];
      entries.push({
        ...entry(user, 'Historical documents linked', `${ids.join(', ')} linked as one tender set`),
        section: 'Historical data',
      });
    }
    return {
      ...state,
      historical: [
        ...a.docs,
        // Linking to a previously ungrouped document pulls it into the new set
        ...state.historical.map((d) => (group && d.id === a.linkedTo ? { ...d, group } : d)),
      ],
      audit: [...state.audit, ...entries],
    };
  }
  if (a.type === 'update-historical') {
    const group = a.doc.group;
    const prev = state.historical.find((d) => d.id === a.doc.id);
    // Archive the superseded version with a note of exactly what changed
    const changes: string[] = [];
    if (prev) {
      if (prev.title !== a.doc.title) changes.push(`Title: ${prev.title} -> ${a.doc.title}`);
      if (prev.docType !== a.doc.docType) changes.push(`Type: ${prev.docType} -> ${a.doc.docType}`);
      if (prev.sector !== a.doc.sector) changes.push(`Sector: ${prev.sector} -> ${a.doc.sector}`);
      if (prev.customer !== a.doc.customer) changes.push(`Customer: ${prev.customer} -> ${a.doc.customer}`);
      if (prev.outcome !== a.doc.outcome) changes.push(`Outcome: ${prev.outcome} -> ${a.doc.outcome}`);
      if (prev.group !== a.doc.group) changes.push(a.doc.group ? 'Linked into a tender set' : 'Unlinked from its tender set');
    }
    if (a.replacedWith) changes.push(`Document replaced (${a.replacedWith})`);
    const updated: HistoricalDoc = {
      ...a.doc,
      history: [
        ...(prev?.history ?? []),
        ...(prev
          ? [{ v: prev.version, archivedAt: new Date().toISOString().slice(0, 10), by: user.name, note: changes.join('; ') || 'Metadata edited' }]
          : []),
      ],
    };
    let historical = state.historical.map((d) => {
      if (d.id === a.doc.id) return updated;
      // Relinking to a previously ungrouped document pulls it into the set
      if (group && a.linkedTo && d.id === a.linkedTo) return { ...d, group };
      return d;
    });
    // A linked set carries ONE outcome: the edited document's outcome wins
    if (group && a.doc.outcome !== '-') {
      historical = historical.map((d) =>
        d.id !== a.doc.id && d.group === group && d.docType !== 'Tender Requirement' && d.outcome !== a.doc.outcome
          ? { ...d, outcome: a.doc.outcome }
          : d,
      );
    }
    const entries: AuditEntry[] = [
      { ...entry(user, 'Historical document updated', `${a.doc.id}: metadata edited; prior version archived, re-embedding`), section: 'Historical data' },
    ];
    if (prev && prev.group !== a.doc.group) {
      entries.push({
        ...entry(
          user,
          a.doc.group ? 'Historical documents linked' : 'Historical document unlinked',
          a.doc.group
            ? `${a.doc.id} linked into a tender set${a.linkedTo ? ` with ${a.linkedTo}` : ''}`
            : `${a.doc.id} removed from its linked tender set`,
        ),
        section: 'Historical data',
      });
    }
    return { ...state, historical, audit: [...state.audit, ...entries] };
  }
  if (a.type === 'update-config') {
    if (user.role !== 'admin') return state; // Administrator only
    return {
      ...state,
      config: { ...state.config, ...a.patch },
      audit: [
        ...state.audit,
        { ...entry(user, 'Configuration updated', a.note), section: 'Admin' },
      ],
    };
  }
  if (a.type === 'archive-historical') {
    const doc = state.historical.find((d) => d.id === a.id);
    return {
      ...state,
      historical: state.historical.map((d) => (d.id === a.id ? { ...d, archived: true } : d)),
      audit: [
        ...state.audit,
        {
          ...entry(user, 'Historical document archived', `${a.id}: ${doc?.title ?? ''} removed from the library and from retrieval for new tenders; existing citations keep resolving to it`),
          section: 'Historical data',
        },
      ],
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

  const logT = (action: string, detail: string, section?: string): AuditEntry[] => [
    ...state.audit,
    entryT(user, action, detail, tender.ref, section),
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
      // One audit entry per change: add / modify / delete, per tab, with values
      let audit = [
        ...state.audit,
        ...(a.changes.length
          ? a.changes.map((c) => entryT(user, c.action, c.detail, tender.ref, c.section))
          : [entryT(user, 'Business case saved', `Changes saved: ${a.summary}`, tender.ref)]),
      ];
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
            'Workflow',
          ),
        ];
      }
      return withBc(next, audit);
    }

    case 'update-submission-field':
      return withTender(
        { submissionOverrides: { ...tender.submissionOverrides, [a.label]: a.value } },
        logT('Submission form field edited', a.label + ' updated before export', 'Submission Form'),
      );
    case 'upload-submission-form':
      return withTender(
        { submissionFormName: a.fileName, submissionFilledAt: new Date().toISOString() },
        [
          ...logT('Submission form uploaded', a.fileName, 'Submission Form'),
          entryT(user, 'Submission form draft generated', 'Fields auto-filled from approved business case ' + bc.basicInfo.crmId + '; non-derivable fields marked for manual input', tender.ref, 'Submission Form'),
        ],
      );

    case 'submit-drb':
      return withBc(
        { ...bc, status: 'in_drb', approvals: [] },
        logT('Submitted for DRB', `${tender.ref} business case submitted for Deal Review Board approval`),
      );
    case 'approve': {
      if (locked) return state;
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
          logT('Business case APPROVED', `Second approval by ${user.name}; ${tender.ref} locked from further edits and submission form enabled`, 'Workflow'),
        );
      }
      return withBc(
        { ...bc, approvals },
        logT('Approval recorded', `${user.name} approved ${tender.ref} (${approvals.length} of ${APPROVALS_REQUIRED}); saving further edits will void it`, 'Workflow'),
      );
    }
    case 'reject':
      return withBc({ ...bc, status: 'draft', approvals: [] }, logT('Business case rejected', a.reason, 'Workflow'));
    case 'set-outcome':
      return withTender(
        { outcome: a.outcome },
        logT('Tender outcome recorded', tender.ref + ' marked as ' + a.outcome, 'Workflow'),
      );
    case 'mark-submitted':
      return withBc(
        { ...bc, status: 'submitted' },
        logT('Submission form exported', `Prefilled form downloaded for ${tender.ref}`, 'Submission Form'),
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
  config: DEFAULT_CONFIG,
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

/** Admin-configurable lists and defaults */
export function useConfig(): AppConfig {
  return useStore().state.config;
}
