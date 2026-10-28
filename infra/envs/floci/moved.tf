# ---------------------------------------------------------------------------
# State migration: these resources used to live in the flat terraform/ root.
# The moved blocks re-address them under module.tendrai so the existing
# Floci state is kept instead of being destroyed and recreated. Safe to
# delete once every state that predates the move has been planned/applied.
# ---------------------------------------------------------------------------

moved {
  from = aws_accessanalyzer_analyzer.account
  to   = module.tendrai.aws_accessanalyzer_analyzer.account
}

moved {
  from = aws_acm_certificate.main
  to   = module.tendrai.aws_acm_certificate.main
}

moved {
  from = aws_acm_certificate_validation.main
  to   = module.tendrai.aws_acm_certificate_validation.main
}

moved {
  from = aws_cloudtrail.main
  to   = module.tendrai.aws_cloudtrail.main
}

moved {
  from = aws_cloudwatch_log_group.app
  to   = module.tendrai.aws_cloudwatch_log_group.app
}

moved {
  from = aws_cloudwatch_log_group.lambda
  to   = module.tendrai.aws_cloudwatch_log_group.lambda
}

moved {
  from = aws_cloudwatch_log_group.pipes
  to   = module.tendrai.aws_cloudwatch_log_group.pipes
}

moved {
  from = aws_cloudwatch_log_group.sfn
  to   = module.tendrai.aws_cloudwatch_log_group.sfn
}

moved {
  from = aws_cloudwatch_log_group.vpc_flow_logs
  to   = module.tendrai.aws_cloudwatch_log_group.vpc_flow_logs
}

moved {
  from = aws_cloudwatch_metric_alarm.alb_5xx
  to   = module.tendrai.aws_cloudwatch_metric_alarm.alb_5xx
}

moved {
  from = aws_cloudwatch_metric_alarm.jobs_dlq
  to   = module.tendrai.aws_cloudwatch_metric_alarm.jobs_dlq
}

moved {
  from = aws_cloudwatch_metric_alarm.lambda_errors
  to   = module.tendrai.aws_cloudwatch_metric_alarm.lambda_errors
}

moved {
  from = aws_cloudwatch_metric_alarm.rds_cpu
  to   = module.tendrai.aws_cloudwatch_metric_alarm.rds_cpu
}

moved {
  from = aws_cloudwatch_metric_alarm.rds_free_storage
  to   = module.tendrai.aws_cloudwatch_metric_alarm.rds_free_storage
}

moved {
  from = aws_cloudwatch_metric_alarm.sfn_failed
  to   = module.tendrai.aws_cloudwatch_metric_alarm.sfn_failed
}

moved {
  from = aws_cloudwatch_metric_alarm.target_5xx
  to   = module.tendrai.aws_cloudwatch_metric_alarm.target_5xx
}

moved {
  from = aws_cloudwatch_metric_alarm.unhealthy_hosts
  to   = module.tendrai.aws_cloudwatch_metric_alarm.unhealthy_hosts
}

moved {
  from = aws_codebuild_project.app
  to   = module.tendrai.aws_codebuild_project.app
}

moved {
  from = aws_codedeploy_app.app
  to   = module.tendrai.aws_codedeploy_app.app
}

moved {
  from = aws_codedeploy_deployment_group.app
  to   = module.tendrai.aws_codedeploy_deployment_group.app
}

moved {
  from = aws_codepipeline.app
  to   = module.tendrai.aws_codepipeline.app
}

moved {
  from = aws_codestarconnections_connection.source
  to   = module.tendrai.aws_codestarconnections_connection.source
}

moved {
  from = aws_cognito_user_group.roles
  to   = module.tendrai.aws_cognito_user_group.roles
}

moved {
  from = aws_cognito_user_pool.main
  to   = module.tendrai.aws_cognito_user_pool.main
}

moved {
  from = aws_cognito_user_pool_client.alb
  to   = module.tendrai.aws_cognito_user_pool_client.alb
}

moved {
  from = aws_cognito_user_pool_domain.main
  to   = module.tendrai.aws_cognito_user_pool_domain.main
}

moved {
  from = aws_config_config_rule.managed
  to   = module.tendrai.aws_config_config_rule.managed
}

