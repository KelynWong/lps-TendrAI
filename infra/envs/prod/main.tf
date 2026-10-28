# ---------------------------------------------------------------------------
# TendrAI — Production environment
#
#   terraform -chdir=infra/envs/prod init
#   terraform -chdir=infra/envs/prod plan
#
# Review every value below before the first apply. Inputs not set here use
# the module defaults in infra/modules/tendrai/variables.tf.
# ---------------------------------------------------------------------------

locals {
  # Shared by every environment (naming, tagging, region).
  project     = "tendrai" # lowercase — S3/Cognito naming rules
  project_tag = "TendrAI"
  aws_region  = "ap-southeast-1" # data residency — the module rejects any other region
  environment = "prod"
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

  # --- all production features on (defaults, shown for clarity) ----------------
  enable_waf               = true
  enable_cognito           = true
  enable_acm               = true
  enable_cicd              = true
  enable_security_services = true
  enable_multi_az          = true

  # --- DNS / TLS ---------------------------------------------------------------
  # The FQDN users will hit; the ACM certificate is issued for it.
  domain_name = "tendrai.example.com"
  # If the zone is hosted in Route53 in this account, set its ID so the ACM
  # validation records are created automatically; otherwise leave "" and create
  # the CNAMEs from the `acm_validation_records` output manually.
  route53_zone_id = ""

  # --- Cognito -----------------------------------------------------------------
  # Must be globally unique across AWS; leave "" to derive from account id.
  cognito_domain_prefix = ""

  # --- application (EC2 Auto Scaling group) ------------------------------------
  app_port                   = 8080
  health_check_path          = "/health"
  instance_type              = "t3.large"
  ami_id                     = "" # "" = latest Amazon Linux 2023 (public SSM parameter)
  asg_min_size               = 1
  asg_desired_capacity       = 2
  asg_max_size               = 4
  root_volume_size           = 30
  app_cpu_target_utilization = 60

  # --- workflow (SQS / Step Functions / Lambda / Bedrock) ----------------------
  lambda_runtime                 = "python3.12"
  lambda_memory_mb               = 2048
  lambda_timeout_seconds         = 600
  sqs_max_receive_count          = 3
  textract_poll_interval_seconds = 15
  bedrock_text_model_id          = "anthropic.claude-3-5-sonnet-20241022-v2:0"
  bedrock_embed_model_id         = "amazon.titan-embed-text-v2:0"

  # --- S3 lifecycle (documents -> Glacier) -------------------------------------
  s3_glacier_transition_days    = 180
  s3_noncurrent_expiration_days = 365

  # --- database ----------------------------------------------------------------
  db_instance_class        = "db.t4g.medium"
  db_allocated_storage     = 50
  db_max_allocated_storage = 200
  db_backup_retention_days = 7
  db_deletion_protection   = true
  db_skip_final_snapshot   = false

  # --- CI/CD -------------------------------------------------------------------
  source_provider_type = "GitHub" # or "GitLab"
  source_repo_owner    = "your-org"
  source_repo_name     = "tendrai"
  source_branch        = "main"
  buildspec_path       = "buildspec.yml"

  # --- observability -----------------------------------------------------------
  log_retention_days = 90
  alarm_email        = "" # e.g. "platform-team@example.com"
}
