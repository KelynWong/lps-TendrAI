# ---------------------------------------------------------------------------
# TendrAI — Production example variable file
#
# Usage:  terraform plan  -var-file=common.tfvars -var-file=prod.tfvars
#         terraform apply -var-file=common.tfvars -var-file=prod.tfvars
#
# (Naming, tags, region and VPC layout live in common.tfvars.)
# Review every value below before the first apply. Remember to delete
# floci_override.tf first — while it exists, terraform targets the emulator.
# ---------------------------------------------------------------------------

environment = "prod"

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

# --- sizing ------------------------------------------------------------------
instance_type        = "t3.large"
asg_min_size         = 1
asg_max_size         = 2
asg_desired_capacity = 1

db_instance_class        = "db.t4g.medium"
db_allocated_storage     = 50
db_max_allocated_storage = 200
db_backup_retention_days = 7
db_deletion_protection   = true
db_skip_final_snapshot   = false

# --- CI/CD -------------------------------------------------------------------
github_owner   = "your-org"
github_repo    = "lps-p2c"
github_branch  = "main"
buildspec_path = "buildspec.yml"

# --- observability -----------------------------------------------------------
log_retention_days = 90
alarm_email        = "" # e.g. "platform-team@example.com"
