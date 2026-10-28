# ---------------------------------------------------------------------------
# TendrAI prod — AWS provider configuration
#
# Region is pinned to ap-southeast-1 (Singapore) for data residency (NFR05).
# default_tags applies the standard tag set to every taggable resource:
#   Project = TendrAI, Environment = prod, ManagedBy = Terraform
# ---------------------------------------------------------------------------

provider "aws" {
  region = local.aws_region

  default_tags {
    tags = {
      Project     = local.project_tag
      Environment = local.environment
      ManagedBy   = "Terraform"
    }
  }
}

provider "archive" {}
