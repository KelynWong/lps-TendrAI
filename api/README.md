# TendrAI API server

Node.js 22 + TypeScript + Fastify. REST API and WebSocket backend for
`frontend`, backed by PostgreSQL (`db/schema.sql`), S3 and the SQS → Step
Functions processing workflow from `infra/`.

## Why Node.js rather than Go

Both run WebSockets well; the deciding factors were reuse and team fit, not
throughput:

- The domain already exists in TypeScript. `types.ts`, the Final Check rules
  engine (`rules/finalChecks.ts`), the MSPO mapping logic and the `xlsx`
  parsing of business cases run on the server unchanged (ported here under
  `src/domain/`). In Go every one of them would be rewritten and kept in sync
  by hand.
- One language end to end: the React team maintains the API, DTOs are the same
  shapes the UI renders, and zod schemas double as the request contract.
- The workload is low-volume and I/O-bound (tens of users, uploads to S3,
  short queries); the heavy lifting (Textract, Bedrock) runs in Lambdas. Go's
  CPU and memory advantage would never be exercised; Node's event loop handles
  thousands of idle WebSocket connections per task without effort.
- Fan-out across ECS tasks uses PostgreSQL `LISTEN/NOTIFY`, so no Redis is
  needed for the live-edit feature.

Go would be the better choice if the API had to do CPU-heavy work in-process
(PDF rendering, large spreadsheet generation at scale) or ship as a single
static binary to constrained hosts. Neither applies here.

## Layout

```
src/
  index.ts            bootstrap (config, pool, bus, S3, SQS, listen)
  app.ts              Fastify app: cors, websocket, auth hook, routes
  config.ts           env validation
  auth/               Cognito/ALB/dev authentication, RBAC (mirror of frontend canDo)
  db/pool.ts          pg pool, transactions
  db/bus.ts           LISTEN/NOTIFY event bus (cross-instance WebSocket fan-out)
  lib/                audit writer, S3 + SQS helpers, DTO loaders, errors, zod helpers
  domain/             Final Check engine, business case workbook parser, template matching
  routes/             one file per resource (see API below)
  ws/clauseRoom.ts    live clause / compliance editing rooms
```

## Running locally

```powershell
cd api
copy .env.example .env          # edit DB and bucket settings
npm install
npm run db:schema; npm run db:seed   # needs psql and DATABASE_URL
npm run dev                     # http://localhost:8080
```

With `AUTH_MODE=dev`, send `x-dev-user: felicia.phan@lpstech.com` (any seeded
user). On AWS, sign-in goes through the ALB's Cognito action
(`AUTH_MODE=alb`). The API verifies the Cognito access token the ALB forwards
(`x-amzn-oidc-accesstoken`): signature, issuer, client id, token use and
expiry. It checks against the pool's public keys in `COGNITO_JWKS_PATH`,
which CI bundles with `npm run fetch:jwks`, because the instances have no
internet access. The ALB's `x-amzn-oidc-data` is used only for email and name,
and only when its `sub` matches the verified token. Users are matched by
Cognito `sub`. API clients can send `Authorization: Bearer <Cognito token>`
(`AUTH_MODE=cognito`), which is verified the same way. Any failure is a 401.
If Cognito rotates its keys, see
[docs/runbooks/cognito-keys.md](../docs/runbooks/cognito-keys.md).

Build: `npm run build` (the pipeline in `infra/modules/tendrai/cicd.tf` builds the
revision and CodeDeploy installs it in place on the EC2 instances).

## Conventions

- JSON everywhere; ids are UUIDs; dates are `yyyy-mm-dd`, timestamps ISO-8601.
- Errors: `{ error, details? }` with 400 (validation), 401, 403 (role), 404,
  409 (duplicate / stale version / job already running), 423 (tender closed).
- Files never pass through the API. Uploads are **presign → PUT to S3 →
  confirm**; downloads return a short-lived presigned URL. Every download is
  audited. The browser's PUT must send `x-amz-server-side-encryption: aws:kms`
  (the presigned URL signs that header and the bucket policy requires it).
- Every mutation writes one audit entry in the same transaction and publishes
  a tender event on the bus (relayed to WebSocket clients of that tender).

## API

### Session
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB ping (no auth) |
| GET | `/api/me` | user + permission map (`canDo`) |
| POST | `/api/me/session`, `/api/me/logout` | audit "Signed in" / "Signed out" |
| GET | `/api/users` | directory for owner pickers; `PATCH /api/users/:id` (admin) |

