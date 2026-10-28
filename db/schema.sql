-- =============================================================================
-- TendrAI — PostgreSQL 16 schema (RDS, pgvector)
--
-- Source of truth for everything frontend shows:
--   users & roles · tenders · tender pack documents · processing jobs ·
--   extracted results (submission checklist, qualification requirements,
--   clauses with compliance + change history, document text chunks for
--   citations/RAG) · per-tender template search · generated documents ·
--   business case versions (header + product/resource/billing lines, Final
--   Check results) · MSPO settings and field mappings · template / boilerplate
--   / certification / CV library with version history and tags · Final Check
--   rules · historical repository with archive & restore · backup restore
--   tests · append-only audit log.
--
-- Binary files never live in the database: every file row carries the S3 key
-- (and S3 version id) of the object in the documents bucket. See
-- db/README.md for the bucket layout.
--
-- Conventions
--   * uuid primary keys (gen_random_uuid()), timestamptz everywhere.
--   * Soft deletes use deleted_at; partial unique indexes ignore deleted rows.
--   * Every mutable table has updated_at maintained by trigger.
--   * Enum values are spelled exactly as frontend/src/types.ts spells them so the
--     API can pass them through without mapping.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive names/emails/tags
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: clause / chunk embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy title search ("similar title" warning)

-- -----------------------------------------------------------------------------
-- Enumerations (mirror frontend/src/types.ts and src/config.ts)
-- -----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('bd', 'bidding-manager', 'presales', 'delivery', 'finance', 'drb', 'admin');

CREATE TYPE tender_type AS ENUM ('Agency', 'Commercial');
CREATE TYPE project_type AS ENUM ('Milestone Based', 'Time Based', 'Usage Based');
CREATE TYPE tender_status AS ENUM ('Draft', 'Active', 'Won', 'Closed');
CREATE TYPE tender_status_reason AS ENUM (
  'In Progress (Draft)', 'Pending (Draft)', 'In Approval (Draft)', 'Approved (Draft)', 'Rejected (Draft)',
  'In Progress (Active)', 'Won (Won)', 'Revised (Closed)', 'Lost (Closed)'
);
CREATE TYPE drb_outcome AS ENUM ('Won', 'Lost', 'Awaiting result');

CREATE TYPE pack_doc_role AS ENUM (
  'General Requirements', 'Technical Specification', 'Commercial Conditions',
  'Legal Conditions', 'Forms and Annexes', 'Unclassified'
);
CREATE TYPE pack_doc_status AS ENUM ('Uploaded', 'Extracting text', 'Text ready', 'Analysing', 'Done', 'Failed');

CREATE TYPE job_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

CREATE TYPE review_state AS ENUM ('unreviewed', 'reviewed', 'new', 'changed', 'missing');
CREATE TYPE checklist_status AS ENUM ('Not started', 'In progress', 'Done');
CREATE TYPE draft_status AS ENUM ('Needs review', 'Done');
CREATE TYPE qualification_kind AS ENUM ('Role', 'Experience', 'Certification', 'Past project');

CREATE TYPE clause_category AS ENUM ('Commercial', 'Technical', 'Legal', 'Finance', 'HR');
CREATE TYPE compliance_status AS ENUM ('Unset', 'Comply', 'Partially comply', 'Do not comply', 'Clarify');
CREATE TYPE clause_change_field AS ENUM ('Compliance', 'Remark', 'Category');

CREATE TYPE template_search_status AS ENUM ('idle', 'searching', 'done');
CREATE TYPE gen_doc_status AS ENUM ('Not generated', 'Generated', 'Needs review');

CREATE TYPE library_kind AS ENUM ('template', 'boilerplate', 'certification', 'cv');
CREATE TYPE library_item_type AS ENUM (
  -- templates
  'Compliance table', 'Cover letter', 'Company profile', 'Form', 'Document formatting',
  -- boilerplate
  'Company background', 'Certification', 'CV'
);

CREATE TYPE rule_kind AS ENUM ('compare', 'range', 'every-line', 'builtin');
CREATE TYPE rule_severity AS ENUM ('error', 'warning');

CREATE TYPE mspo_group AS ENUM ('product', 'resource', 'billing', 'figures');
CREATE TYPE map_source AS ENUM ('workbook', 'mspo', 'manual', 'calculated');
CREATE TYPE map_span AS ENUM ('single', 'rows', 'cols', 'rows-cols');
CREATE TYPE map_dropdown AS ENUM ('category', 'subcategory');

