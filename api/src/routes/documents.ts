// Tender pack documents: presigned upload, confirm, role, reorder, soft delete,
// retry and download. Files go straight from the browser to S3.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCan, assertNotReadOnly } from '../auth/rbac.js';
import { many, one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { dispatchJob } from '../lib/jobs.js';
import { keys } from '../lib/s3.js';
import { fileTypeOf, type TenderJobMessage } from '../lib/sqs.js';
import { assertUnlocked, DOC_SQL, mapDoc, refOf, tenderRow } from '../lib/tenderDto.js';
import { nonEmpty, parse, TenderParams, uuid } from '../lib/validate.js';

const DocParams = z.object({ id: uuid, docId: uuid });
const Role = z.enum(['General Requirements', 'Technical Specification', 'Commercial Conditions', 'Legal Conditions', 'Forms and Annexes', 'Unclassified']);

export async function documentRoutes(app: FastifyInstance) {
  const { pool, storage, queue, bus } = app.ctx;

  const packOf = (tenderId: string) => many(pool, `${DOC_SQL} WHERE d.tender_id = $1 AND d.deleted_at IS NULL ORDER BY d.sort_order, d.uploaded_at`, [tenderId]).then((r) => r.map(mapDoc));

  /** Step 1: reserve ids and presigned PUT URLs. Duplicates (same name + size) are rejected up front. */
  app.post('/api/tenders/:id/documents/presign', async (req) => {
    assertCan(req, 'uploadPack', 'Only the Bidding Manager uploads tender documents');
    const { id } = parse(TenderParams, req.params);
    const { files } = parse(z.object({ files: z.array(z.object({ name: nonEmpty, sizeBytes: z.number().int().nonnegative(), contentType: z.string().optional() })).min(1).max(50) }), req.body);
    assertUnlocked(await tenderRow(pool, id));
    const unsupported = files.filter((f) => !fileTypeOf(f.name)).map((f) => f.name);
    if (unsupported.length) throw badRequest('Only PDF, Word (doc/docx), Excel (xls/xlsx) and CSV documents are supported', { unsupported });
    const existing = await many<{ name: string; size_bytes: number }>(pool, 'SELECT name, size_bytes FROM tender_documents WHERE tender_id = $1 AND deleted_at IS NULL', [id]);
    const dups = files.filter((f) => existing.some((e) => e.name === f.name && e.size_bytes === f.sizeBytes)).map((f) => f.name);
    if (dups.length) throw conflict('Already uploaded to this tender', { duplicates: dups });
    return Promise.all(files.map(async (f) => {
      const documentId = randomUUID();
      const key = keys(id).pack(documentId, f.name);
      return { documentId, key, url: await storage.presignUpload(key, f.contentType), name: f.name };
    }));
  });

  /** Step 2: after the PUTs succeed, record the documents (verified against S3). */
  app.post('/api/tenders/:id/documents', async (req, reply) => {
    assertCan(req, 'uploadPack');
    const { id } = parse(TenderParams, req.params);
    const { files } = parse(z.object({ files: z.array(z.object({ documentId: uuid, name: nonEmpty, sizeBytes: z.number().int().nonnegative(), contentType: z.string().optional(), key: z.string() })).min(1) }), req.body);
    const added = await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const maxOrder = (await one<{ m: number }>(c, 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM tender_documents WHERE tender_id = $1', [id]))!.m;
      const names: string[] = [];
      let order = maxOrder;
      for (const f of files) {
        const expected = keys(id).pack(f.documentId, f.name);
        if (f.key !== expected) throw badRequest(`Unexpected object key for ${f.name}`);
        const head = await storage.head(f.key);
        if (!head) throw badRequest(`${f.name} was not uploaded`);
        await c.query(
          `INSERT INTO tender_documents (id, tender_id, name, size_bytes, content_type, s3_key, s3_version_id, sort_order, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [f.documentId, id, f.name, head.size, f.contentType ?? head.contentType ?? null, f.key, head.versionId ?? null, ++order, req.user.id],
        );
        names.push(f.name);
      }
      await c.query('SELECT mark_results_out_of_date($1, $2, 0, 0)', [id, files.length]);
      await audit(c, req.user, { action: 'Document uploaded', detail: names.join(', '), tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
      return names.length;
    });
    await bus.publish({ tenderId: id, type: 'documents-changed', by: req.user.name, added });
    return reply.status(201).send(await packOf(id));
  });

  app.put('/api/tenders/:id/documents/:docId/role', async (req) => {
    assertNotReadOnly(req);
    const { id, docId } = parse(DocParams, req.params);
    const { role } = parse(z.object({ role: Role }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const d = await one<{ name: string }>(c, 'UPDATE tender_documents SET role = $3, role_unconfirmed = false WHERE id = $2 AND tender_id = $1 AND deleted_at IS NULL RETURNING name', [id, docId, role]);
      if (!d) throw notFound('Document');
      await audit(c, req.user, { action: 'Document role changed', detail: `${d.name} -> ${role}`, tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
    });
    await bus.publish({ tenderId: id, type: 'documents-changed', by: req.user.name });
    return packOf(id);
  });

  app.post('/api/tenders/:id/documents/:docId/move', async (req) => {
    assertNotReadOnly(req);
    const { id, docId } = parse(DocParams, req.params);
    const { direction } = parse(z.object({ direction: z.enum(['up', 'down']) }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const docs = await many<{ id: string; name: string; sort_order: number }>(c, 'SELECT id, name, sort_order FROM tender_documents WHERE tender_id = $1 AND deleted_at IS NULL ORDER BY sort_order, uploaded_at FOR UPDATE', [id]);
      const i = docs.findIndex((d) => d.id === docId);
      const j = direction === 'up' ? i - 1 : i + 1;
      if (i < 0) throw notFound('Document');
      if (j < 0 || j >= docs.length) return;
      // renumber so the swap is well defined even when sort_order values tie
      for (let k = 0; k < docs.length; k++) docs[k].sort_order = k + 1;
      [docs[i].sort_order, docs[j].sort_order] = [docs[j].sort_order, docs[i].sort_order];
      for (const d of docs) await c.query('UPDATE tender_documents SET sort_order = $2 WHERE id = $1', [d.id, d.sort_order]);
      await audit(c, req.user, { action: 'Document reordered', detail: `${docs[i].name} moved ${direction}`, tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
    });
    return packOf(id);
  });

  /** Soft delete: the file stays recoverable for 30 days; extracted items from it are removed on the next run. */
  app.delete('/api/tenders/:id/documents/:docId', async (req) => {
    assertCan(req, 'uploadPack');
    const { id, docId } = parse(DocParams, req.params);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const d = await one<{ name: string; status: string }>(c, 'UPDATE tender_documents SET deleted_at = now(), deleted_by = $3 WHERE id = $2 AND tender_id = $1 AND deleted_at IS NULL RETURNING name, status', [id, docId, req.user.id]);
      if (!d) throw notFound('Document');
      if (t.last_processed_at && d.status !== 'Uploaded') await c.query('SELECT mark_results_out_of_date($1, 0, 1, 0)', [id]);
      await audit(c, req.user, { action: 'Document deleted', detail: d.name, tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
    });
    await bus.publish({ tenderId: id, type: 'documents-changed', by: req.user.name });
    return packOf(id);
  });

  /** Retry a failed document: re-runs text extraction for that one file. */
  app.post('/api/tenders/:id/documents/:docId/retry', async (req) => {
    assertCan(req, 'uploadPack');
    const { id, docId } = parse(DocParams, req.params);
    const message = await withTx(pool, async (c): Promise<TenderJobMessage> => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const d = await one<{ name: string; status: string; s3_key: string }>(c, 'SELECT name, status, s3_key FROM tender_documents WHERE id = $2 AND tender_id = $1 AND deleted_at IS NULL FOR UPDATE', [id, docId]);
      if (!d) throw notFound('Document');
      if (d.status !== 'Failed') throw conflict('Only failed documents can be retried');
      const active = await one(c, `SELECT 1 FROM processing_jobs WHERE tender_id = $1 AND status IN ('queued','running')`, [id]);
      if (active) throw conflict('A processing job is already running for this tender');
      const job = await one<{ id: string }>(c, `INSERT INTO processing_jobs (tender_id, stage, stage_label, document_count, requested_by) VALUES ($1, 1, 'Read documents (text extraction)', 1, $2) RETURNING id`, [id, req.user.id]);
      await c.query(`UPDATE tender_documents SET status = 'Extracting text', fail_reason = NULL WHERE id = $1`, [docId]);
      await audit(c, req.user, { action: 'Document retried', detail: d.name, tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
      return { tenderId: id, jobId: job!.id, mode: 'retry-document', requestedBy: req.user.id, documents: [{ documentId: docId, key: d.s3_key, fileType: fileTypeOf(d.name) ?? 'pdf', textReady: false, textPrefix: null }] };
    });
    await dispatchJob(pool, queue, message);
    await bus.publish({ tenderId: id, type: 'job', jobId: message.jobId, status: 'queued', stage: 1 });
    return packOf(id);
  });

  app.get('/api/tenders/:id/documents/:docId/download', async (req) => {
    const { id, docId } = parse(DocParams, req.params);
    const t = await tenderRow(pool, id);
    const d = await one<{ name: string; s3_key: string; s3_version_id: string | null }>(pool, 'SELECT name, s3_key, s3_version_id FROM tender_documents WHERE id = $2 AND tender_id = $1 AND deleted_at IS NULL', [id, docId]);
    if (!d) throw notFound('Document');
    await audit(pool, req.user, { action: 'File downloaded', detail: d.name, tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
    return { url: await storage.presignDownload(d.s3_key, d.name, d.s3_version_id ?? undefined), fileName: d.name, expiresIn: app.ctx.cfg.PRESIGN_TTL_SECONDS };
  });
}
