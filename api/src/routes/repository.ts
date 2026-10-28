// Historical data repository: records, archive to S3 Glacier, asynchronous
// restore, and file downloads.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan } from '../auth/rbac.js';
import { many, one, withTx } from '../db/pool.js';
import { audit, SYSTEM_ACTOR } from '../lib/audit.js';
import { conflict, locked, notFound } from '../lib/errors.js';
import { formatSize } from '../lib/tenderDto.js';
import { parse, uuid } from '../lib/validate.js';
import type { RepoRecord } from '../types.js';

const RECORD_SQL = `
  SELECT r.*, COALESCE(o.name, r.owner_name) AS owner_display,
    (SELECT COALESCE(json_agg(json_build_object('v', v.v, 'date', v.on_date, 'by', v.by_name, 'note', v.note) ORDER BY v.v), '[]') FROM repository_record_versions v WHERE v.record_id = r.id) AS versions,
    (SELECT COALESCE(json_agg(json_build_object('id', f.id, 'name', f.name, 'sizeBytes', f.size_bytes, 'storageClass', f.storage_class) ORDER BY f.name), '[]') FROM repository_files f WHERE f.record_id = r.id) AS files
  FROM repository_records r LEFT JOIN users o ON o.id = r.owner_id`;

const iso = (v: Date | string | null | undefined) => (v == null ? undefined : v instanceof Date ? v.toISOString() : String(v));

function mapRecord(r: any): RepoRecord {
  return {
    id: r.id, name: r.name, agency: r.agency, kind: r.kind, type: r.type, status: r.status, statusReason: r.status_reason, owner: r.owner_display,
    tenderId: r.tender_id ?? undefined, created: r.created_on, updated: r.updated_on,
    documents: (r.files as { name: string }[]).map((f) => f.name), files: r.files, versions: r.versions,
    archived: r.archived_at ? { sizeFrom: formatSize(r.archived_size_from), sizeTo: formatSize(r.archived_size_to), at: iso(r.archived_at)!.slice(0, 10) } : undefined,
    restore: r.restore_state ? { state: r.restore_state, requestedAt: iso(r.restore_requested_at)!, expiresAt: iso(r.restore_expires_at) } : undefined,
  };
}

/** Glacier Flexible Retrieval; cold enough for archive, restorable in hours. */
const ARCHIVE_CLASS = 'GLACIER' as const;
const RESTORE_DAYS = 7;

