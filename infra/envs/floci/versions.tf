# ---------------------------------------------------------------------------
# TendrAI floci — Terraform / provider version constraints
#
# State stays local (terraform.tfstate here, gitignored); reset-floci.ps1
# wipes it together with the emulator.
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
}