CREATE TYPE repo_kind AS ENUM ('Tender', 'Proposal', 'Business case', 'BOM');
CREATE TYPE repo_status AS ENUM ('Open', 'Closed', 'Won', 'Lost', 'Archived');
CREATE TYPE restore_state AS ENUM ('requested', 'available');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

-- -----------------------------------------------------------------------------
-- Users (identity comes from Cognito; this table holds the app role)
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub   text UNIQUE,                 -- Cognito user pool "sub"
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL,
  role          user_role NOT NULL DEFAULT 'presales',
  role_label    text NOT NULL,               -- display label, e.g. "Bidding Manager"
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Tenders
-- -----------------------------------------------------------------------------

CREATE TABLE tenders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sfdc_crm_id        text,                            -- SFDC/CRM opportunity id (optional)
  ref                text NOT NULL DEFAULT '',        -- GeBIZ / tender reference (optional)
  name               text NOT NULL CHECK (length(btrim(name)) > 0),
  agency             text NOT NULL CHECK (length(btrim(agency)) > 0),  -- customer / agency
  type               tender_type NOT NULL,
  project_type       project_type NOT NULL DEFAULT 'Milestone Based',
  status             tender_status NOT NULL DEFAULT 'Draft',
  status_reason      tender_status_reason NOT NULL DEFAULT 'In Progress (Draft)',
  owner_id           uuid NOT NULL REFERENCES users(id),
  closing_date       date,
  workflow_step      smallint NOT NULL DEFAULT 0 CHECK (workflow_step BETWEEN 0 AND 5),  -- index into WORKFLOW_STEPS
  -- processing results bookkeeping
  last_processed_at  timestamptz,
  out_of_date_added  integer NOT NULL DEFAULT 0,
  out_of_date_removed integer NOT NULL DEFAULT 0,
  out_of_date_repaired integer NOT NULL DEFAULT 0,
  process_failed     text,                            -- reason when the last run produced nothing
  overview           text,                            -- "Build tender overview" stage output
  suggestions        jsonb,                           -- values suggested from the documents, e.g. {"ref": "...", "agency": "..."}
  -- DRB
  drb_outcome        drb_outcome,
  drb_notes          text,
  -- MSPO per-tender settings (null = detected default)
  mspo_quote_line    text,
  mspo_fy_count      smallint CHECK (mspo_fy_count BETWEEN 1 AND 10),
  mspo_days_per_month numeric(5,2) CHECK (mspo_days_per_month > 0 AND mspo_days_per_month <= 31),
  mspo_rows_product  integer CHECK (mspo_rows_product > 0),
  mspo_rows_resource integer CHECK (mspo_rows_resource > 0),
  mspo_rows_billing  integer CHECK (mspo_rows_billing > 0),
  -- archive
  archived_at        timestamptz,
  archived_size_from bigint,
  archived_size_to   bigint,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE TRIGGER tenders_updated_at BEFORE UPDATE ON tenders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- a title is unique among live tenders (the create dialog blocks duplicates)
CREATE UNIQUE INDEX tenders_name_live_uq ON tenders (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) WHERE deleted_at IS NULL;
CREATE INDEX tenders_status_idx ON tenders (status) WHERE deleted_at IS NULL;
CREATE INDEX tenders_owner_idx ON tenders (owner_id);
CREATE INDEX tenders_ref_idx ON tenders (ref) WHERE ref <> '';
CREATE INDEX tenders_name_trgm_idx ON tenders USING gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Tender pack documents (files in S3; soft delete with a recovery window)
-- -----------------------------------------------------------------------------

CREATE TABLE tender_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id        uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  name             text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  content_type     text,
  s3_key           text NOT NULL,                   -- tenders/<tenderId>/pack/<docId>/source.<ext> (ids only; name is in `name`)
  s3_version_id    text,
  sha256           text,
  role             pack_doc_role NOT NULL DEFAULT 'Unclassified',
  role_unconfirmed boolean NOT NULL DEFAULT false,  -- AI classification awaiting confirmation
  pages            integer NOT NULL DEFAULT 0 CHECK (pages >= 0),
  status           pack_doc_status NOT NULL DEFAULT 'Uploaded',
  fail_reason      text,
  text_extracted   boolean NOT NULL DEFAULT false,
  text_s3_prefix   text,                            -- extracted/<tenderId>/<docId>/... where the text result lives (reused on reprocess)
  sort_order       integer NOT NULL DEFAULT 0,
  uploaded_by      uuid REFERENCES users(id),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,                     -- soft delete; purge_deleted_documents() after 30 days
  deleted_by       uuid REFERENCES users(id),
  CONSTRAINT tender_documents_fail_reason_chk CHECK (status <> 'Failed' OR fail_reason IS NOT NULL)
);
CREATE TRIGGER tender_documents_updated_at BEFORE UPDATE ON tender_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- duplicate check: same name + size in one tender
CREATE UNIQUE INDEX tender_documents_dup_uq ON tender_documents (tender_id, name, size_bytes) WHERE deleted_at IS NULL;
CREATE INDEX tender_documents_tender_idx ON tender_documents (tender_id, sort_order) WHERE deleted_at IS NULL;

