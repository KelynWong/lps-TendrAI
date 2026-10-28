# ---------------------------------------------------------------------------
# TendrAI — Floci (floci.io) local-emulation environment
#
#   docker compose -f infra/envs/floci/docker-compose.floci.yml up -d
#   terraform -chdir=infra/envs/floci init
#   terraform -chdir=infra/envs/floci plan
#
# Floci advertises support for Cognito, ACM, WAFv2, EC2, Lambda, SQS, Step
# Functions, the CodePipeline family and the security services, so most flags
# start ON here. If a service errors on apply, flip its flag off — that tells
# you its emulation depth. (EventBridge Pipes, Textract and Bedrock are not
# emulated anywhere; their resources are created as API records only.)
# ---------------------------------------------------------------------------

locals {
  # Shared by every environment (naming, tagging, region).
  project     = "tendrai"
  project_tag = "TendrAI"
  aws_region  = "ap-southeast-1"
  environment = "local"
}

module "tendrai" {
  source = "../../modules/tendrai"

  project     = local.project
  project_tag = local.project_tag
  aws_region  = local.aws_region
  environment = local.environment

  # --- network -----------------------------------------------------------------
  vpc_cidr = "172.16.0.0/16"
  az_count = 2

  # --- feature flags -----------------------------------------------------------
  enable_waf               = true
  enable_cognito           = true
  enable_acm               = true
  enable_cicd              = false
  enable_security_services = false
  enable_multi_az          = false

  # --- small/cheap sizes -------------------------------------------------------
  instance_type          = "t3.micro"
  asg_min_size           = 1
  asg_desired_capacity   = 1
  asg_max_size           = 1
  root_volume_size       = 8
  lambda_memory_mb       = 256
  lambda_timeout_seconds = 60

  db_instance_class        = "db.t3.micro"
  db_allocated_storage     = 20
  db_max_allocated_storage = 21
  db_backup_retention_days = 0
  db_deletion_protection   = false
  db_skip_final_snapshot   = true
  log_retention_days       = 1

  # Floci cannot resolve the public AL2023 AMI SSM parameter; any well-formed
  # AMI id satisfies the emulated EC2 API (instances are records, not VMs).
  ami_id = "ami-0123456789abcdef0"

  domain_name = "tendrai.localhost"
}
