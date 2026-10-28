-- ---------------------------------------------------------------------------
-- TendrAI — least-privilege login roles
--
-- Run as the RDS master user AFTER schema.sql (the master owns every table).
-- Idempotent: safe to re-run after each schema change. Passwords are not set
-- here; `npm --prefix api run db:roles` runs this file and then sets each
-- role's password from its Secrets Manager secret (infra secrets.tf db_role).
--
--   tendrai_app             API server on EC2: read/write data, no DDL,
--                           append-only on audit_entries and clause_changes.
--   tendrai_status_updater  status updater Lambda: job / document progress,
--                           tender completion flags, system audit entries.
--   tendrai_result_loader   result loader Lambda: extracted results only.
--
-- None of these roles owns a table, so none can ALTER/DROP tables or disable
-- the append-only triggers (forbid_change). The master user is for
-- migrations and this bootstrap only; no application component can read its
-- secret.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['tendrai_app', 'tendrai_status_updater', 'tendrai_result_loader'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION', r);
    END IF;
  END LOOP;
END $$;

-- Nobody but the owner creates objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tendrai_app, tendrai_status_updater, tendrai_result_loader;

-- ----- tendrai_app -----------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tendrai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tendrai_app;
-- Append-only tables (the triggers also refuse; this stops it at the grant).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries, clause_changes FROM tendrai_app;
-- Tables and sequences created later by the master (future schema changes).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tendrai_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tendrai_app;

-- ----- tendrai_status_updater ------------------------------------------------
-- Mirrors the writes of POST /internal/jobs/:jobId/progress (api/src/routes/processing.ts).
GRANT SELECT, UPDATE ON processing_jobs TO tendrai_status_updater;
GRANT SELECT, INSERT, UPDATE ON processing_job_documents TO tendrai_status_updater;
GRANT SELECT ON tender_documents TO tendrai_status_updater;
GRANT UPDATE (status, fail_reason, pages, text_extracted, text_s3_prefix) ON tender_documents TO tendrai_status_updater;
GRANT SELECT ON tenders TO tendrai_status_updater;
GRANT UPDATE (last_processed_at, out_of_date_added, out_of_date_removed, out_of_date_repaired, process_failed, workflow_step) ON tenders TO tendrai_status_updater;
-- result counts only: no access to clause or requirement text
GRANT SELECT (tender_id) ON clauses, checklist_items, qualifications TO tendrai_status_updater;
GRANT INSERT ON audit_entries TO tendrai_status_updater;
GRANT USAGE ON SEQUENCE audit_entries_id_seq TO tendrai_status_updater;

-- ----- tendrai_result_loader -------------------------------------------------
GRANT SELECT ON tenders, tender_documents TO tendrai_result_loader;
GRANT UPDATE (overview, suggestions) ON tenders TO tendrai_result_loader;
GRANT SELECT, INSERT, UPDATE ON clauses, checklist_items, qualifications TO tendrai_result_loader;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_chunks TO tendrai_result_loader;
GRANT USAGE ON SEQUENCE document_chunks_id_seq TO tendrai_result_loader;

COMMIT;