-- Text of every document split into chunks (page-aware) for citations
-- ("sentences either side of the passage") and semantic search.
CREATE TABLE document_chunks (
  id           bigserial PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES tender_documents(id) ON DELETE CASCADE,
  tender_id    uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  page         integer NOT NULL CHECK (page >= 1),
  chunk_index  integer NOT NULL,
  text         text NOT NULL,
  embedding    vector(1024),                         -- amazon.titan-embed-text-v2:0
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX document_chunks_doc_page_idx ON document_chunks (document_id, page);
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- Processing jobs (one active job per tender; six named stages)
-- -----------------------------------------------------------------------------

CREATE TABLE processing_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id       uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  status          job_status NOT NULL DEFAULT 'queued',
  stage           smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 6),  -- index into PROCESS_STAGES
  stage_label     text,                              -- e.g. "Extract clauses"
  is_reprocess    boolean NOT NULL DEFAULT false,
  document_count  integer NOT NULL DEFAULT 0,
  requested_by    uuid REFERENCES users(id),
  sqs_message_id  text,
  execution_arn   text,                              -- Step Functions execution
  error           text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER processing_jobs_updated_at BEFORE UPDATE ON processing_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX processing_jobs_one_active_uq ON processing_jobs (tender_id) WHERE status IN ('queued', 'running');
CREATE INDEX processing_jobs_tender_idx ON processing_jobs (tender_id, started_at DESC);

-- Per-document outcome of a run (which run extracted/failed which document).
CREATE TABLE processing_job_documents (
  job_id        uuid NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES tender_documents(id) ON DELETE CASCADE,
  status        pack_doc_status NOT NULL,
  fail_reason   text,
  pages         integer,
  text_reused   boolean NOT NULL DEFAULT false,      -- text extraction skipped (already extracted)
  finished_at   timestamptz,
  PRIMARY KEY (job_id, document_id)
);

-- -----------------------------------------------------------------------------
-- Extracted results: submission checklist, qualification requirements, clauses
-- -----------------------------------------------------------------------------

CREATE TABLE checklist_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id          uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  item               text NOT NULL,
  format             text NOT NULL DEFAULT '',
  deadline           date,
  source_document_id uuid REFERENCES tender_documents(id) ON DELETE SET NULL,
  source_doc_name    text NOT NULL,                  -- kept even if the document is later deleted
  clause_ref         text NOT NULL DEFAULT '',        -- clause number in the source document
  owner_id           uuid REFERENCES users(id),
  owner_name         text,                           -- free-text owner when not a system user
  status             checklist_status NOT NULL DEFAULT 'Not started',
  template_id        uuid,                           -- FK added after library_items
  draft_template_id  uuid,
  draft_status       draft_status,
  draft_generated_at timestamptz,
  draft_s3_key       text,                           -- drafts/<tenderId>/<itemId>/<file>
  review_state       review_state NOT NULL DEFAULT 'unreviewed',
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_draft_chk CHECK ((draft_status IS NULL) = (draft_generated_at IS NULL))
);
CREATE TRIGGER checklist_items_updated_at BEFORE UPDATE ON checklist_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX checklist_items_tender_idx ON checklist_items (tender_id, deadline);

CREATE TABLE qualifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id          uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  kind               qualification_kind NOT NULL,
  requirement        text NOT NULL,
  source_document_id uuid REFERENCES tender_documents(id) ON DELETE SET NULL,
  source_doc_name    text NOT NULL,
  clause_ref         text NOT NULL DEFAULT '',
  evidence_item_id   uuid,                           -- library item (certification or CV); FK added below
  review_state       review_state NOT NULL DEFAULT 'unreviewed',
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER qualifications_updated_at BEFORE UPDATE ON qualifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX qualifications_tender_idx ON qualifications (tender_id, sort_order);

