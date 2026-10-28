"""TendrAI — analyser (placeholder).

Called once per task, one workflow stage each:
    overview                  -> stage 2 Build tender overview
    submissionRequirements    -> stage 3 Extract submission requirements
    qualificationRequirements -> stage 4 Extract qualification requirements
    clauses                   -> stage 5 Extract clauses

Input:
    {"tenderId": "<uuid>", "jobId": "<uuid>", "task": "<task>",
     "normalizedKey": "normalized/<tenderId>/<jobId>/tender.json"}

Output:
    {"task": "<task>", "resultKey": "analysis/<tenderId>/<jobId>/<task>.json"}

The task result is written to S3, not returned, so document text never passes
through Step Functions (execution data is logged on errors) and large results
stay under the 256 KB state payload limit. The result loader reads it.

Expected implementation: read the normalised text from DOCUMENTS_BUCKET and
prompt Bedrock (BEDROCK_TEXT_MODEL_ID, in-region ap-southeast-1 only, via the
bedrock-runtime PrivateLink endpoint). Keep clause and requirement numbering
and all figures exactly as in the source. Submission first drafts are not made
here: the API generates them on demand per checklist item.
Never log prompts, model output or document text.
"""

import json
import logging
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TASKS = ("overview", "submissionRequirements", "qualificationRequirements", "clauses")


def lambda_handler(event, _context):
    task = event["task"]
    if task not in TASKS:
        raise ValueError(f"Unknown analyser task: {task}")
    logger.info(json.dumps({"action": "analyse", "tenderId": event["tenderId"], "jobId": event["jobId"], "task": task, "model": os.environ.get("BEDROCK_TEXT_MODEL_ID")}))
    result_key = f"{os.environ['ANALYSIS_PREFIX']}/{event['tenderId']}/{event['jobId']}/{task}.json"
    # TODO: invoke Bedrock for `task` and write the validated JSON result to result_key.
    return {"task": task, "resultKey": result_key}
