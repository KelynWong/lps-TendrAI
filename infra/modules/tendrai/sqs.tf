# ---------------------------------------------------------------------------
# TendrAI — Tender job queue + EventBridge Pipes (diagram items 7, 8)
#
#   EC2 app --SendMessage (via sqs PrivateLink)--> SQS jobs queue
#   EventBridge Pipe polls the queue (batch size 1) and starts one Step
#   Functions execution per tender job. Poison messages land in the DLQ
#   after sqs_max_receive_count attempts.
#
# Message body contract (JSON) — source of truth: TenderJobMessage in
# api/src/lib/sqs.ts. Keep this comment, the Pipe input_template below and
# statemachine/tender_processing.asl.json in step with it.
#   { "tenderId": "<uuid>", "jobId": "<uuid>",
#     "mode": "process" | "reprocess" | "retry-document",
#     "requestedBy": "<user uuid>",
#     "documents": [ { "documentId": "<uuid>",
#                      "key": "tenders/<tenderId>/pack/<documentId>/source.pdf",
#                      "fileType": "pdf|doc|docx|xls|xlsx|csv",
#                      "textReady": false,
#                      "textPrefix": null | "extracted/<tenderId>/<documentId>/..." } ] }
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${local.name}-tender-jobs-dlq"
  message_retention_seconds = var.sqs_message_retention_seconds

  kms_master_key_id                 = aws_kms_key.data.id
  kms_data_key_reuse_period_seconds = 300

  tags = {
    Name = "${local.name}-tender-jobs-dlq"
  }
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${local.name}-tender-jobs"
  visibility_timeout_seconds = 60
  message_retention_seconds  = var.sqs_message_retention_seconds
  receive_wait_time_seconds  = 20

  kms_master_key_id                 = aws_kms_key.data.id
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = var.sqs_max_receive_count
  })

  tags = {
    Name = "${local.name}-tender-jobs"
  }
}

resource "aws_sqs_queue_redrive_allow_policy" "jobs_dlq" {
  queue_url = aws_sqs_queue.jobs_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.jobs.arn]
  })
}

# Encryption in transit: reject non-TLS access to both queues.
data "aws_iam_policy_document" "sqs_tls_only" {
  for_each = {
    jobs = aws_sqs_queue.jobs.arn
    dlq  = aws_sqs_queue.jobs_dlq.arn
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions   = ["sqs:*"]
    resources = [each.value]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_sqs_queue_policy" "jobs" {
  queue_url = aws_sqs_queue.jobs.id
  policy    = data.aws_iam_policy_document.sqs_tls_only["jobs"].json
}

resource "aws_sqs_queue_policy" "jobs_dlq" {
  queue_url = aws_sqs_queue.jobs_dlq.id
  policy    = data.aws_iam_policy_document.sqs_tls_only["dlq"].json
}

# ----- EventBridge Pipe: SQS -> Step Functions -------------------------------

resource "aws_pipes_pipe" "jobs_to_workflow" {
  name     = "${local.name}-jobs-to-workflow"
  role_arn = aws_iam_role.pipes.arn
  source   = aws_sqs_queue.jobs.arn
  target   = aws_sfn_state_machine.tender_processing.arn

  source_parameters {
    sqs_queue_parameters {
      batch_size                         = 1
      maximum_batching_window_in_seconds = 0
    }
  }

  target_parameters {
    # Parse the SQS body and hand the state machine a clean job object
    # (requestedBy stays in the API's job row; the workflow does not need it).
    input_template = "{\"tenderId\": <$.body.tenderId>, \"jobId\": <$.body.jobId>, \"mode\": <$.body.mode>, \"documents\": <$.body.documents>, \"messageId\": <$.messageId>}"

    step_function_state_machine_parameters {
      invocation_type = "FIRE_AND_FORGET"
    }
  }

  log_configuration {
    level = "ERROR"

    cloudwatch_logs_log_destination {
      log_group_arn = aws_cloudwatch_log_group.pipes.arn
    }
  }

  tags = {
    Name = "${local.name}-jobs-to-workflow"
  }
}
