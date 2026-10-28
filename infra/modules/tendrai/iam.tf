# ---------------------------------------------------------------------------
# TendrAI — IAM (diagram item 21 — least privilege)
#
# * EC2 app instance role   : documents bucket, send jobs to SQS, read its
#                             own DB role secret + app config secret (never
#                             the RDS master secret), data CMK, app logs and
#                             metrics, SSM managed instance, read CI/CD
#                             artifacts for the CodeDeploy agent.
# * Lambda roles (one each) : VPC ENIs + logs + X-Ray, data CMK, plus only
#                             the S3 / DB secret / Bedrock access the function
#                             needs (flags in locals.lambda_functions).
# * Step Functions role     : invoke the workflow Lambdas, Textract, S3
#                             read uploads / write extracted text, logging.
# * EventBridge Pipes role  : consume the SQS queue, start executions.
# * VPC Flow Logs role.
# CI/CD service roles live in cicd.tf; they are gated with the pipeline.
# ---------------------------------------------------------------------------

# ----- EC2 application instance role ----------------------------------------

# EC2 does not send aws:SourceAccount / aws:SourceArn when it assumes an
# instance-profile role, so the trust policy cannot carry those conditions;
# only this account can attach the instance profile (iam:PassRole).
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${local.name}-app-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json

  tags = {
    Name = "${local.name}-app-role"
  }
}

resource "aws_iam_instance_profile" "app" {
  name = "${local.name}-app-profile"
  role = aws_iam_role.app.name

  tags = {
    Name = "${local.name}-app-profile"
  }
}

