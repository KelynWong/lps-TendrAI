# ---------------------------------------------------------------------------
# TendrAI — Step Functions tender-processing workflow (diagram item 9)
#
# Started by the EventBridge Pipe for every SQS job. Definition lives in
# statemachine/tender_processing.asl.json (Amazon States Language):
#
#   UnwrapQueueMessage
#   -> MarkReadingDocuments (stage 1)        status updater Lambda
#   -> ExtractDocuments [Map, per document]  textReady -> reuse textPrefix
#                                            pdf  -> Textract (OutputConfig -> S3)
#                                            docx -> text extractor (Word) Lambda
#                                            xlsx -> text extractor (Excel) Lambda
#                                            any error -> that document Failed only
#   -> ReportDocuments                       per-document status to the API
#   -> mode retry-document? -> MarkCompleted (extract only)
#   -> NormalizeText -> no text at all? -> MarkFailed
#   -> stage 2 overview, 3 submission requirements, 4 qualification
#      requirements, 5 clauses              analyser Lambda -> Bedrock -> S3
#   -> stage 6 LoadResults                   result loader Lambda -> RDS
#   -> MarkCompletedWithResults
#   any step failure -> MarkFailed -> WorkflowFailed
#
# Stages 1-6 are PROCESS_STAGES in api/src/types.ts; every status update uses
# the body of the API's POST /internal/jobs/:jobId/progress.
# ---------------------------------------------------------------------------

resource "aws_sfn_state_machine" "tender_processing" {
  name     = "${local.name}-tender-processing"
  role_arn = aws_iam_role.sfn.arn
  type     = "STANDARD"

  definition = templatefile("${path.module}/statemachine/tender_processing.asl.json", {
    partition                = local.partition
    documents_bucket         = aws_s3_bucket.documents.bucket
    extracted_prefix         = local.s3_prefix_extracted
    kms_key_arn              = aws_kms_key.data.arn
    textract_poll_interval   = var.textract_poll_interval_seconds
    status_updater_arn       = aws_lambda_function.workflow["status_updater"].arn
    text_extractor_word_arn  = aws_lambda_function.workflow["text_extractor_word"].arn
    text_extractor_excel_arn = aws_lambda_function.workflow["text_extractor_excel"].arn
    text_normalizer_arn      = aws_lambda_function.workflow["text_normalizer"].arn
    analyser_arn             = aws_lambda_function.workflow["analyser"].arn
    result_loader_arn        = aws_lambda_function.workflow["result_loader"].arn
  })

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.sfn.arn}:*"
    include_execution_data = true
    level                  = "ERROR"
  }

  tracing_configuration {
    enabled = true
  }

  depends_on = [aws_iam_role_policy.sfn]

  tags = {
    Name = "${local.name}-tender-processing"
  }
}
