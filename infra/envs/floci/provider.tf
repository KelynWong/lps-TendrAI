# ---------------------------------------------------------------------------
# TendrAI floci — AWS provider pointed at the Floci emulator (localhost:4566)
#
# This root only ever talks to the emulator; real AWS lives in infra/envs/prod.
# (Replaces the old floci_override.tf copy-and-delete step.)
#
# default_tags applies the standard tag set to every taggable resource:
#   Project = TendrAI, Environment = local, ManagedBy = Terraform
# ---------------------------------------------------------------------------

provider "aws" {
  access_key = "test"
  secret_key = "test"
  region     = local.aws_region

  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    accessanalyzer         = "http://localhost:4566"
    acm                    = "http://localhost:4566"
    applicationautoscaling = "http://localhost:4566" # kept so pre-EC2 floci state (ECS) is destroyed locally
    autoscaling            = "http://localhost:4566"
    bedrock                = "http://localhost:4566"
    cloudtrail             = "http://localhost:4566"
    cloudwatch             = "http://localhost:4566"
    codebuild              = "http://localhost:4566"
    codedeploy             = "http://localhost:4566"
    codepipeline           = "http://localhost:4566"
    codestarconnections    = "http://localhost:4566"
    cognitoidp             = "http://localhost:4566"
    configservice          = "http://localhost:4566"
    ec2                    = "http://localhost:4566"
    ecr                    = "http://localhost:4566" # kept so pre-EC2 floci state (ECS) is destroyed locally
    ecs                    = "http://localhost:4566" # kept so pre-EC2 floci state (ECS) is destroyed locally
    elbv2                  = "http://localhost:4566"
    events                 = "http://localhost:4566"
    guardduty              = "http://localhost:4566"
    iam                    = "http://localhost:4566"
    inspector2             = "http://localhost:4566"
    kms                    = "http://localhost:4566"
    lambda                 = "http://localhost:4566"
    logs                   = "http://localhost:4566"
    macie2                 = "http://localhost:4566"
    pipes                  = "http://localhost:4566"
    rds                    = "http://localhost:4566"
    route53                = "http://localhost:4566"
    s3                     = "http://localhost:4566"
    secretsmanager         = "http://localhost:4566"
    securityhub            = "http://localhost:4566"
    sfn                    = "http://localhost:4566"
    sns                    = "http://localhost:4566"
    sqs                    = "http://localhost:4566"
    ssm                    = "http://localhost:4566"
    sts                    = "http://localhost:4566"
    wafv2                  = "http://localhost:4566"
    xray                   = "http://localhost:4566"
  }

  default_tags {
    tags = {
      Project     = local.project_tag
      Environment = local.environment
      ManagedBy   = "Terraform"
    }
  }
}

provider "archive" {}