### Tenders
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/tenders` | any | list rows with counts, latest BC figures, attention items |
| POST | `/api/tenders` | bd, bidding-manager | 409 on duplicate title |
| GET | `/api/tenders/:id` | any | full tender (pack, checklist, quals, clauses+history, BC versions+checks, MSPO, gen docs) |
| PATCH | `/api/tenders/:id` | bd, bidding-manager | details; audit lists field changes |
| DELETE | `/api/tenders/:id` | bd, bidding-manager | soft delete |
| PUT | `/api/tenders/:id/status` | bd, bidding-manager | `{status, statusReason}` |
| PUT | `/api/tenders/:id/step` | editors | `{idx}` (monotonic) |
| PUT | `/api/tenders/:id/drb` | drb | `{outcome?, notes?}` |

### Tender pack documents
| Method | Path | Notes |
|---|---|---|
| POST | `/api/tenders/:id/documents/presign` | `{files:[{name,sizeBytes,contentType}]}` → `[{documentId,key,url}]`; 409 duplicates (name+size) |
| POST | `/api/tenders/:id/documents` | confirm `{files:[{documentId,name,sizeBytes,key}]}` (verified in S3) |
| PUT | `/api/tenders/:id/documents/:docId/role` | `{role}` |
| POST | `/api/tenders/:id/documents/:docId/move` | `{direction:'up'|'down'}` |
| DELETE | `/api/tenders/:id/documents/:docId` | soft delete (30-day window) |
| POST | `/api/tenders/:id/documents/:docId/retry` | re-extract one failed document |
| GET | `/api/tenders/:id/documents/:docId/download` | presigned URL |

### Processing
| Method | Path | Notes |
|---|---|---|
| POST | `/api/tenders/:id/process` | queues the job (SQS → Pipes → Step Functions); 409 if one is active |
| GET | `/api/tenders/:id/jobs` | history |
| POST | `/internal/jobs/:jobId/progress` | header `x-internal-token`; called by the status-updater Lambda: `{stage?, status?, error?, documents?:[…]}` |

### Submission checklist, qualifications, clauses
| Method | Path | Notes |
|---|---|---|
| PATCH | `/api/tenders/:id/checklist/:itemId` | `{status?, ownerId?, owner?, templateId?, keepDraft?}` |
| POST / PUT / DELETE | `/api/tenders/:id/checklist/:itemId/draft` | generate / review / discard first draft; `GET …/draft/download` |
| POST | `/api/tenders/:id/template-search` | runs matching, proposes a template per item |
| PUT | `/api/tenders/:id/template-matches/:templateId` | `{confirmed}` |
| PATCH | `/api/tenders/:id/qualifications/:qualId` | `{evidence: libraryItemId|null}` |
| POST | `/api/tenders/:id/qualifications/match` | link certificates named in the requirements |
| GET | `/api/tenders/:id/clauses` | with history and `version` |
| PUT | `/api/tenders/:id/clauses` | `{patches:[{clauseId, version?, patch:{compliance?,category?,response?}}]}` → 200 or 409 with `conflicts` |
| GET | `/api/tenders/:id/clauses/:clauseId/history` | |
| GET | `/api/tenders/:id/clauses/export?format=xlsx|doc` | file download |
| POST / PATCH | `/api/tenders/:id/gen-docs`, `…/gen-docs/:docId` | generated documents |

### Business case and MSPO
| Method | Path | Notes |
|---|---|---|
| GET | `/api/tenders/:id/business-case` | versions with parsed data and Final Check results |
| POST | `/api/tenders/:id/business-case/presign` | `{fileName,sizeBytes}` → `{v,key,url}` |
| POST | `/api/tenders/:id/business-case` | confirm `{v,key,fileName,comment?}`: parses the workbook from S3, stores lines, runs Final Check; layout problems come back as `layoutUnrecognised.missingAnchors` |
| GET | `/api/tenders/:id/business-case/:v/download` | |
| DELETE | `/api/tenders/:id/business-case/:v` | |
| POST | `/api/tenders/:id/business-case/:v/checks` | re-evaluate with current rules |
| PUT | `/api/tenders/:id/mspo/details` | `{quoteLine?, fyCount?, daysPerMonth?, rows?, changes?}` |
| PUT / DELETE | `/api/tenders/:id/mspo/mapping` | override / reset one column (`?group=&target=`) or all |
| POST | `/api/tenders/:id/mspo/downloads` | records a template download (file is built in the browser) |

### Library, rules, repository, audit, backup
| Method | Path | Notes |
|---|---|---|
| GET | `/api/library?kind=template|boilerplate|certification|cv` | includes `usedBy`, `history`, `tags` |
| POST | `/api/library/presign` → POST `/api/library` | create or new version (`replaceId`); certificates require issuer, number, issued, expires |
| PATCH / DELETE | `/api/library/:id` | |
| GET | `/api/library/:id/versions/:version/download`, `/api/library/tags` | |
| GET / PUT / DELETE | `/api/rules`, `/api/rules/:id` | saving re-evaluates every business case version |
| GET / PUT | `/api/mspo-defaults`, `/api/mspo-defaults/:group` | |
| GET | `/api/repository`, `/api/repository/:id` | |
| POST | `/api/repository/:id/archive` | objects → Glacier |
| POST / GET | `/api/repository/:id/restore` | request / poll (flips to `available`) |
| GET | `/api/repository/:id/files/:fileId/download` | 423 while archived and not restored |
| GET | `/api/audit?from&to&tender&section&action&user&search&limit&offset` | `{total, entries}`; `/api/audit/facets` |
| POST | `/api/audit/events` | client-side events (`{action, detail, tenderId?, section?}`) |
| GET | `/api/backup/status`, `/api/backup/restore-tests`; POST `/api/backup/restore-tests` | |

## WebSocket: live clause editing

`ws(s)://host/ws/tenders/:tenderId/clauses` — one room per tender.

