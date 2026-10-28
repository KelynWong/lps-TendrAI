// Audit log: filtered, paged reads plus client-side events (downloads, exports)
// that have no server mutation of their own.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { parse, uuid } from '../lib/validate.js';
import type { AuditEntry } from '../types.js';

export async function auditRoutes(app: FastifyInstance) {
  const { pool } = app.ctx;

  app.get('/api/audit', async (req) => {
    const q = parse(z.object({
      from: z.string().optional(), to: z.string().optional(),
      tender: z.string().optional(), tenderId: uuid.optional(), section: z.string().optional(), action: z.string().optional(), user: z.string().optional(), search: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0),
    }), req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.from) add('ts >= ?::date', q.from);
    if (q.to) add('ts < (?::date + 1)', q.to);
    if (q.tender) add('tender_ref = ?', q.tender);
    if (q.tenderId) add('tender_id = ?', q.tenderId);
    if (q.section) add('section = ?', q.section);
    if (q.action) add('action = ?', q.action);
    if (q.user) add('user_name = ?', q.user);
    if (q.search) add('(detail ILIKE ? OR action ILIKE $' + (params.length + 1) + ')', `%${q.search}%`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM audit_entries ${w}`, params))!.n;
    const rows = await many<any>(pool, `SELECT * FROM audit_entries ${w} ORDER BY ts DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.limit, q.offset]);
    const entries: AuditEntry[] = rows.map((r) => ({ id: String(r.id), ts: r.ts.toISOString(), user: r.user_name, role: r.role_label, action: r.action, detail: r.detail, tender: r.tender_ref ?? undefined, tenderId: r.tender_id ?? undefined, section: r.section ?? undefined }));
    return { total, entries };
  });

  /** Distinct values for the column filters. */
  app.get('/api/audit/facets', async () => {
    const [users, sections, actions, tenders] = await Promise.all([
      many<{ v: string }>(pool, 'SELECT DISTINCT user_name AS v FROM audit_entries ORDER BY 1'),
      many<{ v: string }>(pool, 'SELECT DISTINCT section AS v FROM audit_entries WHERE section IS NOT NULL ORDER BY 1'),
      many<{ v: string }>(pool, 'SELECT DISTINCT action AS v FROM audit_entries ORDER BY 1'),
      many<{ v: string }>(pool, 'SELECT DISTINCT tender_ref AS v FROM audit_entries WHERE tender_ref IS NOT NULL ORDER BY 1'),
    ]);
    return { users: users.map((x) => x.v), sections: sections.map((x) => x.v), actions: actions.map((x) => x.v), tenders: tenders.map((x) => x.v) };
  });

  /** Record a client-side event, e.g. "Draft downloaded", "Certificate downloaded". */
  app.post('/api/audit/events', async (req, reply) => {
    const b = parse(z.object({ action: z.string().trim().min(1).max(80), detail: z.string().max(4000).default(''), tenderId: uuid.optional(), section: z.string().max(80).optional() }), req.body);
    await audit(pool, req.user, { action: b.action, detail: b.detail, tenderId: b.tenderId, section: b.section }, req);
    return reply.status(201).send({ ok: true });
  });
}
