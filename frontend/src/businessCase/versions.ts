// Business case versions. Version numbers only go up when the DRB approves:
//  - v1 is TendrAI's draft from the tender pack
//  - the BD team's saves update the latest (working) version; each save is
//    kept in its `edits`, and saving voids any DRB approvals already given
//  - when every DRB member has approved the latest version it is archived
//    (read-only for good) and an identical working copy becomes the next version
// So every version except the latest is approved. Each version keeps the full
// business case and the data derived from it, so checks and MSPO always read
// what was saved.

import type { BcVersion, RepoRecord, Tender } from '../types';
import { DRB_APPROVERS } from '../config';
import type { BusinessCaseState } from './model';
import { generateBusinessCase, type DraftSource } from './generate';
import { versionData } from './workbook';

export const AI_AUTHOR = 'TendrAI (system)';

export const latestVersion = (t: Pick<Tender, 'bcVersions'>): BcVersion | undefined =>
  t.bcVersions[t.bcVersions.length - 1];

/** The first draft produced by the processing job. */
export function aiDraftVersion(t: Parameters<typeof generateBusinessCase>[0], savedAt: string, opts: Parameters<typeof generateBusinessCase>[1] = {}): BcVersion {
  const bc = generateBusinessCase(t, opts);
  return {
    v: 1,
    origin: 'ai-draft',
    createdAt: savedAt,
    savedBy: AI_AUTHOR,
    savedAt,
    comment: 'First draft generated from the tender pack',
    edits: [],
    bc,
    data: versionData(bc),
  };
}

/** Why the working version cannot be edited, or null when it can. */
export function editBlocked(t: Pick<Tender, 'bcVersions'>, v: BcVersion): string | null {
  if (v.approvedAt) return `v${v.v} is approved and archived`;
  if (latestVersion(t)?.v !== v.v) return 'only the latest version can be edited';
  return null;
}

/** A person's saved edits, applied to the latest (working) version. Approvals
 *  already given are voided: they approved the figures before this save. */
export function withSavedEdits(
  versions: BcVersion[],
  bc: BusinessCaseState,
  by: string,
  at: string,
  summary: string,
  comment?: string,
): BcVersion[] {
  const latest = versions[versions.length - 1];
  if (!latest || latest.approvedAt) return versions;
  const voided = latest.approvals?.length ?? 0;
  const saved: BcVersion = {
    ...latest,
    bc,
    data: versionData(bc),
    savedBy: by,
    savedAt: at,
    approvals: [],
    edits: [...(latest.edits ?? []), { by, at, summary, comment: comment?.trim() || undefined, voidedApprovals: voided || undefined }],
  };
  return [...versions.slice(0, -1), saved];
}

/** Who still has to approve a version. */
export const pendingApprovers = (v: BcVersion) =>
  DRB_APPROVERS.filter((u) => !(v.approvals ?? []).some((a) => a.by === u.name));

/** Why the version cannot collect approvals, or null when it can: only the
 *  latest version, not yet approved, and not an unchanged copy of an approved one. */
export function approvalBlocked(t: Pick<Tender, 'bcVersions'>, v: BcVersion): string | null {
  if (v.approvedAt) return 'this version is already approved';
  if (latestVersion(t)?.v !== v.v) return 'only the latest version can be approved';
  if (v.origin === 'approved-copy' && !v.edits?.length) return `no changes since approved v${v.copyOf}`;
  return null;
}

/** Records one DRB approval on a version. When it is the last one, the
 *  version is archived (approvedAt) and an identical working copy is added as
 *  the next version, so edits continue without touching the approved one. */
