import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, details);
export const unauthorized = (m = 'Sign in required') => new HttpError(401, m);
export const forbidden = (m = 'Your role cannot do this') => new HttpError(403, m);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const conflict = (m: string, details?: unknown) => new HttpError(409, m, details);
export const locked = (m = 'This tender is closed and read-only') => new HttpError(423, m);

export function errorHandler(err: FastifyError | HttpError | ZodError, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.message, details: err.details ?? undefined });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23505') return reply.status(409).send({ error: 'Already exists', details: (err as { detail?: string }).detail });
  if (pgCode === '23503') return reply.status(409).send({ error: 'Referenced record does not exist', details: (err as { detail?: string }).detail });
  if (pgCode === '23514') return reply.status(400).send({ error: 'Constraint violated', details: (err as { detail?: string }).detail ?? err.message });
  const status = (err as FastifyError).statusCode ?? 500;
  if (status >= 500) req.log.error({ err }, 'unhandled error');
  return reply.status(status).send({ error: status >= 500 ? 'Internal error' : err.message });
}
