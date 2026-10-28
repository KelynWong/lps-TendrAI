# TendrAI — data model (PostgreSQL + S3)

`schema.sql` creates the RDS PostgreSQL 16 schema; `seed.sql` loads the
reference data (Final Check rules, MSPO mapping defaults, boilerplate tags and
the demo users). Everything frontend renders maps to a table below; binary files
live in S3 and the tables keep their keys.

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed.sql
npm --prefix api run db:roles     # roles.sql + role passwords, see below
```

## Database roles (`roles.sql`)

The master user owns every object and is used only for schema changes and
this bootstrap. Each component connects as its own login role:

| Role | Used by | Can | Cannot |
|---|---|---|---|
| `tendrai_app` | API server (EC2) | read/write all data tables; INSERT + SELECT on `audit_entries` and `clause_changes` | UPDATE/DELETE/TRUNCATE audit rows, any DDL, drop or disable triggers, create roles |
| `tendrai_status_updater` | status updater Lambda | job and document progress, tender completion columns, insert system audit entries, count results | read clause/requirement text, users or the audit log |
| `tendrai_result_loader` | result loader Lambda | write `tenders.overview`/`suggestions`, clauses, checklist items, qualifications, document chunks | delete clauses, touch jobs, write audit entries, read users |

Passwords live in Secrets Manager (`infra/modules/tendrai/secrets.tf`,
`db_role`). [docs/runbooks/db-roles.md](../docs/runbooks/db-roles.md) covers
bootstrap and rotation. `roles.sql` is idempotent: re-run `db:roles` after
every schema change so new tables get their grants. A new append-only table
also needs an explicit `REVOKE UPDATE, DELETE` for `tendrai_app`, because the
default privileges grant them.

Requires the `vector`, `pgcrypto`, `citext` and `pg_trgm` extensions, all
shipped with RDS PostgreSQL 16.

## Entity map

```
users ─┬─< tenders ─┬─< tender_documents ─< document_chunks (text + embedding, per page)
       │            ├─< processing_jobs ─< processing_job_documents
       │            ├─< checklist_items ─> library_items (template, draft template)
       │            ├─< qualifications ──> library_items (certificate / CV evidence)
       │            ├─< clauses ─< clause_changes               ← live compliance edits
       │            ├─── tender_template_searches ─< tender_template_matches ─> library_items
       │            ├─< gen_docs ─> library_items
       │            ├─< bc_versions ─┬─< bc_products
       │            │                ├─< bc_resources
       │            │                ├─< bc_billing
       │            │                └─< final_check_results ─> final_check_rules
       │            ├─< tender_mspo_mappings        (overrides of mspo_mapping_defaults)
       │            └─< mspo_downloads
       ├─< library_items ─┬─< library_item_versions (one row per uploaded file)
       │                  └─< library_item_tags ─> tags
       ├─< repository_records ─┬─< repository_record_versions
       │                       └─< repository_files
       ├─< backup_restore_tests
       └─< audit_entries  (append-only)