export function withApproval(versions: BcVersion[], v: number, approver: { name: string; roleLabel: string }, at: string): BcVersion[] {
  const target = versions.find((x) => x.v === v);
  if (!target || target.approvedAt || (target.approvals ?? []).some((a) => a.by === approver.name)) return versions;
  const approved: BcVersion = { ...target, approvals: [...(target.approvals ?? []), { by: approver.name, role: approver.roleLabel, at }] };
  const complete = pendingApprovers(approved).length === 0;
  const updated = versions.map((x) => (x.v === v ? (complete ? { ...approved, approvedAt: at } : approved) : x));
  if (!complete) return updated;
  const copy: BcVersion = {
    v: (versions[versions.length - 1]?.v ?? 0) + 1,
    origin: 'approved-copy',
    copyOf: v,
    createdAt: at,
    savedBy: AI_AUTHOR,
    savedAt: at,
    comment: `Working copy of approved v${v}`,
    edits: [],
    bc: target.bc,
    data: target.data,
  };
  return [...updated, copy];
}

// ---- Feedback loop: outcomes feed the next AI drafts ------------------------------

/** The past business cases the AI drafts from, best first: won cases
 *  (preferred), then lost ones (standard). Excluded and open cases are never used. */
export function aiSources(repository: RepoRecord[], forTenderId?: string): DraftSource[] {
  return repository
    // a tender never cites its own filed business case
    .filter((r) => r.kind === 'Business case' && (!forTenderId || r.tenderId !== forTenderId) && (r.aiSource === 'preferred' || r.aiSource === 'standard'))
    .sort((a, b) => (a.aiSource === b.aiSource ? b.updated.localeCompare(a.updated) : a.aiSource === 'preferred' ? -1 : 1))
    .map((r) => ({
      docId: r.refId ?? r.id,
      title: `Business case - ${r.name} (${r.status}, ${r.updated.slice(0, 4)})`,
      use: r.aiSource === 'preferred' ? 'preferred' : 'standard',
    }));
}

/** When a tender's outcome is recorded (Won or Lost), its last approved
 *  business case is filed in Historical data as an AI source: a won case is
 *  preferred, a lost one standard. A record already linked to the tender (an
 *  open business case record) is updated in place, keeping its id and citation
 *  id. Returns null when no version has been approved yet. */
export function outcomeRecord(t: Tender, outcome: 'Won' | 'Lost', repository: RepoRecord[], at: string): RepoRecord | null {
  const approved = [...t.bcVersions].reverse().find((v) => v.approvedAt);
  if (!approved) return null;
  const day = at.slice(0, 10);
  const existing = repository.find((r) => r.tenderId === t.id && r.kind === 'Business case');
  const file = `Business_case_${(t.ref || t.id).replace(/\W+/g, '_')}_v${approved.v}.xlsx`;
  if (existing) {
    return {
      ...existing,
      status: outcome,
      statusReason: outcome === 'Won' ? 'Won (Won)' : 'Lost (Closed)',
      updated: day,
      documents: existing.documents.includes(file) ? existing.documents : [...existing.documents, file],
      versions: t.bcVersions.filter((v) => v.approvedAt).map((v) => ({ v: v.v, date: v.approvedAt!.slice(0, 10), by: 'DRB', note: 'Approved by the DRB' })),
      aiSource: outcome === 'Won' ? 'preferred' : 'standard',
      lessons: t.lessons?.text ?? existing.lessons,
    };
  }
  return {
    id: `rr-${t.id}`,
    name: `${t.name} business case`,
    agency: t.agency,
    kind: 'Business case',
    type: t.type,
    status: outcome,
    statusReason: outcome === 'Won' ? 'Won (Won)' : 'Lost (Closed)',
    owner: t.owner,
    created: t.createdAt,
    updated: day,
    documents: [file],
    versions: t.bcVersions.filter((v) => v.approvedAt).map((v) => ({ v: v.v, date: v.approvedAt!.slice(0, 10), by: 'DRB', note: 'Approved by the DRB' })),
    aiSource: outcome === 'Won' ? 'preferred' : 'standard',
    refId: `BC-${(t.ref || t.id).replace(/[^A-Za-z0-9]+/g, '-')}`,
    tenderId: t.id,
    lessons: t.lessons?.text,
  };
}
