# ---------------------------------------------------------------------------
# LPS-P2C — Outputs
# ---------------------------------------------------------------------------

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

output "vpc_id" {
  description = "VPC ID."
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (app + DB tier)."
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (ALB)."
  value       = aws_subnet.public[*].id
}

output "documents_bucket" {
  description = "S3 bucket holding tender and historical documents."
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

output "app_config_secret_arn" {
  description = "Secrets Manager ARN of the application config secret."
  value       = aws_secretsmanager_secret.app_config.arn
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

output "waf_web_acl_arn" {
  description = "WAFv2 Web ACL ARN (null when enable_waf = false)."
  value       = try(aws_wafv2_web_acl.main[0].arn, null)
}

output "asg_name" {
  description = "Name of the application Auto Scaling group."
  value       = aws_autoscaling_group.app.name
}

output "kms_data_key_arn" {
  description = "ARN of the data CMK (S3/EBS/RDS/Secrets)."
  value       = aws_kms_key.data.arn
}

output "kms_logs_key_arn" {
  description = "ARN of the logs/audit CMK (CloudWatch Logs/CloudTrail)."
  value       = aws_kms_key.logs.arn
}

output "cloudtrail_arn" {
  description = "CloudTrail ARN (null when enable_security_services = false)."
  value       = try(aws_cloudtrail.main[0].arn, null)
}

output "codestar_connection_arn" {
  description = "CodeStar Connections ARN — complete the GitHub handshake in the console after first apply (null when enable_cicd = false)."
  value       = try(aws_codestarconnections_connection.github[0].arn, null)
}

output "pipeline_name" {
  description = "CodePipeline name (null when enable_cicd = false)."
  value       = try(aws_codepipeline.app[0].name, null)
}
