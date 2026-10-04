# ---------------------------------------------------------------------------
# LPS-P2C — Account-wide security services (item 13)
# Gated by var.enable_security_services.
#
# * GuardDuty       — threat detection
# * Security Hub    — AWS Foundational Security Best Practices standard
# * Inspector2      — EC2 vulnerability scanning
# * CloudTrail      — multi-region, log file validation ON (immutable audit
#                     trail), KMS-encrypted, delivered to the dedicated
#                     audit-logs bucket (s3.tf)
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

  standards_arn = "arn:aws:securityhub:${var.aws_region}::standards/aws-foundational-security-best-practices/v/1.0.0"

  depends_on = [aws_securityhub_account.main]
}

resource "aws_inspector2_enabler" "ec2" {
  count = var.enable_security_services ? 1 : 0

  account_ids    = [local.account_id]
  resource_types = ["EC2"]
}

resource "aws_cloudtrail" "main" {
  count = var.enable_security_services ? 1 : 0

  name           = "${local.name}-trail"
  s3_bucket_name = aws_s3_bucket.audit_logs[0].id

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
    Name = "${local.name}-trail"
  }
}
