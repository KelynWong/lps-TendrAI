# ---------------------------------------------------------------------------
# TendrAI — Input variables
# ---------------------------------------------------------------------------

# ----- General ---------------------------------------------------------------

variable "project" {
  description = "Project identifier used as the prefix of every resource name. Lowercase required: S3 bucket and Cognito domain names reject capitals."
  type        = string
  default     = "tendrai"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*$", var.project))
    error_message = "project must be lowercase alphanumeric/hyphens (S3 and Cognito naming rules)."
  }
}

variable "project_tag" {
  description = "Value of the Project tag applied to every resource (display casing)."
  type        = string
  default     = "TendrAI"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging, prod, local)."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region. Must be ap-southeast-1 (Singapore) — data residency requirement NFR05."
  type        = string
  default     = "ap-southeast-1"

  validation {
    condition     = var.aws_region == "ap-southeast-1"
    error_message = "Region must be ap-southeast-1 (data residency requirement NFR05)."
  }
}

# ----- Feature flags ---------------------------------------------------------
# Each flag gates a group of resources so the stack can also be deployed to
# local emulators with partial service coverage.

variable "enable_waf" {
  description = "Create the WAFv2 Web ACL and associate it with the ALB."
  type        = bool
  default     = true
}

variable "enable_cognito" {
  description = "Create the Cognito user pool and enforce authenticate-cognito on the ALB HTTPS listener. Requires enable_acm = true."
  type        = bool
  default     = true
}

variable "enable_acm" {
  description = "Create the ACM certificate and serve the ALB over HTTPS (HTTP redirects). When false, the ALB serves plain HTTP only."
  type        = bool
  default     = true
}

variable "enable_cicd" {
  description = "Create the CI/CD pipeline (CodeConnections source, CodePipeline, CodeBuild, CodeDeploy in-place onto the EC2 Auto Scaling group)."
  type        = bool
  default     = true
}

variable "enable_security_services" {
  description = "Enable account-wide security services (GuardDuty, Security Hub, Inspector2, CloudTrail, Macie, AWS Config, IAM Access Analyzer)."
  type        = bool
  default     = true
}

variable "enable_multi_az" {
  description = "Deploy RDS as Multi-AZ."
  type        = bool
  default     = true
}

# ----- Networking ------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC (diagram: 172.16.0.0/16)."
  type        = string
  default     = "172.16.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread subnets over."
  type        = number
  default     = 2
}

# ----- TLS / DNS -------------------------------------------------------------

variable "domain_name" {
  description = "Fully-qualified domain name the application is served on (ACM certificate and Cognito callback URLs)."
  type        = string
  default     = "tendrai.example.com"
}

variable "route53_zone_id" {
  description = "Optional Route53 hosted zone ID used to auto-create ACM DNS validation records. Leave empty to validate the certificate out-of-band."
  type        = string
  default     = ""
}

# ----- Cognito ---------------------------------------------------------------

variable "cognito_domain_prefix" {
  description = "Globally-unique prefix for the Cognito hosted UI domain. Empty string derives one from the project name and account id."
  type        = string
  default     = ""
}

# ----- Application / EC2 Auto Scaling group ---------------------------------

variable "app_port" {
  description = "Port the web application / API server listens on (ALB target group, EC2 security group, PORT env var)."
  type        = number
  default     = 8080
}

variable "health_check_path" {
  description = "HTTP path used by the ALB target group health check (the API serves /health)."
  type        = string
  default     = "/health"
}

variable "instance_type" {
  description = "EC2 instance type for the application tier (x86_64; the AMI is AL2023 x86_64)."
  type        = string
  default     = "t3.medium"
}

variable "ami_id" {
  description = "Optional AMI ID override for the application instances. Empty string resolves the latest Amazon Linux 2023 AMI via the public SSM parameter (set this explicitly on local emulators, which cannot resolve public SSM AMI parameters)."
  type        = string
  default     = ""
}

variable "asg_min_size" {
  description = "Minimum number of application instances."
  type        = number
  default     = 1
}

variable "asg_max_size" {
  description = "Maximum number of application instances."
  type        = number
  default     = 2
}

variable "asg_desired_capacity" {
  description = "Initial desired number of application instances (target tracking owns it afterwards)."
  type        = number
  default     = 1
}

variable "root_volume_size" {
  description = "Root EBS volume size (GiB) for application instances (encrypted with the data CMK)."
  type        = number
  default     = 30
}

variable "app_cpu_target_utilization" {
  description = "Target average CPU utilisation (%) for the application Auto Scaling group."
  type        = number
  default     = 60
}

# ----- Workflow (SQS / Step Functions / Lambda) ------------------------------

variable "lambda_runtime" {
  description = "Runtime for the workflow Lambda functions."
  type        = string
  default     = "python3.12"
}

variable "lambda_memory_mb" {
  description = "Memory (MiB) for the workflow Lambda functions."
  type        = number
  default     = 1024
}