moved {
  from = aws_config_configuration_recorder.main
  to   = module.tendrai.aws_config_configuration_recorder.main
}

moved {
  from = aws_config_configuration_recorder_status.main
  to   = module.tendrai.aws_config_configuration_recorder_status.main
}

moved {
  from = aws_config_delivery_channel.main
  to   = module.tendrai.aws_config_delivery_channel.main
}

moved {
  from = aws_db_instance.main
  to   = module.tendrai.aws_db_instance.main
}

moved {
  from = aws_db_parameter_group.main
  to   = module.tendrai.aws_db_parameter_group.main
}

moved {
  from = aws_db_subnet_group.main
  to   = module.tendrai.aws_db_subnet_group.main
}

moved {
  from = aws_flow_log.vpc
  to   = module.tendrai.aws_flow_log.vpc
}

moved {
  from = aws_guardduty_detector.main
  to   = module.tendrai.aws_guardduty_detector.main
}

moved {
  from = aws_iam_role.codebuild
  to   = module.tendrai.aws_iam_role.codebuild
}

moved {
  from = aws_iam_role.codedeploy
  to   = module.tendrai.aws_iam_role.codedeploy
}

moved {
  from = aws_iam_role.codepipeline
  to   = module.tendrai.aws_iam_role.codepipeline
}

moved {
  from = aws_iam_role.config
  to   = module.tendrai.aws_iam_role.config
}

moved {
  from = aws_iam_role.flow_logs
  to   = module.tendrai.aws_iam_role.flow_logs
}

moved {
  from = aws_iam_role.lambda
  to   = module.tendrai.aws_iam_role.lambda
}

moved {
  from = aws_iam_role.pipes
  to   = module.tendrai.aws_iam_role.pipes
}

moved {
  from = aws_iam_role.sfn
  to   = module.tendrai.aws_iam_role.sfn
}

moved {
  from = aws_iam_role_policy.codebuild
  to   = module.tendrai.aws_iam_role_policy.codebuild
}

moved {
  from = aws_iam_role_policy.codepipeline
  to   = module.tendrai.aws_iam_role_policy.codepipeline
}

moved {
  from = aws_iam_role_policy.flow_logs
  to   = module.tendrai.aws_iam_role_policy.flow_logs
}

moved {
  from = aws_iam_role_policy.lambda
  to   = module.tendrai.aws_iam_role_policy.lambda
}

moved {
  from = aws_iam_role_policy.pipes
  to   = module.tendrai.aws_iam_role_policy.pipes
}

moved {
  from = aws_iam_role_policy.sfn
  to   = module.tendrai.aws_iam_role_policy.sfn
}

moved {
  from = aws_iam_role_policy_attachment.config
  to   = module.tendrai.aws_iam_role_policy_attachment.config
}

moved {
  from = aws_iam_role_policy_attachment.lambda_vpc
  to   = module.tendrai.aws_iam_role_policy_attachment.lambda_vpc
}

moved {
  from = aws_iam_role_policy_attachment.lambda_xray
  to   = module.tendrai.aws_iam_role_policy_attachment.lambda_xray
}

moved {
  from = aws_inspector2_enabler.main
  to   = module.tendrai.aws_inspector2_enabler.main
}

moved {
  from = aws_internet_gateway.main
  to   = module.tendrai.aws_internet_gateway.main
}

moved {
  from = aws_kms_alias.data
  to   = module.tendrai.aws_kms_alias.data
}

moved {
  from = aws_kms_alias.logs
  to   = module.tendrai.aws_kms_alias.logs
}

moved {
  from = aws_kms_key.data
  to   = module.tendrai.aws_kms_key.data
}

moved {
  from = aws_kms_key.logs
  to   = module.tendrai.aws_kms_key.logs
}

moved {
  from = aws_lambda_function.workflow
  to   = module.tendrai.aws_lambda_function.workflow
}

moved {
  from = aws_lb.main
  to   = module.tendrai.aws_lb.main
}

moved {
  from = aws_lb_listener.http_forward
  to   = module.tendrai.aws_lb_listener.http_forward
}

moved {
  from = aws_lb_listener.http_redirect
  to   = module.tendrai.aws_lb_listener.http_redirect
}

