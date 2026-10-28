# ---------------------------------------------------------------------------
# TendrAI — Account-wide security services (diagram items 25–31)
# Gated by var.enable_security_services.
#
# * GuardDuty            — threat detection
# * Security Hub         — AWS Foundational Security Best Practices standard
# * Inspector2           — EC2 instance and Lambda vulnerability scanning
# * CloudTrail           — multi-region, log file validation ON (immutable
#                          audit trail), KMS-encrypted, delivered to the
#                          dedicated audit-logs bucket (s3.tf)
# * Macie                — sensitive-data discovery for S3
# * AWS Config           — resource configuration recorder + managed rules
# * IAM Access Analyzer  — account-level external access analyzer
# ---------------------------------------------------------------------------

resource "aws_guardduty_detector" "main" {
  count = var.enable_security_services ? 1 : 0

  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"

  tags = {
    Name = "${local.name}-guardduty"
  }
}

resource "aws_securityhub_account" "main" {
  count = var.enable_security_services ? 1 : 0

  enable_default_standards = false
}

resource "aws_securityhub_standards_subscription" "fsbp" {
  count = var.enable_security_services ? 1 : 0

  standards_arn = "arn:${local.partition}:securityhub:${var.aws_region}::standards/aws-foundational-security-best-practices/v/1.0.0"

  depends_on = [aws_securityhub_account.main]
}

resource "aws_inspector2_enabler" "main" {
  count = var.enable_security_services ? 1 : 0

  account_ids    = [local.account_id]
  resource_types = ["EC2", "LAMBDA"]
}

resource "aws_cloudtrail" "main" {
  count = var.enable_security_services ? 1 : 0

  name           = local.trail_name
  s3_bucket_name = aws_s3_bucket.audit_logs[0].id
  s3_key_prefix  = "cloudtrail"

  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true # immutable audit trail (digest files)
  kms_key_id                    = aws_kms_key.logs.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    # Audit object-level access to the tender documents bucket.
    data_resource {
      type   = "AWS::S3::Object"
      values = ["${aws_s3_bucket.documents.arn}/"]
    }
  }

  depends_on = [aws_s3_bucket_policy.audit_logs]

  tags = {
    Name = local.trail_name
  }
}

# ----- Macie -----------------------------------------------------------------

resource "aws_macie2_account" "main" {
  count = var.enable_security_services ? 1 : 0

  finding_publishing_frequency = "FIFTEEN_MINUTES"
  status                       = "ENABLED"
}

# ----- AWS Config ------------------------------------------------------------

data "aws_iam_policy_document" "config_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "config" {
  count = var.enable_security_services ? 1 : 0

  name               = "${local.name}-config-role"
  assume_role_policy = data.aws_iam_policy_document.config_assume.json

  tags = {
    Name = "${local.name}-config-role"
  }
}

resource "aws_iam_role_policy_attachment" "config" {
  count = var.enable_security_services ? 1 : 0

  role       = aws_iam_role.config[0].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWS_ConfigRole"
}

resource "aws_config_configuration_recorder" "main" {
  count = var.enable_security_services ? 1 : 0

  name     = "${local.name}-config-recorder"
  role_arn = aws_iam_role.config[0].arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = true
  }
}

resource "aws_config_delivery_channel" "main" {
  count = var.enable_security_services ? 1 : 0

  name           = "${local.name}-config-delivery"
  s3_bucket_name = aws_s3_bucket.audit_logs[0].bucket
  s3_key_prefix  = "config"
  s3_kms_key_arn = aws_kms_key.logs.arn

  snapshot_delivery_properties {
    delivery_frequency = "TwentyFour_Hours"
  }

  depends_on = [
    aws_config_configuration_recorder.main,
    aws_s3_bucket_policy.audit_logs,
  ]
}

resource "aws_config_configuration_recorder_status" "main" {
  count = var.enable_security_services ? 1 : 0

  name       = aws_config_configuration_recorder.main[0].name
  is_enabled = true

  depends_on = [aws_config_delivery_channel.main]
}

# Managed rules that match this stack's security posture.
resource "aws_config_config_rule" "managed" {
  for_each = var.enable_security_services ? toset([
    "S3_BUCKET_SSL_REQUESTS_ONLY",
    "S3_BUCKET_PUBLIC_READ_PROHIBITED",
    "RDS_STORAGE_ENCRYPTED",
    "RDS_INSTANCE_PUBLIC_ACCESS_CHECK",
    "LAMBDA_INSIDE_VPC",
    "EC2_IMDSV2_CHECK",
    "ENCRYPTED_VOLUMES",
    "CLOUD_TRAIL_ENCRYPTION_ENABLED",
    "CLOUD_TRAIL_LOG_FILE_VALIDATION_ENABLED",
  ]) : toset([])

  name = "${local.name}-${lower(replace(each.key, "_", "-"))}"

  source {
    owner             = "AWS"
    source_identifier = each.key
  }

  depends_on = [aws_config_configuration_recorder_status.main]
}

# ----- IAM Access Analyzer ---------------------------------------------------

resource "aws_accessanalyzer_analyzer" "account" {
  count = var.enable_security_services ? 1 : 0

  analyzer_name = "${local.name}-access-analyzer"
  type          = "ACCOUNT"

  tags = {
    Name = "${local.name}-access-analyzer"
  }
}