variable "lambda_timeout_seconds" {
  description = "Timeout (seconds) for the workflow Lambda functions."
  type        = number
  default     = 300
}

variable "sqs_max_receive_count" {
  description = "Number of receive attempts before a job message is moved to the dead-letter queue."
  type        = number
  default     = 3
}

variable "sqs_message_retention_seconds" {
  description = "Retention (seconds) of messages on the tender job queue and its DLQ."
  type        = number
  default     = 345600 # 4 days
}

variable "textract_poll_interval_seconds" {
  description = "Seconds the Step Functions workflow waits between Textract job status polls."
  type        = number
  default     = 15
}

variable "bedrock_text_model_id" {
  description = "In-region Bedrock foundation model ID the analyser Lambda prompts (overview, submission and qualification requirements, clauses). Must be invokable ON_DEMAND in aws_region; cross-region inference profiles are rejected (data residency)."
  type        = string
  default     = "anthropic.claude-3-5-sonnet-20241022-v2:0"

  validation {
    condition     = !can(regex("^(arn:|global\\.|apac\\.|us\\.|us-gov\\.|eu\\.|jp\\.|au\\.|ca\\.)", var.bedrock_text_model_id))
    error_message = "bedrock_text_model_id must be a plain in-region foundation model ID (e.g. anthropic.claude-...), not an ARN or a cross-region inference profile (global.*, apac.*, us.*, ...)."
  }
}

variable "bedrock_embed_model_id" {
  description = "In-region Bedrock embeddings model ID (pgvector embeddings). Cross-region inference profiles are rejected (data residency)."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"

  validation {
    condition     = !can(regex("^(arn:|global\\.|apac\\.|us\\.|us-gov\\.|eu\\.|jp\\.|au\\.|ca\\.)", var.bedrock_embed_model_id))
    error_message = "bedrock_embed_model_id must be a plain in-region foundation model ID, not an ARN or a cross-region inference profile."
  }
}

# ----- S3 lifecycle ----------------------------------------------------------

variable "s3_glacier_transition_days" {
  description = "Days after which current tender documents transition to S3 Glacier Flexible Retrieval."
  type        = number
  default     = 180
}

variable "s3_noncurrent_expiration_days" {
  description = "Days after which non-current object versions in the documents bucket expire."
  type        = number
  default     = 365
}

# ----- RDS -------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_engine_version" {
  description = "PostgreSQL engine version (major or major.minor)."
  type        = string
  default     = "16"
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "tendrai"
}

variable "db_username" {
  description = "Master username for the database (password is generated and stored in Secrets Manager by RDS)."
  type        = string
  default     = "tendradmin"
}

variable "db_allocated_storage" {
  description = "Initial allocated storage (GiB) for RDS."
  type        = number
  default     = 50
}

variable "db_max_allocated_storage" {
  description = "Upper bound (GiB) for RDS storage autoscaling."
  type        = number
  default     = 200
}

variable "db_backup_retention_days" {
  description = "Automated backup retention period (days)."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Enable RDS deletion protection."
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Skip the final snapshot on destroy (set true only for ephemeral/local environments)."
  type        = bool
  default     = false
}

variable "db_role_password_version" {
  description = "Bump to generate new passwords for the least-privilege DB roles (secrets.tf db_role); then re-run `npm --prefix api run db:roles` to apply them in Postgres."
  type        = number
  default     = 1
}

# ----- WAF -------------------------------------------------------------------

variable "waf_rate_limit" {
  description = "Requests allowed per 5-minute window per source IP before the WAF rate-based rule blocks."
  type        = number
  default     = 2000
}

# ----- CI/CD -----------------------------------------------------------------

variable "source_provider_type" {
  description = "CodeStar Connections provider for the application repository: GitHub or GitLab (diagram: GitHub/GitLab)."
  type        = string
  default     = "GitHub"

  validation {
    condition     = contains(["GitHub", "GitLab", "GitHubEnterpriseServer", "GitLabSelfManaged"], var.source_provider_type)
    error_message = "source_provider_type must be GitHub, GitLab, GitHubEnterpriseServer or GitLabSelfManaged."
  }
}

variable "source_repo_owner" {
  description = "Organisation/user (GitHub) or group (GitLab) that owns the application repository."
  type        = string
  default     = "your-org"
}

variable "source_repo_name" {
  description = "Application repository name."
  type        = string
  default     = "tendrai"
}

variable "source_branch" {
  description = "Branch that triggers the pipeline."
  type        = string
  default     = "main"
}

variable "buildspec_path" {
  description = "Path to the CodeBuild buildspec file inside the repository."
  type        = string
  default     = "buildspec.yml"
}

# ----- Observability ---------------------------------------------------------

variable "log_retention_days" {
  description = "Retention (days) for CloudWatch log groups."
  type        = number
  default     = 90
}

variable "alarm_email" {
  description = "Optional email address subscribed to the CloudWatch alarm SNS topic. Empty string skips the subscription."
  type        = string
  default     = ""
}
