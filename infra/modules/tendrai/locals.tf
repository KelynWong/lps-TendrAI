# ---------------------------------------------------------------------------
# TendrAI — Locals and shared data sources
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name       = "${var.project}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # /20 subnets carved out of the 172.16.0.0/16 VPC CIDR:
  #   public   (ALB)                        -> 172.16.0.0/20,   172.16.16.0/20
  #   private  (EC2, RDS, status updater)   -> 172.16.128.0/20, 172.16.144.0/20
  #   workflow (Step Functions Lambdas)     -> 172.16.192.0/20, 172.16.208.0/20
  public_subnet_cidrs   = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i)]
  private_subnet_cidrs  = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i + 8)]
  workflow_subnet_cidrs = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i + 12)]

  # Project roles mapped to Cognito user pool groups.
  cognito_groups = [
    "executive-sponsor",
    "business-sponsor",
    "bidding-manager",
    "presales",
    "delivery",
    "bd-team",
  ]

  cognito_domain_prefix = var.cognito_domain_prefix != "" ? var.cognito_domain_prefix : "${local.name}-${substr(local.account_id, 0, 6)}"

  # Interface (PrivateLink) endpoints for the NAT-less private tiers.
  #   EC2 app : secretsmanager, sqs, logs, monitoring, kms,
  #             ssm, ssmmessages, ec2messages (Session Manager / SSM agent),
  #             codedeploy, codedeploy-commands-secure (CodeDeploy agent)
  #   Lambdas : secretsmanager, kms, logs, bedrock-runtime
  # S3 is reached through the gateway endpoint (endpoints.tf).
  interface_endpoints = [
    "logs",
    "monitoring",
    "secretsmanager",
    "kms",
    "sqs",
    "bedrock-runtime",
    "ssm",
    "ssmmessages",
    "ec2messages",
    "codedeploy",
    "codedeploy-commands-secure",
  ]

  # Bedrock models the analyser Lambda may invoke (least privilege): exactly the
  # two configured foundation models, in aws_region only. No inference-profile
  # ARNs — cross-region profiles (global.*, apac.*, ...) would route requests
  # out of ap-southeast-1 (data residency, NFR05).
  bedrock_model_arns = [
    "arn:${local.partition}:bedrock:${var.aws_region}::foundation-model/${var.bedrock_text_model_id}",
    "arn:${local.partition}:bedrock:${var.aws_region}::foundation-model/${var.bedrock_embed_model_id}",
  ]

  # Workflow Lambda functions. Keys drive names, roles, log groups, security
  # groups, IAM scope and the Step Functions definition.
  #   subnet_tier   : "private" = app subnets (diagram: beside EC2/RDS),
  #                   "workflow" = dedicated Step Functions subnets.
  #   needs_db      : SG egress to RDS + read of the DB master secret.
  #   needs_s3      : read/write of the documents bucket.
  #   needs_bedrock : InvokeModel on the approved Bedrock models.
  lambda_functions = {
    status_updater = {
      description   = "Writes the current workflow step/status of a tender job to RDS"
      subnet_tier   = "private"
      needs_db      = true
      needs_s3      = false
      needs_bedrock = false
    }
    text_extractor_word = {
      description   = "Extracts text from Word documents in S3 and writes the text result back to S3"
      subnet_tier   = "workflow"
      needs_db      = false
      needs_s3      = true
      needs_bedrock = false
    }
    text_extractor_excel = {
      description   = "Extracts text from Excel workbooks in S3 and writes the text result back to S3"
      subnet_tier   = "workflow"
      needs_db      = false
      needs_s3      = true
      needs_bedrock = false
    }
    text_normalizer = {
      description   = "Normalises extracted text (Textract/Word/Excel) into a standard format and writes it to S3"
      subnet_tier   = "workflow"
      needs_db      = false
      needs_s3      = true
      needs_bedrock = false
    }
    analyser = {
      description   = "Prompts Bedrock to extract clauses/categories, submission and qualification requirements and draft submission documents"
      subnet_tier   = "workflow"
      needs_db      = false
      needs_s3      = true
      needs_bedrock = true
    }
    result_loader = {
      description   = "Loads Bedrock results (clauses with categorisation, submission and qualification requirements) into RDS"
      subnet_tier   = "workflow"
      needs_db      = true
      needs_s3      = true
      needs_bedrock = false
    }
  }

  # Bucket names — account id keeps them globally unique.
  documents_bucket_name = "${local.name}-documents-${local.account_id}"
  cicd_bucket_name      = "${local.name}-cicd-artifacts-${local.account_id}"
  audit_bucket_name     = "${local.name}-audit-logs-${local.account_id}"

  # S3 prefixes used by the workflow.
  # Keys use ids only, never tender or file names (file names live in RDS).
  s3_prefix_uploads    = "tenders"    # tenders/<tenderId>/pack/<documentId>/source.<ext>
  s3_prefix_extracted  = "extracted"  # extracted/<tenderId>/<documentId>/<extractor>/...
  s3_prefix_normalized = "normalized" # normalized/<tenderId>/<jobId>/tender.json
  s3_prefix_analysis   = "analysis"   # analysis/<tenderId>/<jobId>/<task>.json
  s3_prefix_drafts     = "drafts"     # drafts/<tenderId>/<checklistItemId>/<file> (API, on demand)

  trail_name = "${local.name}-trail"
}
