# ---------------------------------------------------------------------------
# TendrAI prod — Terraform / provider version constraints and state backend
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # State is local by default. For team use, uncomment and point at an
  # S3 bucket (with lockfile) in ap-southeast-1:
  #
  # backend "s3" {
  #   bucket       = "tendrai-terraform-state-<account-id>"
  #   key          = "tendrai/prod/terraform.tfstate"
  #   region       = "ap-southeast-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}
