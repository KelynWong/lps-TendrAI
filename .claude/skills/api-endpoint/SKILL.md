---
name: api-endpoint
description: Use when adding or changing an HTTP route in api/src/routes/*.ts, or touching api/src/auth (rbac.ts, index.ts), api/src/lib/validate.ts, lib/errors.ts or lib/audit.ts, api/src/db/bus.ts, or api/src/types.ts. Covers route layout and registration, zod validation, role checks, the error format, audit logging, bus events, docs and a proposed test template.
---

# Adding or changing an API endpoint

Read `CLAUDE.md` first. Its rules apply: every body validated, every endpoint role-checked, consistent errors, append-only audit, no `any`, no logging of document contents or personal data, IDs not names in S3 keys and logs. Auth changes need an explanation of the change and its risk in your reply.

Verify with `npm --prefix api run typecheck`, then `npm --prefix api run build`.

## Layout (`api/src`, see also api/README.md "Layout")
- `app.ts`: `buildApp(ctx)` sets the error handler, CORS, websocket and auth hook, then registers each route plugin (app.ts:55-69).
- `routes/<resource>.ts`: one file per resource. Each exports `async function <resource>Routes(app: FastifyInstance)` and reads `const { pool, storage, bus, cfg, queue } = app.ctx`.
- `auth/index.ts`: resolves `req.user` for every `/api/*` URL (`registerAuth`); tokens are verified offline against bundled Cognito keys (`auth/jwks.ts`). `/health` and `/internal/*` skip it. `/internal/jobs/:jobId/progress` checks `x-internal-token` itself.
- `auth/rbac.ts`: `Role`, `canDo`, `assertCan`, `assertNotReadOnly`.
- `db/pool.ts`: `withTx`, `one`, `many`, `setClause`. `db/bus.ts` is the LISTEN/NOTIFY event bus.
- `lib/`: `validate.ts`, `errors.ts`, `audit.ts`, `s3.ts` (`keys(tenderId)`, ID-based keys), `sqs.ts`, `tenderDto.ts` (`tenderRow`, `assertUnlocked`, `refOf`, DTO mappers).
- `domain/`: Final Check engine, workbook parser, template matching. `ws/clauseRoom.ts`: live clause editing.

New resource: create `routes/<resource>.ts`, import it in `app.ts`, and add `await app.register(<resource>Routes)`. Paths start with `/api/`, or the auth hook will not run.

## Handler order (copy this shape, from routes/checklist.ts:20-59)
```ts
const Params = z.object({ id: uuid, itemId: uuid });

app.patch('/api/tenders/:id/checklist/:itemId', async (req) => {
  assertNotReadOnly(req);                                  // 1. role
  const { id, itemId } = parse(Params, req.params);        // 2. validate params
  const b = parse(z.object({                               //    and body
    status: z.enum(['Not started', 'In progress', 'Done']).optional(),
    ownerId: uuid.nullable().optional(),
  }), req.body);
  assertCan(req, 'editChecklist', 'Only the Bidding Manager edits the submission checklist');
  await withTx(pool, async (c) => {                        // 3. one transaction
    const t = await tenderRow(c, id);                      //    404 if missing or deleted
    assertUnlocked(t);                                     //    423 if Won/Closed/archived
    const k = await one<{ item: string }>(c, 'SELECT item FROM checklist_items WHERE id = $1 AND tender_id = $2 FOR UPDATE', [itemId, id]);
    if (!k) throw notFound('Checklist item');
    await c.query('UPDATE checklist_items SET status = COALESCE($3::checklist_status, status) WHERE id = $1 AND tender_id = $2', [itemId, id, b.status ?? null]);
    await audit(c, req.user, { action: 'Submission item updated', detail: `${k.item}: ${b.status}`, tenderId: id, tenderRef: refOf(t), section: 'Submission' }, req);
  });
  await bus.publish({ tenderId: id, type: 'checklist-changed', by: req.user.name }); // 4. after commit
  return itemsOf(id);                                      // 5. fresh DTO
});
```

## Validation (`lib/validate.ts`)
- Parse every `req.params`, `req.query` and `req.body` with `parse(schema, data)`. A `ZodError` becomes a 400 automatically.
- Reuse the helpers: `uuid`, `isoDate` (yyyy-mm-dd), `nonEmpty` (trimmed, min 1), `TenderParams`.
- Enum fields use `z.enum([...])` with exactly the spellings from `db/schema.sql`.
- Use parameterised SQL only (`$1`). Never interpolate input into SQL.

## Role checks (`auth/rbac.ts`)
- Call `assertCan(req, '<permission>', 'Human reason')` at the top of every handler, before any read of protected data or any write.
- Call `assertNotReadOnly(req)` on mutations that any editor may do. It blocks finance and drb.
- Permissions are `canDo` keys (rbac.ts:17-34). `canDo` mirrors `frontend/src/config.ts` exactly, so a change to one must be made to both.
- Do not add a role without a schema enum change (`user_role`) and a mapping change in `GROUP_ROLE`. Ask first, because it affects auth.

## Errors (`lib/errors.ts`)
- Throw the helpers. Never `reply.send` an error by hand.
  - `badRequest(m, details?)` → 400
  - `unauthorized()` → 401
  - `forbidden()` → 403
  - `notFound('Thing')` → 404
  - `conflict(m, details?)` → 409
  - `locked()` → 423
- The shape is always `{ error, details? }`. Zod errors return `details: [{ path, message }]`.
- Postgres errors are mapped for you: 23505 → 409, 23503 → 409, 23514 → 400. Any 5xx returns `Internal error` and is logged.
- The codes in api/README.md "Conventions" are 400 validation, 401, 403 role, 404, 409 duplicate/stale version/job running, and 423 tender closed. Do not introduce other codes without updating that list.

## Audit (`lib/audit.ts`)
- Every mutation writes exactly one entry with `audit(c, req.user, { action, detail, tenderId?, tenderRef?, section? }, req)`.
- Pass the transaction client `c` from `withTx`, so the entry commits or rolls back with the change.
- For system actions use `SYSTEM_ACTOR`.
- Downloads are audited too.
- `audit_entries` is append-only. A trigger (`db/schema.sql:725`) rejects UPDATE/DELETE. Never write code that updates or deletes it.
- Keep `detail` free of document contents and personal data.
- Some older handlers call `audit(pool, ...)` outside a transaction (e.g. checklist.ts:107-109). Do not copy that. Use `withTx` for new code.

## Bus / WebSocket events (`db/bus.ts`)
- After the transaction commits, call `await bus.publish({ tenderId, type, by: req.user.name })`. Clients of that tender receive it over `/ws/tenders/:tenderId/clauses`.
- Existing types: `tender-updated`, `tender-deleted`, `documents-changed`, `checklist-changed`, `qualifications-changed`, `clauses-updated`, `business-case-changed`, `mspo-changed`, `job`. Reuse one where possible.
- If you add a new type, list it in api/README.md "WebSocket".
- Payload limit is about 7.5 KB. Send IDs, not bodies.

## Keep in sync
- Enums in `api/src/types.ts`, `db/schema.sql` and `frontend/src/types.ts` must match exactly. Do not invent status names.
- Schema changes go through migrations (CLAUDE.md). Not set up yet: there is no migration tool, only `npm --prefix api run db:schema`. Ask before choosing one.
- Docs: update the matching table in api/README.md "API" (Method | Path | Role | Notes) and the "frontend action → API mapping". Update `docs/` when an API changes (see the `documentation` skill).
- Do not copy `many<any>` (routes/audit.ts:32). Type the row.

## Tests: not set up yet (proposal)
No test runner exists in `api/package.json`. Ask before adding the dependency. Suggested: `vitest` as a devDependency plus an `npm --prefix api run test` script, using Fastify's built-in `app.inject` (no extra HTTP library). Proposed template, `api/src/routes/<resource>.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { EventBus } from '../db/bus.js';
import { createStorage } from '../lib/s3.js';
import { createQueue } from '../lib/sqs.js';
import { buildApp } from '../app.js';

// Needs AUTH_MODE=dev and DATABASE_URL pointing at a throwaway DB loaded with db/schema.sql + db/seed.sql.
const cfg = loadConfig();
const pool = createPool(cfg);
const app = await buildApp({ cfg, pool, bus: new EventBus(cfg, pool, console), storage: createStorage(cfg), queue: createQueue(cfg) });
const as = (email: string) => ({ 'x-dev-user': email });

describe('PATCH /api/tenders/:id/checklist/:itemId', () => {
  beforeAll(() => app.ready());
  afterAll(async () => { await app.close(); await pool.end(); });

  it('rejects an invalid body with 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/tenders/${crypto.randomUUID()}/checklist/${crypto.randomUUID()}`, headers: as('john.price@lpstech.com'), payload: { status: 'Nope' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error', 'Invalid request');
  });

  it('forbids a read-only role with 403', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/tenders/${crypto.randomUUID()}/checklist/${crypto.randomUUID()}`, headers: as('ruey.lin@lpstech.com'), payload: {} });
    expect(res.statusCode).toBe(403);
  });
});
```
Cover at least the following for each endpoint: 400 (bad body), 403 (wrong role), 404, 423 where `assertUnlocked` applies, the happy path, and one audit row written. The seeded users are in `db/seed.sql:123-132`.
