// Per-tender template search, match confirmation and generated documents.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan, assertNotReadOnly } from '../auth/rbac.js';
import { many, one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { assertUnlocked, loadTender, mapGenDoc, refOf, tenderRow } from '../lib/tenderDto.js';
import { parse, TenderParams, uuid } from '../lib/validate.js';
import { matchTemplates, proposeTemplate } from '../domain/templateMatch.js';
import { loadLibrary } from './library.js';

export async function submissionRoutes(app: FastifyInstance) {
  const { pool, bus } = app.ctx;

  /** "Find matching templates": agency name first, then generic fallbacks; proposes a template per checklist item. */
  app.post('/api/tenders/:id/template-search', async (req) => {
    assertCan(req, 'generateDocs', 'Only the Bidding Manager runs the template search');
    const { id } = parse(TenderParams, req.params);
    const templates = await loadLibrary(pool, 'template');
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const { matches, genericFallback } = matchTemplates({ agency: t.agency, type: t.type }, templates);
      await c.query(
        `INSERT INTO tender_template_searches (tender_id, status, ran_at, ran_by, generic_fallback) VALUES ($1, 'done', now(), $2, $3)
         ON CONFLICT (tender_id) DO UPDATE SET status = 'done', ran_at = now(), ran_by = EXCLUDED.ran_by, generic_fallback = EXCLUDED.generic_fallback`,
        [id, req.user.id, genericFallback]);
      // keep confirmations for templates that still match; drop the rest
      await c.query('DELETE FROM tender_template_matches WHERE tender_id = $1 AND NOT (template_id = ANY($2::uuid[]))', [id, matches.map((m) => m.templateId)]);
      for (const m of matches) {
        await c.query(
          `INSERT INTO tender_template_matches (tender_id, template_id, reason) VALUES ($1, $2, $3)
           ON CONFLICT (tender_id, template_id) DO UPDATE SET reason = EXCLUDED.reason`, [id, m.templateId, m.reason]);
      }
      const items = await many<{ id: string; item: string; template_id: string | null }>(c, 'SELECT id, item, template_id FROM checklist_items WHERE tender_id = $1', [id]);
      for (const k of items) {
        const proposed = proposeTemplate(k.item, matches, templates);
        if (proposed && proposed !== k.template_id) await c.query('UPDATE checklist_items SET template_id = $2 WHERE id = $1', [k.id, proposed]);
      }
      await audit(c, req.user, { action: 'Templates matched', detail: `${matches.length} suitable template(s) found`, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
    });
    await bus.publish({ tenderId: id, type: 'checklist-changed', by: req.user.name });
    const t = await loadTender(pool, id);
    return { templateSearch: t!.templateSearch, checklist: t!.checklist };
  });

  app.put('/api/tenders/:id/template-matches/:templateId', async (req) => {
    assertCan(req, 'generateDocs');
    const { id, templateId } = parse(z.object({ id: uuid, templateId: uuid }), req.params);
    const { confirmed } = parse(z.object({ confirmed: z.boolean() }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const r = await c.query('UPDATE tender_template_matches SET confirmed = $3, confirmed_by = $4, confirmed_at = CASE WHEN $3 THEN now() END WHERE tender_id = $1 AND template_id = $2 RETURNING template_id', [id, templateId, confirmed, req.user.id]);
      if (!r.rows[0]) throw notFound('Template match');
      const name = (await one<{ name: string }>(c, 'SELECT name FROM library_items WHERE id = $1', [templateId]))?.name ?? '';
      await audit(c, req.user, { action: confirmed ? 'Template match confirmed' : 'Template match unconfirmed', detail: name, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
    });
    return (await loadTender(pool, id))!.templateSearch;
  });

  // ---- generated documents -------------------------------------------------------
  const genDocsOf = (tenderId: string) => many(pool, 'SELECT * FROM gen_docs WHERE tender_id = $1 ORDER BY sort_order, created_at', [tenderId]).then((r) => r.map(mapGenDoc));

  app.post('/api/tenders/:id/gen-docs', async (req, reply) => {
    assertCan(req, 'generateDocs');
    const { id } = parse(TenderParams, req.params);
    const b = parse(z.object({ name: z.string().min(1), templateId: uuid.optional() }), req.body);
    const t = await tenderRow(pool, id);
    assertUnlocked(t);
    await pool.query('INSERT INTO gen_docs (tender_id, name, template_id, sort_order) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM gen_docs WHERE tender_id = $1))', [id, b.name, b.templateId ?? null]);
    return reply.status(201).send(await genDocsOf(id));
  });

  app.patch('/api/tenders/:id/gen-docs/:docId', async (req) => {
    assertNotReadOnly(req);
    const { id, docId } = parse(z.object({ id: uuid, docId: uuid }), req.params);
    const b = parse(z.object({
      status: z.enum(['Not generated', 'Generated', 'Needs review']).optional(),
      templateId: uuid.nullable().optional(),
      autoFilled: z.array(z.string()).optional(),
      manual: z.array(z.string()).optional(),
    }), req.body);
    if (b.status || b.templateId !== undefined) assertCan(req, 'generateDocs');
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const r = await c.query(
        `UPDATE gen_docs SET status = COALESCE($3::gen_doc_status, status), template_id = CASE WHEN $4::boolean THEN $5::uuid ELSE template_id END,
           auto_filled = COALESCE($6::text[], auto_filled), manual = COALESCE($7::text[], manual),
           generated_at = CASE WHEN $3 IN ('Generated','Needs review') THEN now() ELSE generated_at END
         WHERE id = $1 AND tender_id = $2 RETURNING name`,
        [docId, id, b.status ?? null, b.templateId !== undefined, b.templateId ?? null, b.autoFilled ?? null, b.manual ?? null]);
      if (!r.rows[0]) throw notFound('Generated document');
      await c.query('UPDATE tenders SET workflow_step = GREATEST(workflow_step, 4) WHERE id = $1', [id]);
      if (b.status) await audit(c, req.user, { action: 'Document generated', detail: `${r.rows[0].name}: ${b.status}`, tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
    });
    return genDocsOf(id);
  });
}
