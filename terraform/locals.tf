# ---------------------------------------------------------------------------
# LPS-P2C — Locals and shared data sources
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name       = "${var.project}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id

  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # /20 subnets carved out of the VPC CIDR:
  # public  -> 10.0.0.0/20, 10.0.16.0/20
  # private -> 10.0.128.0/20, 10.0.144.0/20
  public_subnet_cidrs  = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i)]
  private_subnet_cidrs = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i + 8)]

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

  # Interface (PrivateLink) endpoints required for a NAT-less private tier:
  # app egress to AWS services goes over these instead of the internet.
  interface_endpoints = [
    "bedrock-runtime",
    "secretsmanager",
    "kms",
    "logs",
    "monitoring",
    "ssm",
    "ssmmessages",
    "ec2messages",
  ]

  # Bedrock foundation models the app may invoke (least privilege — item 9).
  bedrock_model_arns = [
    "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v2:0",
    "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-*",
  ]

  # Bucket names — account id keeps them globally unique.
  documents_bucket_name = "${local.name}-documents-${local.account_id}"
  cicd_bucket_name      = "${local.name}-cicd-artifacts-${local.account_id}"
  audit_bucket_name     = "${local.name}-audit-logs-${local.account_id}"
}
