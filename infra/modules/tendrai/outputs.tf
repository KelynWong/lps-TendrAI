# ---------------------------------------------------------------------------
# TendrAI — Outputs
# ---------------------------------------------------------------------------

# ----- Edge / application ----------------------------------------------------

output "alb_dns_name" {
  description = "Public DNS name of the ALB (point var.domain_name at this via CNAME/alias)."
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 zone ID of the ALB (for alias records)."
  value       = aws_lb.main.zone_id
}

output "app_url" {
  description = "URL the application is served on."
  value       = var.enable_acm ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
}

output "waf_web_acl_arn" {
  description = "WAFv2 Web ACL ARN (null when enable_waf = false)."
  value       = try(aws_wafv2_web_acl.main[0].arn, null)
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN (null when enable_acm = false)."
  value       = try(aws_acm_certificate.main[0].arn, null)
}

output "acm_validation_records" {
  description = "DNS records to create for ACM validation when route53_zone_id is not managed here."
  value = try([
    for dvo in aws_acm_certificate.main[0].domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ], [])
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID (null when enable_cognito = false)."
  value       = try(aws_cognito_user_pool.main[0].id, null)
}

output "cognito_hosted_ui_domain" {
  description = "Cognito hosted UI domain (null when enable_cognito = false)."
  value       = try("https://${aws_cognito_user_pool_domain.main[0].domain}.auth.${var.aws_region}.amazoncognito.com", null)
}

# ----- Network ---------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (ALB)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (EC2 app instances, RDS, status-updater Lambda)."
  value       = aws_subnet.private[*].id
}

output "workflow_subnet_ids" {
  description = "Workflow subnet IDs (Step Functions Lambdas)."
  value       = aws_subnet.workflow[*].id
}

# ----- Compute ---------------------------------------------------------------

output "app_asg_name" {
  description = "Name of the EC2 application Auto Scaling group (CodeDeploy deploys to it)."
  value       = aws_autoscaling_group.app.name
}

output "app_launch_template_id" {
  description = "ID of the EC2 application launch template."
  value       = aws_launch_template.app.id
}

output "app_launch_template_latest_version" {
  description = "Latest version of the EC2 application launch template."
  value       = aws_launch_template.app.latest_version
}

output "app_instance_role_arn" {
  description = "ARN of the EC2 application instance role."
  value       = aws_iam_role.app.arn
}

output "app_security_group_id" {
  description = "Security group of the EC2 application instances (ALB in on app_port only)."
  value       = aws_security_group.app.id
}

output "app_target_group_arn" {
  description = "ALB target group the Auto Scaling group registers instances in."
  value       = aws_lb_target_group.app.arn
}

output "codedeploy_app_name" {
  description = "CodeDeploy application name (null when enable_cicd = false)."
  value       = try(aws_codedeploy_app.app[0].name, null)
}

output "codedeploy_deployment_group_name" {
  description = "CodeDeploy in-place deployment group name (null when enable_cicd = false)."
  value       = try(aws_codedeploy_deployment_group.app[0].deployment_group_name, null)
}

# ----- Workflow --------------------------------------------------------------

output "tender_jobs_queue_url" {
  description = "SQS queue URL the application sends tender jobs to."
  value       = aws_sqs_queue.jobs.url
}

output "tender_jobs_dlq_url" {
  description = "Dead-letter queue URL for failed tender jobs."
  value       = aws_sqs_queue.jobs_dlq.url
}

output "state_machine_arn" {
  description = "Step Functions tender-processing state machine ARN."
  value       = aws_sfn_state_machine.tender_processing.arn
}

output "pipe_arn" {
  description = "EventBridge Pipe ARN (SQS -> Step Functions)."
  value       = aws_pipes_pipe.jobs_to_workflow.arn
}

output "lambda_function_names" {
  description = "Workflow Lambda function names keyed by role."
  value       = { for k, fn in aws_lambda_function.workflow : k => fn.function_name }
}

# ----- Data ------------------------------------------------------------------

output "documents_bucket" {
  description = "S3 bucket holding tender uploads, extracted/normalised text and drafts."
  value       = aws_s3_bucket.documents.bucket
}

output "cicd_artifacts_bucket" {
  description = "S3 bucket holding CI/CD artifacts."
  value       = aws_s3_bucket.cicd_artifacts.bucket
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)."
  value       = aws_db_instance.main.endpoint
}

output "db_master_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master credentials."
  value       = try(aws_db_instance.main.master_user_secret[0].secret_arn, null)
  sensitive   = true
}

output "db_role_secret_arns" {
  description = "Secrets Manager ARNs of the least-privilege DB role credentials, keyed app / status_updater / result_loader (docs/runbooks/db-roles.md)."
  value       = { for k, s in aws_secretsmanager_secret.db_role : k => s.arn }
}

output "app_config_secret_arn" {
  description = "Secrets Manager ARN of the application config secret."
  value       = aws_secretsmanager_secret.app_config.arn
}

output "kms_data_key_arn" {
  description = "ARN of the data CMK (S3/RDS/Secrets/SQS/EBS/Lambda)."
  value       = aws_kms_key.data.arn
}

output "kms_logs_key_arn" {
  description = "ARN of the logs/audit CMK (CloudWatch Logs/CloudTrail/Config/SNS)."
  value       = aws_kms_key.logs.arn
}

# ----- Security / CI-CD ------------------------------------------------------

output "cloudtrail_arn" {
  description = "CloudTrail ARN (null when enable_security_services = false)."
  value       = try(aws_cloudtrail.main[0].arn, null)
}

output "codestar_connection_arn" {
  description = "CodeStar Connections ARN — complete the provider handshake in the console after first apply (null when enable_cicd = false)."
  value       = try(aws_codestarconnections_connection.source[0].arn, null)
}

output "pipeline_name" {
  description = "CodePipeline name (null when enable_cicd = false)."
  value       = try(aws_codepipeline.app[0].name, null)
}

output "alarm_topic_arn" {
  description = "SNS topic that receives CloudWatch alarm notifications."
  value       = aws_sns_topic.alarms.arn
}
