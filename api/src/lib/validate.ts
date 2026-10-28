import { z } from 'zod';

/** Parses with zod; a ZodError propagates to the error handler as 400. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');
export const nonEmpty = z.string().trim().min(1);

export const TenderParams = z.object({ id: uuid });
