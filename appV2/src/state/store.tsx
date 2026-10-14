/* eslint-disable react-refresh/only-export-components */
// App-wide state. Everything is in-memory demo state: refreshing resets it.

import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type {
  BcVersion,
  Boilerplate,
  ChecklistItem,
  Clause,
  GenDoc,
  PackDoc,
  PackDocRole,
  RepoRecord,
  TemplateDoc,
  TemplateSearch,
  Tender,
} from '../types';
import type { Role, UserInfo } from '../config';
import { BACKUP, BOILERPLATE, REPOSITORY, TEMPLATES, TENDERS } from '../data/mock';
import { buildDemoExtraction } from '../data/extraction';

export interface AppState {
  user: UserInfo | null; // null = not signed in
  role: Role;
  activeTenderId: string | null;
  tenders: Tender[];
  templates: TemplateDoc[];
  boilerplate: Boilerplate[];
  repository: RepoRecord[];
  backup: typeof BACKUP & { lastRestoreDemo?: string };
}

type Action =
  | { type: 'login'; user: UserInfo }
  | { type: 'logout' }
  | { type: 'set-role'; role: Role }
  | { type: 'open-tender'; id: string }
  | { type: 'create-tender'; tender: Tender }
  | { type: 'update-tender'; tenderId: string; patch: Partial<Pick<Tender, 'sfdcCrmId' | 'ref' | 'name' | 'agency' | 'type' | 'closingDate'>> }
  | { type: 'delete-tender'; tenderId: string }
  | { type: 'close-tender' }
  | { type: 'set-step'; tenderId: string; idx: number }
  | { type: 'correct-doc-role'; tenderId: string; docId: string; role: PackDocRole }
  | { type: 'add-pack-docs'; tenderId: string; docs: PackDoc[] }
  | { type: 'move-pack-doc'; tenderId: string; docId: string; direction: 'up' | 'down' }
  | { type: 'remove-pack-doc'; tenderId: string; docId: string }
  // -- the one processing job per tender (simulated stage advance) --
  | { type: 'start-processing'; tenderId: string }
  | { type: 'set-process-stage'; tenderId: string; stage: number }
  | { type: 'finish-processing'; tenderId: string }
  | { type: 'retry-doc'; tenderId: string; docId: string }
  | { type: 'retry-doc-done'; tenderId: string; docId: string }
  // -- per-tender template search --
  | { type: 'template-search-start'; tenderId: string }
  | { type: 'template-search-done'; tenderId: string; search: TemplateSearch }
  | { type: 'set-mspo-mapping'; tenderId: string; key: string; tab: string; from: string; to?: string }
  | { type: 'delete-bc-version'; tenderId: string; v: number }
  | { type: 'set-tender-status'; tenderId: string; status: Tender['status']; statusReason: Tender['statusReason'] }
  | { type: 'patch-checklist'; tenderId: string; itemId: string; patch: Partial<ChecklistItem> }
  | { type: 'patch-clause'; tenderId: string; clauseId: string; patch: Partial<Clause> }
  | { type: 'upload-bc'; tenderId: string; version: BcVersion }
  | { type: 'set-drb'; tenderId: string; outcome?: Tender['drbOutcome']; notes?: string }
  | { type: 'patch-gendoc'; tenderId: string; docId: string; patch: Partial<GenDoc> }
  | { type: 'add-template'; tpl: TemplateDoc }
  | { type: 'update-template'; id: string; patch: Partial<TemplateDoc> }
  | { type: 'delete-template'; id: string }
  | { type: 'add-boilerplate'; item: Boilerplate }
  | { type: 'update-boilerplate'; id: string; patch: Partial<Boilerplate> }
  | { type: 'delete-boilerplate'; id: string }
  | { type: 'archive-repo'; id: string; sizeFrom: string; sizeTo: string }
  | { type: 'request-restore'; id: string }
  | { type: 'complete-restore'; id: string }
  | { type: 'backup-restore-demo' };

function patchTender(state: AppState, id: string, fn: (t: Tender) => Tender): AppState {
  return { ...state, tenders: state.tenders.map((t) => (t.id === id ? fn(t) : t)) };
}

/** Plausible page count once text extraction has run (deterministic per name). */
const pagesFor = (name: string) =>
  6 + ((name.length * 13 + name.charCodeAt(0)) % 72);

