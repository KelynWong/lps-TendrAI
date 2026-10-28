// MSPO template settings per tender: quote line, fiscal years, man-days per
// month, last rows per plan, field-mapping overrides and download logging.
// The workbook itself is generated in the browser (frontend mspo/mapping.ts) from
// the business case data this API serves; this records the settings and log.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan } from '../auth/rbac.js';
import { one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { assertUnlocked, loadTender, refOf, tenderRow } from '../lib/tenderDto.js';
import { parse, TenderParams } from '../lib/validate.js';

const Group = z.enum(['product', 'resource', 'billing', 'figures']);
const Plan = z.enum(['product', 'resource', 'billing']);
const cellRe = /^[A-Za-z]{1,2}[1-9]\d*$/;
const groupLabel = (g: string, target: string) => `${g === 'figures' ? 'Business case figures' : `${g} plan`}: ${target}`;

export async function mspoRoutes(app: FastifyInstance) {
  const { pool, bus } = app.ctx;
  const settingsOf = async (id: string) => {
    const t = (await loadTender(pool, id))!;
    return { mspoQuoteLine: t.mspoQuoteLine, mspoFyCount: t.mspoFyCount, mspoDaysPerMonth: t.mspoDaysPerMonth, mspoRows: t.mspoRows, mspoMapping: t.mspoMapping };
  };

  /** Save the per-business-case details in one go (one audit entry). */
  app.put('/api/tenders/:id/mspo/details', async (req) => {
    assertCan(req, 'downloadMspo', 'Only the BD team edits MSPO details');
    const { id } = parse(TenderParams, req.params);
    const b = parse(z.object({
      quoteLine: z.string().trim().optional(),
      fyCount: z.number().int().min(1).max(10).optional(),
      daysPerMonth: z.number().positive().max(31).optional(),
      rows: z.object({ product: z.number().int().positive().max(500).optional(), resource: z.number().int().positive().max(500).optional(), billing: z.number().int().positive().max(500).optional() }).optional(),
      /** human-readable change list from the UI ("Quote line: (empty) -> QL-1") */
      changes: z.array(z.string()).optional(),
    }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      await c.query(
        `UPDATE tenders SET
           mspo_quote_line     = CASE WHEN $2::boolean THEN NULLIF($3, '') ELSE mspo_quote_line END,
           mspo_fy_count       = COALESCE($4, mspo_fy_count),
           mspo_days_per_month = COALESCE($5, mspo_days_per_month),
           mspo_rows_product   = COALESCE($6, mspo_rows_product),
           mspo_rows_resource  = COALESCE($7, mspo_rows_resource),
           mspo_rows_billing   = COALESCE($8, mspo_rows_billing)
         WHERE id = $1`,
        [id, b.quoteLine !== undefined, b.quoteLine ?? null, b.fyCount ?? null, b.daysPerMonth ?? null, b.rows?.product ?? null, b.rows?.resource ?? null, b.rows?.billing ?? null]);
      const detail = b.changes?.length ? b.changes.join('; ') : [
        b.quoteLine !== undefined && `Quote line: ${b.quoteLine || '(cleared)'}`,
        b.fyCount !== undefined && `${b.fyCount} fiscal year(s)`,
        b.daysPerMonth !== undefined && `${b.daysPerMonth} man-days per month`,
        b.rows && `rows ${JSON.stringify(b.rows)}`,
      ].filter(Boolean).join('; ');
      await audit(c, req.user, { action: 'MSPO details saved', detail: detail || 'No change', tenderId: id, tenderRef: refOf(t), section: 'MSPO templates' }, req);
    });
    await bus.publish({ tenderId: id, type: 'mspo-changed', by: req.user.name });
    return settingsOf(id);
  });

  /** Override where one template column is filled from for this tender. */
  app.put('/api/tenders/:id/mspo/mapping', async (req) => {
    assertCan(req, 'downloadMspo', 'Only the BD team edits the MSPO mapping');
    const { id } = parse(TenderParams, req.params);
    const b = parse(z.object({ group: Group, target: z.string().min(1), tab: z.string().min(1), from: z.string().regex(cellRe, 'first cell like C6'), to: z.string().regex(cellRe).optional() }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const known = await one(c, 'SELECT 1 FROM mspo_mapping_defaults WHERE "group" = $1 AND target = $2', [b.group, b.target]);
      if (!known) throw badRequest(`"${b.target}" is not a column of the ${b.group} template`);
      await c.query(
        `INSERT INTO tender_mspo_mappings (tender_id, "group", target, tab, from_cell, to_cell, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tender_id, "group", target) DO UPDATE SET tab = EXCLUDED.tab, from_cell = EXCLUDED.from_cell, to_cell = EXCLUDED.to_cell, updated_by = EXCLUDED.updated_by`,
        [id, b.group, b.target, b.tab, b.from.toUpperCase(), b.to?.toUpperCase() ?? null, req.user.id]);
      await audit(c, req.user, { action: 'MSPO mapping changed', detail: `${groupLabel(b.group, b.target)} <- ${b.tab} ${b.from.toUpperCase()}${b.to ? `:${b.to.toUpperCase()}` : ''}`, tenderId: id, tenderRef: refOf(t), section: 'MSPO templates' }, req);
    });
    await bus.publish({ tenderId: id, type: 'mspo-changed', by: req.user.name });
    return settingsOf(id);
  });

  /** Reset one column (query group+target) or everything (no query) to the company defaults. */
  app.delete('/api/tenders/:id/mspo/mapping', async (req) => {
    assertCan(req, 'downloadMspo');
    const { id } = parse(TenderParams, req.params);
    const q = parse(z.object({ group: Group.optional(), target: z.string().optional() }), req.query);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      if (q.group && q.target) {
        await c.query('DELETE FROM tender_mspo_mappings WHERE tender_id = $1 AND "group" = $2 AND target = $3', [id, q.group, q.target]);
      } else {
        await c.query('DELETE FROM tender_mspo_mappings WHERE tender_id = $1', [id]);
        await c.query('UPDATE tenders SET mspo_rows_product = NULL, mspo_rows_resource = NULL, mspo_rows_billing = NULL, mspo_fy_count = NULL, mspo_days_per_month = NULL WHERE id = $1', [id]);
      }
      await audit(c, req.user, { action: 'MSPO mapping reset to default', detail: q.group && q.target ? groupLabel(q.group, q.target) : 'All plans', tenderId: id, tenderRef: refOf(t), section: 'MSPO templates' }, req);
    });
    await bus.publish({ tenderId: id, type: 'mspo-changed', by: req.user.name });
    return settingsOf(id);
  });

  /** Record a template download (the file is built in the browser). */
  app.post('/api/tenders/:id/mspo/downloads', async (req, reply) => {
    assertCan(req, 'downloadMspo', 'Only the BD team downloads MSPO templates');
    const { id } = parse(TenderParams, req.params);
    const b = parse(z.object({ plan: Plan, v: z.number().int().min(1), quoteLine: z.string().trim().default(''), failedChecks: z.number().int().nonnegative().default(0) }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      const ver = await one<{ id: string }>(c, 'SELECT id FROM bc_versions WHERE tender_id = $1 AND v = $2 AND deleted_at IS NULL', [id, b.v]);
      await c.query('INSERT INTO mspo_downloads (tender_id, version_id, plan, quote_line, failed_checks, downloaded_by) VALUES ($1, $2, $3, $4, $5, $6)', [id, ver?.id ?? null, b.plan, b.quoteLine, b.failedChecks, req.user.id]);
      if (ver) await c.query('UPDATE bc_versions SET mspo_downloaded_at = now() WHERE id = $1', [ver.id]);
      const name = `${b.plan[0].toUpperCase()}${b.plan.slice(1)} plan`;
      await audit(c, req.user, { action: 'MSPO template downloaded', detail: `${name} from v${b.v}, quote line ${b.quoteLine || '-'}${b.failedChecks ? ` (${b.failedChecks} Final Check(s) failed)` : ''}`, tenderId: id, tenderRef: refOf(t), section: 'MSPO templates' }, req);
    });
    return reply.status(201).send({ ok: true });
  });
}
