"""TendrAI — text normalizer (placeholder).

Input (documents = the ExtractDocuments Map result):
    {"tenderId": "<uuid>", "jobId": "<uuid>",
     "documents": [ {"documentId": "<uuid>", "status": "Text ready", "textPrefix": "extracted/<tenderId>/<documentId>/textract/<JobId>"},
                    {"documentId": "<uuid>", "status": "Text ready", "textPrefix": "extracted/<tenderId>/<documentId>/word"},
                    {"documentId": "<uuid>", "status": "Failed", "failReason": "..."} ]}

Output (consumed by the analyser; documentCount 0 fails the job):
    {"normalizedKey": "normalized/<tenderId>/<jobId>/tender.json", "documentCount": n}

Expected implementation: for every document with status "Text ready", read its
text result from DOCUMENTS_BUCKET (Textract JSON block files for PDFs, plain
text for Word/Excel), normalise into one JSON document that keeps documentId and
page for every passage (the analyser cites them), and write it to normalizedKey.
Never log document text — ids and counts only.
"""

import json
import logging
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event, _context):
    readable = [d for d in event.get("documents", []) if d.get("status") == "Text ready"]
    logger.info(json.dumps({"action": "normalize", "tenderId": event["tenderId"], "jobId": event["jobId"], "documents": len(readable)}))
    normalized_key = f"{os.environ['NORMALIZED_PREFIX']}/{event['tenderId']}/{event['jobId']}/tender.json"
    # TODO: merge the text results of `readable` and write the normalised document to normalized_key.
    return {
        "normalizedKey": normalized_key,
        "documentCount": len(readable),
    }
