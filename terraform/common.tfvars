# ---------------------------------------------------------------------------
# TendrAI — values shared by every environment (naming, tagging, region, VPC).
# Always pass this file FIRST, then the environment file:
#
#   terraform plan  -var-file=common.tfvars -var-file=floci.tfvars
#   terraform apply -var-file=common.tfvars -var-file=prod.tfvars
# ---------------------------------------------------------------------------

# Naming prefix for every resource (lowercase — S3/Cognito naming rules).
project = "tendrai"

# Tag applied to every resource: Project = TendrAI
project_tag = "TendrAI"

# Data residency — the variable validation rejects any other region.
aws_region = "ap-southeast-1"

# Network layout shared by all environments.
vpc_cidr = "10.0.0.0/16"
az_count = 2
