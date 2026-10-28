// Submission checklist items: status/owner/template edits and first drafts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { assertCan, assertNotReadOnly } from '../auth/rbac.js';
import { many, one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { keys } from '../lib/s3.js';
import { assertUnlocked, CHECKLIST_SQL, mapChecklist, refOf, tenderRow } from '../lib/tenderDto.js';
import { parse, uuid } from '../lib/validate.js';

const Params = z.object({ id: uuid, itemId: uuid });

export async function checklistRoutes(app: FastifyInstance) {
  const { pool, storage, bus, cfg } = app.ctx;

  const itemsOf = (tenderId: string) => many(pool, `${CHECKLIST_SQL} WHERE k.tender_id = $1 ORDER BY k.deadline NULLS LAST, k.sort_order`, [tenderId]).then((r) => r.map(mapChecklist));

  app.patch('/api/tenders/:id/checklist/:itemId', async (req) => {
    assertNotReadOnly(req);
    const { id, itemId } = parse(Params, req.params);
    const b = parse(z.object({
      status: z.enum(['Not started', 'In progress', 'Done']).optional(),
      ownerId: uuid.nullable().optional(),
      owner: z.string().nullable().optional(),
      templateId: uuid.nullable().optional(),
      /** false discards the current draft (template changed) */
      keepDraft: z.boolean().optional(),
    }), req.body);
    if (b.templateId !== undefined || b.status !== undefined) assertCan(req, 'editChecklist', 'Only the Bidding Manager edits the submission checklist');
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const k = await one<{ item: string; template_id: string | null; draft_status: string | null }>(c, 'SELECT item, template_id, draft_status FROM checklist_items WHERE id = $1 AND tender_id = $2 FOR UPDATE', [itemId, id]);
      if (!k) throw notFound('Checklist item');
      const discardDraft = b.templateId !== undefined && b.templateId !== k.template_id && k.draft_status && b.keepDraft !== true;
      await c.query(
        `UPDATE checklist_items SET
           status = COALESCE($3::checklist_status, status),
           owner_id = CASE WHEN $4::boolean THEN $5::uuid ELSE owner_id END,
           owner_name = CASE WHEN $6::boolean THEN $7 ELSE owner_name END,
           template_id = CASE WHEN $8::boolean THEN $9::uuid ELSE template_id END,
           draft_template_id = CASE WHEN $10::boolean THEN NULL ELSE draft_template_id END,
           draft_status = CASE WHEN $10::boolean THEN NULL ELSE draft_status END,
           draft_generated_at = CASE WHEN $10::boolean THEN NULL ELSE draft_generated_at END,
           draft_s3_key = CASE WHEN $10::boolean THEN NULL ELSE draft_s3_key END
         WHERE id = $1 AND tender_id = $2`,
        [itemId, id, b.status ?? null, b.ownerId !== undefined, b.ownerId ?? null, b.owner !== undefined, b.owner ?? null, b.templateId !== undefined, b.templateId ?? null, !!discardDraft]);
      if (b.templateId !== undefined && b.templateId !== k.template_id) {
        const name = b.templateId ? (await one<{ name: string }>(c, 'SELECT name FROM library_items WHERE id = $1', [b.templateId]))?.name ?? 'Unknown' : 'None';
        await audit(c, req.user, { action: 'Template selected', detail: `${k.item} -> ${name}${discardDraft ? ' (draft discarded)' : ''}`, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
      } else if (b.status) {
        await audit(c, req.user, { action: 'Submission item updated', detail: `${k.item}: ${b.status}`, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
      }
    });
    await bus.publish({ tenderId: id, type: 'checklist-changed', by: req.user.name });
    return itemsOf(id);
  });

  /**
   * Generate the first draft of a submission document from its template.
   * Produces the document in S3 and marks the item "Needs review". The current
   * generator fills the heading, tender reference and template name; the
   * Bedrock-backed drafting (analyser Lambda, drafts/ prefix) replaces it.
   */
  app.post('/api/tenders/:id/checklist/:itemId/draft', async (req, reply) => {
    assertCan(req, 'generateDocs', 'Only the Bidding Manager generates documents');
    const { id, itemId } = parse(Params, req.params);
    const t = await tenderRow(pool, id);
    assertUnlocked(t);
    const k = await one<{ item: string; template_id: string | null }>(pool, 'SELECT item, template_id FROM checklist_items WHERE id = $1 AND tender_id = $2', [itemId, id]);
    if (!k) throw notFound('Checklist item');
    const tpl = k.template_id ? await one<{ name: string; version: string; item_type: string }>(pool, 'SELECT name, version, item_type FROM library_items WHERE id = $1', [k.template_id]) : null;
    const isSheet = k.item.toLowerCase().includes('compliance') || tpl?.item_type === 'Compliance table';
    const stem = k.item.replace(/\W+/g, '_').replace(/_+$/, '');
    const fileName = `${stem}_draft.${isSheet ? 'xlsx' : 'doc'}`;
    const key = keys(id).draft(itemId, fileName);
    if (isSheet) {
      const clauses = await many<{ number: string; text: string; category: string; compliance: string; response: string }>(pool, 'SELECT number, text, category, compliance, response FROM clauses WHERE tender_id = $1 ORDER BY sort_order', [id]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [t.name, t.ref], [`Template: ${tpl ? `${tpl.name} (v${tpl.version})` : 'generic'}`], [],
        ['Clause', 'Requirement', 'Category', 'Compliance', 'Response'],
        ...clauses.map((c) => [c.number, c.text, c.category, c.compliance, c.response || '[TO COMPLETE]']),
      ]), 'Compliance table');
      await storage.put(key, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      const html = `<html><head><meta charset="utf-8"></head><body><h1>${k.item}</h1><p><b>${t.ref || t.name}</b> - ${t.name}</p><p>Template: ${tpl ? `${tpl.name} (v${tpl.version})` : 'generic'}</p><p>First draft generated by TendrAI. Sections that could not be auto-filled are marked [TO COMPLETE].</p></body></html>`;
      await storage.put(key, html, 'application/msword');
    }
    await withTx(pool, async (c) => {
      await c.query(`UPDATE checklist_items SET draft_template_id = $3, draft_status = 'Needs review', draft_generated_at = now(), draft_s3_key = $4 WHERE id = $1 AND tender_id = $2`, [itemId, id, k.template_id, key]);
      await c.query('UPDATE tenders SET workflow_step = GREATEST(workflow_step, 4) WHERE id = $1', [id]);
      await audit(c, req.user, { action: 'First draft generated', detail: k.item, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
    });
    await bus.publish({ tenderId: id, type: 'checklist-changed', by: req.user.name });
    return reply.status(201).send(await itemsOf(id));
  });

  app.put('/api/tenders/:id/checklist/:itemId/draft', async (req) => {
    assertCan(req, 'generateDocs');
    const { id, itemId } = parse(Params, req.params);
    const { status } = parse(z.object({ status: z.enum(['Needs review', 'Done']) }), req.body);
    const t = await tenderRow(pool, id);
    assertUnlocked(t);
    const r = await pool.query(`UPDATE checklist_items SET draft_status = $3 WHERE id = $1 AND tender_id = $2 AND draft_status IS NOT NULL RETURNING item`, [itemId, id, status]);
    if (!r.rows[0]) throw conflict('No draft to update');
    await audit(pool, req.user, { action: 'Draft reviewed', detail: `${r.rows[0].item}: ${status}`, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
    return itemsOf(id);
  });

  app.delete('/api/tenders/:id/checklist/:itemId/draft', async (req) => {
    assertCan(req, 'generateDocs');
    const { id, itemId } = parse(Params, req.params);
    const t = await tenderRow(pool, id);
    assertUnlocked(t);
    const r = await pool.query(`UPDATE checklist_items SET draft_template_id = NULL, draft_status = NULL, draft_generated_at = NULL, draft_s3_key = NULL WHERE id = $1 AND tender_id = $2 AND draft_status IS NOT NULL RETURNING item`, [itemId, id]);
    if (r.rows[0]) await audit(pool, req.user, { action: 'Draft discarded', detail: r.rows[0].item, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
    return itemsOf(id);
  });

  app.get('/api/tenders/:id/checklist/:itemId/draft/download', async (req) => {
    const { id, itemId } = parse(Params, req.params);
    const t = await tenderRow(pool, id);
    const k = await one<{ item: string; draft_s3_key: string | null }>(pool, 'SELECT item, draft_s3_key FROM checklist_items WHERE id = $1 AND tender_id = $2', [itemId, id]);
    if (!k?.draft_s3_key) throw notFound('Draft');
    await audit(pool, req.user, { action: 'Draft downloaded', detail: k.item, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
    const fileName = k.draft_s3_key.split('/').pop()!;
    return { url: await storage.presignDownload(k.draft_s3_key, fileName), fileName, expiresIn: cfg.PRESIGN_TTL_SECONDS };
  });
}
