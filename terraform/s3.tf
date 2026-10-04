# ---------------------------------------------------------------------------
# LPS-P2C — S3 buckets (item 7, plus the CloudTrail audit bucket for item 13)
#
# All buckets: KMS (CMK) encryption with bucket keys, versioning, full public
# access block, and a TLS-only bucket policy (encryption in transit).
# ---------------------------------------------------------------------------

# ----- documents: tender PDFs + historical documents ------------------------

resource "aws_s3_bucket" "documents" {
  bucket = local.documents_bucket_name

  tags = {
    Name = local.documents_bucket_name
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "documents_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.documents.arn,
      "${aws_s3_bucket.documents.arn}/*",
    ]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = data.aws_iam_policy_document.documents_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.documents]
}

# ----- cicd-artifacts: CodePipeline/CodeBuild artifacts ---------------------

resource "aws_s3_bucket" "cicd_artifacts" {
  bucket = local.cicd_bucket_name

  tags = {
    Name = local.cicd_bucket_name
  }
}

resource "aws_s3_bucket_versioning" "cicd_artifacts" {
  bucket = aws_s3_bucket.cicd_artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cicd_artifacts" {
  bucket = aws_s3_bucket.cicd_artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "cicd_artifacts" {
  bucket = aws_s3_bucket.cicd_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "cicd_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.cicd_artifacts.arn,
      "${aws_s3_bucket.cicd_artifacts.arn}/*",
    ]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "cicd_artifacts" {
  bucket = aws_s3_bucket.cicd_artifacts.id
  policy = data.aws_iam_policy_document.cicd_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.cicd_artifacts]
}

# ----- audit-logs: CloudTrail destination (immutable audit trail) -----------
# Created only alongside the security services (see security_services.tf).

resource "aws_s3_bucket" "audit_logs" {
  count = var.enable_security_services ? 1 : 0

  bucket = local.audit_bucket_name

  tags = {
    Name = local.audit_bucket_name
  }
}

resource "aws_s3_bucket_versioning" "audit_logs" {
  count = var.enable_security_services ? 1 : 0

  bucket = aws_s3_bucket.audit_logs[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_logs" {
  count = var.enable_security_services ? 1 : 0

  bucket = aws_s3_bucket.audit_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.logs.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "audit_logs" {
  count = var.enable_security_services ? 1 : 0

  bucket = aws_s3_bucket.audit_logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "audit_bucket" {
  count = var.enable_security_services ? 1 : 0

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.audit_logs[0].arn,
      "${aws_s3_bucket.audit_logs[0].arn}/*",
    ]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "AWSCloudTrailAclCheck"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit_logs[0].arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${var.aws_region}:${local.account_id}:trail/${local.name}-trail"]
    }
  }

  statement {
    sid    = "AWSCloudTrailWrite"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit_logs[0].arn}/AWSLogs/${local.account_id}/*"]
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${var.aws_region}:${local.account_id}:trail/${local.name}-trail"]
    }
  }
}

resource "aws_s3_bucket_policy" "audit_logs" {
  count = var.enable_security_services ? 1 : 0

  bucket = aws_s3_bucket.audit_logs[0].id
  policy = data.aws_iam_policy_document.audit_bucket[0].json

  depends_on = [aws_s3_bucket_public_access_block.audit_logs]
}
