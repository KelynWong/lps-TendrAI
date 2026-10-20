# TendrAI demo hosting - minimal static-site stack (S3 + CloudFront + WAF).
# Separate from ../terraform (the full product architecture): this folder only
# hosts the built React demo for internal LPS users and targets REAL AWS
# (CloudFront and WAF are not emulated by Floci).

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# S3 bucket lives in the project region (NFR05: ap-southeast-1)
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project_tag
      Component = "demo-hosting"
      ManagedBy = "terraform"
    }
  }
}

# WAF for CloudFront distributions MUST be created in us-east-1 (CLOUDFRONT scope)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = var.project_tag
      Component = "demo-hosting"
      ManagedBy = "terraform"
    }
  }
}