CREATE TABLE clauses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id          uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  number             text NOT NULL,                  -- EXACT numbering from the source document
  text               text NOT NULL,
  category           clause_category NOT NULL,
  sub_tags           text[] NOT NULL DEFAULT '{}',
  source_document_id uuid REFERENCES tender_documents(id) ON DELETE SET NULL,
  source_doc_name    text NOT NULL,
  page               integer NOT NULL DEFAULT 1 CHECK (page >= 1),
  ref_issue          text,                           -- cross-reference does not match numbering
  compliance         compliance_status NOT NULL DEFAULT 'Unset',
  response           text NOT NULL DEFAULT '',       -- the remark / response
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  review_state       review_state NOT NULL DEFAULT 'unreviewed',
  embedding          vector(1024),
  -- optimistic concurrency for live collaborative edits: every saved change
  -- increments version; a save carrying a stale version is rejected
  version            integer NOT NULL DEFAULT 1,
  updated_by         uuid REFERENCES users(id),
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER clauses_updated_at BEFORE UPDATE ON clauses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX clauses_tender_idx ON clauses (tender_id, sort_order);
CREATE INDEX clauses_tender_doc_number_idx ON clauses (tender_id, source_doc_name, number);
CREATE INDEX clauses_embedding_idx ON clauses USING hnsw (embedding vector_cosine_ops);

-- Earlier compliance values and remarks, oldest first (Clause.history).
CREATE TABLE clause_changes (
  id          bigserial PRIMARY KEY,
  clause_id   uuid NOT NULL REFERENCES clauses(id) ON DELETE CASCADE,
  tender_id   uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  by_user_id  uuid REFERENCES users(id),
  by_name     text NOT NULL,
  field       clause_change_field NOT NULL,
  from_value  text NOT NULL DEFAULT '',
  to_value    text NOT NULL DEFAULT ''
);
CREATE INDEX clause_changes_clause_idx ON clause_changes (clause_id, ts);
CREATE TRIGGER clause_changes_append_only BEFORE UPDATE OR DELETE ON clause_changes FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- -----------------------------------------------------------------------------
-- Library: templates, boilerplate, certifications, CVs (files in S3, versioned)
-- -----------------------------------------------------------------------------

CREATE TABLE library_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          library_kind NOT NULL,
  name          citext NOT NULL,
  agency        text NOT NULL DEFAULT 'Generic',    -- templates: MHA / ATFM / Generic / any new agency
  item_type     library_item_type NOT NULL,
  version       text NOT NULL,                      -- current version label, e.g. "3.1" or "2026"
  owner_id      uuid REFERENCES users(id),
  uploaded_by   uuid REFERENCES users(id),
  -- certification details
  expires       date,
  issuer        text,
  cert_number   text,
  issued        date,
  -- CV details
  cv_role       text,
  cv_years      smallint CHECK (cv_years >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT library_items_type_chk CHECK (
    (kind = 'template'      AND item_type IN ('Compliance table', 'Cover letter', 'Company profile', 'Form', 'Document formatting')) OR
    (kind = 'boilerplate'   AND item_type = 'Company background') OR
    (kind = 'certification' AND item_type = 'Certification') OR
    (kind = 'cv'            AND item_type = 'CV')
  )
);
CREATE TRIGGER library_items_updated_at BEFORE UPDATE ON library_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- templates are unique per name + agency; other kinds per name + kind
CREATE UNIQUE INDEX library_items_template_uq ON library_items (name, agency) WHERE kind = 'template' AND deleted_at IS NULL;
CREATE UNIQUE INDEX library_items_other_uq    ON library_items (kind, name) WHERE kind <> 'template' AND deleted_at IS NULL;
CREATE INDEX library_items_kind_idx ON library_items (kind) WHERE deleted_at IS NULL;
CREATE INDEX library_items_expires_idx ON library_items (expires) WHERE kind = 'certification' AND deleted_at IS NULL;

-- Every uploaded version of a library item; the current one is flagged.
CREATE TABLE library_item_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  version       text NOT NULL,
  file_name     text NOT NULL,
  size_bytes    bigint NOT NULL DEFAULT 0,
  content_type  text,
  s3_key        text NOT NULL,                      -- library/<itemId>/v<version>/<file>
  s3_version_id text,
  is_current    boolean NOT NULL DEFAULT false,
  uploaded_by   uuid REFERENCES users(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version)
);
CREATE UNIQUE INDEX library_item_versions_current_uq ON library_item_versions (item_id) WHERE is_current;

