# ---------------------------------------------------------------------------
# TendrAI — Floci (floci.io) local-emulation variable overrides
#
# Usage:  docker compose -f docker-compose.floci.yml up -d
#         copy floci_override.tf.example floci_override.tf   (first time only)
#         terraform init
#         terraform plan  -var-file=common.tfvars -var-file=floci.tfvars
#         terraform apply -var-file=common.tfvars -var-file=floci.tfvars
#
# Floci advertises support for Cognito, ACM, WAFv2, the CodePipeline family
# and the security services, so most flags start ON here. If a service errors
# on apply, flip its flag off — that tells you its emulation depth.
# ---------------------------------------------------------------------------

environment = "local"

# --- feature flags -----------------------------------------------------------
enable_waf               = true
enable_cognito           = true
enable_acm               = true
enable_cicd              = false
enable_security_services = false
enable_multi_az          = false

# --- small/cheap sizes -------------------------------------------------------
instance_type            = "t3.micro"
asg_min_size             = 1
asg_max_size             = 1
asg_desired_capacity     = 1
root_volume_size         = 8
db_instance_class        = "db.t3.micro"
db_allocated_storage     = 20
db_max_allocated_storage = 21
db_backup_retention_days = 0
db_deletion_protection   = false
db_skip_final_snapshot   = true
log_retention_days       = 1

# Emulators cannot resolve the public AL2023 SSM AMI parameter — any
# well-formed AMI id satisfies the mocked EC2 API.
ami_id = "ami-0a1b2c3d4e5f67890"

domain_name = "tendrai.localhost"
