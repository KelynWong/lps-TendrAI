"""TendrAI — result loader (placeholder). Stage 6: Build compliance table.

Input:
    {"tenderId": "<uuid>", "jobId": "<uuid>",
     "resultKeys": {"overview": "analysis/<tenderId>/<jobId>/overview.json",
                    "submissionRequirements": "...", "qualificationRequirements": "...",
                    "clauses": "..."}}

Output (passed as `results` in the completed status update):
    {"clauses": n, "checklist": n, "qualifications": n}

Expected implementation: read DB credentials from Secrets Manager
(DB_SECRET_ARN), read the four analyser results from DOCUMENTS_BUCKET and write
them to RDS PostgreSQL (DB_HOST/DB_PORT/DB_NAME) in one transaction:
tenders.overview, checklist_items, qualifications and clauses (the compliance
table). On reprocess, match existing rows and set review_state new / changed /
missing; never delete rows or overwrite human-owned fields. Figures are
written exactly as read. Never log document text.
"""

import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, _context):
    logger.info(json.dumps({"action": "load_results", "tenderId": event["tenderId"], "jobId": event["jobId"]}))
    # TODO: read event["resultKeys"] from S3 and write the results to RDS.
    return {"clauses": 0, "checklist": 0, "qualifications": 0}
