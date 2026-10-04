# ---------------------------------------------------------------------------
# LPS-P2C — IAM (items 5, 9, 11 — least privilege)
#
# * App instance role: SSM Session Manager, Bedrock invoke on the two model
#   families only, documents bucket, its own secrets, data CMK, its own log
#   group, read-only CI/CD artifacts (CodeDeploy agent).
# * VPC Flow Logs delivery role.
# CI/CD service roles live in cicd.tf; they are gated with the pipeline.
# ---------------------------------------------------------------------------

# ----- Application instance role --------------------------------------------

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
}

# Session Manager (no SSH anywhere in this stack).
resource "aws_iam_role_policy_attachment" "app_ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Bedrock: invoke ONLY Titan Text Embeddings V2 and Claude foundation models
# in ap-southeast-1 (item 9 — least privilege, data residency).
data "aws_iam_policy_document" "bedrock_invoke" {
  statement {
    sid    = "InvokeApprovedFoundationModels"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = local.bedrock_model_arns
  }
}

resource "aws_iam_policy" "bedrock_invoke" {
  name        = "${local.name}-bedrock-invoke"
  description = "Invoke Titan Embeddings V2 and Claude models in ${var.aws_region} only"
  policy      = data.aws_iam_policy_document.bedrock_invoke.json
}

resource "aws_iam_role_policy_attachment" "app_bedrock" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.bedrock_invoke.arn
}

# Application data-plane access.
data "aws_iam_policy_document" "app_data" {
  statement {
    sid    = "DocumentsBucketObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  statement {
    sid    = "DocumentsBucketList"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.documents.arn]
  }

  statement {
    sid    = "CicdArtifactsReadOnly"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.cicd_artifacts.arn,
      "${aws_s3_bucket.cicd_artifacts.arn}/*",
    ]
  }

  # CodeDeploy agent installer lives in an AWS-owned regional bucket.
  statement {
    sid       = "CodeDeployAgentInstaller"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::aws-codedeploy-${var.aws_region}/*"]
  }

  statement {
    sid    = "ReadAppSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.app_config.arn,
      aws_db_instance.main.master_user_secret[0].secret_arn,
    ]
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

  statement {
    sid    = "WriteAppLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = ["${aws_cloudwatch_log_group.app.arn}:*"]
  }

  statement {
    sid       = "PutCustomMetrics"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["LPS-P2C"]
    }
  }
}

resource "aws_iam_policy" "app_data" {
  name        = "${local.name}-app-data"
  description = "LPS-P2C app data-plane access (S3, Secrets Manager, KMS, logs)"
  policy      = data.aws_iam_policy_document.app_data.json
}

resource "aws_iam_role_policy_attachment" "app_data" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.app_data.arn
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