CREATE TABLE tags (
  id    serial PRIMARY KEY,
  name  citext NOT NULL UNIQUE
);
CREATE TABLE library_item_tags (
  item_id uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  tag_id  integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

ALTER TABLE checklist_items
  ADD CONSTRAINT checklist_items_template_fk FOREIGN KEY (template_id) REFERENCES library_items(id) ON DELETE SET NULL,
  ADD CONSTRAINT checklist_items_draft_template_fk FOREIGN KEY (draft_template_id) REFERENCES library_items(id) ON DELETE SET NULL;
ALTER TABLE qualifications
  ADD CONSTRAINT qualifications_evidence_fk FOREIGN KEY (evidence_item_id) REFERENCES library_items(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Per-tender template search and generated documents
-- -----------------------------------------------------------------------------

CREATE TABLE tender_template_searches (
  tender_id        uuid PRIMARY KEY REFERENCES tenders(id) ON DELETE CASCADE,
  status           template_search_status NOT NULL DEFAULT 'idle',
  ran_at           timestamptz,
  ran_by           uuid REFERENCES users(id),
  generic_fallback boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tender_template_searches_updated_at BEFORE UPDATE ON tender_template_searches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tender_template_matches (
  tender_id    uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  template_id  uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  reason       text NOT NULL,
  confirmed    boolean NOT NULL DEFAULT false,
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  PRIMARY KEY (tender_id, template_id)
);

CREATE TABLE gen_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id    uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  name         text NOT NULL,
  template_id  uuid REFERENCES library_items(id) ON DELETE SET NULL,
  status       gen_doc_status NOT NULL DEFAULT 'Not generated',
  auto_filled  text[] NOT NULL DEFAULT '{}',
  manual       text[] NOT NULL DEFAULT '{}',
  s3_key       text,                                -- generated/<tenderId>/<docId>/<file>
  generated_at timestamptz,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER gen_docs_updated_at BEFORE UPDATE ON gen_docs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX gen_docs_tender_idx ON gen_docs (tender_id, sort_order);

-- -----------------------------------------------------------------------------
-- Business case versions (uploaded workbooks) and their parsed lines
-- -----------------------------------------------------------------------------

CREATE TABLE bc_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id           uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  v                   integer NOT NULL CHECK (v >= 1),
  uploaded_by         uuid REFERENCES users(id),
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  file_name           text NOT NULL,
  size_bytes          bigint NOT NULL DEFAULT 0,
  s3_key              text NOT NULL,                -- tenders/<tenderId>/business-case/v<n>/<file>
  s3_version_id       text,
  comment             text,
  parsed_from_file    boolean NOT NULL DEFAULT false,
  layout_unrecognised boolean NOT NULL DEFAULT false,
  missing_anchors     text[] NOT NULL DEFAULT '{}',  -- sheet/header anchors not found
  mspo_downloaded_at  timestamptz,
  -- header: values the workbook STATES (Summary / Basic Info tabs)
  tcv                 numeric(16,2) NOT NULL DEFAULT 0,
  product_total       numeric(16,2) NOT NULL DEFAULT 0,
  labour_total        numeric(16,2) NOT NULL DEFAULT 0,
  margin_pct          numeric(7,3)  NOT NULL DEFAULT 0,
  currency            char(3) NOT NULL DEFAULT 'SGD',
  duration_months     integer NOT NULL DEFAULT 0 CHECK (duration_months >= 0),
  project_start       date,
  -- raw cell values the Final Check rules may read (tab -> cell -> value)
  cells               jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at          timestamptz,
  deleted_by          uuid REFERENCES users(id),
  UNIQUE (tender_id, v)
);
CREATE INDEX bc_versions_tender_idx ON bc_versions (tender_id, v DESC) WHERE deleted_at IS NULL;

CREATE TABLE bc_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES bc_versions(id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  ql          smallint NOT NULL DEFAULT 1,           -- quote line
  category    text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  unit_cost   numeric(16,2) NOT NULL DEFAULT 0,
  qty         numeric(14,3) NOT NULL DEFAULT 0,
  fy_qty      numeric(14,3)[],                       -- quantity per fiscal-year column, when present
  total       numeric(16,2) NOT NULL DEFAULT 0,
  UNIQUE (version_id, line_no)
);

CREATE TABLE bc_resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES bc_versions(id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  ql          smallint NOT NULL DEFAULT 1,
  role        text NOT NULL DEFAULT '',
  skill       text,                                  -- Resource Plan remarks column (MSPO Skill)
  grade       text NOT NULL DEFAULT '',
  team        text NOT NULL DEFAULT '',
  mandays     numeric(12,2) NOT NULL DEFAULT 0,
  fy_mandays  numeric(12,2)[],                       -- man-days per fiscal year, first FY first
  day_rate    numeric(12,2) NOT NULL DEFAULT 0,
  total       numeric(16,2) NOT NULL DEFAULT 0,
  UNIQUE (version_id, line_no)
);

CREATE TABLE bc_billing (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   uuid NOT NULL REFERENCES bc_versions(id) ON DELETE CASCADE,
  line_no      integer NOT NULL,
  billing_date date,
  schedule     text NOT NULL DEFAULT '',
  amount       numeric(16,2) NOT NULL DEFAULT 0,
  remark       text,
  UNIQUE (version_id, line_no)
);

-- -----------------------------------------------------------------------------
-- Final Check rules (data, managed on "Business case management") and results
-- -----------------------------------------------------------------------------

CREATE TABLE final_check_rules (
  id          text PRIMARY KEY,                      -- slug, e.g. billing-equals-ccb
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  severity    rule_severity NOT NULL DEFAULT 'warning',
  enabled     boolean NOT NULL DEFAULT true,
  kind        rule_kind NOT NULL,
  -- kind-specific definition, same shape as RuleDef in frontend:
  --   compare    {left:{tab,ref}, right:{tab,ref}, tolerance}
  --   range      {target:{tab,ref}, min, max}
  --   every-line {target:{tab,ref}, op, value, value2}
  --   builtin    {builtin, tabs:[...], tolerance}
  definition  jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  is_builtin  boolean NOT NULL DEFAULT false,        -- shipped with the system
  created_by  uuid REFERENCES users(id),
  updated_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER final_check_rules_updated_at BEFORE UPDATE ON final_check_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Cached evaluation of the enabled rules against a version (recomputed when
-- rules change). Lets the tender list show "Final Check failures" cheaply.
CREATE TABLE final_check_results (
  version_id   uuid NOT NULL REFERENCES bc_versions(id) ON DELETE CASCADE,
  rule_id      text NOT NULL REFERENCES final_check_rules(id) ON DELETE CASCADE,
  ok           boolean NOT NULL,
  skipped      boolean NOT NULL DEFAULT false,
  expected     text NOT NULL DEFAULT '',
  actual       text NOT NULL DEFAULT '',
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, rule_id)
);
CREATE INDEX final_check_results_failed_idx ON final_check_results (version_id) WHERE NOT ok;

-- -----------------------------------------------------------------------------
-- MSPO template mapping: company defaults + per-tender overrides + downloads
-- -----------------------------------------------------------------------------

CREATE TABLE mspo_mapping_defaults (
  "group"    mspo_group NOT NULL,
  position   integer NOT NULL,                      -- column order in the template
  target     text NOT NULL,                         -- template column name
  source     map_source NOT NULL,
  tab        text,                                  -- workbook tab (source = workbook)
  from_cell  text,                                  -- first cell (source = workbook)
  span       map_span,
  note       text,
  dropdown   map_dropdown,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("group", target),
  UNIQUE ("group", position),
  CONSTRAINT mspo_mapping_defaults_workbook_chk CHECK (source <> 'workbook' OR (tab IS NOT NULL AND from_cell IS NOT NULL AND span IS NOT NULL))
);
CREATE TRIGGER mspo_mapping_defaults_updated_at BEFORE UPDATE ON mspo_mapping_defaults FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tender.mspoMapping: key "<group>:<target>" -> { tab, from, to }
CREATE TABLE tender_mspo_mappings (
  tender_id  uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  "group"    mspo_group NOT NULL,
  target     text NOT NULL,
  tab        text NOT NULL,
  from_cell  text NOT NULL,
  to_cell    text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tender_id, "group", target)
);
CREATE TRIGGER tender_mspo_mappings_updated_at BEFORE UPDATE ON tender_mspo_mappings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mspo_downloads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id      uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  version_id     uuid REFERENCES bc_versions(id) ON DELETE SET NULL,
  plan           mspo_group NOT NULL CHECK (plan <> 'figures'),
  quote_line     text NOT NULL DEFAULT '',
  failed_checks  integer NOT NULL DEFAULT 0,
  s3_key         text,                               -- tenders/<tenderId>/mspo/<plan>-v<n>-<ts>.xlsx (optional copy)
  downloaded_by  uuid REFERENCES users(id),
  downloaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mspo_downloads_tender_idx ON mspo_downloads (tender_id, downloaded_at DESC);

-- -----------------------------------------------------------------------------
-- Historical repository (archive = S3 Glacier; restore is asynchronous)
-- -----------------------------------------------------------------------------

CREATE TABLE repository_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  agency               text NOT NULL,
  kind                 repo_kind NOT NULL,
  type                 tender_type NOT NULL,
  status               repo_status NOT NULL DEFAULT 'Open',
  status_reason        text NOT NULL DEFAULT 'In Progress (Active)',
  owner_id             uuid REFERENCES users(id),
  owner_name           text NOT NULL,
  tender_id            uuid REFERENCES tenders(id) ON DELETE SET NULL,   -- linked live tender, if any
  created_on           date NOT NULL DEFAULT current_date,
  updated_on           date NOT NULL DEFAULT current_date,
  archived_at          timestamptz,
  archived_size_from   bigint,
  archived_size_to     bigint,
  restore_state        restore_state,
  restore_requested_at timestamptz,
  restore_requested_by uuid REFERENCES users(id),
  restore_available_at timestamptz,
  restore_expires_at   timestamptz,                  -- restored copies are temporary
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
CREATE TRIGGER repository_records_updated_at BEFORE UPDATE ON repository_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX repository_records_status_idx ON repository_records (status) WHERE deleted_at IS NULL;
CREATE INDEX repository_records_tender_idx ON repository_records (tender_id);

CREATE TABLE repository_record_versions (
  record_id  uuid NOT NULL REFERENCES repository_records(id) ON DELETE CASCADE,
  v          integer NOT NULL,
  on_date    date NOT NULL,
  by_name    text NOT NULL,
  note       text NOT NULL DEFAULT '',
  PRIMARY KEY (record_id, v)
);

CREATE TABLE repository_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id     uuid NOT NULL REFERENCES repository_records(id) ON DELETE CASCADE,
  name          text NOT NULL,
  size_bytes    bigint NOT NULL DEFAULT 0,
  content_type  text,
  s3_key        text NOT NULL,                       -- repository/<recordId>/<file>
  s3_version_id text,
  storage_class text NOT NULL DEFAULT 'STANDARD',    -- STANDARD | GLACIER | ... mirrors S3
  added_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, name)
);

