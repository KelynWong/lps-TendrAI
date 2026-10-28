# Re-exports every output of the tendrai module (infra/modules/tendrai/outputs.tf).

output "alb_dns_name" {
  value = module.tendrai.alb_dns_name
}

output "alb_zone_id" {
  value = module.tendrai.alb_zone_id
}

output "app_url" {
  value = module.tendrai.app_url
}

output "waf_web_acl_arn" {
  value = module.tendrai.waf_web_acl_arn
}

output "acm_certificate_arn" {
  value = module.tendrai.acm_certificate_arn
}

output "acm_validation_records" {
  value = module.tendrai.acm_validation_records
}

output "cognito_user_pool_id" {
  value = module.tendrai.cognito_user_pool_id
}

output "cognito_hosted_ui_domain" {
  value = module.tendrai.cognito_hosted_ui_domain
}

output "vpc_id" {
  value = module.tendrai.vpc_id
}

output "public_subnet_ids" {
  value = module.tendrai.public_subnet_ids
}

output "private_subnet_ids" {
  value = module.tendrai.private_subnet_ids
}

output "workflow_subnet_ids" {
  value = module.tendrai.workflow_subnet_ids
}

output "app_asg_name" {
  value = module.tendrai.app_asg_name
}

output "app_launch_template_id" {
  value = module.tendrai.app_launch_template_id
}

output "app_launch_template_latest_version" {
  value = module.tendrai.app_launch_template_latest_version
}

output "app_instance_role_arn" {
  value = module.tendrai.app_instance_role_arn
}

output "app_security_group_id" {
  value = module.tendrai.app_security_group_id
}

output "app_target_group_arn" {
  value = module.tendrai.app_target_group_arn
}

output "codedeploy_app_name" {
  value = module.tendrai.codedeploy_app_name
}

output "codedeploy_deployment_group_name" {
  value = module.tendrai.codedeploy_deployment_group_name
}

output "tender_jobs_queue_url" {
  value = module.tendrai.tender_jobs_queue_url
}

output "tender_jobs_dlq_url" {
  value = module.tendrai.tender_jobs_dlq_url
}

output "state_machine_arn" {
  value = module.tendrai.state_machine_arn
}

output "pipe_arn" {
  value = module.tendrai.pipe_arn
}

output "lambda_function_names" {
  value = module.tendrai.lambda_function_names
}

output "documents_bucket" {
  value = module.tendrai.documents_bucket
}

output "cicd_artifacts_bucket" {
  value = module.tendrai.cicd_artifacts_bucket
}

output "rds_endpoint" {
  value = module.tendrai.rds_endpoint
}

output "db_master_secret_arn" {
  value     = module.tendrai.db_master_secret_arn
  sensitive = true
}

output "app_config_secret_arn" {
  value = module.tendrai.app_config_secret_arn
}

output "kms_data_key_arn" {
  value = module.tendrai.kms_data_key_arn
}

output "kms_logs_key_arn" {
  value = module.tendrai.kms_logs_key_arn
}

output "cloudtrail_arn" {
  value = module.tendrai.cloudtrail_arn
}

output "codestar_connection_arn" {
  value = module.tendrai.codestar_connection_arn
}

output "pipeline_name" {
  value = module.tendrai.pipeline_name
}

output "alarm_topic_arn" {
  value = module.tendrai.alarm_topic_arn
}

output "db_role_secret_arns" {
  value = module.tendrai.db_role_secret_arns
}
