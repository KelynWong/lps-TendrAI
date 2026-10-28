# ---------------------------------------------------------------------------
# TendrAI — CI/CD (diagram items 22, 24) — gated by var.enable_cicd
#
# GitHub/GitLab (CodeConnections) -> CodePipeline -> CodeBuild (build the
# web app + API bundle, update the workflow Lambda code) -> CodeDeploy
# EC2/on-premises IN-PLACE deployment onto the app Auto Scaling group.
# Artifacts live in the cicd-artifacts bucket, encrypted with the data CMK.
#
# The CodeDeploy agent on each instance pulls the revision from the
# artifacts bucket (S3 gateway endpoint) and polls CodeDeploy over the
# codedeploy / codedeploy-commands-secure interface endpoints; nothing
# connects inbound to the instances.
#
# The application repository must produce, from buildspec.yml, a revision
# bundle (the CodeBuild output artifact) containing:
#   * appspec.yml  — CodeDeploy EC2 AppSpec: files -> /opt/tendrai/app, hooks
#                    that stop / start the tendrai-app systemd unit (ec2.tf)
#                    and a ValidateService hook that curls /health
#   * dist/, node_modules/ (production), package.json
#   * certs/rds-global-bundle.pem (DB_SSL_CA_PATH; the instances have no
#     internet access to download it)
#   * certs/cognito-jwks.json (COGNITO_JWKS_PATH): the user pool's public
#     signing keys, from `npm --prefix api run fetch:jwks` (uses the
#     COGNITO_USER_POOL_ID build variable). The build must fail without it; the
#     API verifies sign-in tokens only against this file.
# and update the six workflow Lambdas with
#   aws lambda update-function-code --function-name $LAMBDA_<KEY> --zip-file ...
# CodeBuild receives the function names as LAMBDA_* environment variables.
#
# NOTE: after the first apply the connection is in PENDING state — a human
# must complete the provider handshake once in the AWS console
# (Developer Tools -> Settings -> Connections -> Update pending connection).
# ---------------------------------------------------------------------------

resource "aws_codestarconnections_connection" "source" {
  count = var.enable_cicd ? 1 : 0

  name          = "${local.name}-${lower(var.source_provider_type)}"
  provider_type = var.source_provider_type

  tags = {
    Name = "${local.name}-${lower(var.source_provider_type)}"
  }
}

# ----- CodeBuild -------------------------------------------------------------

data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "codebuild" {
  count = var.enable_cicd ? 1 : 0

  name               = "${local.name}-codebuild-role"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json

  tags = {
    Name = "${local.name}-codebuild-role"
  }
}

data "aws_iam_policy_document" "codebuild" {
  count = var.enable_cicd ? 1 : 0

  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:/aws/codebuild/${local.name}-*"]
  }

  statement {
    sid    = "Artifacts"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.cicd_artifacts.arn,
      "${aws_s3_bucket.cicd_artifacts.arn}/*",
    ]
  }

  # Ship new code to exactly the six workflow Lambdas (no config changes).
  statement {
    sid       = "UpdateWorkflowLambdaCode"
    effect    = "Allow"
    actions   = ["lambda:UpdateFunctionCode"]
    resources = [for fn in aws_lambda_function.workflow : fn.arn]
  }

  statement {
    sid    = "ArtifactEncryption"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.data.arn]
  }
}

resource "aws_iam_role_policy" "codebuild" {
  count = var.enable_cicd ? 1 : 0

  name   = "${local.name}-codebuild"
  role   = aws_iam_role.codebuild[0].id
  policy = data.aws_iam_policy_document.codebuild[0].json
}

