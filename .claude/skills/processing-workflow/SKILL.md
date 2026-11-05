---
name: processing-workflow
description: Use when touching the tender-processing pipeline - infra/modules/tendrai/sqs.tf (SQS queue, DLQ, EventBridge Pipe), step_functions.tf or statemachine/tender_processing.asl.json, lambda.tf/locals.tf lambda_functions, any lambdas/<fn>/handler.py, the status updater, or API code that enqueues jobs or reads/writes job or document status (api/src/lib/sqs.ts, api/src/lib/jobs.ts, api/src/routes/processing.ts, api/src/routes/documents.ts retry). Covers stage names, the message contract, status models, retries/failures and where results land.
---

# Tender-processing workflow (SQS -> Pipe -> Step Functions -> Lambdas -> RDS)

Read `CLAUDE.md` first, and `infra/README.md` "Tender-processing workflow". Flow:
API `dispatchJob` (after commit) -> SQS `<name>-tender-jobs` -> Pipe `<name>-jobs-to-workflow` -> state machine `<name>-tender-processing` (STANDARD).

## One contract, four places — change them together
1. **Message**: `TenderJobMessage` in `api/src/lib/sqs.ts` is the source of truth: `{ tenderId, jobId, mode: 'process'|'reprocess'|'retry-document', requestedBy, documents: [{ documentId, key, fileType, textReady, textPrefix }] }`.
2. **Pipe**: `input_template` in `sqs.tf` forwards `tenderId, jobId, mode, documents, messageId` (not `requestedBy`).
3. **State machine**: `statemachine/tender_processing.asl.json`.
4. **Status updates**: every `Mark*`/`Report*` state sends the status-updater Lambda `{ jobId, mode, ...body }` where body is exactly the `Progress` schema of `POST /internal/jobs/:jobId/progress` in `api/src/routes/processing.ts`: `stage?: 1-6, status?: running|completed|failed, error?, executionArn?, documents?: [{ documentId, status, failReason?, pages?, textPrefix? }], results?: { clauses, checklist, qualifications }`.
Also keep in sync: Lambda docstrings, the `sqs.tf` header comment, the `step_functions.tf` header comment, `infra/README.md`, `db/README.md` S3 table.

## All six Lambdas are placeholders
`lambdas/{status_updater,text_extractor_word,text_extractor_excel,text_normalizer,analyser,result_loader}/handler.py` log ids, build the output S3 key and return stub results (`# TODO`). Their docstrings are the I/O contract. Python (`var.lambda_runtime`, `python3.12`), `handler.lambda_handler`, packaged by `infra/modules/tendrai/lambda.tf` from `lambdas/<key>`. A new function needs a key in `local.lambda_functions` (`subnet_tier`, `needs_db`, `needs_s3`, `needs_bedrock` drive IAM/SG) and a `templatefile` var in `step_functions.tf`.

## States (exact names) and stages
Stages are `PROCESS_STAGES` (`api/src/types.ts`, `frontend/src/types.ts`).
- `UnwrapQueueMessage` (Pass, `$[0]`: Pipe batch of 1)
- **Stage 1 Read documents**: `MarkReadingDocuments` (`stage 1, status running, executionArn`) -> `ExtractDocuments` Map (`MaxConcurrency 5`, item `{ tenderId, jobId, document }`, result `$.extracted`):
  - `TextAlreadyExtracted`: `textReady` and `textPrefix` set -> `ReuseText`.
  - `RouteByFileType`: `pdf` -> `StartTextract` -> `WaitForTextract` -> `GetTextractStatus` -> `IsTextractDone` -> `TextractResult`; `doc/docx` -> `ExtractWord`; `xls/xlsx/csv` -> `ExtractExcel`; else `UnsupportedFileType`.
  - Every branch ends in a document result `{ documentId, status: 'Text ready'|'Failed', textPrefix?, failReason? }`. Errors never fail the Map: service/throttling errors -> `ExtractionServiceUnavailable` (failReason contains "service unavailable", which the API re-queues on the next run); others -> `ExtractionFailed`.
  - `ReportDocuments` sends `documents: $.extracted`.
  - `ExtractOnly`: `mode == retry-document` -> `MarkCompleted` (stop).
  - `NormalizeText` -> `AnyTextRead` (`documentCount > 0`, else `NoTextRead` -> `MarkFailed`).
- **Stages 2-5**: `MarkOverview` -> `AnalyseOverview`, `MarkSubmissionRequirements` -> `AnalyseSubmissionRequirements`, `MarkQualificationRequirements` -> `AnalyseQualificationRequirements`, `MarkClauses` -> `AnalyseClauses`. Analyser `task` = `overview | submissionRequirements | qualificationRequirements | clauses`; each returns only `resultKey`.
- **Stage 6 Build compliance table**: `MarkComplianceTable` -> `LoadResults` (returns counts) -> `MarkCompletedWithResults` (`status completed, results`) -> `Done`.
- Failure: every top-level Task and the Map `Catch States.ALL -> MarkFailed` (`status failed, error: "Processing failed (<ErrorName>)"`, never the cause) -> `WorkflowFailed`.
After editing the ASL, parse it as JSON with the `${...}` placeholders filled and check that every `Next`/`Default`/`Catch`/`Choices` target names an existing state in its scope (`terraform validate` does not check ASL).

