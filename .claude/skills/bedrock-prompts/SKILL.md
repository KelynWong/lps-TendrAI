---
name: bedrock-prompts
description: Use when writing or changing an AI prompt, editing lambdas/analyser/handler.py or lambdas/result_loader/handler.py, changing Bedrock model IDs or Bedrock IAM (bedrock_text_model_id, bedrock_embed_model_id, local.bedrock_model_arns), or changing the JSON the analyser returns and the result loader writes to clauses, checklist_items or qualifications. Covers the in-region model rule, prompt versioning, the output schema, numbering and figure preservation, and evaluation.
---

# Bedrock prompts and the analyser output

Read `CLAUDE.md` first ("AI/Bedrock calls", "Figures", "Do not log document contents"). Pipeline context is in the `processing-workflow` skill.

## Current state (facts)
- `lambdas/analyser/handler.py` is a placeholder: no Bedrock call, no prompts. It is invoked **once per task**, one workflow stage each: `overview` (stage 2), `submissionRequirements` (3), `qualificationRequirements` (4), `clauses` (5). Input `{ tenderId, jobId, task, normalizedKey }`; it writes the task result to `analysis/<tenderId>/<jobId>/<task>.json` (`ANALYSIS_PREFIX`) and returns only `{ task, resultKey }`, so no document text passes through Step Functions.
- `lambdas/result_loader/handler.py` is a placeholder (stage 6): input `{ tenderId, jobId, resultKeys: { overview, submissionRequirements, qualificationRequirements, clauses } }`, output counts `{ clauses, checklist, qualifications }`.
- Submission first drafts are not made by the workflow; the API generates them on demand per checklist item (`api/src/routes/checklist.ts`, a non-AI placeholder today).
- No prompt files, no prompt version, no eval set exist anywhere in the repo.
- Lambdas have no internet; Bedrock is reached only through the `bedrock-runtime` interface endpoint (`locals.tf` `interface_endpoints`).

