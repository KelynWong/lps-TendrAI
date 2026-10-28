// Clauses and the compliance table: read, batch save (shared with the
// WebSocket room), change history and exports.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { canDo } from '../auth/rbac.js';
import type { AuthUser } from '../auth/rbac.js';
import type { AppContext } from '../context.js';
import { many, one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { forbidden, locked, notFound } from '../lib/errors.js';
import { CLAUSE_SQL, mapClause, refOf, tenderRow } from '../lib/tenderDto.js';
import { parse, TenderParams, uuid } from '../lib/validate.js';
import type { Clause } from '../types.js';

export const ClausePatch = z.object({
  compliance: z.enum(['Unset', 'Comply', 'Partially comply', 'Do not comply', 'Clarify']).optional(),
  category: z.enum(['Commercial', 'Technical', 'Legal', 'Finance', 'HR']).optional(),
  response: z.string().max(20_000).optional(),
});
export const ClausePatches = z.array(z.object({ clauseId: uuid, version: z.number().int().optional(), patch: ClausePatch })).min(1).max(500);
export type ClausePatchInput = z.infer<typeof ClausePatches>;

export interface SaveResult {
  clauses: Clause[];
  /** patches rejected because someone saved a newer version first */
  conflicts: { clauseId: string; current: Clause }[];
  auditLine?: string;
}

export async function loadClauses(ctx: AppContext, tenderId: string, ids?: string[]): Promise<Clause[]> {
  const rows = ids
    ? await many(ctx.pool, `${CLAUSE_SQL} WHERE c.tender_id = $1 AND c.id = ANY($2::uuid[]) ORDER BY c.sort_order, c.created_at`, [tenderId, ids])
    : await many(ctx.pool, `${CLAUSE_SQL} WHERE c.tender_id = $1 ORDER BY c.sort_order, c.created_at`, [tenderId]);
  return rows.map(mapClause);
}

/**
 * Applies several clause edits in one transaction and one audit entry.
 * Compliance and remark changes are appended to clause_changes; the clause
 * version increments so concurrent editors detect stale saves.
 */
export async function saveClausePatches(ctx: AppContext, user: AuthUser, tenderId: string, patches: ClausePatchInput, req?: FastifyRequest): Promise<SaveResult> {
  if (!canDo.editClauses(user.role)) throw forbidden('Your role views clauses only');
  const changedIds: string[] = [];
  const conflicts: SaveResult['conflicts'] = [];
  const lines: string[] = [];
  await withTx(ctx.pool, async (c) => {
    const t = await tenderRow(c, tenderId);
    if (t.status === 'Won' || t.status === 'Closed' || t.archived_at) throw locked('This tender is closed - clauses are read-only');
    for (const { clauseId, version, patch } of patches) {
      const cur = await one<{ id: string; number: string; compliance: string; category: string; response: string; version: number }>(
        c, 'SELECT id, number, compliance, category, response, version FROM clauses WHERE id = $1 AND tender_id = $2 FOR UPDATE', [clauseId, tenderId]);
      if (!cur) throw notFound('Clause');
      if (version !== undefined && version !== cur.version) {
        const fresh = await one(c, `${CLAUSE_SQL} WHERE c.id = $1`, [clauseId]);
        conflicts.push({ clauseId, current: mapClause(fresh!) });
        continue;
      }
      if (patch.compliance !== undefined && patch.compliance !== 'Unset' && !canDo.editCompliance(user.role) && patch.compliance !== cur.compliance) {
        throw forbidden('Only the BD team and Bidding Manager set compliance');
      }
      const parts: string[] = [];
      if (patch.compliance !== undefined && patch.compliance !== cur.compliance) {
        parts.push(`compliance ${cur.compliance} -> ${patch.compliance}`);
        await c.query('INSERT INTO clause_changes (clause_id, tender_id, by_user_id, by_name, field, from_value, to_value) VALUES ($1, $2, $3, $4, $5, $6, $7)', [clauseId, tenderId, user.id, user.name, 'Compliance', cur.compliance, patch.compliance]);
      }
      if (patch.category !== undefined && patch.category !== cur.category) {
        parts.push(`category ${cur.category} -> ${patch.category}`);
        await c.query('INSERT INTO clause_changes (clause_id, tender_id, by_user_id, by_name, field, from_value, to_value) VALUES ($1, $2, $3, $4, $5, $6, $7)', [clauseId, tenderId, user.id, user.name, 'Category', cur.category, patch.category]);
      }
      if (patch.response !== undefined && patch.response !== cur.response) {
        parts.push(`remark "${patch.response}"`);
        await c.query('INSERT INTO clause_changes (clause_id, tender_id, by_user_id, by_name, field, from_value, to_value) VALUES ($1, $2, $3, $4, $5, $6, $7)', [clauseId, tenderId, user.id, user.name, 'Remark', cur.response, patch.response]);
      }
      if (!parts.length) continue;
      await c.query(
        `UPDATE clauses SET compliance = COALESCE($3::compliance_status, compliance), category = COALESCE($4::clause_category, category), response = COALESCE($5, response),
           reviewed_by = $6, reviewed_at = now(), review_state = 'reviewed', version = version + 1, updated_by = $6
         WHERE id = $1 AND tender_id = $2`,
        [clauseId, tenderId, patch.compliance ?? null, patch.category ?? null, patch.response ?? null, user.id]);
      changedIds.push(clauseId);
      lines.push(`Clause ${cur.number}: ${parts.join(', ')}`);
    }
    if (lines.length) {
      await audit(c, user, {
        action: lines.length > 1 ? 'Clauses updated' : 'Clause updated',
        detail: lines.length > 1 ? `${lines.length} clauses - ${lines.join('; ')}` : lines[0],
        tenderId, tenderRef: refOf(t), section: 'Clauses',
      }, req);
    }
  });
  const clauses = changedIds.length ? await loadClauses(ctx, tenderId, changedIds) : [];
  if (changedIds.length) {
    // ids only: bodies are fetched by each instance (NOTIFY payload limit)
    await ctx.bus.publish({ tenderId, type: 'clauses-updated', ids: changedIds, by: user.name, byId: user.id });
  }
  return { clauses, conflicts, auditLine: lines.length ? lines.join('; ') : undefined };
}

export async function clauseRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { pool } = ctx;

  app.get('/api/tenders/:id/clauses', async (req) => {
    const { id } = parse(TenderParams, req.params);
    await tenderRow(pool, id);
    return loadClauses(ctx, id);
  });

  /** Batch save - same semantics as the WebSocket `save` message. 409 lists conflicts. */
  app.put('/api/tenders/:id/clauses', async (req, reply) => {
    const { id } = parse(TenderParams, req.params);
    const { patches } = parse(z.object({ patches: ClausePatches }), req.body);
    const result = await saveClausePatches(ctx, req.user, id, patches, req);
    return reply.status(result.conflicts.length ? 409 : 200).send(result);
  });

  app.get('/api/tenders/:id/clauses/:clauseId/history', async (req) => {
    const { id, clauseId } = parse(z.object({ id: uuid, clauseId: uuid }), req.params);
    const rows = await many<{ ts: Date; by_name: string; field: string; from_value: string; to_value: string }>(pool, 'SELECT ts, by_name, field, from_value, to_value FROM clause_changes WHERE clause_id = $1 AND tender_id = $2 ORDER BY ts, id', [clauseId, id]);
    return rows.map((h) => ({ ts: h.ts.toISOString(), by: h.by_name, field: h.field, from: h.from_value, to: h.to_value }));
  });

  /** Compliance table export (Excel or Word-compatible HTML). */
  app.get('/api/tenders/:id/clauses/export', async (req, reply) => {
    const { id } = parse(TenderParams, req.params);
    const { format } = parse(z.object({ format: z.enum(['xlsx', 'doc']).default('xlsx') }), req.query);
    const t = await tenderRow(pool, id);
    const clauses = await loadClauses(ctx, id);
    const stem = `${(t.ref || t.name).replace(/\W+/g, '_')}_compliance_table`;
    await audit(pool, req.user, { action: 'Clauses exported', detail: `${format === 'xlsx' ? 'Excel' : 'Word'}, ${clauses.length} clauses`, tenderId: id, tenderRef: refOf(t), section: 'Clauses' }, req);
    if (format === 'xlsx') {
      const rows = [['Clause', 'Requirement', 'Category', 'Source document', 'Page', 'Compliance', 'Response', 'Reviewed by'],
        ...clauses.map((c) => [c.number, c.text, c.category, c.sourceDoc, c.page, c.compliance, c.response, c.reviewedBy ?? ''])];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Compliance table');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${stem}.xlsx"`).send(buf);
    }
    const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
    const html = `<html><head><meta charset="utf-8"><title>${esc(t.name)}</title></head><body><h1>${esc(t.name)}</h1><p>${esc(t.ref || '')}</p>
<table border="1" cellspacing="0" cellpadding="4"><tr><th>Clause</th><th>Requirement</th><th>Category</th><th>Compliance</th><th>Response</th></tr>
${clauses.map((c) => `<tr><td>${esc(c.number)}</td><td>${esc(c.text)}</td><td>${esc(c.category)}</td><td>${esc(c.compliance)}</td><td>${esc(c.response)}</td></tr>`).join('\n')}
</table></body></html>`;
    return reply.header('content-type', 'application/msword').header('content-disposition', `attachment; filename="${stem}.doc"`).send(html);
  });
}
