// Entrypoint: wire config, PostgreSQL, the event bus, S3 and SQS, then listen.
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { EventBus } from './db/bus.js';
import { createStorage } from './lib/s3.js';
import { readDbCredentials } from './lib/secrets.js';
import { createQueue } from './lib/sqs.js';
import { buildApp } from './app.js';

async function main() {
  const cfg = loadConfig();
  if (cfg.db.secretArn) {
    // EC2: connect as the least-privilege tendrai_app role, never the master user
    const creds = await readDbCredentials(cfg.AWS_REGION, cfg.db.secretArn);
    cfg.db.user = creds.username;
    cfg.db.password = creds.password;
  }
  const pool = createPool(cfg);
  const storage = createStorage(cfg);
  const queue = createQueue(cfg);
  const bus = new EventBus(cfg, pool, console);

  const app = await buildApp({ cfg, pool, bus, storage, queue });
  await bus.start();
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  app.log.info({ port: cfg.PORT, auth: cfg.AUTH_MODE, bucket: cfg.DOCUMENTS_BUCKET, queue: queue.enabled }, 'TendrAI API ready');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close().catch(() => undefined);
    await bus.stop();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
