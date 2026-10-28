# Project overview
TendrAI is an internal tool for LPS that reads tender requirement documents (AI extraction of submission requirements, qualification requirements and categorized clauses, plus compliance tables), validates uploaded Excel business cases against Final Check rules, and fills MSPO templates. AI never generates costs or business cases.
Stack: React + TypeScript frontend, Node.js + TypeScript API, PostgreSQL (RDS), Terraform on AWS (ap-southeast-1), GitLab CI/CD.

# Repo layout
- `frontend/`  React app (design tokens in `frontend/src/theme/tokens.css`, UI primitives such as Button, toast and citation in `frontend/src/ui/`, shared feature components in `frontend/src/components/`). `frontend/legacy/app-v1/` is the frozen V1 POC; do not change it unless asked.
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
- Figures from business cases must pass through exactly as read. No rounding, reformatting or AI rewriting of numbers.
- A failed Final Check rule warns and never blocks. A template layout mismatch does block MSPO generation.
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

# When unsure
- If a library is missing, prefer a well-maintained library over custom code, and tell me which one and why.
- If a requirement is unclear or a change affects security or data residency, ask before writing code.
- State assumptions explicitly in your reply when you have to make one.