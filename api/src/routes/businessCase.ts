// Business case versions: presigned upload, server-side parse of the workbook
// from S3, Final Check evaluation, download, delete.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan } from '../auth/rbac.js';
import type { Queryable } from '../db/pool.js';
import { many, one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { keys } from '../lib/s3.js';
import { assertUnlocked, BC_VERSION_SQL, mapBcVersion, refOf, tenderRow } from '../lib/tenderDto.js';
import { nonEmpty, parse, TenderParams, uuid } from '../lib/validate.js';
import { parseBusinessCase } from '../domain/bcWorkbook.js';
import { ruleFromRow, runFinalChecks } from '../domain/finalChecks.js';
import type { BcVersionData, RuleDef } from '../types.js';

export async function loadRules(q: Queryable): Promise<RuleDef[]> {
  const rows = await many<any>(q, 'SELECT * FROM final_check_rules ORDER BY sort_order, created_at');
  return rows.map(ruleFromRow);
}

/** (Re)evaluates the enabled rules for one version and caches the results. */
export async function evaluateVersion(q: Queryable, versionId: string, data: BcVersionData, rules?: RuleDef[]) {
  const results = runFinalChecks(data, rules ?? (await loadRules(q)));
  await q.query('DELETE FROM final_check_results WHERE version_id = $1', [versionId]);
  for (const r of results) {
    await q.query('INSERT INTO final_check_results (version_id, rule_id, ok, skipped, expected, actual) VALUES ($1, $2, $3, $4, $5, $6)', [versionId, r.ruleId, r.ok, !!r.skipped, r.expected, r.actual]);
  }
  return results;
}

/** Rebuilds BcVersionData from the stored rows (used when rules change). */
export async function versionData(q: Queryable, versionId: string): Promise<BcVersionData | null> {
  const row = await one<any>(q, `${BC_VERSION_SQL} WHERE b.id = $1`, [versionId]);
  return row ? mapBcVersion(row).data : null;
}

export async function businessCaseRoutes(app: FastifyInstance) {
  const { pool, storage, bus, cfg } = app.ctx;
  const Params = z.object({ id: uuid, v: z.coerce.number().int().min(1) });
  const versionsOf = (tenderId: string) => many<any>(pool, `${BC_VERSION_SQL} WHERE b.tender_id = $1 AND b.deleted_at IS NULL ORDER BY b.v`, [tenderId]).then((r) => r.map(mapBcVersion));

  app.get('/api/tenders/:id/business-case', async (req) => {
    const { id } = parse(TenderParams, req.params);
    await tenderRow(pool, id);
    return versionsOf(id);
  });

  /** Step 1: reserve the next version number and a presigned PUT URL. */
  app.post('/api/tenders/:id/business-case/presign', async (req) => {
    assertCan(req, 'uploadBc', 'Only the BD team uploads the business case');
    const { id } = parse(TenderParams, req.params);
    const { fileName, contentType } = parse(z.object({ fileName: nonEmpty, sizeBytes: z.number().int().nonnegative(), contentType: z.string().optional() }), req.body);
    if (!/\.(xlsx|xlsm)$/i.test(fileName)) throw badRequest('Business case uploads accept .xlsx and .xlsm workbooks');
    assertUnlocked(await tenderRow(pool, id));
    const next = (await one<{ v: number }>(pool, 'SELECT COALESCE(MAX(v), 0) + 1 AS v FROM bc_versions WHERE tender_id = $1', [id]))!.v;
    const key = keys(id).bc(next, fileName);
    return { v: next, key, url: await storage.presignUpload(key, contentType) };
  });

  /** Step 2: parse the uploaded workbook, store the version and its lines, run Final Check. */
  app.post('/api/tenders/:id/business-case', async (req, reply) => {
    assertCan(req, 'uploadBc');
    const { id } = parse(TenderParams, req.params);
    const b = parse(z.object({ v: z.number().int().min(1), key: z.string(), fileName: nonEmpty, comment: z.string().trim().optional() }), req.body);
    if (b.key !== keys(id).bc(b.v, b.fileName)) throw badRequest('Unexpected object key');
    const head = await storage.head(b.key);
    if (!head) throw badRequest('The workbook was not uploaded');
    const parsed = parseBusinessCase(await storage.get(b.key));
    const versionId = await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const exists = await one(c, 'SELECT 1 FROM bc_versions WHERE tender_id = $1 AND v = $2', [id, b.v]);
      if (exists) throw badRequest(`Version ${b.v} already exists - request a new presign`);
      const d = parsed.data;
      const row = await one<{ id: string }>(c,
        `INSERT INTO bc_versions (tender_id, v, uploaded_by, file_name, size_bytes, s3_key, s3_version_id, comment, parsed_from_file, layout_unrecognised, missing_anchors,
           tcv, product_total, labour_total, margin_pct, currency, duration_months, project_start, cells)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
        [id, b.v, req.user.id, b.fileName, head.size, b.key, head.versionId ?? null, b.comment || null, parsed.parsed, !parsed.parsed, parsed.missingAnchors,
          d.header.tcv, d.header.productTotal, d.header.labourTotal, d.header.marginPct, (d.header.currency || 'SGD').slice(0, 3), d.header.durationMonths, d.header.projectStart || null, JSON.stringify(d.cells ?? {})]);
      const vid = row!.id;
      for (const [i, p] of d.products.entries()) await c.query('INSERT INTO bc_products (version_id, line_no, ql, category, description, unit_cost, qty, fy_qty, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [vid, i + 1, p.ql, p.category, p.desc, p.unitCost, p.qty, p.fyQty ?? null, p.total]);
      for (const [i, r] of d.resources.entries()) await c.query('INSERT INTO bc_resources (version_id, line_no, ql, role, skill, grade, team, mandays, fy_mandays, day_rate, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [vid, i + 1, r.ql, r.role, r.skill ?? null, r.grade, r.team, r.mandays, r.fyMandays ?? null, r.dayRate, r.total]);
      for (const [i, l] of d.billing.entries()) await c.query('INSERT INTO bc_billing (version_id, line_no, billing_date, schedule, amount, remark) VALUES ($1, $2, $3, $4, $5, $6)', [vid, i + 1, l.date || null, l.schedule, l.amount, l.remark ?? null]);
      if (parsed.parsed) await evaluateVersion(c, vid, d);
      await c.query('UPDATE tenders SET workflow_step = GREATEST(workflow_step, 2) WHERE id = $1', [id]);
      await audit(c, req.user, { action: 'Business case uploaded', detail: `v${b.v} - ${b.fileName}${parsed.parsed ? '' : ' (layout not recognised)'}${b.comment ? ` ("${b.comment}")` : ''}`, tenderId: id, tenderRef: refOf(t), section: 'Business case' }, req);
      return vid;
    });
    await bus.publish({ tenderId: id, type: 'business-case-changed', by: req.user.name });
    const row = await one<any>(pool, `${BC_VERSION_SQL} WHERE b.id = $1`, [versionId]);
    return reply.status(201).send(mapBcVersion(row!));
  });

  app.get('/api/tenders/:id/business-case/:v/download', async (req) => {
    const { id, v } = parse(Params, req.params);
    const t = await tenderRow(pool, id);
    const row = await one<{ file_name: string; s3_key: string; s3_version_id: string | null }>(pool, 'SELECT file_name, s3_key, s3_version_id FROM bc_versions WHERE tender_id = $1 AND v = $2 AND deleted_at IS NULL', [id, v]);
    if (!row) throw notFound('Business case version');
    await audit(pool, req.user, { action: 'File downloaded', detail: `Business case v${v} - ${row.file_name}`, tenderId: id, tenderRef: refOf(t), section: 'Business case' }, req);
    return { url: await storage.presignDownload(row.s3_key, row.file_name, row.s3_version_id ?? undefined), fileName: row.file_name, expiresIn: cfg.PRESIGN_TTL_SECONDS };
  });

  app.delete('/api/tenders/:id/business-case/:v', async (req) => {
    assertCan(req, 'uploadBc');
    const { id, v } = parse(Params, req.params);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const r = await c.query('UPDATE bc_versions SET deleted_at = now(), deleted_by = $3 WHERE tender_id = $1 AND v = $2 AND deleted_at IS NULL RETURNING id', [id, v, req.user.id]);
      if (!r.rows[0]) throw notFound('Business case version');
      await audit(c, req.user, { action: 'Business case version deleted', detail: `v${v}`, tenderId: id, tenderRef: refOf(t), section: 'Business case' }, req);
    });
    await bus.publish({ tenderId: id, type: 'business-case-changed', by: req.user.name });
    return versionsOf(id);
  });

  /** Re-run Final Check for one version with the current rules. */
  app.post('/api/tenders/:id/business-case/:v/checks', async (req) => {
    const { id, v } = parse(Params, req.params);
    await tenderRow(pool, id);
    const row = await one<{ id: string; layout_unrecognised: boolean }>(pool, 'SELECT id, layout_unrecognised FROM bc_versions WHERE tender_id = $1 AND v = $2 AND deleted_at IS NULL', [id, v]);
    if (!row) throw notFound('Business case version');
    if (row.layout_unrecognised) return [];
    const data = await versionData(pool, row.id);
    return evaluateVersion(pool, row.id, data!);
  });
}
