---
name: gitlab-ci-cd
description: Use when creating or editing .gitlab-ci.yml, buildspec.yml / appspec.yml, infra/modules/tendrai/cicd.tf, the EC2 user_data in infra/modules/tendrai/ec2.tf, api/Dockerfile or any other Dockerfile, or any deployment or environment-promotion step. Separates what the repo deploys with today (CodePipeline/CodeBuild/CodeDeploy) from the proposed GitLab CI/CD design.
---

# CI/CD for TendrAI

Read `CLAUDE.md` (Commands) and `infra/README.md` ("Deploying to real AWS" steps 4-6) first. Load the `terraform-module` skill for any change to `cicd.tf`, and `aws-security-review` for any IAM, secret or credential change.

The user wants GitLab CI/CD. The repo today has NO `.gitlab-ci.yml` and NO `buildspec.yml`. Always say which of the two sections below a change belongs to. Do not create `.gitlab-ci.yml` or remove the CodePipeline resources unless the user asks; ask first.

## Current (in repo)
Defined in `infra/modules/tendrai/cicd.tf`, all gated by `var.enable_cicd` (`count = var.enable_cicd ? 1 : 0`). `envs/prod/main.tf` sets `enable_cicd = true`; `envs/floci/main.tf` sets it `false`. There is only one pipeline (prod); no dev/staging environment in AWS.
- **Source**: `aws_codestarconnections_connection.source` (`source_provider_type` = `GitHub` | `GitLab` | `GitHubEnterpriseServer` | `GitLabSelfManaged`, validated in `variables.tf`). Pipeline triggers on `var.source_branch` (default `main`) of `source_repo_owner/source_repo_name`. The connection needs a one-time console handshake after apply.
- **Build**: `aws_codebuild_project.app` - `amazonlinux2-x86_64-standard:5.0`, `privileged_mode = false` (no docker), 30 min timeout, `encryption_key = aws_kms_key.data.arn`, buildspec at `var.buildspec_path` (`buildspec.yml`, **not in repo yet**). Env vars passed (plain text, none secret): `ENVIRONMENT`, `AWS_ACCOUNT_ID`, `APP_PORT`, `APP_INSTALL_DIR`, `COGNITO_USER_POOL_ID` (for `npm --prefix api run fetch:jwks`, which writes `certs/cognito-jwks.json`; the build must fail without it), and `LAMBDA_<KEY>` = function name for each of the six workflow Lambdas. The buildspec must output a CodeDeploy EC2 revision (`appspec.yml` installing to `/opt/tendrai/app` with hooks that stop/start the `tendrai-app` systemd unit and validate `/health`, `dist/`, production `node_modules/`, `package.json`, `certs/rds-global-bundle.pem`, `certs/cognito-jwks.json`) and run `aws lambda update-function-code` for each Lambda.
- **CodeBuild role**: logs on `/aws/codebuild/${local.name}-*`, CI/CD artifacts bucket, `lambda:UpdateFunctionCode` on exactly the six workflow function ARNs, data CMK. It has no Terraform or Secrets Manager rights.
- **Deploy** (`CodeDeploy` action, `aws_codedeploy_app.app` with `compute_platform = "Server"`, `aws_codedeploy_deployment_group.app`) - how in-place deployment works today:
  - `IN_PLACE` + `WITH_TRAFFIC_CONTROL` onto `aws_autoscaling_group.app`, config `CodeDeployDefault.OneAtATime`.
  - For each instance in turn CodeDeploy deregisters it from `aws_lb_target_group.app`, the CodeDeploy agent on the instance pulls the revision from the artifacts bucket (S3 gateway endpoint; it polls CodeDeploy over the `codedeploy` / `codedeploy-commands-secure` endpoints, no inbound connection) and runs the appspec hooks, then CodeDeploy re-registers it.
  - Scale-out instances get the last successful revision through the lifecycle hook CodeDeploy puts on the ASG.
  - Auto-rollback on `DEPLOYMENT_FAILURE` and `DEPLOYMENT_STOP_ON_ALARM`; the only alarm wired is `aws_cloudwatch_metric_alarm.target_5xx`.
  - CodeDeploy role: inline least-privilege policy (lifecycle hooks on the one ASG, register/deregister on the one target group, `Describe*`, launch only from the app launch template, `iam:PassRole` on the app instance role), not `AWSCodeDeployRole`.