```
client → {type:'auth', token?}                          (first frame; ALB cookie / dev header also work)
client → {type:'focus'|'blur', clauseId, field}         field: compliance | category | response
client → {type:'draft', clauseId, field, value}         unsaved value others see live
client → {type:'save', patches:[{clauseId, version, patch}]}
server → {type:'ready', you, presence}
server → {type:'presence', users:[{id,name,role,editing:[{clauseId,field}]}]}
server → {type:'draft', clauseId, field, value, by}
server → {type:'clauses-updated', clauses:[Clause], by} (after any save, REST or WS, on any instance)
server → {type:'saved'|'conflict', clauses, conflicts}  ack to the saver
server → {type:'job'|'documents-changed'|'checklist-changed'|'business-case-changed'|'tender-updated', …}
```

Semantics: a save applies all non-conflicting patches, records one audit entry
(`Clause updated` / `Clauses updated`, exactly as the UI's `save-clauses`
action), appends to `clause_changes`, bumps `clauses.version` and broadcasts
the new rows. A patch whose `version` is stale comes back under `conflicts`
with the current clause so the editor can merge. Presence is per instance and
merged through the bus; stale instances age out after 60 s.

## frontend action → API mapping

| store action | call |
|---|---|
| `login` / `logout` | `POST /api/me/session` / `POST /api/me/logout` |
| `create-tender`, `update-tender`, `delete-tender`, `set-tender-status`, `set-step`, `set-drb` | tenders routes above |
| `add-pack-docs`, `correct-doc-role`, `move-pack-doc`, `remove-pack-doc`, `retry-doc` | documents routes |
| `start-processing` / `set-process-stage` / `finish-processing` | `POST …/process`; progress arrives over the WebSocket `job` event |
| `template-search-*`, `patch-checklist` (template, draft) | `POST …/template-search`, `PATCH …/checklist/:itemId`, `…/draft` |
| `patch-qual` | `PATCH …/qualifications/:qualId`, `POST …/qualifications/match` |
| `patch-clause`, `save-clauses` | `PUT …/clauses` or WebSocket `save` |
| `save-bc`, `approve-bc-version` (V3) | business case routes. The API still implements the V2 upload (presign / confirm) and version delete; V3 "save business case" and "approve version" are not built yet, see [V3 backend follow-up](../docs/USER_GUIDE.md#v3-backend-follow-up) |
| `set-mspo-details`, `set-mspo-meta`, `set-mspo-rows`, `set-mspo-mapping`, `reset-mspo-mapping` | `PUT …/mspo/details`, `PUT/DELETE …/mspo/mapping` |
| `upload-template`, `upload-boilerplate`, `update-*`, `delete-*` | library routes |
| `upsert-rule`, `delete-rule`, `set-mspo-defaults` | rules routes |
| `archive-repo`, `request-restore`, `complete-restore` | repository routes (poll `GET …/restore`) |
| `log` (downloads, exports) | `POST /api/audit/events` (server-side downloads are audited automatically) |
| `backup-restore-demo` | `POST /api/backup/restore-tests` |