data "aws_iam_policy_document" "app" {
  # Exactly the object operations in api/src/lib/s3.ts: presigned PUT/GET,
  # Head (GetObject), Put, Get (incl. VersionId), Delete, CopyObject to change
  # the storage class (needs Get + Put, plus the tagging pair when the source
  # object has tags) and RestoreObject.
  statement {
    sid    = "DocumentsBucketObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:RestoreObject",
      "s3:GetObjectTagging",
      "s3:PutObjectTagging",
    ]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  # ListBucket lets HeadObject return 404 (not 403) for a missing key;
  # versioning/replication are read by the backup page (bucketHealth).
  statement {
    sid    = "DocumentsBucketRead"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketVersioning",
      "s3:GetReplicationConfiguration",
    ]
    resources = [aws_s3_bucket.documents.arn]
  }

  # "queues a job for each tender" (api/src/lib/sqs.ts SendMessage).
  statement {
    sid       = "QueueTenderJobs"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.jobs.arn]
  }

  # Only the app's own DB login role secret and the app config secret.
  # Never the RDS master secret.
  statement {
    sid    = "ReadAppSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.db_role["app"].arn,
      aws_secretsmanager_secret.app_config.arn,
    ]
  }

  # Documents, secrets, the job queue, CI/CD artifacts and the EBS volumes
  # are encrypted with the data CMK.
  statement {
    sid    = "UseDataKey"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.data.arn]
  }

  # CloudWatch agent ships the app log file to the app log group only.
  statement {
    sid    = "WriteAppLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      aws_cloudwatch_log_group.app.arn,
      "${aws_cloudwatch_log_group.app.arn}:*",
    ]
  }

  # Backup page: object count and size metrics of the bucket.
  # cloudwatch:GetMetricStatistics has no resource-level permissions.
  statement {
    sid       = "ReadBucketMetrics"
    effect    = "Allow"
    actions   = ["cloudwatch:GetMetricStatistics"]
    resources = ["*"]
  }

  # CloudWatch agent memory/disk metrics. PutMetricData has no resource-level
  # permissions; the namespace condition limits it to the project namespace.
  statement {
    sid       = "PutCustomMetrics"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [var.project_tag]
    }
  }

  # SSM managed instance (Session Manager, no SSH). UpdateInstanceInformation
  # is scoped to instances in this account/region.
  statement {
    sid       = "SsmManagedInstance"
    effect    = "Allow"
    actions   = ["ssm:UpdateInstanceInformation"]
    resources = ["arn:${local.partition}:ec2:${var.aws_region}:${local.account_id}:instance/*"]
  }

  # ssmmessages / ec2messages channels have no resource-level permissions.
  statement {
    sid    = "SsmSessionChannels"
    effect = "Allow"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
      "ec2messages:AcknowledgeMessage",
      "ec2messages:DeleteMessage",
      "ec2messages:FailMessage",
      "ec2messages:GetEndpoint",
      "ec2messages:GetMessages",
      "ec2messages:SendReply",
    ]
    resources = ["*"]
  }

  # CodeDeploy agent: pull revisions from the CI/CD artifacts bucket.
  statement {
    sid    = "CicdArtifactsReadOnly"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${aws_s3_bucket.cicd_artifacts.arn}/*"]
  }

  statement {
    sid       = "CicdArtifactsList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.cicd_artifacts.arn]
  }

  # CodeDeploy agent installer and agent package (AWS-owned regional bucket,
  # reached through the S3 gateway endpoint).
  statement {
    sid       = "CodeDeployAgentInstaller"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:${local.partition}:s3:::aws-codedeploy-${var.aws_region}/*"]
  }

  # CodeDeploy agent over the codedeploy-commands-secure endpoint
  # (:enable_auth_policy: true). These actions have no resource-level
  # permissions.
  statement {
    sid    = "CodeDeployAgentCommands"
    effect = "Allow"
    actions = [
      "codedeploy-commands-secure:GetDeploymentSpecification",
      "codedeploy-commands-secure:PollHostCommand",
      "codedeploy-commands-secure:PutHostCommandAcknowledgement",
      "codedeploy-commands-secure:PutHostCommandComplete",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${local.name}-app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

# ----- Workflow Lambda roles (one per function) -----------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each = local.lambda_functions

  name               = "${local.name}-${replace(each.key, "_", "-")}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json

  tags = {
    Name = "${local.name}-${replace(each.key, "_", "-")}-role"
  }
}

# ENI management for VPC-attached functions + CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  for_each = local.lambda_functions

  role       = aws_iam_role.lambda[each.key].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_xray" {
  for_each = local.lambda_functions

  role       = aws_iam_role.lambda[each.key].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

data "aws_iam_policy_document" "lambda" {
  for_each = local.lambda_functions

  # Environment variables, S3 objects and secrets are encrypted with the data CMK.
  statement {
    sid    = "UseDataKey"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.data.arn]
  }

  dynamic "statement" {
    for_each = each.value.needs_s3 ? [1] : []

    content {
      sid    = "DocumentsBucketObjects"
      effect = "Allow"
      actions = [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:PutObject",
      ]
      resources = ["${aws_s3_bucket.documents.arn}/*"]
    }
  }

  dynamic "statement" {
    for_each = each.value.needs_s3 ? [1] : []

    content {
      sid    = "DocumentsBucketList"
      effect = "Allow"
      actions = [
        "s3:ListBucket",
        "s3:GetBucketLocation",
      ]
      resources = [aws_s3_bucket.documents.arn]
    }
  }

  dynamic "statement" {
    for_each = each.value.needs_db ? [1] : []

    content {
      # Only this function's own DB role secret — never the master secret.
      sid    = "ReadOwnDbRoleSecret"
      effect = "Allow"
      actions = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
      ]
      resources = [aws_secretsmanager_secret.db_role[each.key].arn]
    }
  }

  dynamic "statement" {
    for_each = each.value.needs_bedrock ? [1] : []

    content {
      sid    = "InvokeApprovedFoundationModels"
      effect = "Allow"
      actions = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      resources = local.bedrock_model_arns
    }
  }
}

resource "aws_iam_role_policy" "lambda" {
  for_each = local.lambda_functions

  name   = "${local.name}-${replace(each.key, "_", "-")}"
  role   = aws_iam_role.lambda[each.key].id
  policy = data.aws_iam_policy_document.lambda[each.key].json
}

# ----- Step Functions role ---------------------------------------------------

data "aws_iam_policy_document" "sfn_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "sfn" {
  name               = "${local.name}-tender-processing-sfn-role"
  assume_role_policy = data.aws_iam_policy_document.sfn_assume.json

  tags = {
    Name = "${local.name}-tender-processing-sfn-role"
  }
}

data "aws_iam_policy_document" "sfn" {
  statement {
    sid     = "InvokeWorkflowLambdas"
    effect  = "Allow"
    actions = ["lambda:InvokeFunction"]
    resources = flatten([
      for fn in aws_lambda_function.workflow : [fn.arn, "${fn.arn}:*"]
    ])
  }

  # Textract has no resource-level permissions.
  statement {
    sid    = "TextractPdfs"
    effect = "Allow"
    actions = [
      "textract:StartDocumentTextDetection",
      "textract:GetDocumentTextDetection",
    ]
    resources = ["*"]
  }

  # Textract reads uploads and writes results on behalf of this role.
  statement {
    sid       = "ReadTenderUploads"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.documents.arn}/${local.s3_prefix_uploads}/*"]
  }

  statement {
    sid       = "WriteExtractedText"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.documents.arn}/${local.s3_prefix_extracted}/*"]
  }

  statement {
    sid       = "ListDocumentsBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.documents.arn]
  }

  statement {
    sid    = "UseDataKey"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.data.arn]
  }

  # CloudWatch Logs delivery for state machine logging (vended logs).
  statement {
    sid    = "StateMachineLogging"
    effect = "Allow"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutLogEvents",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "XRayTracing"
    effect = "Allow"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "sfn" {
  name   = "${local.name}-tender-processing-sfn"
  role   = aws_iam_role.sfn.id
  policy = data.aws_iam_policy_document.sfn.json
}

# ----- EventBridge Pipes role -----------------------------------------------

data "aws_iam_policy_document" "pipes_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["pipes.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:pipes:${var.aws_region}:${local.account_id}:pipe/${local.name}-jobs-to-workflow"]
    }
  }
}

resource "aws_iam_role" "pipes" {
  name               = "${local.name}-jobs-pipe-role"
  assume_role_policy = data.aws_iam_policy_document.pipes_assume.json

  tags = {
    Name = "${local.name}-jobs-pipe-role"
  }
}

data "aws_iam_policy_document" "pipes" {
  statement {
    sid    = "ConsumeJobQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.jobs.arn]
  }

  statement {
    sid       = "DecryptQueueMessages"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }

  statement {
    sid       = "StartTenderProcessing"
    effect    = "Allow"
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.tender_processing.arn]
  }
}

resource "aws_iam_role_policy" "pipes" {
  name   = "${local.name}-jobs-pipe"
  role   = aws_iam_role.pipes.id
  policy = data.aws_iam_policy_document.pipes.json
}

# ----- VPC Flow Logs delivery role ------------------------------------------

data "aws_iam_policy_document" "flow_logs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow_logs" {
  name               = "${local.name}-flow-logs-role"
  assume_role_policy = data.aws_iam_policy_document.flow_logs_assume.json

  tags = {
    Name = "${local.name}-flow-logs-role"
  }
}

data "aws_iam_policy_document" "flow_logs" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]
    resources = ["${aws_cloudwatch_log_group.vpc_flow_logs.arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow_logs" {
  name   = "${local.name}-flow-logs"
  role   = aws_iam_role.flow_logs.id
  policy = data.aws_iam_policy_document.flow_logs.json
}
