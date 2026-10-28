// Fastify application: plugins, auth hook, routes and the clause WebSocket.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { AppContext } from './context.js';
import { buildAuth, registerAuth } from './auth/index.js';
import { errorHandler } from './lib/errors.js';
import { meRoutes } from './routes/me.js';
import { tenderRoutes } from './routes/tenders.js';
import { documentRoutes } from './routes/documents.js';
import { processingRoutes } from './routes/processing.js';
import { checklistRoutes } from './routes/checklist.js';
import { qualificationRoutes } from './routes/qualifications.js';
import { clauseRoutes } from './routes/clauses.js';
import { submissionRoutes } from './routes/submission.js';
import { businessCaseRoutes } from './routes/businessCase.js';
import { mspoRoutes } from './routes/mspo.js';
import { libraryRoutes } from './routes/library.js';
import { rulesRoutes } from './routes/rules.js';
import { repositoryRoutes } from './routes/repository.js';
import { auditRoutes } from './routes/audit.js';
import { backupRoutes } from './routes/backup.js';
import { ClauseRooms } from './ws/clauseRoom.js';

export async function buildApp(ctx: Omit<AppContext, 'log'>) {
  const app = Fastify({
    logger: { level: ctx.cfg.LOG_LEVEL },
    trustProxy: ctx.cfg.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: (req) => (req.headers['x-amzn-trace-id'] as string | undefined) ?? crypto.randomUUID(),
  });
  const full: AppContext = { ...ctx, log: app.log };
  app.decorate('ctx', full);
  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin: full.cfg.corsOrigins.length ? full.cfg.corsOrigins : false,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-dev-user', 'x-requested-with'],
  });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  const auth = buildAuth(full.cfg, full.pool, app.log);
  registerAuth(app, auth);

  app.get('/health', async () => {
    await full.pool.query('SELECT 1');
    return { ok: true, service: 'tendrai-api', time: new Date().toISOString() };
  });

  const rooms = new ClauseRooms(full, auth);
  app.decorate('clauseRooms', rooms);
  rooms.register(app);

  await app.register(meRoutes);
  await app.register(tenderRoutes);
  await app.register(documentRoutes);
  await app.register(processingRoutes);
  await app.register(checklistRoutes);
  await app.register(qualificationRoutes);
  await app.register(clauseRoutes);
  await app.register(submissionRoutes);
  await app.register(businessCaseRoutes);
  await app.register(mspoRoutes);
  await app.register(libraryRoutes);
  await app.register(rulesRoutes);
  await app.register(repositoryRoutes);
  await app.register(auditRoutes);
  await app.register(backupRoutes);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    clauseRooms: ClauseRooms;
  }
}
