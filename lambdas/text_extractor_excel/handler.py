"""TendrAI — text extractor for Excel workbooks and CSV (placeholder).

Called by the ExtractDocuments Map state, once per document.

Input:
    {"tenderId": "<uuid>",
     "document": {"documentId": "<uuid>", "key": "tenders/<tenderId>/pack/<documentId>/source.xlsx",
                  "fileType": "xlsx", "textReady": false, "textPrefix": null}}

Output (one item of the Map result; same shape as a document entry of the
API's POST /internal/jobs/:jobId/progress body):
    {"documentId": "<uuid>", "status": "Text ready",
     "textPrefix": "extracted/<tenderId>/<documentId>/excel"}

Raise on failure: the state machine turns any error into
{"status": "Failed", "failReason": ...} for this document only.

Expected implementation: download the object from DOCUMENTS_BUCKET, flatten
sheets to text (e.g. openpyxl) and write it under textPrefix. Cell values are
copied exactly as stored — no rounding or number formatting.
Never log document text or file names — ids only.
"""

import json
import logging
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, _context):
    document = event["document"]
    logger.info(json.dumps({"action": "extract_excel", "tenderId": event["tenderId"], "documentId": document["documentId"]}))
    text_prefix = f"{os.environ['EXTRACTED_PREFIX']}/{event['tenderId']}/{document['documentId']}/excel"
    # TODO: read the workbook from S3, extract text and write it under text_prefix.
    return {
        "documentId": document["documentId"],
        "status": "Text ready",
        "textPrefix": text_prefix,
    }
