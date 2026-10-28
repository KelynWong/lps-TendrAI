# ---------------------------------------------------------------------------
# TendrAI — KMS customer-managed keys (diagram: two KMS icons)
#
# Two CMKs, both with annual rotation:
#   * data — S3 documents/artifacts, RDS storage, Secrets Manager, SQS, EBS,
#            Lambda environment variables, Textract output
#   * logs — CloudWatch Logs, CloudTrail, AWS Config, alarm SNS topic
# ---------------------------------------------------------------------------

# ----- Data key --------------------------------------------------------------

data "aws_iam_policy_document" "kms_data" {
  # Account root retains full control; grants fine-grained use via IAM.
  statement {
    sid    = "EnableIAMUserPermissions"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # Textract writes OutputConfig results to the documents bucket encrypted
  # with this key (Step Functions passes KMSKeyId).
  statement {
    sid    = "AllowTextractOutputEncryption"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["textract.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  # The Auto Scaling service-linked role launches the app instances, whose
  # EBS volumes are encrypted with this key (ec2.tf). It may use the key only
  # through EC2 in this region, and create grants only for AWS resources.
  # The role must already exist (it does in any account that has used EC2
  # Auto Scaling; otherwise create it once, see infra/README.md).
  statement {
    sid    = "AllowAutoScalingEbsEncryption"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [local.autoscaling_slr_arn]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ec2.${var.aws_region}.amazonaws.com"]
    }
  }

  statement {
    sid    = "AllowAutoScalingEbsGrants"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [local.autoscaling_slr_arn]
    }
    actions   = ["kms:CreateGrant"]
    resources = ["*"]
    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
  }

  # EventBridge Pipes decrypts messages from the KMS-encrypted SQS queue
  # using its execution role (IAM), and SQS itself needs no key grant.
  # Lambda decrypts its environment variables via the function role (IAM).
}

locals {
  autoscaling_slr_arn = "arn:${local.partition}:iam::${local.account_id}:role/aws-service-role/autoscaling.amazonaws.com/AWSServiceRoleForAutoScaling"
}

resource "aws_kms_key" "data" {
  description             = "${local.name} data key (S3, RDS, Secrets Manager, SQS, EBS, Lambda env, Textract)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_data.json

  tags = {
    Name = "${local.name}-data-key"
  }
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

# ----- Logs / audit key ------------------------------------------------------

data "aws_iam_policy_document" "kms_logs" {
  statement {
    sid    = "EnableIAMUserPermissions"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # CloudWatch Logs encrypts log groups with this key.
  statement {
    sid    = "AllowCloudWatchLogs"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:*"]
    }
  }

  # CloudTrail encrypts log files delivered to S3 with this key.
  statement {
    sid    = "AllowCloudTrailEncrypt"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions   = ["kms:GenerateDataKey*"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid    = "AllowCloudTrailDescribe"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions   = ["kms:DescribeKey"]
    resources = ["*"]
  }

  # AWS Config delivers configuration snapshots/history to the audit bucket.
  statement {
    sid    = "AllowConfigDelivery"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    actions = [
      "kms:GenerateDataKey*",
      "kms:Decrypt",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  # CloudWatch alarms publish to the KMS-encrypted SNS alarm topic.
  statement {
    sid    = "AllowCloudWatchAlarmsSNS"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    actions = [
      "kms:GenerateDataKey*",
      "kms:Decrypt",
    ]
    resources = ["*"]
  }
}

resource "aws_kms_key" "logs" {
  description             = "${local.name} logs/audit key (CloudWatch Logs, CloudTrail, Config, SNS)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_logs.json

  tags = {
    Name = "${local.name}-logs-key"
  }
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${local.name}-logs"
  target_key_id = aws_kms_key.logs.key_id
}
