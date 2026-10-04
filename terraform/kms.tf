# ---------------------------------------------------------------------------
# LPS-P2C — KMS customer-managed keys (item 10)
#
# Two CMKs, both with annual rotation:
#   * data — S3 documents/artifacts, EBS volumes, RDS storage, Secrets Manager
#   * logs — CloudWatch Logs, CloudTrail, alarm SNS topic
# ---------------------------------------------------------------------------

# ----- Data key --------------------------------------------------------------

data "aws_iam_policy_document" "kms_data" {
  # Account root retains full control; grants fine-grained use via IAM.
  statement {
    sid    = "EnableIAMUserPermissions"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # Auto Scaling launches instances with KMS-encrypted EBS volumes; the
  # service-linked role needs to use the key via EC2. Scoping with ViaService
  # avoids referencing the service-linked role directly (it may not exist yet).
  statement {
    sid    = "AllowEBSUseViaEC2"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
      "kms:CreateGrant",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ec2.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "data" {
  description             = "${local.name} data key (S3, EBS, RDS, Secrets Manager)"
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
      identifiers = ["arn:aws:iam::${local.account_id}:root"]
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
      values   = ["arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:*"]
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
  description             = "${local.name} logs/audit key (CloudWatch Logs, CloudTrail, SNS)"
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
