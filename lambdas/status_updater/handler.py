"""TendrAI — status updater (placeholder).

Invoked by the Step Functions workflow at every stage change.

Input: the body of the API's POST /internal/jobs/:jobId/progress
(api/src/routes/processing.ts, schema `Progress`) plus jobId and mode:
    {"jobId": "<uuid>", "mode": "process|reprocess|retry-document",
     "stage": 1-6,                                   # PROCESS_STAGES in api/src/types.ts
     "status": "running|completed|failed",
     "executionArn": "<arn>",
     "error": "Processing failed (<ErrorName>)",
     "documents": [{"documentId": "<uuid>", "status": "Text ready|Failed",
                    "failReason": "...", "pages": n, "textPrefix": "..."}],
     "results": {"clauses": n, "checklist": n, "qualifications": n}}
Every field except jobId is optional.

Expected implementation: read DB_SECRET_ARN (the tendrai_status_updater role,
never the master) and, in one transaction, apply exactly the transitions of
the API's progress endpoint: job stage/status, document statuses, tender
completion or failure, retry-document handling, system audit entry, then
SELECT notify_tender_event(...). Grants: db/roles.sql.
Log ids and status only — never error causes or document text.
"""

import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, _context):
    logger.info(json.dumps({"action": "update_status", "jobId": event["jobId"], "stage": event.get("stage"), "status": event.get("status"), "documents": len(event.get("documents", []))}))
    # TODO: apply the progress update for event["jobId"].
    return {"jobId": event["jobId"], "updated": True}
