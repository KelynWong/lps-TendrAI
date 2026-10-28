---
name: documentation
description: Use when editing anything in docs/, any README.md (root, api/, infra/, infra/envs/demo/, db/, frontend/legacy/app-v1/), or after changing an API route, a Terraform module's inputs/outputs, a deployment step or the DB schema, since CLAUDE.md requires docs to be updated then. Holds where each doc lives, the API table format, a proposed runbook template and style rules.
---

# Writing and updating TendrAI docs

`CLAUDE.md` requires a `docs/` update when you change an API, a Terraform module's inputs, or a deployment step. Do the docs update in the same change as the code. Never leave it for later.

## What lives where (today)
| File | Holds | Update when |
|---|---|---|
| `README.md` | Product summary, folder table, PowerShell quick start | a top-level folder, install or run command changes |
| `docs/USER_GUIDE.md` | User guide for the current app (`frontend/`): roles, workflow steps with exact UI labels, statuses | user-visible flow, labels, roles or statuses change |
| `api/README.md` | Layout, running locally, Conventions (error codes, presign→PUT→confirm, audit + bus), API tables, WebSocket protocol, frontend action → API mapping | any route, error code, event type or env var changes |
| `infra/README.md` | Architecture → file mapping, layout, processing workflow, feature flags, Floci local testing, deploying to AWS, security posture | module inputs/outputs, resources, deploy steps change |
| `infra/envs/demo/README.md` | Static demo hosting for the V1 POC: connect, deploy, update, access control, teardown | demo env changes |
| `db/README.md` | Entity map, frontend → table mapping, design notes, S3 layout | schema, enum or S3 key layout changes |
| `frontend/legacy/app-v1/README.md`, `DEMO_GUIDE.md`, `WALKTHROUGH.md` | Frozen V1 POC notes, demo script and walkthrough (V1 had the AI draft a costed business case, which the current product does not do) | only when asked (the POC is frozen) |

## Intended `docs/` structure: not set up yet
CLAUDE.md and the root README say `docs/` holds architecture, API and runbooks, but only `USER_GUIDE.md` exists. Proposed layout (ask before creating it, and move content rather than duplicate it):
- `docs/architecture/`: diagrams and design decisions. Today this lives in `infra/README.md` (Architecture → file mapping) and `db/README.md`.
- `docs/api/`: per-resource endpoint reference. Today this lives in `api/README.md` "API".
- `docs/runbooks/`: one file per operational task (deploy, Floci reset, DB schema apply, restore test, demo teardown).

Until these folders exist, update the README that holds the content today. When you create one, link it from the root `README.md` folder table.

## API docs format
Follow the existing style in `api/README.md`. Endpoints are grouped under `### <Resource>` with this table:

```md
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/tenders` | bd, bidding-manager | 409 on duplicate title |
| PUT | `/api/tenders/:id/status` | bd, bidding-manager | `{status, statusReason}` |
```

- Method: uppercase. Several methods on one path may share a row (`POST / PUT / DELETE`).
- Path: in backticks, with `:param` placeholders and query parameters (`?format=xlsx|doc`).
- Role: the role values from `api/src/auth/rbac.ts` (`bd`, `bidding-manager`, `presales`, `delivery`, `finance`, `drb`, `admin`), or `any` / `editors`. The Role column is missing in some current tables (Session, documents, processing and later ones). Add it when you touch one of those rows.
- Notes: request body as `{field, optional?}`, the response shape if it is not the resource DTO (`→ {v,key,url}`), and any non-obvious status codes (409, 423).
- Audit: the README states the rule once under "Conventions" (one entry per mutation). Only note an endpoint's audit action when it is special, e.g. `audit "Signed in"`, or downloads.
- Also update "frontend action → API mapping" and, for new bus event types, the "WebSocket" block.
- Proposal: if `docs/api/` is created, use one section per endpoint with Method + path, Roles, Body (zod fields), Response, Errors, Audit action and Bus event. Ask first.

## Runbook template (proposed, no runbooks exist yet)
~~~md
# <Task name>

**Purpose:** one sentence on what this achieves.
**When to use:** trigger or symptom.
**Prerequisites:** tools and versions, access/role, env (floci | prod | demo), files needed.

## Steps
1. <What and why>
   ```powershell
   terraform -chdir=infra/envs/floci plan
   ```
2. ...

## Verification
Exact command and the expected output.

## Rollback
Exact commands to undo, or "not reversible" plus what to do instead.

## Escalation
Who to contact (team/role, not a personal phone number) and what to include (request id, job id, tender id).
~~~
Commands touching real AWS (`prod`, `demo`) must say so in bold before the step. Never tell the reader to run `terraform apply` on prod without the approval step.

## Style rules
- Use IDs, not names. Example values use tender, job, document and request IDs (UUIDs), never real tender or customer names. Personal names appear only for the seeded demo users already in `db/seed.sql`.
- No secrets. Never paste keys, tokens, passwords, connection strings with credentials, account IDs or real tfvars values. Point to Secrets Manager or to the `*.example` files (`api/.env.example`, `infra/envs/demo/demo.tfvars.example`).
- Use PowerShell for commands. The team is on Windows, so use ```` ```powershell ```` fences.
  - Environment variables are `$env:DATABASE_URL`, not `$DATABASE_URL` (as in db/README.md).
  - Chain commands with `;`, not `&&`.
  - Quote `-var-file` (`terraform plan '-var-file=demo.tfvars'`, as in infra/envs/demo/README.md).
  - Prefer the root-relative forms from CLAUDE.md: `npm --prefix api ...`, `terraform -chdir=infra/envs/<env> ...`.
- Links are relative: `[infra/README.md](infra/README.md#local-testing-with-floci)`. Adjust `../` from inside `docs/`. External links are only for third-party tools.
- Use the domain vocabulary from CLAUDE.md (Tender, Tender pack, Document, Clause, Business case, Version, Check, MSPO template, DRB). Status names must match `db/schema.sql` exactly.
- Docs must not claim the AI produces costs or business cases. Business case figures come from the uploaded Excel, as read.
- Keep each fact in one place and link to it from elsewhere. For example, error codes live in api/README.md "Conventions" and are not repeated per doc.

## Checklist after a code change
- API route changed: update api/README.md (API table, mapping, WebSocket if events changed) and, if user-visible, docs/USER_GUIDE.md.
- Terraform module input/output changed: update infra/README.md (feature flags / layout / deploying) and any env README that sets it.
- Deploy step changed: update infra/README.md "Deploying to real AWS" or infra/envs/demo/README.md, plus the runbook if one exists.
- Schema/enum changed: update db/README.md, and check that `api/src/types.ts` and `frontend/src/types.ts` match.