moved {
  from = aws_lb_listener.https
  to   = module.tendrai.aws_lb_listener.https
}

moved {
  from = aws_macie2_account.main
  to   = module.tendrai.aws_macie2_account.main
}

moved {
  from = aws_pipes_pipe.jobs_to_workflow
  to   = module.tendrai.aws_pipes_pipe.jobs_to_workflow
}

moved {
  from = aws_route.public_internet
  to   = module.tendrai.aws_route.public_internet
}

moved {
  from = aws_route_table.private
  to   = module.tendrai.aws_route_table.private
}

moved {
  from = aws_route_table.public
  to   = module.tendrai.aws_route_table.public
}

moved {
  from = aws_route_table_association.private
  to   = module.tendrai.aws_route_table_association.private
}

moved {
  from = aws_route_table_association.public
  to   = module.tendrai.aws_route_table_association.public
}

moved {
  from = aws_route_table_association.workflow
  to   = module.tendrai.aws_route_table_association.workflow
}

moved {
  from = aws_route53_record.acm_validation
  to   = module.tendrai.aws_route53_record.acm_validation
}

moved {
  from = aws_s3_bucket.audit_logs
  to   = module.tendrai.aws_s3_bucket.audit_logs
}

moved {
  from = aws_s3_bucket.cicd_artifacts
  to   = module.tendrai.aws_s3_bucket.cicd_artifacts
}

moved {
  from = aws_s3_bucket.documents
  to   = module.tendrai.aws_s3_bucket.documents
}

moved {
  from = aws_s3_bucket_cors_configuration.documents
  to   = module.tendrai.aws_s3_bucket_cors_configuration.documents
}

moved {
  from = aws_s3_bucket_lifecycle_configuration.cicd_artifacts
  to   = module.tendrai.aws_s3_bucket_lifecycle_configuration.cicd_artifacts
}

moved {
  from = aws_s3_bucket_lifecycle_configuration.documents
  to   = module.tendrai.aws_s3_bucket_lifecycle_configuration.documents
}

moved {
  from = aws_s3_bucket_policy.audit_logs
  to   = module.tendrai.aws_s3_bucket_policy.audit_logs
}

moved {
  from = aws_s3_bucket_policy.cicd_artifacts
  to   = module.tendrai.aws_s3_bucket_policy.cicd_artifacts
}

moved {
  from = aws_s3_bucket_policy.documents
  to   = module.tendrai.aws_s3_bucket_policy.documents
}

moved {
  from = aws_s3_bucket_public_access_block.audit_logs
  to   = module.tendrai.aws_s3_bucket_public_access_block.audit_logs
}

moved {
  from = aws_s3_bucket_public_access_block.cicd_artifacts
  to   = module.tendrai.aws_s3_bucket_public_access_block.cicd_artifacts
}

moved {
  from = aws_s3_bucket_public_access_block.documents
  to   = module.tendrai.aws_s3_bucket_public_access_block.documents
}

moved {
  from = aws_s3_bucket_server_side_encryption_configuration.audit_logs
  to   = module.tendrai.aws_s3_bucket_server_side_encryption_configuration.audit_logs
}

moved {
  from = aws_s3_bucket_server_side_encryption_configuration.cicd_artifacts
  to   = module.tendrai.aws_s3_bucket_server_side_encryption_configuration.cicd_artifacts
}

moved {
  from = aws_s3_bucket_server_side_encryption_configuration.documents
  to   = module.tendrai.aws_s3_bucket_server_side_encryption_configuration.documents
}

moved {
  from = aws_s3_bucket_versioning.audit_logs
  to   = module.tendrai.aws_s3_bucket_versioning.audit_logs
}

moved {
  from = aws_s3_bucket_versioning.cicd_artifacts
  to   = module.tendrai.aws_s3_bucket_versioning.cicd_artifacts
}

moved {
  from = aws_s3_bucket_versioning.documents
  to   = module.tendrai.aws_s3_bucket_versioning.documents
}

moved {
  from = aws_secretsmanager_secret.app_config
  to   = module.tendrai.aws_secretsmanager_secret.app_config
}

moved {
  from = aws_secretsmanager_secret_version.app_config
  to   = module.tendrai.aws_secretsmanager_secret_version.app_config
}

