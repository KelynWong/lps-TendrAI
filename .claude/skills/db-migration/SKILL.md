---
name: db-migration
description: Use when changing db/schema.sql or db/seed.sql, adding or altering tables, columns, enums, indexes, constraints, triggers or views, or writing API/Lambda SQL that needs a column, table or enum value that does not exist yet. Covers the migration convention, rollback, the versioning and soft-delete patterns already in the schema, the append-only tables, enum mirroring and the schema docs to update.
---

# Database schema changes (PostgreSQL 16 on RDS)

Read `CLAUDE.md` first ("Database", "Audit log", "Domain vocabulary"). This skill adds the details for `db/`.

## Current state (facts)
- `db/schema.sql` is one `BEGIN … COMMIT` script that creates everything from scratch (`CREATE TYPE`, `CREATE TABLE`, no `IF NOT EXISTS`). Re-running it on a database that already has the schema fails, so it only works against an empty database.
- `npm --prefix api run db:schema` / `db:seed` run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../db/<file>.sql` (`api/package.json`).
- `db/seed.sql` is idempotent: `ON CONFLICT … DO UPDATE/NOTHING` for `final_check_rules`, `tags`, `users`; `DELETE FROM mspo_mapping_defaults` then re-insert. Keep it re-runnable.
- There is **no migration tool and no `db/migrations/` folder**, although CLAUDE.md says schema changes go only through migrations.

## Migrations: Not set up yet
Proposal (ask the user before creating the folder or adding any tool):
- Option A, plain SQL: `db/migrations/NNNN_short_name.up.sql` + `NNNN_short_name.down.sql` (4-digit, zero-padded, snake_case), each wrapped in `BEGIN; … COMMIT;`, applied in order and recorded in a `schema_migrations(version text primary key, applied_at timestamptz)` table by a small runner script.
- Option B, a maintained tool: `node-pg-migrate` in `api/` (`pg` is already a dependency), with SQL migration files and an `api` npm script `db:migrate`.
- `0001_baseline` would be today's `schema.sql`.

Until the user decides, for every schema change:
1. Write the change as a standalone forward SQL snippet plus its reverse, and show both in your reply.
2. Apply the same change to `db/schema.sql` so it stays the current-state snapshot (fresh installs). Put it in the section where the table lives, not at the end.
3. Never tell the user to drop and re-run `schema.sql` against a database holding data.

## Rollback rules
- One down per up. The down must restore the previous shape exactly (column type, default, NOT NULL, index, trigger).
- Not reversible, say so in the migration header and in your reply:
  - `ALTER TYPE … ADD VALUE`: Postgres cannot remove an enum value. A down would need a new type, a column rewrite and a swap; usually write "irreversible" instead.
  - `ALTER TYPE … ADD VALUE` also cannot be used in the same transaction that then uses the new value. Split it.
  - Dropping a column or table loses data; the down can recreate the shape but not the data.
- Prefer additive changes: add nullable column, backfill, then add `NOT NULL` in a later migration.
- Long locks on big tables (`clauses`, `document_chunks`, `audit_entries`): use `CREATE INDEX CONCURRENTLY` (outside a transaction) and mention it.

## Conventions in schema.sql (follow them)
- `uuid` PK with `gen_random_uuid()`, except append-only logs (`bigserial`: `audit_entries`, `clause_changes`, `document_chunks`) and `final_check_rules.id` (text slug).
- `timestamptz` everywhere. Every mutable table has `updated_at` plus `CREATE TRIGGER <table>_updated_at BEFORE UPDATE … EXECUTE FUNCTION set_updated_at()`. Add both on any new mutable table.
- Files never live in the DB: store `s3_key` (+ `s3_version_id`). Keys use IDs, never names, at the prefix level (see S3 layout in `db/README.md`).
- FKs to `tenders(id)` use `ON DELETE CASCADE`; references to a source document use `ON DELETE SET NULL` and keep a copied `source_doc_name`.
- `citext` for case-insensitive names/emails/tags; `vector(1024)` for embeddings (`amazon.titan-embed-text-v2:0`).

## Versioning patterns already used
| Pattern | Where | How |
|---|---|---|
| Numbered versions per parent | `bc_versions` | `v integer CHECK (v >= 1)`, `UNIQUE (tender_id, v)`; API computes `MAX(v)+1` (`api/src/routes/businessCase.ts`). Lines in `bc_products` / `bc_resources` / `bc_billing` hang off `version_id`, `UNIQUE (version_id, line_no)`. |
| Current-flag history | `library_item_versions` | One row per upload, `version text`, `UNIQUE (item_id, version)`, `is_current boolean` with partial unique index `library_item_versions_current_uq ON (item_id) WHERE is_current`. `library_items.version` holds the current label. API clears `is_current` before inserting the new current row (`api/src/routes/library.ts`). |
| Version log rows | `repository_record_versions` | PK `(record_id, v)`, `on_date`, `by_name`, `note`. |
| Optimistic concurrency | `clauses.version` | `integer NOT NULL DEFAULT 1`; every save does `version = version + 1`; a patch carrying a stale `version` is rejected (`api/src/routes/clauses.ts`). Any new UPDATE on `clauses` must bump `version`. |
| Field change history | `clause_changes` | `clause_id`, `ts`, `by_user_id`, `by_name`, `field clause_change_field` ('Compliance','Remark','Category'), `from_value`, `to_value`. Append-only. |
| Per-run outcome | `processing_job_documents` | PK `(job_id, document_id)`, per-run `status pack_doc_status`. |

## Soft delete and archive patterns
- `deleted_at timestamptz` on `tenders`, `tender_documents` (+ `deleted_by`), `library_items`, `bc_versions` (+ `deleted_by`), `repository_records`.
- Uniqueness ignores deleted rows via partial unique indexes: `tenders_name_live_uq … WHERE deleted_at IS NULL`, `tender_documents_dup_uq (tender_id, name, size_bytes) WHERE deleted_at IS NULL`, `library_items_template_uq` / `library_items_other_uq … AND deleted_at IS NULL`. Copy this pattern for any new unique constraint on a soft-deletable table.
- Read paths filter `deleted_at IS NULL` (views `v_tender_list`, `v_latest_parsed_bc`, `v_template_usage`). Update the views when you add a soft-deletable table they read.
- Hard delete only through `purge_deleted_documents(retention interval DEFAULT '30 days')`.
- Archive is separate from delete: `tenders.archived_at/archived_size_*`, `repository_records.archived_*` + `restore_*`, `repo_status 'Archived'`.
- Reprocessing never deletes extracted rows: it sets `review_state` to `new` / `changed` / `missing` (`db/README.md` design notes).

## Append-only tables
- `audit_entries` and `clause_changes` have `BEFORE UPDATE OR DELETE … EXECUTE FUNCTION forbid_change()` triggers (raises `insufficient_privilege`). Never drop, disable or bypass these triggers, never add `UPDATE`/`DELETE` on them, and never add `ON DELETE CASCADE` FKs into `audit_entries` (it uses `ON DELETE SET NULL` for `user_id`, `tender_id`).
- Note: FK actions fire these row triggers. Hard-deleting a `tenders` or `users` row referenced by `audit_entries` (`SET NULL` = UPDATE) or a `clauses` row with `clause_changes` (`CASCADE` = DELETE) will raise. Tenders are soft-deleted today; flag this to the user if you add any hard delete.
- New audited actions are inserted via `api/src/lib/audit.ts`, in the same transaction as the mutation.

## Database roles and grants (`db/roles.sql`)
- Components never connect as the master user: `tendrai_app` (API), `tendrai_status_updater` and `tendrai_result_loader` (Lambdas). None owns a table. The master user is for migrations and `db:roles` only.
- Every new table needs a decision about who may touch it. `tendrai_app` gets SELECT/INSERT/UPDATE/DELETE on new tables automatically (default privileges). The Lambda roles get nothing unless you add an explicit `GRANT` to `roles.sql`. Use column-level grants where a role only needs some columns (see `tenders`).
- A new append-only table: add a `forbid_change()` trigger AND `REVOKE UPDATE, DELETE, TRUNCATE … FROM tendrai_app` in `roles.sql`.
- New Lambda SQL: check it against that Lambda's grants in `roles.sql` and extend them minimally. The status updater mirrors the writes of the API progress endpoint (`api/src/routes/processing.ts`).
- Update the role table in `db/README.md` when grants change. After a schema change, `npm --prefix api run db:roles` re-applies the grants (real AWS: `docs/runbooks/db-roles.md`, only when the user asks).

## Enums
- Enum values are spelled exactly as the TypeScript types (schema header comment). Any `CREATE TYPE` / `ALTER TYPE … ADD VALUE` must be mirrored in `api/src/types.ts` and `frontend/src/types.ts` in the same change, plus any `z.enum([...])` copies in `api/src/routes/*.ts` (e.g. `Role` in `documents.ts`, `Progress.documents.status` in `processing.ts`). Grep for an existing value to find them all.
- Do not invent status names (CLAUDE.md). Ask first.
- Renaming a value: `ALTER TYPE … RENAME VALUE` is reversible; still mirror it everywhere.

## Docs to update in the same change
- `db/README.md` "Entity map" ASCII tree (new table and its parent).
- `db/README.md` "How frontend concepts map" table (frontend type → table/columns).
- `db/README.md` "Design notes" if you add a new pattern (versioning, concurrency, retention).
- `db/README.md` "S3 layout" and the key comment in `api/src/lib/s3.ts` if you add an `s3_key` column with a new prefix; also `infra/modules/tendrai/s3.tf` header comment.
- Comment the new columns inline in `schema.sql` the way existing columns are.

## Check before done
- `npm --prefix api run typecheck` and `npm --prefix frontend run build` if types changed.
- If you have a local Postgres, apply `schema.sql` to an empty DB, then `seed.sql` twice and `roles.sql` twice (proves idempotency). With no Docker or psql, PGlite (`@electric-sql/pglite` with the vector, citext, pg_trgm and pgcrypto extensions) can apply both files in Node from a scratch folder; use `SET ROLE <role>` to prove what each role can and cannot do. Do not run against a shared or real database unless asked.
