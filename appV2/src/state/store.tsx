/* eslint-disable react-refresh/only-export-components */
// App-wide state. Everything is in-memory demo state: refreshing resets it.

import { createContext, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type {
  AuditEntry,
  BcVersion,
  Boilerplate,
  ChecklistItem,
  Clause,
  ClauseChange,
  GenDoc,
  PackDoc,
  PackDocRole,
  RepoRecord,
  TemplateDoc,
  TemplateSearch,
  Qualification,
  Tender,
} from '../types';
import { PROCESS_STAGES } from '../types';
import type { Role, UserInfo } from '../config';
import { AUDIT, BACKUP, BOILERPLATE, BOILERPLATE_TAGS, REPOSITORY, TEMPLATES, TENDERS } from '../data/mock';
import { buildDemoExtraction } from '../data/extraction';
import { DEFAULT_RULES, type RuleDef } from '../rules/finalChecks';
import { DEFAULT_MSPO_MAPPING, type FieldMapEntry, type MapGroup, type MspoDefaults, type MspoPlan } from '../mspo/mapping';

export interface AppState {
  user: UserInfo | null; // null = not signed in
  role: Role;
  activeTenderId: string | null;
  tenders: Tender[];
  templates: TemplateDoc[];
  boilerplate: Boilerplate[];
  /** tags offered for boilerplate; grows as users create tags */
  boilerplateTags: string[];
  repository: RepoRecord[];
  backup: typeof BACKUP & { lastRestoreDemo?: string };
  audit: AuditEntry[];
  /** Final Check rules applied to every business case upload */
  rules: RuleDef[];
  /** company-wide MSPO mapping defaults (tenders may adjust their copy) */
  mspoDefaults: MspoDefaults;
  /** filters to apply when the Audit log opens (e.g. "View history" on a tab) */
  auditPrefill?: { tender?: string; section?: string };
  /** page the shell should switch to (n changes on every request) */
  nav?: { page: string; sub?: string; n: number };
  /** where "Back to tender" returns: the tender and its inner tab */
  returnTo?: ReturnTarget;
  /** inner tender tab to open once (set by "Back to tender") */
  packTabRequest?: string;
}

export interface ReturnTarget {
  tenderId: string;
  /** inner tab key: upload | checklist | quals | clauses */
  packTab: string;
  label: string;
}

/** Client-side events with no state change of their own (downloads, exports)
 *  are recorded through this action so the audit log covers them too. */
export interface LogEvent {
  action: string;
  detail: string;
  tenderId?: string;
  section?: string;
}

export type Action =
  | { type: 'log'; event: LogEvent }
  | { type: 'upsert-rule'; rule: RuleDef }
  | { type: 'delete-rule'; id: string }
  | { type: 'set-mspo-defaults'; plan: MapGroup; entries: FieldMapEntry[] }
  | { type: 'set-mspo-rows'; tenderId: string; plan: MspoPlan; rows?: number }
  | { type: 'set-mspo-meta'; tenderId: string; quoteLine?: string; fyCount?: number; daysPerMonth?: number }
  | { type: 'open-audit'; tender?: string; section?: string; returnTo?: ReturnTarget }
  | { type: 'go-to'; page: string; sub?: string; returnTo?: ReturnTarget }
  | { type: 'back-to-tender' }
  | { type: 'clear-return' }
  | { type: 'clear-pack-tab-request' }
  | { type: 'clear-audit-prefill' }
  | { type: 'set-mspo-details'; tenderId: string; changes: string[]; quoteLine: string; fyCount: number; daysPerMonth: number; rows: Record<MspoPlan, number> }
  | { type: 'reset-mspo-mapping'; tenderId: string; key?: string }
  | { type: 'upload-template'; tpl: TemplateDoc; replaceId?: string }
  | { type: 'upload-boilerplate'; item: Boilerplate; replaceId?: string }
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
  /** several clause edits saved together (one audit entry) */
  | { type: 'save-clauses'; tenderId: string; patches: { clauseId: string; patch: Partial<Clause> }[] }
  | { type: 'patch-qual'; tenderId: string; qualId: string; patch: Partial<Qualification> }
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

/** Tags not yet on the boilerplate tag list (case-insensitive). */
const newTags = (state: AppState, tags?: string[]) =>
  (tags ?? []).filter((t) => !state.boilerplateTags.some((x) => x.toLowerCase() === t.toLowerCase()));

/** Adds any tags a user created to the shared list. */
function withTags(state: AppState, tags?: string[]): AppState {
  const added = newTags(state, tags);
  return added.length ? { ...state, boilerplateTags: [...state.boilerplateTags, ...added].sort((x, y) => x.localeCompare(y)) } : state;
}

/** Audit suffix naming tags this change adds to the list. */
const tagNote = (state: AppState, tags?: string[]) => {
  const added = newTags(state, tags);
  return added.length ? ` (new tag${added.length > 1 ? 's' : ''} added to the list: ${added.join(', ')})` : '';
};

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
    case 'open-audit':
      return {
        ...state,
        activeTenderId: null,
        auditPrefill: { tender: a.tender, section: a.section },
        nav: { page: 'audit', n: (state.nav?.n ?? 0) + 1 },
        returnTo: a.returnTo,
      };
    case 'go-to':
      return { ...state, activeTenderId: null, nav: { page: a.page, sub: a.sub, n: (state.nav?.n ?? 0) + 1 }, returnTo: a.returnTo };
    case 'back-to-tender':
      if (!state.returnTo) return state;
      return {
        ...state,
        activeTenderId: state.returnTo.tenderId,
        packTabRequest: state.returnTo.packTab,
        nav: { page: 'tenders', n: (state.nav?.n ?? 0) + 1 },
        returnTo: undefined,
      };
    case 'clear-return':
      return state.returnTo ? { ...state, returnTo: undefined } : state;
    case 'clear-pack-tab-request':
      return { ...state, packTabRequest: undefined };
    case 'clear-audit-prefill':
      return { ...state, auditPrefill: undefined };
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
    case 'save-clauses': {
      const patches = a.type === 'patch-clause' ? [{ clauseId: a.clauseId, patch: a.patch }] : a.patches;
      const now = new Date().toISOString();
      const by = state.user?.name ?? 'Unknown';
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        clauses: t.clauses.map((c) => {
          const p = patches.find((x) => x.clauseId === c.id)?.patch;
          if (!p) return c;
          // keep earlier compliance values and remarks so changes can be reviewed
          const changes: ClauseChange[] = [];
          if (p.compliance !== undefined && p.compliance !== c.compliance) {
            changes.push({ ts: now, by, field: 'Compliance', from: c.compliance, to: p.compliance });
          }
          if (p.response !== undefined && p.response !== c.response) {
            changes.push({ ts: now, by, field: 'Remark', from: c.response, to: p.response });
          }
          return { ...c, ...p, history: changes.length ? [...(c.history ?? []), ...changes] : c.history };
        }),
      }));
    }
    case 'patch-qual':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        quals: t.quals.map((q) => (q.id === a.qualId ? { ...q, ...a.patch } : q)),
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
    case 'log':
      return state; // the audit wrapper records it
    case 'upsert-rule':
      return {
        ...state,
        rules: state.rules.some((r) => r.id === a.rule.id)
          ? state.rules.map((r) => (r.id === a.rule.id ? a.rule : r))
          : [...state.rules, a.rule],
      };
    case 'delete-rule':
      return { ...state, rules: state.rules.filter((r) => r.id !== a.id) };
    case 'set-mspo-defaults':
      return { ...state, mspoDefaults: { ...state.mspoDefaults, [a.plan]: a.entries } };
    case 'set-mspo-rows':
      return patchTender(state, a.tenderId, (t) => ({ ...t, mspoRows: { ...t.mspoRows, [a.plan]: a.rows } }));
    case 'set-mspo-details':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        mspoQuoteLine: a.quoteLine || undefined,
        mspoFyCount: a.fyCount,
        mspoDaysPerMonth: a.daysPerMonth,
        mspoRows: { ...a.rows },
      }));
    case 'set-mspo-meta':
      return patchTender(state, a.tenderId, (t) => ({
        ...t,
        ...(a.quoteLine !== undefined ? { mspoQuoteLine: a.quoteLine || undefined } : {}),
        ...('fyCount' in a ? { mspoFyCount: a.fyCount } : {}),
        ...('daysPerMonth' in a ? { mspoDaysPerMonth: a.daysPerMonth } : {}),
      }));
    case 'reset-mspo-mapping':
      return patchTender(state, a.tenderId, (t) => {
        if (!a.key) return { ...t, mspoMapping: undefined, mspoRows: undefined, mspoFyCount: undefined, mspoDaysPerMonth: undefined };
        const next = { ...t.mspoMapping };
        delete next[a.key];
        return { ...t, mspoMapping: next };
      });
    case 'upload-template': {
      const old = a.replaceId ? state.templates.find((x) => x.id === a.replaceId) : undefined;
      if (!old) return { ...state, templates: [a.tpl, ...state.templates] };
      // replacing keeps the record (and its usage) and archives the old version
      const next: TemplateDoc = {
        ...old,
        ...a.tpl,
        id: old.id,
        usedBy: old.usedBy,
        history: [{ version: old.version, updated: old.updated, uploadedBy: old.uploadedBy }, ...(old.history ?? [])],
      };
      return { ...state, templates: state.templates.map((x) => (x.id === old.id ? next : x)) };
    }
    case 'upload-boilerplate': {
      const old = a.replaceId ? state.boilerplate.find((x) => x.id === a.replaceId) : undefined;
      if (!old) return withTags({ ...state, boilerplate: [a.item, ...state.boilerplate] }, a.item.tags);
      const next: Boilerplate = {
        ...old,
        ...a.item,
        id: old.id,
        history: [{ version: old.version, updated: old.updated, uploadedBy: old.uploadedBy }, ...(old.history ?? [])],
      };
      return withTags({ ...state, boilerplate: state.boilerplate.map((x) => (x.id === old.id ? next : x)) }, a.item.tags);
    }
    case 'add-template':
      return { ...state, templates: [a.tpl, ...state.templates] };
    case 'update-template':
      return { ...state, templates: state.templates.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'delete-template':
      return { ...state, templates: state.templates.filter((x) => x.id !== a.id) };
    case 'add-boilerplate':
      return withTags({ ...state, boilerplate: [a.item, ...state.boilerplate] }, a.item.tags);
    case 'update-boilerplate':
      return withTags({ ...state, boilerplate: state.boilerplate.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) }, a.patch.tags);
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