-- -----------------------------------------------------------------------------
-- Backup: restore-test record (status KPIs are read live from S3)
-- -----------------------------------------------------------------------------

CREATE TABLE backup_restore_tests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at         timestamptz NOT NULL DEFAULT now(),
  run_by         uuid REFERENCES users(id),
  run_by_name    text NOT NULL,
  files_restored integer NOT NULL DEFAULT 0,
  passed         boolean NOT NULL,
  result         text NOT NULL,
  is_demo        boolean NOT NULL DEFAULT false
);

-- -----------------------------------------------------------------------------
-- Audit log (append-only; every user and system action)
-- -----------------------------------------------------------------------------

CREATE TABLE audit_entries (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES users(id),
  user_name   text NOT NULL,                         -- "TendrAI (system)" for automated actions
  role_label  text NOT NULL,                         -- "Automated" for the system
  action      text NOT NULL,                         -- e.g. "Clause updated"
  detail      text NOT NULL DEFAULT '',
  tender_id   uuid REFERENCES tenders(id) ON DELETE SET NULL,
  tender_ref  text,                                  -- GeBIZ ref, else title, at the time of the action
  section     text,                                  -- Documents, Clauses, Business case, Templates...
  request_id  text,
  ip          inet
);
CREATE INDEX audit_entries_ts_idx ON audit_entries (ts DESC);
CREATE INDEX audit_entries_tender_idx ON audit_entries (tender_ref, ts DESC);
CREATE INDEX audit_entries_section_idx ON audit_entries (section, ts DESC);
CREATE INDEX audit_entries_action_idx ON audit_entries (action);
CREATE TRIGGER audit_entries_append_only BEFORE UPDATE OR DELETE ON audit_entries FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- -----------------------------------------------------------------------------
-- Views used by the API
-- -----------------------------------------------------------------------------

