# ---------------------------------------------------------------------------
# TendrAI — S3 buckets (diagram items 10, 11, plus CI/CD artifacts and the
# CloudTrail / AWS Config audit bucket)
#
# All buckets: KMS (CMK) encryption with bucket keys, versioning, full public
# access block, and a TLS-only bucket policy (encryption in transit).
#
# documents bucket layout (see locals.s3_prefix_*):
#   tenders/<tenderId>/...                 uploads from the EC2 app (full list: api/src/lib/s3.ts)
#   extracted/<tenderId>/<documentId>/...  Textract / Word / Excel text results
#   normalized/<tenderId>/<jobId>/...      normalised text for the analyser
#   analysis/<tenderId>/<jobId>/...        analyser results, read by the result loader
#   drafts/<tenderId>/<checklistItemId>/.. submission first drafts (API, on demand)
# Lifecycle: current objects -> S3 Glacier after s3_glacier_transition_days,
# non-current versions -> Glacier after 30 days, expired after
# s3_noncurrent_expiration_days (diagram item 11, S3 Glacier).
# ---------------------------------------------------------------------------

# ----- documents: tender uploads, extracted/normalised text, drafts ---------

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

# Browsers upload straight to S3 with presigned PUT URLs issued by the API.
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.enable_acm ? ["https://${var.domain_name}"] : ["http://${aws_lb.main.dns_name}"]
    allowed_headers = ["content-type", "x-amz-server-side-encryption", "x-amz-meta-*"]
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "archive-to-glacier"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = var.s3_glacier_transition_days
      storage_class = "GLACIER"
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = var.s3_noncurrent_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.documents]
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

  # Belt-and-braces: objects must be written with the data CMK.
  statement {
    sid    = "DenyUnencryptedObjectUploads"
    effect = "Deny"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
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

resource "aws_s3_bucket_lifecycle_configuration" "cicd_artifacts" {
  bucket = aws_s3_bucket.cicd_artifacts.id

  rule {
    id     = "expire-old-artifacts"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.cicd_artifacts]
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

# ----- audit-logs: CloudTrail + AWS Config destination ----------------------
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

  # --- CloudTrail ---
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
      values   = ["arn:${local.partition}:cloudtrail:${var.aws_region}:${local.account_id}:trail/${local.trail_name}"]
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
    resources = ["${aws_s3_bucket.audit_logs[0].arn}/cloudtrail/AWSLogs/${local.account_id}/*"]
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:cloudtrail:${var.aws_region}:${local.account_id}:trail/${local.trail_name}"]
    }
  }

  # --- AWS Config ---
  statement {
    sid    = "AWSConfigBucketPermissionsCheck"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit_logs[0].arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid    = "AWSConfigBucketExistenceCheck"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.audit_logs[0].arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid    = "AWSConfigBucketDelivery"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit_logs[0].arn}/config/AWSLogs/${local.account_id}/Config/*"]
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "audit_logs" {
  count = var.enable_security_services ? 1 : 0

  bucket = aws_s3_bucket.audit_logs[0].id
  policy = data.aws_iam_policy_document.audit_bucket[0].json

  depends_on = [aws_s3_bucket_public_access_block.audit_logs]
}
