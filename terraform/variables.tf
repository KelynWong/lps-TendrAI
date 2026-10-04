# ---------------------------------------------------------------------------
# LPS-P2C — Input variables
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
  description = "Create the WAFv2 Web ACL and associate it with the ALB. Disable if the local emulator rejects it."
  type        = bool
  default     = true
}

variable "enable_cognito" {
  description = "Create the Cognito user pool and enforce authenticate-cognito on the ALB HTTPS listener. Requires enable_acm = true (ALB Cognito auth only works on HTTPS listeners). Disable if the local emulator rejects it."
  type        = bool
  default     = true
}

variable "enable_acm" {
  description = "Create the ACM certificate and serve the ALB over HTTPS (HTTP redirects). When false, the ALB serves plain HTTP only. Disable if the local emulator rejects it."
  type        = bool
  default     = true
}

variable "enable_cicd" {
  description = "Create the CI/CD pipeline (CodeStar Connection, CodePipeline, CodeBuild, CodeDeploy). Disable if the local emulator rejects it."
  type        = bool
  default     = true
}

variable "enable_security_services" {
  description = "Enable account-wide security services (GuardDuty, Security Hub, Inspector2, CloudTrail). Disable if the local emulator rejects it."
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
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread subnets over."
  type        = number
  default     = 2
}

# ----- TLS / DNS -------------------------------------------------------------

variable "domain_name" {
  description = "Fully-qualified domain name the application is served on (used for the ACM certificate and Cognito callback URLs)."
  type        = string
  default     = "p2c.example.com"
}

variable "route53_zone_id" {
  description = "Optional Route53 hosted zone ID used to auto-create ACM DNS validation records. Leave empty to validate the certificate out-of-band (validation records are shown in outputs)."
  type        = string
  default     = ""
}

# ----- Cognito ---------------------------------------------------------------

variable "cognito_domain_prefix" {
  description = "Globally-unique prefix for the Cognito hosted UI domain. Empty string derives one from the project name and account id."
  type        = string
  default     = ""
}

# ----- Application / EC2 -----------------------------------------------------

variable "app_port" {
  description = "Port the application listens on inside the EC2 instances."
  type        = number
  default     = 8080
}

variable "health_check_path" {
  description = "HTTP path used by the ALB target group health check."
  type        = string
  default     = "/"
}

variable "instance_type" {
  description = "EC2 instance type for the application tier."
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
  description = "Desired number of application instances."
  type        = number
  default     = 1
}

variable "root_volume_size" {
  description = "Root EBS volume size (GiB) for application instances."
  type        = number
  default     = 30
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
  default     = "lpsp2c"
}

variable "db_username" {
  description = "Master username for the database (password is generated and stored in Secrets Manager by RDS)."
  type        = string
  default     = "lpsadmin"
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

# ----- WAF -------------------------------------------------------------------

variable "waf_rate_limit" {
  description = "Requests allowed per 5-minute window per source IP before the WAF rate-based rule blocks."
  type        = number
  default     = 2000
}

# ----- CI/CD -----------------------------------------------------------------

variable "github_owner" {
  description = "GitHub organisation/user that owns the application repository."
  type        = string
  default     = "your-org"
}

variable "github_repo" {
  description = "GitHub repository name of the application."
  type        = string
  default     = "lps-p2c"
}

variable "github_branch" {
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
