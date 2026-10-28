// Tenders: list, create, read, edit, delete, status, workflow step, DRB outcome.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan, assertNotReadOnly } from '../auth/rbac.js';
import { withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { assertUnlocked, loadTender, loadTenderList, refOf, tenderRow } from '../lib/tenderDto.js';
import { isoDate, nonEmpty, parse, TenderParams } from '../lib/validate.js';

const STATUS_REASONS = {
  Draft: ['In Progress (Draft)', 'Pending (Draft)', 'In Approval (Draft)', 'Approved (Draft)', 'Rejected (Draft)'],
  Active: ['In Progress (Active)'],
  Won: ['Won (Won)'],
  Closed: ['Revised (Closed)', 'Lost (Closed)'],
} as const;

const TenderBody = z.object({
  sfdcCrmId: z.string().trim().optional(),
  ref: z.string().trim().default(''),
  name: nonEmpty,
  agency: nonEmpty,
  type: z.enum(['Agency', 'Commercial']),
  projectType: z.enum(['Milestone Based', 'Time Based', 'Usage Based']).optional(),
  closingDate: isoDate.optional().or(z.literal('')),
});

export async function tenderRoutes(app: FastifyInstance) {
  const { pool, bus } = app.ctx;

  app.get('/api/tenders', async () => loadTenderList(pool));

  app.get('/api/tenders/:id', async (req) => {
    const { id } = parse(TenderParams, req.params);
    const t = await loadTender(pool, id);
    if (!t) throw notFound('Tender');
    return t;
  });

  app.post('/api/tenders', async (req, reply) => {
    assertCan(req, 'manageTenders');
    const b = parse(TenderBody, req.body);
    const id = await withTx(pool, async (c) => {
      const dup = await c.query('SELECT id FROM tenders WHERE deleted_at IS NULL AND lower(regexp_replace(btrim(name), \'\\s+\', \' \', \'g\')) = lower(regexp_replace(btrim($1), \'\\s+\', \' \', \'g\'))', [b.name]);
      if (dup.rows[0]) throw conflict('A tender with this title already exists', { tenderId: dup.rows[0].id });
      const r = await c.query<{ id: string }>(
        `INSERT INTO tenders (sfdc_crm_id, ref, name, agency, type, project_type, owner_id, closing_date, created_by)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Milestone Based'), $7, $8, $7) RETURNING id`,
        [b.sfdcCrmId || null, b.ref, b.name, b.agency, b.type, b.projectType ?? null, req.user.id, b.closingDate || null],
      );
      await audit(c, req.user, { action: 'Tender created', detail: `${b.name} (${b.type}, ${b.agency})`, tenderId: r.rows[0].id, tenderRef: b.ref || b.name, section: 'Tenders' }, req);
      return r.rows[0].id;
    });
    return reply.status(201).send(await loadTender(pool, id));
  });

  app.patch('/api/tenders/:id', async (req) => {
    assertCan(req, 'manageTenders');
    const { id } = parse(TenderParams, req.params);
    const b = parse(TenderBody.partial(), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const current: Record<string, unknown> = { sfdcCrmId: t.sfdc_crm_id ?? undefined, ref: t.ref, name: t.name, agency: t.agency, type: t.type, closingDate: t.closing_date ?? '' };
      const changes = Object.entries(b)
        .filter(([k, v]) => v !== undefined && (current[k] ?? '') !== (v ?? ''))
        .map(([k, v]) => `${k}: ${String(current[k] ?? '-') || '-'} -> ${String(v ?? '-') || '-'}`);
      if (!changes.length) return;
      await c.query(
        `UPDATE tenders SET
           sfdc_crm_id  = CASE WHEN $2::boolean THEN NULLIF($3, '') ELSE sfdc_crm_id END,
           ref          = COALESCE($4, ref),
           name         = COALESCE($5, name),
           agency       = COALESCE($6, agency),
           type         = COALESCE($7::tender_type, type),
           project_type = COALESCE($8::project_type, project_type),
           closing_date = CASE WHEN $9::boolean THEN NULLIF($10, '')::date ELSE closing_date END
         WHERE id = $1`,
        [id, b.sfdcCrmId !== undefined, b.sfdcCrmId ?? null, b.ref ?? null, b.name ?? null, b.agency ?? null, b.type ?? null, b.projectType ?? null, b.closingDate !== undefined, b.closingDate ?? null],
      );
      await audit(c, req.user, { action: 'Tender details edited', detail: changes.join('; '), tenderId: id, tenderRef: refOf(t), section: 'Tenders' }, req);
    });
    await bus.publish({ tenderId: id, type: 'tender-updated', by: req.user.name });
    return loadTender(pool, id);
  });

  app.delete('/api/tenders/:id', async (req, reply) => {
    assertCan(req, 'manageTenders');
    const { id } = parse(TenderParams, req.params);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      await c.query('UPDATE tenders SET deleted_at = now() WHERE id = $1', [id]);
      await c.query('UPDATE tender_documents SET deleted_at = now(), deleted_by = $2 WHERE tender_id = $1 AND deleted_at IS NULL', [id, req.user.id]);
      await c.query(`UPDATE processing_jobs SET status = 'cancelled', finished_at = now() WHERE tender_id = $1 AND status IN ('queued','running')`, [id]);
      await audit(c, req.user, { action: 'Tender deleted', detail: t.name, tenderId: id, tenderRef: refOf(t), section: 'Tenders' }, req);
    });
    await bus.publish({ tenderId: id, type: 'tender-deleted', by: req.user.name });
    return reply.status(204).send();
  });

  app.put('/api/tenders/:id/status', async (req) => {
    assertNotReadOnly(req);
    if (!['bd', 'bidding-manager', 'admin'].includes(req.user.role)) assertCan(req, 'manageTenders');
    const { id } = parse(TenderParams, req.params);
    const b = parse(z.object({ status: z.enum(['Draft', 'Active', 'Won', 'Closed']), statusReason: z.string() }), req.body);
    if (!(STATUS_REASONS[b.status] as readonly string[]).includes(b.statusReason)) throw conflict(`"${b.statusReason}" is not a reason for status ${b.status}`);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      await c.query(
        `UPDATE tenders SET status = $2, status_reason = $3,
           drb_outcome = CASE WHEN $3 = 'Won (Won)' THEN 'Won'::drb_outcome WHEN $3 = 'Lost (Closed)' THEN 'Lost'::drb_outcome ELSE drb_outcome END,
           workflow_step = CASE WHEN $2 IN ('Won','Closed') THEN 5 ELSE workflow_step END
         WHERE id = $1`,
        [id, b.status, b.statusReason],
      );
      await audit(c, req.user, { action: 'Status changed', detail: `${t.status_reason} -> ${b.statusReason}`, tenderId: id, tenderRef: refOf(t), section: 'Tenders' }, req);
    });
    await bus.publish({ tenderId: id, type: 'tender-updated', by: req.user.name });
    return loadTender(pool, id);
  });

  app.put('/api/tenders/:id/step', async (req) => {
    assertNotReadOnly(req);
    const { id } = parse(TenderParams, req.params);
    const { idx } = parse(z.object({ idx: z.number().int().min(0).max(5) }), req.body);
    await tenderRow(pool, id);
    await pool.query('UPDATE tenders SET workflow_step = GREATEST(workflow_step, $2) WHERE id = $1', [id, idx]);
    return { ok: true };
  });

  app.put('/api/tenders/:id/drb', async (req) => {
    assertCan(req, 'recordOutcome');
    const { id } = parse(TenderParams, req.params);
    const b = parse(z.object({ outcome: z.enum(['Won', 'Lost', 'Awaiting result']).optional(), notes: z.string().optional() }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      await c.query(
        `UPDATE tenders SET
           drb_outcome   = COALESCE($2::drb_outcome, drb_outcome),
           drb_notes     = COALESCE($3, drb_notes),
           status        = CASE WHEN $2 = 'Won' THEN 'Won'::tender_status WHEN $2 = 'Lost' THEN 'Closed'::tender_status ELSE status END,
           status_reason = CASE WHEN $2 = 'Won' THEN 'Won (Won)'::tender_status_reason WHEN $2 = 'Lost' THEN 'Lost (Closed)'::tender_status_reason ELSE status_reason END,
           workflow_step = CASE WHEN $2 IN ('Won','Lost') THEN 5 ELSE GREATEST(workflow_step, 3) END
         WHERE id = $1`,
        [id, b.outcome ?? null, b.notes ?? null],
      );
      await audit(c, req.user, { action: 'DRB outcome recorded', detail: [b.outcome && `Outcome: ${b.outcome}`, b.notes !== undefined && 'notes updated'].filter(Boolean).join('; ') || 'No change', tenderId: id, tenderRef: refOf(t), section: 'DRB' }, req);
    });
    await bus.publish({ tenderId: id, type: 'tender-updated', by: req.user.name });
    return loadTender(pool, id);
  });
}