resource "aws_codebuild_project" "app" {
  count = var.enable_cicd ? 1 : 0

  name          = "${local.name}-build"
  description   = "Builds the TendrAI web app + API revision for CodeDeploy and updates the workflow Lambda code"
  service_role  = aws_iam_role.codebuild[0].arn
  build_timeout = 30

  encryption_key = aws_kms_key.data.arn

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/amazonlinux2-x86_64-standard:5.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = false # no docker builds

    environment_variable {
      name  = "ENVIRONMENT"
      value = var.environment
    }
    environment_variable {
      name  = "AWS_ACCOUNT_ID"
      value = local.account_id
    }
    environment_variable {
      name  = "APP_PORT"
      value = tostring(var.app_port)
    }
    environment_variable {
      name  = "APP_INSTALL_DIR"
      value = local.app_install_dir
    }
    # `npm --prefix api run fetch:jwks` bundles this pool's public signing keys
    environment_variable {
      name  = "COGNITO_USER_POOL_ID"
      value = var.enable_cognito ? aws_cognito_user_pool.main[0].id : ""
    }

    # LAMBDA_STATUS_UPDATER, LAMBDA_TEXT_EXTRACTOR_WORD, ... => function name
    dynamic "environment_variable" {
      for_each = aws_lambda_function.workflow

      content {
        name  = "LAMBDA_${upper(environment_variable.key)}"
        value = environment_variable.value.function_name
      }
    }
  }

  source {
    type      = "CODEPIPELINE"
    buildspec = var.buildspec_path
  }

  logs_config {
    cloudwatch_logs {
      group_name = "/aws/codebuild/${local.name}-build"
    }
  }

  tags = {
    Name = "${local.name}-build"
  }
}

# ----- CodeDeploy (EC2/on-premises, in-place onto the ASG) --------------------

data "aws_iam_policy_document" "codedeploy_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codedeploy.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "codedeploy" {
  count = var.enable_cicd ? 1 : 0

  name               = "${local.name}-codedeploy-role"
  assume_role_policy = data.aws_iam_policy_document.codedeploy_assume.json

  tags = {
    Name = "${local.name}-codedeploy-role"
  }
}

# Least-privilege replacement for the AWSCodeDeployRole managed policy,
# covering an in-place deployment to one ASG behind one target group.
data "aws_iam_policy_document" "codedeploy" {
  count = var.enable_cicd ? 1 : 0

  # Lifecycle hook that deploys the last good revision to scale-out instances.
  statement {
    sid    = "ManageAppAsg"
    effect = "Allow"
    actions = [
      "autoscaling:CompleteLifecycleAction",
      "autoscaling:DeleteLifecycleHook",
      "autoscaling:PutLifecycleHook",
      "autoscaling:RecordLifecycleActionHeartbeat",
      "autoscaling:ResumeProcesses",
      "autoscaling:SuspendProcesses",
      "autoscaling:UpdateAutoScalingGroup",
    ]
    resources = [aws_autoscaling_group.app.arn]
  }

  # Describe* calls have no resource-level permissions.
  statement {
    sid    = "DescribeFleet"
    effect = "Allow"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeLifecycleHooks",
      "autoscaling:DescribeWarmPool",
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
      "cloudwatch:DescribeAlarms",
    ]
    resources = ["*"]
  }

  # Take each instance out of / back into the target group during deployment.
  statement {
    sid    = "ShiftTraffic"
    effect = "Allow"
    actions = [
      "elasticloadbalancing:DeregisterTargets",
      "elasticloadbalancing:RegisterTargets",
    ]
    resources = [aws_lb_target_group.app.arn]
  }

  # An ASG built from a launch template requires the caller of
  # UpdateAutoScalingGroup to be able to launch from that template.
  # RunInstances/CreateTags are limited to launches from the app template.
  statement {
    sid       = "LaunchFromAppTemplate"
    effect    = "Allow"
    actions   = ["ec2:RunInstances", "ec2:CreateTags"]
    resources = ["*"]
    condition {
      test     = "ArnLike"
      variable = "ec2:LaunchTemplate"
      values   = [aws_launch_template.app.arn]
    }
  }

  statement {
    sid       = "PassAppInstanceRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.app.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "codedeploy" {
  count = var.enable_cicd ? 1 : 0

  name   = "${local.name}-codedeploy"
  role   = aws_iam_role.codedeploy[0].id
  policy = data.aws_iam_policy_document.codedeploy[0].json
}

resource "aws_codedeploy_app" "app" {
  count = var.enable_cicd ? 1 : 0

  name             = "${local.name}-app"
  compute_platform = "Server"

  tags = {
    Name = "${local.name}-app"
  }
}

resource "aws_codedeploy_deployment_group" "app" {
  count = var.enable_cicd ? 1 : 0

  app_name              = aws_codedeploy_app.app[0].name
  deployment_group_name = "${local.name}-app-dg"
  service_role_arn      = aws_iam_role.codedeploy[0].arn

  autoscaling_groups = [aws_autoscaling_group.app.name]

  # One instance at a time keeps the rest of the fleet serving; with a single
  # instance it behaves like AllAtOnce.
  deployment_config_name = "CodeDeployDefault.OneAtATime"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "IN_PLACE"
  }

  load_balancer_info {
    target_group_info {
      name = aws_lb_target_group.app.name
    }
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }

  alarm_configuration {
    enabled = true
    alarms  = [aws_cloudwatch_metric_alarm.target_5xx.alarm_name]
  }

  tags = {
    Name = "${local.name}-app-dg"
  }
}