moved {
  from = aws_security_group.alb
  to   = module.tendrai.aws_security_group.alb
}

moved {
  from = aws_security_group.db
  to   = module.tendrai.aws_security_group.db
}

moved {
  from = aws_security_group.lambda
  to   = module.tendrai.aws_security_group.lambda
}

moved {
  from = aws_security_group.vpc_endpoints
  to   = module.tendrai.aws_security_group.vpc_endpoints
}

moved {
  from = aws_securityhub_account.main
  to   = module.tendrai.aws_securityhub_account.main
}

moved {
  from = aws_securityhub_standards_subscription.fsbp
  to   = module.tendrai.aws_securityhub_standards_subscription.fsbp
}

moved {
  from = aws_sfn_state_machine.tender_processing
  to   = module.tendrai.aws_sfn_state_machine.tender_processing
}

moved {
  from = aws_sns_topic.alarms
  to   = module.tendrai.aws_sns_topic.alarms
}

moved {
  from = aws_sns_topic_subscription.alarm_email
  to   = module.tendrai.aws_sns_topic_subscription.alarm_email
}

moved {
  from = aws_sqs_queue.jobs
  to   = module.tendrai.aws_sqs_queue.jobs
}

moved {
  from = aws_sqs_queue.jobs_dlq
  to   = module.tendrai.aws_sqs_queue.jobs_dlq
}

moved {
  from = aws_sqs_queue_policy.jobs
  to   = module.tendrai.aws_sqs_queue_policy.jobs
}

moved {
  from = aws_sqs_queue_policy.jobs_dlq
  to   = module.tendrai.aws_sqs_queue_policy.jobs_dlq
}

moved {
  from = aws_sqs_queue_redrive_allow_policy.jobs_dlq
  to   = module.tendrai.aws_sqs_queue_redrive_allow_policy.jobs_dlq
}

moved {
  from = aws_subnet.private
  to   = module.tendrai.aws_subnet.private
}

moved {
  from = aws_subnet.public
  to   = module.tendrai.aws_subnet.public
}

moved {
  from = aws_subnet.workflow
  to   = module.tendrai.aws_subnet.workflow
}

moved {
  from = aws_vpc.main
  to   = module.tendrai.aws_vpc.main
}

moved {
  from = aws_vpc_endpoint.interface
  to   = module.tendrai.aws_vpc_endpoint.interface
}

moved {
  from = aws_vpc_endpoint.s3
  to   = module.tendrai.aws_vpc_endpoint.s3
}

moved {
  from = aws_vpc_security_group_egress_rule.alb_to_cognito
  to   = module.tendrai.aws_vpc_security_group_egress_rule.alb_to_cognito
}

moved {
  from = aws_vpc_security_group_egress_rule.lambda_to_db
  to   = module.tendrai.aws_vpc_security_group_egress_rule.lambda_to_db
}

moved {
  from = aws_vpc_security_group_egress_rule.lambda_to_endpoints
  to   = module.tendrai.aws_vpc_security_group_egress_rule.lambda_to_endpoints
}

moved {
  from = aws_vpc_security_group_egress_rule.lambda_to_s3
  to   = module.tendrai.aws_vpc_security_group_egress_rule.lambda_to_s3
}

moved {
  from = aws_vpc_security_group_ingress_rule.alb_http
  to   = module.tendrai.aws_vpc_security_group_ingress_rule.alb_http
}

moved {
  from = aws_vpc_security_group_ingress_rule.alb_https
  to   = module.tendrai.aws_vpc_security_group_ingress_rule.alb_https
}

moved {
  from = aws_vpc_security_group_ingress_rule.db_from_lambda
  to   = module.tendrai.aws_vpc_security_group_ingress_rule.db_from_lambda
}

moved {
  from = aws_vpc_security_group_ingress_rule.vpce_https
  to   = module.tendrai.aws_vpc_security_group_ingress_rule.vpce_https
}

moved {
  from = aws_wafv2_web_acl.main
  to   = module.tendrai.aws_wafv2_web_acl.main
}

moved {
  from = aws_wafv2_web_acl_association.alb
  to   = module.tendrai.aws_wafv2_web_acl_association.alb
}
