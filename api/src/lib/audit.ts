// Audit log writer. Every mutating route records exactly one entry; system
// actions (job results, restores) use the system actor.
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import type { AuthUser } from '../auth/rbac.js';

export const SYSTEM_ACTOR = { name: 'TendrAI (system)', roleLabel: 'Automated' };

export interface AuditInput {
  action: string;
  detail: string;
  tenderId?: string | null;
  /** GeBIZ ref or title; looked up from tenderId when omitted */
  tenderRef?: string | null;
  section?: string | null;
}

export async function audit(q: Queryable, actor: AuthUser | typeof SYSTEM_ACTOR, input: AuditInput, req?: FastifyRequest) {
  let tenderRef = input.tenderRef ?? null;
  if (!tenderRef && input.tenderId) {
    const r = await q.query<{ ref: string; name: string }>('SELECT ref, name FROM tenders WHERE id = $1', [input.tenderId]);
    if (r.rows[0]) tenderRef = r.rows[0].ref || r.rows[0].name;
  }
  await q.query(
    `INSERT INTO audit_entries (user_id, user_name, role_label, action, detail, tender_id, tender_ref, section, request_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      'id' in actor ? actor.id : null,
      actor.name,
      actor.roleLabel,
      input.action,
      input.detail,
      input.tenderId ?? null,
      tenderRef,
      input.section ?? null,
      req?.id ?? null,
      req?.ip ?? null,
    ],
  );
}
