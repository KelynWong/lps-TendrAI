// Backup and redundancy: live bucket health plus the restore-test record.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan } from '../auth/rbac.js';
import { many, one } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { formatSize } from '../lib/tenderDto.js';
import { parse } from '../lib/validate.js';

export async function backupRoutes(app: FastifyInstance) {
  const { pool, storage, cfg } = app.ctx;

  app.get('/api/backup/status', async () => {
    const primary = await storage.bucketHealth();
    const second = cfg.BACKUP_BUCKET ? await storage.bucketHealth(cfg.BACKUP_BUCKET).catch(() => null) : null;
    const lastTest = await one<any>(pool, 'SELECT * FROM backup_restore_tests ORDER BY run_at DESC LIMIT 1');
    const replication = primary.replication[0];
    return {
      primary: { location: `S3 ${cfg.AWS_REGION} (${storage.bucket})`, status: 'Healthy', objects: primary.objects ?? 0, size: formatSize(primary.bytes ?? 0) },
      versioning: { status: primary.versioning, deleteProtection: primary.mfaDelete === 'Enabled' ? 'MFA delete enabled' : 'Versioned - deleted objects stay as non-current versions' },
      secondCopy: cfg.BACKUP_BUCKET
        ? { location: `S3 ${cfg.BACKUP_BUCKET_REGION} (${cfg.BACKUP_BUCKET})`, status: replication?.status === 'Enabled' ? 'Healthy' : 'Not replicating', objects: second?.objects ?? 0, size: formatSize(second?.bytes ?? 0) }
        : { location: 'Not configured', status: 'Not configured', objects: 0, size: '-' },
      lastBackup: lastTest?.run_at?.toISOString?.() ?? null,
      lastRestoreTest: lastTest ? { date: lastTest.run_at.toISOString().slice(0, 10), by: lastTest.run_by_name, result: lastTest.result, passed: lastTest.passed, filesRestored: lastTest.files_restored, demo: lastTest.is_demo } : null,
    };
  });

  app.get('/api/backup/restore-tests', async () => {
    const rows = await many<any>(pool, 'SELECT * FROM backup_restore_tests ORDER BY run_at DESC LIMIT 50');
    return rows.map((r) => ({ id: r.id, runAt: r.run_at.toISOString(), by: r.run_by_name, filesRestored: r.files_restored, passed: r.passed, result: r.result, demo: r.is_demo }));
  });

  /** Record a restore test (the restore itself runs out-of-band against the second copy). */
  app.post('/api/backup/restore-tests', async (req, reply) => {
    assertCan(req, 'manageRepo', 'Only the BD team records restore tests');
    const b = parse(z.object({ filesRestored: z.number().int().nonnegative().default(0), passed: z.boolean(), result: z.string().min(1), demo: z.boolean().default(false) }), req.body);
    await pool.query('INSERT INTO backup_restore_tests (run_by, run_by_name, files_restored, passed, result, is_demo) VALUES ($1, $2, $3, $4, $5, $6)', [req.user.id, req.user.name, b.filesRestored, b.passed, b.result, b.demo]);
    await audit(pool, req.user, { action: b.passed ? 'Restore test passed' : 'Restore test failed', detail: `${b.filesRestored} files - ${b.result}`, section: 'Backup' }, req);
    return reply.status(201).send({ ok: true });
  });
}
