// Hands a committed processing job to the queue. Called only after the
// transaction that created the job row has committed, so the workflow never
// receives a jobId that a rollback removed. If the send fails the job is
// marked failed and the documents are put back the way the workflow's own
// failure path leaves them.
import type pg from 'pg';
import { withTx } from '../db/pool.js';
import { audit, SYSTEM_ACTOR } from './audit.js';
import { HttpError } from './errors.js';
import type { Queue, TenderJobMessage } from './sqs.js';

const QUEUE_FAILED = 'Could not queue the processing job';

export async function dispatchJob(pool: pg.Pool, queue: Queue, msg: TenderJobMessage): Promise<void> {
  let messageId: string | undefined;
  try {
    messageId = await queue.sendJob(msg);
  } catch {
    await withTx(pool, async (c) => {
      await c.query(`UPDATE processing_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [msg.jobId, QUEUE_FAILED]);
      const ids = msg.documents.map((d) => d.documentId);
      if (msg.mode === 'retry-document') {
        await c.query(`UPDATE tender_documents SET status = 'Failed', fail_reason = 'Text extraction service unavailable' WHERE id = ANY($1::uuid[]) AND status = 'Extracting text'`, [ids]);
      } else {
        await c.query(`UPDATE tenders SET process_failed = $2 WHERE id = $1`, [msg.tenderId, QUEUE_FAILED]);
        await c.query(`UPDATE tender_documents SET status = 'Uploaded' WHERE tender_id = $1 AND deleted_at IS NULL AND status IN ('Extracting text','Text ready','Analysing')`, [msg.tenderId]);
      }
      await audit(c, SYSTEM_ACTOR, { action: 'Processing failed', detail: QUEUE_FAILED, tenderId: msg.tenderId, section: 'Documents' });
    });
    throw new HttpError(503, `${QUEUE_FAILED}; try again shortly`);
  }
  await pool.query('UPDATE processing_jobs SET sqs_message_id = $2 WHERE id = $1', [msg.jobId, messageId ?? null]);
}