```

## How frontend concepts map

| frontend (`src/types.ts`) | Tables / columns |
|---|---|
| `Tender` header, status, stepIdx, DRB, MSPO settings, archive | `tenders` (one row; `workflow_step`, `drb_*`, `mspo_*`, `archived_*`) |
| `Tender.pack: PackDoc[]` | `tender_documents` (S3 key, role, status, pages, soft delete) |
| `Tender.job: ProcessingJob` | `processing_jobs` (partial unique index: one queued/running job per tender) |
| `Tender.outOfDate`, `processFailed`, `lastProcessedAt` | `tenders.out_of_date_*`, `process_failed`, `last_processed_at` |
| `ChecklistItem` (+ `draft`) | `checklist_items` (`draft_*` columns, `template_id`) |
| `Qualification` (+ `evidence`) | `qualifications.evidence_item_id` |
| `Clause` (+ `history`, `reviewedBy`, `reviewState`) | `clauses` (+ `version` for concurrent edits), `clause_changes` |
| citations: text around a clause, page navigation | `document_chunks` (page-aware text, pgvector embedding) |
| `TemplateSearch` / `TemplateMatch` | `tender_template_searches`, `tender_template_matches` |
| `GenDoc` | `gen_docs` |
| `BcVersion` (+ `data.header`) | `bc_versions` (header columns, `cells` jsonb of raw numeric cells) |
| `BcProduct` / `BcResource` / `BcBilling` | `bc_products`, `bc_resources`, `bc_billing` |
| Final Check results (`runFinalChecks`) | `final_check_results` cache, recomputed when rules change |
| `RuleDef` (`DEFAULT_RULES`) | `final_check_rules` (`definition` jsonb holds the kind-specific fields) |
| `MspoDefaults` (`DEFAULT_MSPO_MAPPING`) | `mspo_mapping_defaults` (one row per template column, ordered) |
| `Tender.mspoMapping["plan:target"]` | `tender_mspo_mappings` |
| `Tender.mspoRows/QuoteLine/FyCount/DaysPerMonth` | `tenders.mspo_rows_*`, `mspo_quote_line`, `mspo_fy_count`, `mspo_days_per_month` |
| `TemplateDoc`, `Boilerplate` (certificates, CVs) | `library_items` (`kind`), `library_item_versions` (history), `tags` |
| `TemplateDoc.usedBy` | view `v_template_usage` (checklist + gen_docs + confirmed matches) |
| `RepoRecord`, `RepoVersion`, `documents` | `repository_records`, `repository_record_versions`, `repository_files` |
| archive / restore | `repository_records.archived_*`, `restore_*` + S3 Glacier storage class / RestoreObject |
| `BACKUP.lastRestoreTest` | `backup_restore_tests`; the KPIs are read live from S3 |
| `AuditEntry` | `audit_entries` (append-only trigger) |
| `USERS` / `Role` | `users` (role authoritative here; Cognito provides identity) |

## Design notes

- **Live clause edits.** `clauses.version` increments on every save. A save
  that carries a stale version is rejected with the current row so the UI can
  show who changed it. Compliance and remark changes append to
  `clause_changes`, which is what `Clause.history` renders.
- **One active job per tender** is enforced by the partial unique index on
  `processing_jobs`. Document status transitions are stored on
  `tender_documents`; `processing_job_documents` keeps the per-run outcome.
- **Soft deletes with a recovery window.** `tender_documents.deleted_at` plus
  `purge_deleted_documents(interval)` implement the 30-day window; the S3
  object is removed when the row is purged (bucket versioning keeps non-current
  versions per the lifecycle in `infra/modules/tendrai/s3.tf`).
- **Reprocessing keeps human work.** Extracted rows are never deleted by a
  run; the workflow sets `review_state` to `new` / `changed` / `missing` and
  leaves `reviewed_by`, `compliance` and `response` alone.
- **Everything is auditable.** Every API mutation writes one `audit_entries`
  row in the same transaction; the system actor records job results and
  completed restores.
- **Cross-instance events.** `notify_tender_event()` / `pg_notify('tendrai_events')`
  fan out WebSocket events across ECS tasks (see `api/src/db/bus.ts`).

## S3 layout (documents bucket, `infra/modules/tendrai/s3.tf`)

| Prefix | Content | Written by |
|---|---|---|
| `tenders/<tenderId>/pack/<documentId>/source.<ext>` | uploaded tender documents (ids only; the file name is `tender_documents.name`) | browser via presigned PUT |
| `tenders/<tenderId>/business-case/v<n>/<file>` | business case workbooks | browser via presigned PUT |
| `tenders/<tenderId>/mspo/<plan>-v<n>-<ts>.xlsx` | optional copy of generated MSPO templates | API |
| `extracted/<tenderId>/<documentId>/textract/<textractJobId>/…`, `extracted/<tenderId>/<documentId>/word|excel/…` | text extraction results (`tender_documents.text_s3_prefix`) | Step Functions / Lambdas |
| `normalized/<tenderId>/<jobId>/tender.json` | normalised text for the analyser | text-normalizer Lambda |
| `analysis/<tenderId>/<jobId>/<task>.json` | analyser results per task (overview, submission and qualification requirements, clauses) | analyser Lambda |
| `drafts/<tenderId>/<checklistItemId>/<file>` | first drafts of submission documents | API (on demand) |
| `generated/<tenderId>/<genDocId>/<file>` | generated submission documents | API |
| `exports/<tenderId>/<file>` | clause exports | API |
| `library/<itemId>/v<version>/<file>` | templates, boilerplate, certificates, CVs | browser via presigned PUT |
| `repository/<recordId>/<file>` | historical records | API / migration |

Bucket settings: SSE-KMS (data CMK) with a deny on unencrypted uploads,
versioning, TLS-only policy, lifecycle to Glacier after 180 days. Archiving a
repository record rewrites its objects to `GLACIER` immediately; a restore is
`RestoreObject` for 7 days and the API polls `HeadObject` until the restore
finishes.