-- Which live tenders use each template (TemplateDoc.usedBy).
CREATE VIEW v_template_usage AS
SELECT template_id, array_agg(DISTINCT tender_id ORDER BY tender_id) AS tender_ids
FROM (
  SELECT ci.template_id, ci.tender_id FROM checklist_items ci JOIN tenders t ON t.id = ci.tender_id AND t.deleted_at IS NULL WHERE ci.template_id IS NOT NULL
  UNION
  SELECT gd.template_id, gd.tender_id FROM gen_docs gd JOIN tenders t ON t.id = gd.tender_id AND t.deleted_at IS NULL WHERE gd.template_id IS NOT NULL
  UNION
  SELECT m.template_id, m.tender_id FROM tender_template_matches m JOIN tenders t ON t.id = m.tender_id AND t.deleted_at IS NULL WHERE m.confirmed
) u
GROUP BY template_id;

-- Latest business case version per tender whose layout was read (figures).
CREATE VIEW v_latest_parsed_bc AS
SELECT DISTINCT ON (tender_id) *
FROM bc_versions
WHERE deleted_at IS NULL AND NOT layout_unrecognised
ORDER BY tender_id, v DESC;

-- Tender list row: counts, active job, latest BC figures and failed checks.
CREATE VIEW v_tender_list AS
SELECT
  t.*,
  u.name AS owner_name,
  (SELECT count(*) FROM tender_documents d WHERE d.tender_id = t.id AND d.deleted_at IS NULL)                                AS document_count,
  (SELECT count(*) FROM tender_documents d WHERE d.tender_id = t.id AND d.deleted_at IS NULL AND d.status = 'Failed')        AS failed_document_count,
  (SELECT count(*) FROM clauses c WHERE c.tender_id = t.id)                                                                  AS clause_count,
  (SELECT count(*) FROM clauses c WHERE c.tender_id = t.id AND c.reviewed_by IS NOT NULL)                                    AS reviewed_clause_count,
  (SELECT count(*) FROM checklist_items k WHERE k.tender_id = t.id)                                                          AS checklist_count,
  (SELECT count(*) FROM qualifications q WHERE q.tender_id = t.id)                                                           AS qualification_count,
  (SELECT count(*) FROM bc_versions b WHERE b.tender_id = t.id AND b.deleted_at IS NULL)                                     AS bc_version_count,
  j.id    AS job_id,
  j.stage AS job_stage,
  j.started_at AS job_started_at,
  lb.v            AS latest_bc_v,
  lb.tcv          AS latest_bc_tcv,
  lb.product_total AS latest_bc_product_total,
  lb.labour_total AS latest_bc_labour_total,
  lb.margin_pct   AS latest_bc_margin_pct,
  (SELECT layout_unrecognised FROM bc_versions b WHERE b.tender_id = t.id AND b.deleted_at IS NULL ORDER BY v DESC LIMIT 1)   AS latest_bc_layout_unrecognised,
  (SELECT count(*) FROM final_check_results r WHERE r.version_id = lb.id AND NOT r.ok)                                        AS latest_bc_failed_checks