## Model IDs: in-region only (ap-southeast-1)
- Configured in: `infra/envs/prod/main.tf` (`bedrock_text_model_id = "anthropic.claude-3-5-sonnet-20241022-v2:0"`, `bedrock_embed_model_id = "amazon.titan-embed-text-v2:0"`), defaults in `infra/modules/tendrai/variables.tf` (same values), passed to every Lambda as `BEDROCK_TEXT_MODEL_ID` / `BEDROCK_EMBED_MODEL_ID` (`lambda.tf`), and copied into the `app-config` secret (`secrets.tf`, `ignore_changes`, so operators may have changed the live value). `infra/envs/floci/main.tf` uses the defaults.
- IAM: `iam.tf` statement `InvokeApprovedFoundationModels` (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`) on `local.bedrock_model_arns` in `locals.tf`, only for functions with `needs_bedrock = true` (`analyser`).
- Rules:
  - Use plain in-region foundation-model IDs (`anthropic.…`, `amazon.…`). Never `global.*`, `apac.*` or any other cross-region inference profile ID or ARN.
  - Read the model ID from the env var; never hard-code it in Python.
  - Create the client with `region_name="ap-southeast-1"` (or `AWS_REGION`) and do not override the endpoint.
  - Before switching models, confirm the model is enabled for on-demand use in ap-southeast-1 (`infra/README.md` prerequisite 6). If it is only offered through an inference profile there, stop and ask the user; this is a data-residency decision.
  - `document_chunks.embedding` and `clauses.embedding` are `vector(1024)` (Titan Text Embeddings V2). Changing the embed model or its dimension needs a migration (`db-migration` skill) and re-embedding.
- `local.bedrock_model_arns` grants exactly the two configured foundation-model ARNs in `var.aws_region`, with no inference-profile ARNs, and both model variables have a validation that rejects ARNs and `global.`/`apac.`/`us.`/`eu.`/… prefixes. Never widen either (no wildcards, no inference profiles).

## Prompt versioning: Not set up yet
Proposal (ask the user before creating files):
- `lambdas/analyser/prompts/<task>/vN.md` with `<task>` the analyser task names (`overview`, `submissionRequirements`, `qualificationRequirements`, `clauses`); plain text with named placeholders. Never edit a released `vN.md`; add `vN+1.md`.
- A small `lambdas/analyser/prompts/active.json` mapping task -> version, so a model or prompt change is one reviewed diff.
- Return `promptVersions: { clauses: "v3", … }` and `modelId` in the analyser output; the loader records them. There is no column for this today (`clauses`, `checklist_items`, `qualifications`, `processing_jobs` have none), so storing it needs a migration, e.g. `processing_jobs.model_id text`, `processing_jobs.prompt_versions jsonb`. Ask first.
- Packaging: `lambda.tf` zips the whole `lambdas/analyser` folder, so files under `prompts/` ship automatically.

## Output JSON schema (derived from the tables the loader fills)
Not formalised in code yet; this is what `db/schema.sql` and `api/src/types.ts` can store. Each task writes its own file (`analysis/<tenderId>/<jobId>/<task>.json`) holding the matching key below; `overview` -> `tenders.overview` (text). Propose it as a JSON Schema file next to the prompts when you implement, and ask before adding fields that need new columns.
```jsonc
{
  "tenderId": "<uuid>",
  "overview": "...",                              // -> tenders.overview (stage 2)
  "clauses": [{                                   // -> clauses
    "number": "4.2.1",                            // number: verbatim from source
    "text": "...",                                // text: verbatim
    "category": "Commercial",                     // clause_category: Commercial|Technical|Legal|Finance|HR
    "subTags": ["..."],                           // sub_tags text[]
    "sourceDocId": "<tender_documents.id>",       // source_document_id (+ source_doc_name copied by loader)
    "page": 12,                                   // page integer >= 1
    "refIssue": null                              // ref_issue: cross-reference that does not match numbering
  }],
  "submissionRequirements": [{                    // -> checklist_items
    "item": "...", "format": "", "deadline": "YYYY-MM-DD" | null,
    "sourceDocId": "<uuid>", "clause": "3.1"      // clause -> clause_ref (verbatim)
  }],
  "qualificationRequirements": [{                 // -> qualifications
    "kind": "Role",                               // qualification_kind: Role|Experience|Certification|Past project
    "requirement": "...", "sourceDocId": "<uuid>", "clause": "5.4"
  }]
}
```
- The model never sets human-owned fields: `compliance` (stays `Unset`), `response`, `reviewed_by`, `review_state`, `owner_*`, `status`, `template_id`, `evidence_item_id`, `version`.
- Only `clauses` has a `page` column. `checklist_items` / `qualifications` cite by `clause_ref` + source document; finer citations come from `document_chunks (document_id, page, chunk_index, text)`. Adding `page` to the other two needs a migration.
- `sourceDocId` requires the normalised input (`normalized/<tenderId>/<jobId>/tender.json`, format not defined yet in `text_normalizer`) to keep the `documentId` and page for each passage. The workflow carries `documentId` through every extraction result.
- Validate the model output against the schema in the analyser (enum values exactly as the Postgres enums; reject unknown categories rather than mapping them silently) and fail the task on invalid JSON; do not let the loader guess.
- Schema columns with no analyser task yet (raise before adding one): `tenders.suggestions` (`{"ref","agency"}`), `tender_documents.role` + `role_unconfirmed` (AI document classification).
- Reprocessing: the loader matches existing rows (e.g. clauses by `tender_id, source_doc_name, number`, index `clauses_tender_doc_number_idx`) and sets `review_state` `new`/`changed`/`missing`; it never deletes rows or overwrites human fields (`db/README.md`).

## Preservation rules (put these in every prompt and enforce them in code)
- Clause and requirement numbers are copied verbatim from the source (`clauses.number` comment: "EXACT numbering"). Never renumber, normalise (`4.2.1` vs `4.2.1.`), fill gaps or infer missing numbers. Empty string if the source has none.
- Clause and requirement text is quoted, not paraphrased or summarised.
- Figures, amounts, dates and percentages are never rounded, converted or rewritten.
- The AI never generates costs, prices, business cases or compliance decisions (CLAUDE.md). Drafts fill templates from tender text and library content only.
- Prefer "not found" over invention: missing deadline -> `null`, unknown category -> fail validation, not a guess.

## Logging and data handling
- Never log prompt inputs or model outputs, or any document text, at any level. Log `tenderId`, `jobId`, task name, prompt version, model ID, token counts, latency, item counts.
- Never return text through Step Functions: the analyser writes results to S3 and returns the key (the state machine logs execution data on errors, `include_execution_data = true`).
- No document text in exception messages (they land in `$.error`, the `MarkFailed` payload and `processing_jobs.error`).

## Evaluation: Not set up yet
Proposal (ask the user first; tender documents may be confidential, so the golden set must be synthetic or approved):
- `lambdas/analyser/eval/cases/<case>/input.json` (normalised text in the `tender.json` format) and `expected.json` (schema above).
- `lambdas/analyser/eval/run_eval.py`: runs the analyser prompt code against each case with the configured in-region model, writes a report (not the model text) with exact-match rate on `number`, category accuracy, requirement recall/precision, and a hard failure on any changed number or figure.
- Run manually with `python lambdas/analyser/eval/run_eval.py --model $BEDROCK_TEXT_MODEL_ID` against ap-southeast-1, only when the user asks (it calls real AWS). Run it on every prompt or model change and put the before/after scores in your reply.

## Check before done
- `python -m py_compile lambdas/analyser/handler.py lambdas/result_loader/handler.py`.
- Infra touched: `terraform fmt -check -recursive infra` and `terraform validate` for `floci` and `prod`; explain IAM changes and their risk.
