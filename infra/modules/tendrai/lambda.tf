# ---------------------------------------------------------------------------
# TendrAI — Workflow Lambda functions (diagram items 12, 13, 14, 15, 17 and
# the status updater)
#
# One function per key of local.lambda_functions, each with its own IAM role,
# security group and KMS-encrypted log group. Code under lambdas/<name> (repo
# root) is a placeholder handler documenting the input/output contract; the real
# implementation is deployed by the application team (same zip layout).
#
# All functions run inside the VPC (no internet): S3 via the gateway
# endpoint; Secrets Manager, KMS, CloudWatch Logs and Bedrock via PrivateLink.
# ---------------------------------------------------------------------------

data "archive_file" "lambda" {
  for_each = local.lambda_functions

  type        = "zip"
  source_dir  = "${path.module}/../../../lambdas/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

locals {
  lambda_common_env = {
    ENVIRONMENT            = var.environment
    DOCUMENTS_BUCKET       = aws_s3_bucket.documents.bucket
    UPLOADS_PREFIX         = local.s3_prefix_uploads
    EXTRACTED_PREFIX       = local.s3_prefix_extracted
    NORMALIZED_PREFIX      = local.s3_prefix_normalized
    ANALYSIS_PREFIX        = local.s3_prefix_analysis
    DRAFTS_PREFIX          = local.s3_prefix_drafts
    BEDROCK_TEXT_MODEL_ID  = var.bedrock_text_model_id
    BEDROCK_EMBED_MODEL_ID = var.bedrock_embed_model_id
  }

  # Each DB-writing Lambda connects as its own least-privilege role
  # (secrets.tf db_role, keyed by function name; grants in db/roles.sql).
  lambda_db_env = {
    for k in keys(local.db_roles) : k => {
      DB_HOST       = aws_db_instance.main.address
      DB_PORT       = tostring(aws_db_instance.main.port)
      DB_NAME       = var.db_name
      DB_SECRET_ARN = aws_secretsmanager_secret.db_role[k].arn
    } if contains(keys(local.lambda_functions), k)
  }
}

resource "aws_lambda_function" "workflow" {
  for_each = local.lambda_functions

  function_name = "${local.name}-${replace(each.key, "_", "-")}"
  description   = each.value.description
  role          = aws_iam_role.lambda[each.key].arn

  filename         = data.archive_file.lambda[each.key].output_path
  source_code_hash = data.archive_file.lambda[each.key].output_base64sha256
  handler          = "handler.lambda_handler"
  runtime          = var.lambda_runtime
  architectures    = ["arm64"]
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  # Environment variables encrypted at rest with the data CMK.
  kms_key_arn = aws_kms_key.data.arn

  environment {
    variables = merge(
      local.lambda_common_env,
      each.value.needs_db ? local.lambda_db_env[each.key] : {},
    )
  }

  vpc_config {
    subnet_ids         = each.value.subnet_tier == "private" ? aws_subnet.private[*].id : aws_subnet.workflow[*].id
    security_group_ids = [aws_security_group.lambda[each.key].id]
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.lambda[each.key].name
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_vpc,
    aws_iam_role_policy_attachment.lambda_xray,
    aws_iam_role_policy.lambda,
  ]

  tags = {
    Name = "${local.name}-${replace(each.key, "_", "-")}"
  }
}
