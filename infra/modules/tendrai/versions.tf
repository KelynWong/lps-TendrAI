# ---------------------------------------------------------------------------
# TendrAI module — Terraform / provider version constraints
#
# Provider configuration (region, default tags) and the state backend live in
# the calling environment root under infra/envs/<env>.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    # Packages the placeholder Lambda handlers under lambdas/ (repo root) into zip files.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}