export async function repositoryRoutes(app: FastifyInstance) {
  const { pool, storage, cfg } = app.ctx;
  const recordsOf = () => many<any>(pool, `${RECORD_SQL} WHERE r.deleted_at IS NULL ORDER BY r.updated_on DESC, r.name`).then((r) => r.map(mapRecord));
  const recordOf = async (id: string) => {
    const r = await one<any>(pool, `${RECORD_SQL} WHERE r.id = $1 AND r.deleted_at IS NULL`, [id]);
    if (!r) throw notFound('Record');
    return mapRecord(r);
  };

  app.get('/api/repository', async () => recordsOf());
  app.get('/api/repository/:id', async (req) => recordOf(parse(z.object({ id: uuid }), req.params).id));

  /** Archive: files move to Glacier; the record stays searchable by metadata. */
  app.post('/api/repository/:id/archive', async (req) => {
    assertCan(req, 'manageRepo', 'Only the BD team archives records');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const rec = await recordOf(id);
    if (rec.status === 'Archived') throw conflict('Record is already archived');
    const files = await many<{ id: string; s3_key: string; size_bytes: number }>(pool, 'SELECT id, s3_key, size_bytes FROM repository_files WHERE record_id = $1', [id]);
    let sizeFrom = 0;
    for (const f of files) {
      const head = await storage.head(f.s3_key);
      sizeFrom += head?.size ?? f.size_bytes;
      if (head && head.storageClass !== ARCHIVE_CLASS) await storage.changeStorageClass(f.s3_key, ARCHIVE_CLASS);
      await pool.query('UPDATE repository_files SET storage_class = $2, size_bytes = $3 WHERE id = $1', [f.id, ARCHIVE_CLASS, head?.size ?? f.size_bytes]);
    }
    // Glacier stores the same bytes; the "compressed to" figure is the billed footprint estimate (~24%)
    const sizeTo = Math.round(sizeFrom * 0.24);
    await withTx(pool, async (c) => {
      await c.query(`UPDATE repository_records SET status = 'Archived', archived_at = now(), archived_size_from = $2, archived_size_to = $3, restore_state = NULL, restore_requested_at = NULL, restore_available_at = NULL, restore_expires_at = NULL, updated_on = current_date WHERE id = $1`, [id, sizeFrom, sizeTo]);
      await audit(c, req.user, { action: 'Record archived', detail: `${rec.name} - compressed ${formatSize(sizeFrom)} to ${formatSize(sizeTo)}`, section: 'Historical data' }, req);
    });
    return recordOf(id);
  });

  /** Request a restore of every archived file; completes asynchronously. */
  app.post('/api/repository/:id/restore', async (req, reply) => {
    assertCan(req, 'manageRepo');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const rec = await recordOf(id);
    if (rec.status !== 'Archived') throw conflict('Only archived records need a restore');
    if (rec.restore?.state === 'requested') throw conflict('Restore already requested');
    const files = await many<{ s3_key: string }>(pool, 'SELECT s3_key FROM repository_files WHERE record_id = $1', [id]);
    for (const f of files) await storage.requestRestore(f.s3_key, RESTORE_DAYS);
    await withTx(pool, async (c) => {
      await c.query(`UPDATE repository_records SET restore_state = 'requested', restore_requested_at = now(), restore_requested_by = $2, restore_available_at = NULL, restore_expires_at = NULL WHERE id = $1`, [id, req.user.id]);
      await audit(c, req.user, { action: 'Restore requested', detail: rec.name, section: 'Historical data' }, req);
    });
    return reply.status(202).send(await recordOf(id));
  });

  /** Poll: flips to "available" once every file is readable again. */
  app.get('/api/repository/:id/restore', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const rec = await recordOf(id);
    if (rec.restore?.state !== 'requested') return rec;
    const files = await many<{ s3_key: string }>(pool, 'SELECT s3_key FROM repository_files WHERE record_id = $1', [id]);
    const readable = await Promise.all(files.map((f) => storage.isReadable(f.s3_key)));
    if (files.length && readable.every(Boolean)) {
      await withTx(pool, async (c) => {
        await c.query(`UPDATE repository_records SET restore_state = 'available', restore_available_at = now(), restore_expires_at = now() + ($2 || ' days')::interval WHERE id = $1 AND restore_state = 'requested'`, [id, String(RESTORE_DAYS)]);
        await audit(c, SYSTEM_ACTOR, { action: 'Restore completed', detail: `${rec.name} - files available`, section: 'Historical data' });
      });
    }
    return recordOf(id);
  });

  app.get('/api/repository/:id/files/:fileId/download', async (req) => {
    const { id, fileId } = parse(z.object({ id: uuid, fileId: uuid }), req.params);
    const rec = await recordOf(id);
    const f = await one<{ name: string; s3_key: string; s3_version_id: string | null }>(pool, 'SELECT name, s3_key, s3_version_id FROM repository_files WHERE id = $1 AND record_id = $2', [fileId, id]);
    if (!f) throw notFound('File');
    if (rec.status === 'Archived' && !(await storage.isReadable(f.s3_key))) throw locked('Archived: request a restore first - archived files cannot be opened directly');
    await audit(pool, req.user, { action: 'File downloaded', detail: `${rec.name} - ${f.name}`, section: 'Historical data' }, req);
    return { url: await storage.presignDownload(f.s3_key, f.name, f.s3_version_id ?? undefined), fileName: f.name, expiresIn: cfg.PRESIGN_TTL_SECONDS };
  });

  /** Create a record (e.g. when a tender closes) and register its stored files. */
  app.post('/api/repository', async (req, reply) => {
    assertCan(req, 'manageRepo');
    const b = parse(z.object({
      name: z.string().trim().min(1), agency: z.string().trim().min(1), kind: z.enum(['Tender', 'Proposal', 'Business case', 'BOM']), type: z.enum(['Agency', 'Commercial']),
      status: z.enum(['Open', 'Closed', 'Won', 'Lost']).default('Open'), statusReason: z.string().default('In Progress (Active)'), tenderId: uuid.optional(),
      files: z.array(z.object({ name: z.string().min(1), key: z.string().min(1), sizeBytes: z.number().int().nonnegative().default(0), contentType: z.string().optional() })).default([]),
      note: z.string().default('Record created'),
    }), req.body);
    const id = await withTx(pool, async (c) => {
      const r = await one<{ id: string }>(c,
        `INSERT INTO repository_records (name, agency, kind, type, status, status_reason, owner_id, owner_name, tender_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [b.name, b.agency, b.kind, b.type, b.status, b.statusReason, req.user.id, req.user.name, b.tenderId ?? null]);
      await c.query('INSERT INTO repository_record_versions (record_id, v, on_date, by_name, note) VALUES ($1, 1, current_date, $2, $3)', [r!.id, req.user.name, b.note]);
      for (const f of b.files) await c.query('INSERT INTO repository_files (record_id, name, size_bytes, content_type, s3_key) VALUES ($1, $2, $3, $4, $5)', [r!.id, f.name, f.sizeBytes, f.contentType ?? null, f.key]);
      await audit(c, req.user, { action: 'Record created', detail: `${b.name} (${b.kind})`, section: 'Historical data' }, req);
      return r!.id;
    });
    return reply.status(201).send(await recordOf(id));
  });
}