## Status models (do not invent names; enum changes follow `db-migration`)
- `job_status`: `queued | running | completed | failed | cancelled`. One active job per tender (`processing_jobs_one_active_uq`), API returns 409 first.
- `pack_doc_status`: `Uploaded | Extracting text | Text ready | Analysing | Done | Failed` (`Failed` requires `fail_reason`).
- API transitions: on start (`processing.ts`) `Uploaded`+text -> `Text ready`, `Uploaded` -> `Extracting text`, `Done` -> `Text ready`, `Failed` "service unavailable" -> `Extracting text`. Progress: `stage >= 2` -> `Analysing`; `completed` -> `Done`, `last_processed_at`, reset out-of-date, audit; `failed` -> `process_failed`, in-flight docs -> `Uploaded`, audit.
- `mode: retry-document` (`documents.ts` retry): extract only. `completed` adds the Text-ready docs to `out_of_date_repaired` (like the UI's `retry-doc-done`); `failed` marks the doc `Failed` and does not touch `process_failed`.
- `textReady` is sent only when `text_extracted` and `text_s3_prefix` are both set.

## How the status updater applies an update (decided: direct to RDS)
Per the architecture spec, the status updater Lambda writes RDS directly, connecting as `tendrai_status_updater` (secret `db_role["status_updater"]`, grants in `db/roles.sql`). It cannot call the API: the EC2 app SG admits only the ALB.
- Its SQL must do exactly what `POST /internal/jobs/:jobId/progress` does (`api/src/routes/processing.ts`): job stage/status, document statuses, `processing_job_documents` upsert, tender completion/failure, retry-document handling, system audit entry, then `SELECT notify_tender_event(...)` so the API's WebSocket clients update. The API endpoint stays for local runs.
- When you change either side, change the other in the same change and re-check the grants. If the two drift, propose moving the transitions into one SQL function both call (needs a migration; ask first).

## Retries and failure handling
- Lambda tasks retry `Lambda.ServiceException|AWSLambdaException|SdkClientException|TooManyRequestsException` (2 s, x3, backoff 2; analyser 5 s). Handler exceptions are not retried.
- Textract retries throughput/throttling/limit/internal errors (5 s, x5, backoff 2). No overall poll limit on the Wait loop.
- SQS: visibility 60 s, redrive to `<name>-tender-jobs-dlq` after `sqs_max_receive_count` (3). Pipe `FIRE_AND_FORGET`: the DLQ only catches messages the Pipe could not start; failed executions are not redriven. User-level retry is always a new job.
- `dispatchJob` (`api/src/lib/jobs.ts`): if the send fails the job is marked `failed`, docs restored, audited, and the request returns 503.
- Alarms (`cloudwatch.tf`): DLQ visible messages, `ExecutionsFailed > 0`, per-Lambda `Errors > 3`.

## Where results go (ids only in keys)
- `tenders/<tenderId>/pack/<documentId>/source.<ext>` uploads (`keys().pack`; the file name lives in `tender_documents.name`).
- `extracted/<tenderId>/<documentId>/textract/<textractJobId>/` and `extracted/<tenderId>/<documentId>/word|excel/` -> stored as `tender_documents.text_s3_prefix` for reuse.
- `normalized/<tenderId>/<jobId>/tender.json`; `analysis/<tenderId>/<jobId>/<task>.json` (`ANALYSIS_PREFIX`).
- RDS (`result_loader`): `tenders.overview`, `checklist_items`, `qualifications`, `clauses`. Reprocess matches rows and sets `review_state` `new/changed/missing`; never deletes rows or overwrites human fields. JSON shape: `bedrock-prompts` skill.
- Submission first drafts are not part of this workflow: the API makes them on demand per checklist item (`drafts/<tenderId>/<checklistItemId>/<file>`).

## Rules
- Only ids, S3 keys and counts pass between states (`include_execution_data = true` logs payloads on errors; 256 KB limit).
- Log ids and status only. Never document text, file names, prompts, model output or error causes.
- Figures pass through exactly as read or saved. The V3 business case draft (planned seventh stage, "Draft business case") is not in the state machine yet; see "V3 backend follow-up" in docs/USER_GUIDE.md.
- IAM changes stay least-privilege; explain the risk (CLAUDE.md).
- Check before done: `terraform fmt -check -recursive infra`, `terraform -chdir=infra/envs/floci validate` (and `prod` after `init -backend=false`), `npm --prefix api run typecheck`, `python -m py_compile lambdas/<fn>/handler.py` where Python is available.
