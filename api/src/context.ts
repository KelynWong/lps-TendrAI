import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import type { EventBus } from './db/bus.js';
import type { Storage } from './lib/s3.js';
import type { Queue } from './lib/sqs.js';

export interface AppContext {
  cfg: Config;
  pool: pg.Pool;
  bus: EventBus;
  storage: Storage;
  queue: Queue;
  log: FastifyBaseLogger;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