FROM tenders t
JOIN users u ON u.id = t.owner_id
LEFT JOIN processing_jobs j ON j.tender_id = t.id AND j.status IN ('queued', 'running')
LEFT JOIN v_latest_parsed_bc lb ON lb.tender_id = t.id
WHERE t.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Maintenance functions
-- -----------------------------------------------------------------------------

-- Hard-delete tender documents soft-deleted more than `retention` ago. The S3
-- objects are removed by the caller (the API lists the keys first) or by the
-- bucket lifecycle on non-current versions. Run daily (EventBridge Scheduler).
CREATE OR REPLACE FUNCTION purge_deleted_documents(retention interval DEFAULT interval '30 days')
RETURNS TABLE (document_id uuid, s3_key text)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  DELETE FROM tender_documents d
  WHERE d.deleted_at IS NOT NULL AND d.deleted_at < now() - retention
  RETURNING d.id, d.s3_key;
END $$;

-- Mark results stale after a document change (Tender.outOfDate counters).
CREATE OR REPLACE FUNCTION mark_results_out_of_date(p_tender uuid, p_added int, p_removed int, p_repaired int)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenders
  SET out_of_date_added    = out_of_date_added + p_added,
      out_of_date_removed  = out_of_date_removed + p_removed,
      out_of_date_repaired = out_of_date_repaired + p_repaired
  WHERE id = p_tender AND last_processed_at IS NOT NULL;
$$;

-- Notify API instances (LISTEN tendrai_events) so WebSocket rooms fan out
-- across ECS tasks. Payload must stay under 8000 bytes.
CREATE OR REPLACE FUNCTION notify_tender_event(p_tender uuid, p_payload jsonb)
RETURNS void LANGUAGE sql AS $$
  SELECT pg_notify('tendrai_events', jsonb_build_object('tenderId', p_tender) || p_payload #>> '{}');
$$;

COMMIT;
