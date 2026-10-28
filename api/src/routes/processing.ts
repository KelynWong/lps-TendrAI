// Processing jobs: start (or reprocess) the tender pack, read job history, and
// the internal progress endpoint the workflow's status-updater Lambda calls.
//
// The Lambda may instead write processing_jobs / tender_documents directly and
// call notify_tender_event(); both paths end in the same WebSocket broadcast.
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { assertCan } from '../auth/rbac.js';
import { many, one, withTx } from '../db/pool.js';
import { audit, SYSTEM_ACTOR } from '../lib/audit.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { dispatchJob } from '../lib/jobs.js';
import { fileTypeOf, type JobDocument, type TenderJobMessage } from '../lib/sqs.js';
import { assertUnlocked, mapJob, refOf, tenderRow } from '../lib/tenderDto.js';
import { parse, TenderParams, uuid } from '../lib/validate.js';
import { PROCESS_STAGES } from '../types.js';

export async function processingRoutes(app: FastifyInstance) {
  const { pool, queue, bus, cfg } = app.ctx;

  app.post('/api/tenders/:id/process', async (req, reply) => {
    assertCan(req, 'uploadPack', 'Only the Bidding Manager starts processing');
    const { id } = parse(TenderParams, req.params);
    const { jobId, reprocess, message } = await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const active = await one(c, `SELECT 1 FROM processing_jobs WHERE tender_id = $1 AND status IN ('queued','running')`, [id]);
      if (active) throw conflict('A processing job is already running for this tender');
      const docs = await many<{ id: string; name: string; s3_key: string; status: string; text_extracted: boolean; text_s3_prefix: string | null; fail_reason: string | null }>(
        c, 'SELECT id, name, s3_key, status, text_extracted, text_s3_prefix, fail_reason FROM tender_documents WHERE tender_id = $1 AND deleted_at IS NULL ORDER BY sort_order FOR UPDATE', [id]);
      if (!docs.length) throw conflict('Upload at least one document before processing');
      const reprocess = !!t.last_processed_at;
      const job = await one<{ id: string }>(c,
        `INSERT INTO processing_jobs (tender_id, stage, stage_label, is_reprocess, document_count, requested_by) VALUES ($1, 1, $2, $3, $4, $5) RETURNING id`,
        [id, PROCESS_STAGES[0], reprocess, docs.length, req.user.id]);
      // same status transitions as the UI's start-processing reducer
      await c.query(`
        UPDATE tender_documents SET
          status = CASE
            WHEN status = 'Failed' AND fail_reason ILIKE '%service unavailable%' THEN 'Extracting text'::pack_doc_status
            WHEN status = 'Uploaded' AND text_extracted THEN 'Text ready'::pack_doc_status
            WHEN status = 'Uploaded' THEN 'Extracting text'::pack_doc_status
            WHEN status = 'Done' THEN 'Text ready'::pack_doc_status
            ELSE status END,
          fail_reason = CASE WHEN status = 'Failed' AND fail_reason ILIKE '%service unavailable%' THEN NULL ELSE fail_reason END
        WHERE tender_id = $1 AND deleted_at IS NULL`, [id]);
      await c.query('UPDATE tenders SET process_failed = NULL WHERE id = $1', [id]);
      const documents: JobDocument[] = docs
        .filter((d) => fileTypeOf(d.name))
        .map((d) => {
          const textReady = d.text_extracted && !!d.text_s3_prefix;
          return { documentId: d.id, key: d.s3_key, fileType: fileTypeOf(d.name)!, textReady, textPrefix: textReady ? d.text_s3_prefix : null };
        });
      await audit(c, req.user, { action: reprocess ? 'Reprocessing started' : 'Processing started', detail: `${docs.length} documents, ${PROCESS_STAGES.length} stages`, tenderId: id, tenderRef: refOf(t), section: 'Documents' }, req);
      const message: TenderJobMessage = { tenderId: id, jobId: job!.id, mode: reprocess ? 'reprocess' : 'process', documents, requestedBy: req.user.id };
      return { jobId: job!.id, reprocess, message };
    });
    await dispatchJob(pool, queue, message);
    await bus.publish({ tenderId: id, type: 'job', jobId, status: 'queued', stage: 1, reprocess });
    const job = await one(pool, 'SELECT * FROM processing_jobs WHERE id = $1', [jobId]);
    return reply.status(202).send(mapJob(job!));
  });

  app.get('/api/tenders/:id/jobs', async (req) => {
    const { id } = parse(TenderParams, req.params);
    await tenderRow(pool, id);
    const rows = await many(pool, 'SELECT * FROM processing_jobs WHERE tender_id = $1 ORDER BY started_at DESC LIMIT 50', [id]);
    return rows.map(mapJob);
  });

  // ---- internal: workflow progress --------------------------------------------
  // POST /internal/jobs/:jobId/progress  (header x-internal-token)
  //   { mode?, stage?: 1-6, status?: 'running'|'completed'|'failed', error?,
  //     documents?: [{ documentId, status, failReason?, pages?, textPrefix? }], results? }
  // The state machine (statemachine/tender_processing.asl.json) sends exactly
  // this body to the status-updater Lambda at every stage change.
  // mode 'retry-document' re-reads one file only: completion flags the results
  // out of date (like the UI) instead of marking the tender processed.
  const Progress = z.object({
    mode: z.enum(['process', 'reprocess', 'retry-document']).optional(),
    stage: z.number().int().min(1).max(6).optional(),
    status: z.enum(['running', 'completed', 'failed']).optional(),
    error: z.string().optional(),
    executionArn: z.string().optional(),
    documents: z.array(z.object({
      documentId: uuid,
      status: z.enum(['Uploaded', 'Extracting text', 'Text ready', 'Analysing', 'Done', 'Failed']),
      failReason: z.string().optional(),
      pages: z.number().int().nonnegative().optional(),
      textPrefix: z.string().optional(),
    })).optional(),
    results: z.object({ clauses: z.number().int(), checklist: z.number().int(), qualifications: z.number().int() }).optional(),
  });

  app.post('/internal/jobs/:jobId/progress', async (req) => {
    const token = process.env.INTERNAL_TOKEN;
    const given = req.headers['x-internal-token'];
    if (!token || typeof given !== 'string' || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) throw unauthorized('Invalid internal token');
    const { jobId } = parse(z.object({ jobId: uuid }), req.params);
    const b = parse(Progress, req.body);
    const ev = await withTx(pool, async (c) => {
      const job = await one<{ id: string; tender_id: string; status: string; is_reprocess: boolean }>(c, 'SELECT id, tender_id, status, is_reprocess FROM processing_jobs WHERE id = $1 FOR UPDATE', [jobId]);
      if (!job) throw notFound('Job');
      const tenderId = job.tender_id;
      if (b.stage !== undefined || b.status || b.executionArn) {
        await c.query(
          `UPDATE processing_jobs SET stage = COALESCE($2, stage), stage_label = COALESCE($3, stage_label), status = COALESCE($4::job_status, status),
             execution_arn = COALESCE($5, execution_arn), error = COALESCE($6, error),
             finished_at = CASE WHEN $4 IN ('completed','failed') THEN now() ELSE finished_at END
           WHERE id = $1`,
          [jobId, b.stage ?? null, b.stage ? PROCESS_STAGES[b.stage - 1] : null, b.status ?? null, b.executionArn ?? null, b.error ?? null]);
      }
      for (const d of b.documents ?? []) {
        await c.query(
          `UPDATE tender_documents SET status = $3, fail_reason = $4, pages = COALESCE($5, pages),
             text_extracted = CASE WHEN $3 IN ('Text ready','Analysing','Done') THEN true ELSE text_extracted END,
             text_s3_prefix = COALESCE($6, text_s3_prefix)
           WHERE id = $1 AND tender_id = $2`,
          [d.documentId, tenderId, d.status, d.status === 'Failed' ? (d.failReason ?? 'Extraction failed') : null, d.pages ?? null, d.textPrefix ?? null]);
        await c.query(
          `INSERT INTO processing_job_documents (job_id, document_id, status, fail_reason, pages, finished_at) VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (job_id, document_id) DO UPDATE SET status = EXCLUDED.status, fail_reason = EXCLUDED.fail_reason, pages = EXCLUDED.pages, finished_at = now()`,
          [jobId, d.documentId, d.status, d.failReason ?? null, d.pages ?? null]);
      }
      if (b.stage !== undefined && b.stage >= 2) {
        await c.query(`UPDATE tender_documents SET status = 'Analysing', text_extracted = true WHERE tender_id = $1 AND deleted_at IS NULL AND status IN ('Extracting text','Text ready')`, [tenderId]);
      }
      const retry = b.mode === 'retry-document';
      if (b.status === 'completed' && retry) {
        const repaired = (await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM processing_job_documents WHERE job_id = $1 AND status = 'Text ready'`, [jobId]))!.n;
        if (repaired) await c.query('SELECT mark_results_out_of_date($1, 0, 0, $2)', [tenderId, repaired]);
      }
      if (b.status === 'failed' && retry) {
        // the job's document never got a per-document result (the run failed before ReportDocuments)
        await c.query(`UPDATE tender_documents SET status = 'Failed', fail_reason = $2 WHERE tender_id = $1 AND deleted_at IS NULL AND status = 'Extracting text'`, [tenderId, b.error ?? 'Text extraction failed']);
        await audit(c, SYSTEM_ACTOR, { action: 'Processing failed', detail: b.error ?? 'Document retry failed', tenderId, section: 'Documents' });
      }
      if (b.status === 'completed' && !retry) {
        await c.query(`UPDATE tender_documents SET status = 'Done', text_extracted = true WHERE tender_id = $1 AND deleted_at IS NULL AND status = 'Analysing'`, [tenderId]);
        await c.query(`UPDATE tenders SET last_processed_at = now(), out_of_date_added = 0, out_of_date_removed = 0, out_of_date_repaired = 0, process_failed = NULL, workflow_step = GREATEST(workflow_step, 1) WHERE id = $1`, [tenderId]);
        const counts = b.results ?? (await one<{ clauses: number; checklist: number; qualifications: number }>(c,
          `SELECT (SELECT count(*) FROM clauses WHERE tender_id = $1)::int AS clauses, (SELECT count(*) FROM checklist_items WHERE tender_id = $1)::int AS checklist, (SELECT count(*) FROM qualifications WHERE tender_id = $1)::int AS qualifications`, [tenderId]))!;
        const failed = (await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM tender_documents WHERE tender_id = $1 AND deleted_at IS NULL AND status = 'Failed'`, [tenderId]))!.n;
        await audit(c, SYSTEM_ACTOR, { action: 'Processing completed', detail: `${counts.clauses} clauses, ${counts.checklist} submission documents, ${counts.qualifications} qualification requirements${failed ? `; ${failed} document${failed > 1 ? 's' : ''} failed` : ''}`, tenderId, section: 'Documents' });
      }
      if (b.status === 'failed' && !retry) {
        await c.query(`UPDATE tenders SET process_failed = $2 WHERE id = $1`, [tenderId, b.error ?? 'Processing failed']);
        await c.query(`UPDATE tender_documents SET status = 'Uploaded' WHERE tender_id = $1 AND deleted_at IS NULL AND status IN ('Extracting text','Text ready','Analysing')`, [tenderId]);
        await audit(c, SYSTEM_ACTOR, { action: 'Processing failed', detail: b.error ?? 'No results produced', tenderId, section: 'Documents' });
      }
      return { tenderId, jobId, status: b.status ?? job.status, stage: b.stage };
    });
    await bus.publish({ tenderId: ev.tenderId, type: 'job', jobId: ev.jobId, status: ev.status, stage: ev.stage });
    return { ok: true };
  });

  void cfg;
}