// ---- Audit log ----------------------------------------------------------------
// Every dispatched action is described here, in one place, so nothing a user
// does can bypass the log. Navigation-only actions return null.

const SYSTEM_ACTOR = { name: 'TendrAI (system)', role: 'Automated' };
let auditSeq = 0;

type Described = Omit<AuditEntry, 'id' | 'ts' | 'user' | 'role'> & { system?: boolean };

/** "product:Category" -> "product plan: Category" */
const mapKeyLabel = (key: string) => {
  const [group, target] = key.split(/:(.*)/);
  return `${group === 'figures' ? 'Business case figures' : `${group} plan`}: ${target}`;
};

function describe(prev: AppState, a: Action, next: AppState): Described | null {
  const tenderOf = (id?: string) => (id ? prev.tenders.find((t) => t.id === id) ?? next.tenders.find((t) => t.id === id) : undefined);
  const refOf = (id?: string) => {
    const t = tenderOf(id);
    return t ? (t.ref || t.name) : undefined;
  };
  const docName = (tid: string, did: string) => tenderOf(tid)?.pack.find((d) => d.id === did)?.name ?? 'document';
  switch (a.type) {
    case 'open-audit':
    case 'clear-audit-prefill':
    case 'go-to':
    case 'back-to-tender':
    case 'clear-return':
    case 'clear-pack-tab-request':
      return null;
    case 'log':
      return { action: a.event.action, detail: a.event.detail, tender: refOf(a.event.tenderId), section: a.event.section };
    case 'login':
      return { action: 'Signed in', detail: a.user.email };
    case 'upsert-rule': {
      const old = prev.rules.find((r) => r.id === a.rule.id);
      if (old && old.enabled !== a.rule.enabled && JSON.stringify({ ...old, enabled: a.rule.enabled }) === JSON.stringify(a.rule)) {
        return { action: a.rule.enabled ? 'Rule enabled' : 'Rule disabled', detail: a.rule.name, section: 'Business case management' };
      }
      return { action: old ? 'Rule edited' : 'Rule added', detail: `${a.rule.name} (${a.rule.severity})`, section: 'Business case management' };
    }
    case 'delete-rule':
      return { action: 'Rule deleted', detail: prev.rules.find((r) => r.id === a.id)?.name ?? '', section: 'Business case management' };
    case 'set-mspo-defaults':
      return { action: 'MSPO default mapping changed', detail: a.plan === 'figures' ? 'Business case figures' : `${a.plan} plan`, section: 'Business case management' };
    case 'set-mspo-rows':
      return { action: 'MSPO row count changed', detail: `${a.plan} plan: ${a.rows ?? 'default'} rows`, tender: refOf(a.tenderId), section: 'MSPO templates' };
    case 'set-mspo-details':
      return { action: 'MSPO details saved', detail: a.changes.join('; '), tender: refOf(a.tenderId), section: 'MSPO templates' };
    case 'set-mspo-meta':
      return a.quoteLine !== undefined
        ? { action: 'MSPO quote line set', detail: a.quoteLine || '(cleared)', tender: refOf(a.tenderId), section: 'MSPO templates' }
        : 'daysPerMonth' in a
          ? { action: 'MSPO man-days per month changed', detail: `${a.daysPerMonth ?? 'default'} man-days per month`, tender: refOf(a.tenderId), section: 'MSPO templates' }
          : { action: 'MSPO fiscal years changed', detail: `${a.fyCount ?? 'default'} fiscal year(s)`, tender: refOf(a.tenderId), section: 'MSPO templates' };
    case 'reset-mspo-mapping':
      return { action: 'MSPO mapping reset to default', detail: a.key ? mapKeyLabel(a.key) : 'All plans', tender: refOf(a.tenderId), section: 'MSPO templates' };
    case 'logout':
      return { action: 'Signed out', detail: prev.user?.email ?? '' };
    case 'create-tender':
      return { action: 'Tender created', detail: `${a.tender.name} (${a.tender.type}, ${a.tender.agency})`, tender: a.tender.ref || a.tender.name, section: 'Tenders' };
    case 'update-tender': {
      const t = tenderOf(a.tenderId);
      const changes = Object.entries(a.patch)
        .filter(([k, v]) => t && (t as unknown as Record<string, unknown>)[k] !== v && !(v === undefined && !(t as unknown as Record<string, unknown>)[k]))
        .map(([k, v]) => `${k}: ${String((t as unknown as Record<string, unknown>)[k] ?? '-') || '-'} -> ${String(v ?? '-') || '-'}`);
      return changes.length ? { action: 'Tender details edited', detail: changes.join('; '), tender: refOf(a.tenderId), section: 'Tenders' } : null;
    }
    case 'delete-tender':
      return { action: 'Tender deleted', detail: tenderOf(a.tenderId)?.name ?? '', tender: refOf(a.tenderId), section: 'Tenders' };
    case 'set-tender-status': {
      const t = tenderOf(a.tenderId);
      return { action: 'Status changed', detail: `${t?.statusReason ?? '-'} -> ${a.statusReason}`, tender: refOf(a.tenderId), section: 'Tenders' };
    }
    case 'add-pack-docs':
      return { action: 'Document uploaded', detail: a.docs.map((d) => d.name).join(', '), tender: refOf(a.tenderId), section: 'Documents' };
    case 'remove-pack-doc':
      return { action: 'Document deleted', detail: docName(a.tenderId, a.docId), tender: refOf(a.tenderId), section: 'Documents' };
    case 'move-pack-doc':
      return { action: 'Document reordered', detail: `${docName(a.tenderId, a.docId)} moved ${a.direction}`, tender: refOf(a.tenderId), section: 'Documents' };
    case 'correct-doc-role':
      return { action: 'Document role changed', detail: `${docName(a.tenderId, a.docId)} -> ${a.role}`, tender: refOf(a.tenderId), section: 'Documents' };
    case 'start-processing': {
      const t = tenderOf(a.tenderId);
      return { action: t?.lastProcessedAt ? 'Reprocessing started' : 'Processing started', detail: `${t?.pack.length ?? 0} documents, ${PROCESS_STAGES.length} stages`, tender: refOf(a.tenderId), section: 'Documents' };
    }
    case 'finish-processing': {
      const t = next.tenders.find((x) => x.id === a.tenderId);
      if (!tenderOf(a.tenderId)?.job) return null;
      return { system: true, action: 'Processing completed', detail: `${t?.clauses.length ?? 0} clauses, ${t?.checklist.length ?? 0} submission documents, ${t?.quals.length ?? 0} qualification requirements`, tender: refOf(a.tenderId), section: 'Documents' };
    }
    case 'retry-doc':
      return { action: 'Document retried', detail: docName(a.tenderId, a.docId), tender: refOf(a.tenderId), section: 'Documents' };
    case 'template-search-done':
      return { action: 'Templates matched', detail: `${a.search.matches.length} suitable template(s) found`, tender: refOf(a.tenderId), section: 'Submission' };
    case 'patch-checklist': {
      const k = tenderOf(a.tenderId)?.checklist.find((x) => x.id === a.itemId);
      if (!k) return null;
      if ('draft' in a.patch && a.patch.draft && !k.draft) {
        return { action: 'First draft generated', detail: k.item, tender: refOf(a.tenderId), section: 'Submission' };
      }
      if ('templateId' in a.patch && a.patch.templateId !== k.templateId) {
        const name = prev.templates.find((x) => x.id === a.patch.templateId)?.name ?? 'None';
        return { action: 'Template selected', detail: `${k.item} -> ${name}${'draft' in a.patch && !a.patch.draft && k.draft ? ' (draft discarded)' : ''}`, tender: refOf(a.tenderId), section: 'Submission' };
      }
      return null;
    }
    case 'patch-qual': {
      const q = tenderOf(a.tenderId)?.quals.find((x) => x.id === a.qualId);
      if (!q || !('evidence' in a.patch) || a.patch.evidence === q.evidence) return null;
      const cert = prev.boilerplate.find((b) => b.id === a.patch.evidence);
      return { action: 'Certificate linked', detail: `${q.requirement} -> ${cert ? `${cert.name} v${cert.version}` : 'None'}`, tender: refOf(a.tenderId), section: 'Qualification' };
    }
    case 'patch-clause':
    case 'save-clauses': {
      const patches = a.type === 'patch-clause' ? [{ clauseId: a.clauseId, patch: a.patch }] : a.patches;
      const lines = patches.flatMap(({ clauseId, patch }) => {
        const c = tenderOf(a.tenderId)?.clauses.find((x) => x.id === clauseId);
        if (!c) return [];
        const parts: string[] = [];
        if (patch.compliance !== undefined && patch.compliance !== c.compliance) parts.push(`compliance ${c.compliance} -> ${patch.compliance}`);
        if (patch.category !== undefined && patch.category !== c.category) parts.push(`category ${c.category} -> ${patch.category}`);
        if (patch.response !== undefined && patch.response !== c.response) parts.push(`remark "${patch.response}"`);
        return parts.length ? [`Clause ${c.number}: ${parts.join(', ')}`] : [];
      });
      if (!lines.length) return null;
      return {
        action: lines.length > 1 ? 'Clauses updated' : 'Clause updated',
        detail: lines.length > 1 ? `${lines.length} clauses - ${lines.join('; ')}` : lines[0],
        tender: refOf(a.tenderId),
        section: 'Clauses',
      };
    }
    case 'upload-bc':
      return { action: 'Business case uploaded', detail: `v${a.version.v} - ${a.version.fileName}${a.version.layoutUnrecognised ? ' (layout not recognised)' : ''}`, tender: refOf(a.tenderId), section: 'Business case' };
    case 'delete-bc-version':
      return { action: 'Business case version deleted', detail: `v${a.v}`, tender: refOf(a.tenderId), section: 'Business case' };
    case 'set-mspo-mapping':
      return { action: 'MSPO mapping changed', detail: `${mapKeyLabel(a.key)} <- ${a.tab} ${a.from}${a.to ? `:${a.to}` : ''}`, tender: refOf(a.tenderId), section: 'MSPO templates' };
    case 'upload-template':
      return { action: a.replaceId ? 'Template replaced' : 'Template uploaded', detail: `${a.tpl.name} v${a.tpl.version} (${a.tpl.agency}, ${a.tpl.type})`, section: 'Templates' };
    case 'upload-boilerplate': {
      const kind = a.item.type === 'Certification' ? 'Certification' : 'Boilerplate';
      return { action: `${kind} ${a.replaceId ? 'replaced' : 'uploaded'}`, detail: `${a.item.name} v${a.item.version}${tagNote(prev, a.item.tags)}`, section: 'Templates' };
    }
    case 'update-template':
      return { action: 'Template edited', detail: prev.templates.find((x) => x.id === a.id)?.name ?? '', section: 'Templates' };
    case 'delete-template':
      return { action: 'Template deleted', detail: prev.templates.find((x) => x.id === a.id)?.name ?? '', section: 'Templates' };
    case 'update-boilerplate':
      return { action: 'Boilerplate edited', detail: `${prev.boilerplate.find((x) => x.id === a.id)?.name ?? ''}${tagNote(prev, a.patch.tags)}`, section: 'Templates' };
    case 'delete-boilerplate':
      return { action: 'Boilerplate deleted', detail: prev.boilerplate.find((x) => x.id === a.id)?.name ?? '', section: 'Templates' };
    case 'archive-repo':
      return { action: 'Record archived', detail: `${prev.repository.find((r) => r.id === a.id)?.name ?? ''} - compressed ${a.sizeFrom} to ${a.sizeTo}`, section: 'Historical data' };
    case 'request-restore':
      return { action: 'Restore requested', detail: prev.repository.find((r) => r.id === a.id)?.name ?? '', section: 'Historical data' };
    case 'complete-restore':
      return { system: true, action: 'Restore completed', detail: `${prev.repository.find((r) => r.id === a.id)?.name ?? ''} - files available`, section: 'Historical data' };
    default:
      return null; // navigation and intermediate job states are not user actions
  }
}

function auditedReducer(state: AppState, a: Action): AppState {
  const next = reducer(state, a);
  const d = describe(state, a, next);
  if (!d) return next;
  const actor = d.system
    ? SYSTEM_ACTOR
    : { name: (a.type === 'login' ? a.user : state.user)?.name ?? 'Unknown', role: (a.type === 'login' ? a.user : state.user)?.roleLabel ?? '-' };
  const { system: _system, ...rest } = d;
  void _system;
  const entry: AuditEntry = { id: `a-${Date.now()}-${++auditSeq}`, ts: new Date().toISOString(), user: actor.name, role: actor.role, ...rest };
  return { ...next, audit: [...next.audit, entry] };
}

const initial: AppState = {
  user: null, // sign in via the login screen
  role: 'bd',
  activeTenderId: null,
  tenders: TENDERS,
  templates: TEMPLATES,
  boilerplate: BOILERPLATE,
  boilerplateTags: BOILERPLATE_TAGS,
  repository: REPOSITORY,
  backup: BACKUP,
  audit: AUDIT,
  rules: DEFAULT_RULES,
  mspoDefaults: DEFAULT_MSPO_MAPPING,
};

const Ctx = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(auditedReducer, initial);
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