function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'login':
      return { ...state, user: a.user, role: a.user.role };
    case 'logout':
      return { ...state, user: null, activeTenderId: null };
    case 'set-role':
      return { ...state, role: a.role };
    case 'open-tender':
      return { ...state, activeTenderId: a.id };
    case 'create-tender':
      return { ...state, tenders: [a.tender, ...state.tenders] };
    case 'update-tender':
      return patchTender(state, a.tenderId, (t) => ({ ...t, ...a.patch }));
    case 'delete-tender':
      return {
        ...state,
        tenders: state.tenders.filter((t) => t.id !== a.tenderId),
        activeTenderId: state.activeTenderId === a.tenderId ? null : state.activeTenderId,
      };
    case 'close-tender':
      return { ...state, activeTenderId: null };
    case 'set-step':
      return patchTender(state, a.tenderId, (t) => ({ ...t, stepIdx: Math.max(t.stepIdx, a.idx) }));
    case 'correct-doc-role':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        pack: t.pack.map((d) => (d.id === a.docId ? { ...d, role: a.role, roleUnconfirmed: false } : d)),
      }));
    case 'add-pack-docs':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        pack: [...t.pack, ...a.docs],
        outOfDate: t.lastProcessedAt
          ? { added: (t.outOfDate?.added ?? 0) + a.docs.length, removed: t.outOfDate?.removed ?? 0, repaired: t.outOfDate?.repaired }
          : t.outOfDate,
      }));
    case 'move-pack-doc':
      return patchTender(state, a.tenderId, (t) => {
        const index = t.pack.findIndex((d) => d.id === a.docId);
        const nextIndex = a.direction === 'up' ? index - 1 : index + 1;
        if (index < 0 || nextIndex < 0 || nextIndex >= t.pack.length) return t;
        const pack = [...t.pack];
        [pack[index], pack[nextIndex]] = [pack[nextIndex], pack[index]];
        return { ...t, pack };
      });
    case 'remove-pack-doc':
      return patchTender(state, a.tenderId, (t) => {
        const doc = t.pack.find((d) => d.id === a.docId);
        const wasProcessed = !!t.lastProcessedAt && !!doc && doc.status !== 'Uploaded';
        return {
          ...t,
          pack: t.pack.filter((d) => d.id !== a.docId),
          outOfDate: wasProcessed
            ? { added: t.outOfDate?.added ?? 0, removed: (t.outOfDate?.removed ?? 0) + 1, repaired: t.outOfDate?.repaired }
            : t.outOfDate,
        };
      });

    // ---- processing job -----------------------------------------------------
    case 'start-processing':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        processFailed: undefined,
        job: { stage: 1, startedAt: new Date().toISOString() },
        pack: t.pack.map((d) =>
          d.status === 'Failed' && d.failReason?.includes('service unavailable')
            ? { ...d, status: 'Extracting text', failReason: undefined }
            : d.status === 'Uploaded'
              ? { ...d, status: d.textExtracted ? 'Text ready' : 'Extracting text' }
              : d.status === 'Done'
                ? { ...d, status: 'Text ready' } // text reused; analysis re-runs
                : d,
        ),
      }));
    case 'set-process-stage':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        job: t.job ? { ...t.job, stage: a.stage } : t.job,
        pack: a.stage >= 2
          ? t.pack.map((d) =>
              d.status === 'Extracting text' || d.status === 'Text ready'
                ? { ...d, status: 'Analysing', textExtracted: true, pages: d.pages || pagesFor(d.name) }
                : d)
          : t.pack,
      }));
    case 'finish-processing':
      return patchTender(state, a.tenderId, (t) => {
        if (!t.job) return t; // one job per tender; ignore stray completions
        const firstRun = t.clauses.length === 0;
        const extraction = firstRun ? buildDemoExtraction(t) : null;
        // Reprocess keeps human work (compliance statuses and responses stay);
        // newly found clauses are appended.
        let clauses = t.clauses;
        if (!firstRun && t.outOfDate) {
          const src = t.pack.find((d) => d.status === 'Analysing')?.name ?? t.pack[0]?.name ?? 'Tender document';
          clauses = [
            ...clauses,
            { id: `${t.id}-new-${Date.now()}`, number: 'Addendum 1.1', text: 'Tenderers shall take into account the clarifications issued in the latest addendum when preparing their submission.', category: 'Commercial', subTags: [], sourceDoc: src, page: 1, compliance: 'Unset', response: '' },
            { id: `${t.id}-new2-${Date.now()}`, number: 'Addendum 1.2', text: 'The submission deadline stated in the addendum supersedes the deadline in the original tender notice.', category: 'Commercial', subTags: [], sourceDoc: src, page: 2, compliance: 'Unset', response: '' },
          ];
        }
        return {
          ...t,
          job: undefined,
          outOfDate: undefined,
          processFailed: undefined,
          lastProcessedAt: new Date().toISOString(),
          pack: t.pack.map((d) =>
            d.status === 'Analysing'
              ? { ...d, status: 'Done', textExtracted: true, pages: d.pages || pagesFor(d.name) }
              : d),
          checklist: firstRun && extraction ? extraction.checklist : t.checklist,
          quals: firstRun && extraction ? extraction.quals : t.quals,
          clauses: firstRun && extraction ? extraction.clauses : clauses,
          stepIdx: Math.max(t.stepIdx, 1),
        };
      });
    case 'retry-doc':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        pack: t.pack.map((d) => (d.id === a.docId ? { ...d, status: 'Extracting text', failReason: undefined } : d)),
      }));
    case 'retry-doc-done':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        pack: t.pack.map((d) =>
          d.id === a.docId
            ? { ...d, status: 'Text ready', textExtracted: true, pages: d.pages || pagesFor(d.name) }
            : d),
        outOfDate: t.lastProcessedAt
          ? { added: t.outOfDate?.added ?? 0, removed: t.outOfDate?.removed ?? 0, repaired: (t.outOfDate?.repaired ?? 0) + 1 }
          : t.outOfDate,
      }));

    // ---- template search -------------------------------------------------------
    case 'template-search-start':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        templateSearch: { status: 'searching', matches: [] },
      }));
    case 'template-search-done':
      return patchTender(state, a.tenderId, (t) => ({ ...t, templateSearch: a.search }));
    case 'set-mspo-mapping':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        mspoMapping: { ...t.mspoMapping, [a.key]: { tab: a.tab, from: a.from, to: a.to } },
      }));
    case 'delete-bc-version':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        bcVersions: t.bcVersions.filter((v) => v.v !== a.v),
      }));
    case 'set-tender-status':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        status: a.status,
        statusReason: a.statusReason,
        drbOutcome: a.statusReason === 'Won (Won)' ? 'Won' : a.statusReason === 'Lost (Closed)' ? 'Lost' : t.drbOutcome,
        stepIdx: a.status === 'Won' || a.status === 'Closed' ? 5 : t.stepIdx,
      }));

    case 'patch-checklist':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        checklist: t.checklist.map((k) => (k.id === a.itemId ? { ...k, ...a.patch } : k)),
      }));
    case 'patch-clause':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        clauses: t.clauses.map((c) => (c.id === a.clauseId ? { ...c, ...a.patch } : c)),
      }));
    case 'upload-bc':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        bcVersions: [...t.bcVersions, a.version],
        stepIdx: Math.max(t.stepIdx, 2),
      }));
    case 'set-drb':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        drbOutcome: a.outcome ?? t.drbOutcome,
        drbNotes: a.notes ?? t.drbNotes,
        status: a.outcome === 'Won' ? 'Won' : a.outcome === 'Lost' ? 'Closed' : t.status,
        statusReason: a.outcome === 'Won' ? 'Won (Won)' : a.outcome === 'Lost' ? 'Lost (Closed)' : t.statusReason,
        stepIdx: a.outcome && a.outcome !== 'Awaiting result' ? 5 : Math.max(t.stepIdx, 3),
      }));
    case 'patch-gendoc':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        genDocs: t.genDocs.map((g) => (g.id === a.docId ? { ...g, ...a.patch } : g)),
        stepIdx: Math.max(t.stepIdx, 4),
      }));
    case 'add-template':
      return { ...state, templates: [a.tpl, ...state.templates] };
    case 'update-template':
      return { ...state, templates: state.templates.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'delete-template':
      return { ...state, templates: state.templates.filter((x) => x.id !== a.id) };
    case 'add-boilerplate':
      return { ...state, boilerplate: [a.item, ...state.boilerplate] };
    case 'update-boilerplate':
      return { ...state, boilerplate: state.boilerplate.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'delete-boilerplate':
      return { ...state, boilerplate: state.boilerplate.filter((x) => x.id !== a.id) };
    case 'archive-repo':
      return {
        ...state,
        repository: state.repository.map((r) =>
          r.id === a.id
            ? { ...r, status: 'Archived', archived: { sizeFrom: a.sizeFrom, sizeTo: a.sizeTo, at: new Date().toISOString().slice(0, 10) }, restore: undefined }
            : r,
        ),
      };
    case 'request-restore':
      return {
        ...state,
        repository: state.repository.map((r) =>
          r.id === a.id ? { ...r, restore: { state: 'requested', requestedAt: new Date().toISOString() } } : r,
        ),
      };
    case 'complete-restore':
      return {
        ...state,
        repository: state.repository.map((r) =>
          r.id === a.id && r.restore?.state === 'requested'
            ? { ...r, restore: { ...r.restore, state: 'available' } }
            : r,
        ),
      };
    case 'backup-restore-demo':
      return { ...state, backup: { ...state.backup, lastRestoreDemo: new Date().toISOString() } };
    default:
      return state;
  }
}

const initial: AppState = {
  user: null, // sign in via the login screen
  role: 'bd',
  activeTenderId: null,
  tenders: TENDERS,
  templates: TEMPLATES,
  boilerplate: BOILERPLATE,
  repository: REPOSITORY,
  backup: BACKUP,
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

export function useTender(id?: string | null): Tender | null {
  const { state } = useStore();
  const tid = id ?? state.activeTenderId;
  return state.tenders.find((t) => t.id === tid) ?? null;
}