- **Pipeline**: `aws_codepipeline.app`, V2, stages Source -> Build -> Deploy, artifacts in the CI/CD bucket encrypted with the data CMK. No approval stage, no test stage.
- **Runtime**: EC2 Auto Scaling group (`ec2.tf`), Amazon Linux 2023 x86_64, Node.js 22 from the AL2023 repos, the app runs as the `tendrai` user from `/opt/tendrai/app` with its non-secret config in `/etc/tendrai/app.env` (written by user_data). `api/Dockerfile` is no longer used by the pipeline.
- **Not covered by the pipeline today** (Not set up yet; ask before adding):
  - Terraform plan/apply: manual, from a workstation, local state.
  - Lambda code: zipped from `lambdas/` by `lambda.tf` and shipped at `terraform apply` time; the pipeline can also update it, but the next apply re-uploads the Terraform-packaged zip.
  - Frontend: no prod hosting resource exists for `frontend/` other than whatever the revision bundles with the API.
  - DB schema: `npm --prefix api run db:schema`, no migration tool.
  - Typecheck/build of frontend and api before the revision is built.

## Target (proposed, not built)
Ask the user before building any of this. Proposed `.gitlab-ci.yml` stages:
1. `lint` - `terraform fmt -check -recursive infra`. (No JS linter exists yet; do not invent one.)
2. `typecheck` - `npm --prefix frontend ci`, `npm --prefix api ci`, `npm --prefix api run typecheck`.
3. `build` - `npm --prefix frontend run build` (also the frontend typecheck), `npm --prefix api run build`.
4. `validate` - for each of `prod`, `floci`, `demo`: `terraform -chdir=infra/envs/<env> init -backend=false` + `validate`.
5. `plan` - `terraform -chdir=infra/envs/prod plan -out=tfplan` on merge requests that touch `infra/` or `lambdas/`; save `tfplan` (and a `terraform show -no-color` text copy) as an artifact with short expiry. Requires the S3 backend in `envs/prod/versions.tf` (currently commented out; state is local) - Not set up yet.
6. `package` - build the CodeDeploy EC2 revision (appspec + `dist/` + production `node_modules/` + RDS CA bundle) and upload it to the CI/CD artifacts bucket keyed by `$CI_COMMIT_SHA`.
7. `deploy` - apply + rollout (below).

**Plan/apply gating**
- `plan` runs on every MR to `infra/`; reviewers read it for replacements/destroys.
- `apply` is a `when: manual` job, only on the protected default branch, in a protected GitLab environment `prod` with required approvers, and runs `terraform apply tfplan` from the saved plan artifact of the same pipeline (never a fresh unreviewed plan).
- Add `resource_group: prod` so two applies never overlap.

**Environment promotion**: floci (local only, developer-run, never from CI against AWS) -> prod. A real `dev`/`staging` AWS env would be a new `infra/envs/<env>/` root and is Not set up yet. For the app, the option that keeps today's rollout is: GitLab builds/uploads the SHA revision, then triggers CodeDeploy (or keeps CodePipeline for the deploy half) so the in-place one-at-a-time rollout, the 5xx alarm and auto-rollback stay. Confirm with the user.

**Secrets handling**
- AWS access from GitLab: OIDC (`id_tokens:` with `aud`) to an IAM role with a trust policy restricted on `sub` to `project_path:<group>/<repo>:ref_type:branch:ref:<default>` (plus an environment claim for the apply role). Separate plan (read-only) and apply roles. This role and the GitLab OIDC provider are Not set up yet; they belong in `cicd.tf` behind a flag.
- Never store long-lived AWS keys in CI/CD variables. Non-AWS values: protected + masked variables only, scoped to the `prod` environment.
- App secrets stay in Secrets Manager (`app_config` and the app's `db_role["app"]` secret); the EC2 instances get only their ARNs (`APP_CONFIG_SECRET_ARN`, `DB_SECRET_ARN`) and read them at start-up. Never pass them as CodeBuild/GitLab variables or bake them into revisions/artifacts; never echo them in job logs.

**Approvals**
- Protected default branch; MR approval required (CODEOWNERS for `infra/`, `.gitlab-ci.yml`, `api/src/auth/` - Not set up yet).
- Protected environment `prod` with named deployers/approvers for apply and deploy jobs.

## When editing
- `cicd.tf` changes: keep every resource behind `count = var.enable_cicd ? 1 : 0`, keep CodeBuild/CodePipeline/CodeDeploy policies scoped to the specific project/bucket/ASG/target group/function/key ARNs, keep `PassAppInstanceRole` limited to the app instance role with `iam:PassedToService = ec2.amazonaws.com`.
- Revisions: no secrets in the bundle, the app keeps running as the non-root `tendrai` user, keep x86_64 (the AMI is AL2023 x86_64).
- Any deployment-step change: update `infra/README.md` and `docs/` (CLAUDE.md), and run the `terraform-module` validation steps.
