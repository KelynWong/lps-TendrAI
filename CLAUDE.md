# Project overview
TendrAI is an internal tool for LPS that reads tender requirement documents (AI extraction of submission requirements, qualification requirements and categorized clauses, plus compliance tables), drafts a first business case from the tender pack with AI, lets the BD team review and edit it, has the DRB approve it (each full approval archives that version and starts the next one as a copy), validates it against Final Check rules, and fills MSPO templates from the latest saved figures. The AI business case is only ever a draft: every AI-drafted figure carries its provenance (cited or estimate) until a person confirms it, and nothing is sent to MSPO or the DRB without a person saving a version. (V3; V2 validated uploaded Excel business cases instead.)
V3 status: the frontend (in-memory demo) implements this. The API, DB and Lambdas still implement the V2 upload flow; see "V3 backend follow-up" in `docs/USER_GUIDE.md`.
Stack: React + TypeScript frontend, Node.js + TypeScript API, PostgreSQL (RDS), Terraform on AWS (ap-southeast-1), GitLab CI/CD.

# Repo layout
- `frontend/`  React app (design tokens in `frontend/src/theme/tokens.css`, UI primitives such as Button, toast and citation in `frontend/src/ui/`, shared feature components in `frontend/src/components/`). The business case workspace (AI draft, seven workbook tabs, calculation engine, versions, .xlsx export) is in `frontend/src/businessCase/`. `frontend/legacy/app-v1/` (V1 POC) and `frontend/legacy/app-v2/` (V2, Excel upload) are frozen; do not change them unless asked.
- `api/`       Node.js API server (Fastify, zod, pg)
- `lambdas/`   Workflow Lambdas, Python, one folder per function (`text_extractor_word`, `text_extractor_excel`, `text_normalizer`, `analyser`, `result_loader`, `status_updater`); packaged by `infra/modules/tendrai/lambda.tf`
- `infra/`     Terraform (modules in `infra/modules/`, environments in `infra/envs/`: `prod` = real AWS, `floci` = local emulator, `demo` = static hosting for the V1 POC)
- `db/`        Schema (`schema.sql`), seed data and schema docs
- `.gitlab-ci.yml`  Pipeline (not created yet)
- `docs/`      User guide, architecture, API and runbooks (the V1 POC's demo guide and walkthrough live in `frontend/legacy/app-v1/`)

# Commands
Each package installs separately with npm (no root workspace). Run these from the repo root.
- Install: `npm --prefix frontend install` and `npm --prefix api install`
- Frontend dev / build: `npm --prefix frontend run dev` | `npm --prefix frontend run build` (the build runs `tsc -b`, so it is also the frontend typecheck). No test runner or linter is set up yet.
- Demo documents: `npm --prefix frontend run mock-docs` regenerates the PDF/Word/Excel files under `frontend/public/mock-documents/` (and `src/data/mockDocumentFiles.ts`) from the mock data, so cited passages can be found and highlighted. Re-run it after changing `frontend/src/data/mock.ts` or the AI draft's citations.
- API dev / typecheck / build: `npm --prefix api run dev` | `npm --prefix api run typecheck` | `npm --prefix api run build`. No test runner or linter is set up yet.
- Terraform (no AWS calls): `terraform fmt -check -recursive infra`, then `terraform -chdir=infra/envs/<env> init -backend=false` and `terraform -chdir=infra/envs/<env> validate`
- Terraform plan: only `terraform -chdir=infra/envs/floci plan` (Floci emulator running, see `infra/README.md`). `plan` on `prod` or `demo` calls real AWS, so only run it when I ask.
- DB schema: `npm --prefix api run db:schema` / `db:seed`. These apply `db/schema.sql` and `db/seed.sql` with psql against `$DATABASE_URL`. There is no migration tool yet. After any schema change, also run `npm --prefix api run db:roles` (least-privilege role grants, `db/roles.sql`; against real AWS follow `docs/runbooks/db-roles.md`, and only when I ask).
Run the typecheck/build for every package you touched, plus `terraform validate` for infra changes, before calling a task done. Never run `terraform apply` or any command against a real AWS account unless I ask.

# Engineering constraints
- Strict TypeScript in `frontend/` and `api/`. No `any`, no `@ts-ignore` without a comment explaining why. Lambdas in `lambdas/` are Python.
- Frontend: use existing design tokens and shared components only. Do not add new colours, fonts, or one-off styles. If a token or component is missing, ask before inventing one.
- API: validate every request body with a schema; check the caller's role on every endpoint (never rely on the UI hiding a button); return consistent error shapes.
- Database: schema changes only through migrations, never by editing the schema directly. Keep migrations reversible where possible.
- Audit log is append-only. Never write code that updates or deletes audit entries.
- Figures from a saved business case version pass through to Final Check, the DRB views, MSPO and the .xlsx export exactly as saved. No rounding, reformatting or AI rewriting of saved numbers (display formatting only). AI may only produce the first draft (v1) and must never change a version a person saved. The BD team chooses which version fills the MSPO templates (default: the latest approved).
- Everything is calculated in the quote currency: product lines may be priced in their vendor's currency and day rates come from the SGD rate card; both convert at the business case's applied exchange rates (`fxRate` / `toQuote` in `frontend/src/businessCase/calc.ts`), which a new AI draft copies from the company exchange rate defaults (Business case management). Totals in different currencies are never added together.
- The web app is the source of truth for the business case. The MSPO mapping points at business case fields in the app (`BC_FIELDS` in `frontend/src/mspo/mapping.ts`), not at Excel cells; the `.xlsx` download is for people's own reference.
- Every AI value shows its confidence: business case lines the match % of the past case they were drafted from, clause categories the classifier's score (`frontend/src/lib/confidence.ts`). Past business cases (other customers' prices) are visible to BD, Presales, Finance and the DRB only (`canDo.viewHistoricalPricing`). Only BD edits the business case.
- Every AI-drafted business case value keeps its provenance (cited to a historical record or the tender pack, or marked as an estimate) until a person confirms or edits it. Reprocessing a tender never replaces an existing business case.
- Business case version numbers only increase on full DRB approval: v1 is the AI draft; when every DRB member has approved the latest version it is archived (never edited or deleted) and an identical working copy becomes the next version. So every version except the latest is approved. BD saves update the latest version in place (each save recorded in its `edits`) and void any approvals already given. Only the latest version can collect approvals; versions are never deleted.
- A failed Final Check rule warns and never blocks.
- AI/Bedrock calls: use the in-region model ID in `ap-southeast-1` only. Never use `global.*` or cross-region inference profiles (data residency requirement).
- Infrastructure: least-privilege IAM (no `*` actions or resources), encryption with KMS on S3 and RDS, no public access to the app server or database, no secrets in code, Terraform variables, or logs. Secrets come from Secrets Manager.
- Do not log document contents or personal data.
- Use IDs, not tender or customer names, in S3 keys and log lines.

# Domain vocabulary (use these terms consistently in code and UI)
Tender, Tender pack, Document, Clause, Business case, Version, Check, MSPO template, DRB. Statuses are defined as Postgres enums in `db/schema.sql` and mirrored in `frontend/src/types.ts` and `api/src/types.ts` (keep all three in sync); do not invent new status names.

# Workflow and conventions
- Branch names: `[feature/<ticket>-short-name]`; commits: `[convention]`.
- Make small, focused changes. For anything touching IAM, networking, or auth, explain the change and the risk in your reply.
- Update `docs/` when you change an API, a Terraform module's inputs, or a deployment step.
- The TendrAI version (v[major].[minor].[patch], bottom left of the footer and the sign-in page) is the `version` in each app's `package.json`, injected by its `vite.config.ts`. Bump it in `frontend/package.json` (and `package-lock.json`) for a release. V3 is 3.x, the frozen V2 is 2.0.0 and the V1 POC 1.0.0.

# When unsure
- If a library is missing, prefer a well-maintained library over custom code, and tell me which one and why.
- If a requirement is unclear or a change affects security or data residency, ask before writing code.
- State assumptions explicitly in your reply when you have to make one.