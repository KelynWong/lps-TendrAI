# ---------------------------------------------------------------------------
# TendrAI — AWS provider configuration
#
# Region is pinned to ap-southeast-1 (Singapore) for data residency (NFR05).
# For local testing against Floci, copy floci_override.tf.example to
# floci_override.tf — it redirects this provider to http://localhost:4566.
# ---------------------------------------------------------------------------

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_tag
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
