# ---------------------------------------------------------------------------
# LPS-P2C — CI/CD (item 12) — gated by var.enable_cicd
#
# GitHub (CodeStar Connection) -> CodePipeline -> CodeBuild -> CodeDeploy
# (in-place onto the app ASG). Artifacts live in the cicd-artifacts bucket,
# encrypted with the data CMK.
#
# NOTE: after the first apply the CodeStar connection is in PENDING state —
# a human must complete the GitHub handshake once in the AWS console
# (Developer Tools -> Connections -> Update pending connection).
# ---------------------------------------------------------------------------

resource "aws_codestarconnections_connection" "github" {
  count = var.enable_cicd ? 1 : 0

  name          = "${local.name}-github"
  provider_type = "GitHub"

  tags = {
    Name = "${local.name}-github"
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
  }
}

resource "aws_iam_role" "codebuild" {
  count = var.enable_cicd ? 1 : 0

  name               = "${local.name}-codebuild-role"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
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
    resources = ["arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/codebuild/${local.name}-*"]
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

resource "aws_iam_role_policy" "codebuild" {
  count = var.enable_cicd ? 1 : 0

  name   = "${local.name}-codebuild"
  role   = aws_iam_role.codebuild[0].id
  policy = data.aws_iam_policy_document.codebuild[0].json
}

resource "aws_codebuild_project" "app" {
  count = var.enable_cicd ? 1 : 0

  name          = "${local.name}-build"
  description   = "Builds the LPS-P2C application"
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
    privileged_mode = false

    environment_variable {
      name  = "ENVIRONMENT"
      value = var.environment
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

# ----- CodeDeploy ------------------------------------------------------------

data "aws_iam_policy_document" "codedeploy_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codedeploy.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "codedeploy" {
  count = var.enable_cicd ? 1 : 0

  name               = "${local.name}-codedeploy-role"
  assume_role_policy = data.aws_iam_policy_document.codedeploy_assume.json
}

resource "aws_iam_role_policy_attachment" "codedeploy" {
  count = var.enable_cicd ? 1 : 0

  role       = aws_iam_role.codedeploy[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRole"
}

resource "aws_codedeploy_app" "app" {
  count = var.enable_cicd ? 1 : 0

  name             = "${local.name}-app"
  compute_platform = "Server"
}

resource "aws_codedeploy_deployment_group" "app" {
  count = var.enable_cicd ? 1 : 0

  app_name              = aws_codedeploy_app.app[0].name
  deployment_group_name = "${local.name}-app-dg"
  service_role_arn      = aws_iam_role.codedeploy[0].arn

  autoscaling_groups = [aws_autoscaling_group.app.name]

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
    events  = ["DEPLOYMENT_FAILURE"]
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
  }
}

resource "aws_iam_role" "codepipeline" {
  count = var.enable_cicd ? 1 : 0

  name               = "${local.name}-codepipeline-role"
  assume_role_policy = data.aws_iam_policy_document.codepipeline_assume.json
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
    sid       = "UseGitHubConnection"
    effect    = "Allow"
    actions   = ["codestar-connections:UseConnection"]
    resources = [aws_codestarconnections_connection.github[0].arn]
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
      "arn:aws:codedeploy:${var.aws_region}:${local.account_id}:application:${aws_codedeploy_app.app[0].name}",
      "arn:aws:codedeploy:${var.aws_region}:${local.account_id}:deploymentgroup:${aws_codedeploy_app.app[0].name}/*",
      "arn:aws:codedeploy:${var.aws_region}:${local.account_id}:deploymentconfig:*",
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

  name     = "${local.name}-pipeline"
  role_arn = aws_iam_role.codepipeline[0].arn

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
      name             = "GitHub"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source_output"]

      configuration = {
        ConnectionArn    = aws_codestarconnections_connection.github[0].arn
        FullRepositoryId = "${var.github_owner}/${var.github_repo}"
        BranchName       = var.github_branch
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
      name            = "Deploy"
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