# ----- CodePipeline ----------------------------------------------------------

data "aws_iam_policy_document" "codepipeline_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codepipeline.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "codepipeline" {
  count = var.enable_cicd ? 1 : 0

  name               = "${local.name}-codepipeline-role"
  assume_role_policy = data.aws_iam_policy_document.codepipeline_assume.json

  tags = {
    Name = "${local.name}-codepipeline-role"
  }
}

data "aws_iam_policy_document" "codepipeline" {
  count = var.enable_cicd ? 1 : 0

  statement {
    sid    = "Artifacts"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:GetBucketLocation",
      "s3:GetBucketVersioning",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.cicd_artifacts.arn,
      "${aws_s3_bucket.cicd_artifacts.arn}/*",
    ]
  }

  statement {
    sid    = "UseSourceConnection"
    effect = "Allow"
    actions = [
      "codestar-connections:UseConnection",
      "codeconnections:UseConnection",
    ]
    resources = [aws_codestarconnections_connection.source[0].arn]
  }

  statement {
    sid    = "RunBuilds"
    effect = "Allow"
    actions = [
      "codebuild:StartBuild",
      "codebuild:BatchGetBuilds",
    ]
    resources = [aws_codebuild_project.app[0].arn]
  }

  statement {
    sid    = "RunDeployments"
    effect = "Allow"
    actions = [
      "codedeploy:CreateDeployment",
      "codedeploy:GetDeployment",
      "codedeploy:GetDeploymentConfig",
      "codedeploy:GetApplication",
      "codedeploy:GetApplicationRevision",
      "codedeploy:RegisterApplicationRevision",
    ]
    resources = [
      "arn:${local.partition}:codedeploy:${var.aws_region}:${local.account_id}:application:${aws_codedeploy_app.app[0].name}",
      "arn:${local.partition}:codedeploy:${var.aws_region}:${local.account_id}:deploymentgroup:${aws_codedeploy_app.app[0].name}/${aws_codedeploy_deployment_group.app[0].deployment_group_name}",
      "arn:${local.partition}:codedeploy:${var.aws_region}:${local.account_id}:deploymentconfig:CodeDeployDefault.OneAtATime",
    ]
  }

  statement {
    sid    = "ArtifactEncryption"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.data.arn]
  }
}

resource "aws_iam_role_policy" "codepipeline" {
  count = var.enable_cicd ? 1 : 0

  name   = "${local.name}-codepipeline"
  role   = aws_iam_role.codepipeline[0].id
  policy = data.aws_iam_policy_document.codepipeline[0].json
}

resource "aws_codepipeline" "app" {
  count = var.enable_cicd ? 1 : 0

  name          = "${local.name}-pipeline"
  role_arn      = aws_iam_role.codepipeline[0].arn
  pipeline_type = "V2"

  artifact_store {
    location = aws_s3_bucket.cicd_artifacts.bucket
    type     = "S3"

    encryption_key {
      id   = aws_kms_key.data.arn
      type = "KMS"
    }
  }

  stage {
    name = "Source"

    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        ConnectionArn    = aws_codestarconnections_connection.source[0].arn
        FullRepositoryId = "${var.source_repo_owner}/${var.source_repo_name}"
        BranchName       = var.source_branch
      }
    }
  }

  stage {
    name = "Build"

    action {
      name             = "Build"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source_output"]
      output_artifacts = ["build_output"]

      configuration = {
        ProjectName = aws_codebuild_project.app[0].name
      }
    }
  }

  stage {
    name = "Deploy"

    action {
      name            = "InPlaceDeploy"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "CodeDeploy"
      version         = "1"
      input_artifacts = ["build_output"]

      configuration = {
        ApplicationName     = aws_codedeploy_app.app[0].name
        DeploymentGroupName = aws_codedeploy_deployment_group.app[0].deployment_group_name
      }
    }
  }

  tags = {
    Name = "${local.name}-pipeline"
  }
}
