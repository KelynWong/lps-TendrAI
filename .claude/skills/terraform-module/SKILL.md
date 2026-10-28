---
name: terraform-module
description: Use when adding, changing or reviewing anything under infra/ (infra/modules/tendrai/*.tf, infra/envs/{prod,floci,demo}/*.tf, moved.tf, statemachine/*.asl.json) or how lambdas/ is packaged into Lambda zips. Covers module conventions, naming and tagging, least-privilege IAM, KMS, VPC endpoints and how to validate and plan safely.
---

# Terraform module work (TendrAI)

Read `CLAUDE.md` (Commands, Engineering constraints) and `infra/README.md` first. This skill adds the conventions that live in the code.

## Layout you must respect
- `infra/modules/tendrai/` is the whole AWS stack as ONE module, one file per service:
  - network: `vpc.tf`, `endpoints.tf`, `security_groups.tf`
  - edge: `alb.tf`, `acm.tf`, `cognito.tf`, `waf.tf`
  - app/data: `ec2.tf` (launch template + ASG), `rds.tf`, `s3.tf`, `secrets.tf`
  - workflow: `sqs.tf` (queue + EventBridge Pipe), `lambda.tf`, `step_functions.tf` + `statemachine/tender_processing.asl.json`
  - security/ops: `iam.tf` (all non-CI/CD roles), `kms.tf`, `cloudwatch.tf`, `security_services.tf`, `cicd.tf` (its own roles)
  - plumbing: `variables.tf`, `locals.tf`, `outputs.tf`, `versions.tf`
- Put new resources in the matching service file. Create a new file only for a new service, and add it to the file-mapping table in `infra/README.md`.
- `infra/envs/prod` (real AWS) and `infra/envs/floci` (emulator on `localhost:4566`) are thin roots: `main.tf` (locals + `module "tendrai"`), `provider.tf`, `versions.tf`, `outputs.tf`. There are NO tfvars for these envs; inputs are set literally in `envs/<env>/main.tf`.
- `infra/envs/demo` is a separate static-site stack (S3 + CloudFront + WAF, own `variables.tf` and a committed `demo.tfvars`). It does not use the module. Do not mix its conventions into the module.
- Lambda code is `lambdas/<function>/handler.py` (repo root). `lambda.tf` zips each folder with `data "archive_file" "lambda"` (`source_dir = "${path.module}/../../../lambdas/${each.key}"`, output in `modules/tendrai/.build/`, gitignored). Handler is always `handler.lambda_handler`, runtime `var.lambda_runtime`, `architectures = ["arm64"]`. A new Lambda = new folder in `lambdas/` + new key in `local.lambda_functions`; the folder name must equal the key.

## Variables, flags, outputs
- Every variable in `variables.tf` has `description` and `type`; add a `validation` block when a wrong value breaks policy. Model: `aws_region` (`condition = var.aws_region == "ap-southeast-1"`, NFR05) and `project` (lowercase regex). Group new variables under the existing `# ----- <Section> ---` headers.
- Feature flags are `enable_*` bools defaulting to `true` (`enable_waf`, `enable_acm`, `enable_cognito`, `enable_cicd`, `enable_security_services`, `enable_multi_az`). Gate whole resources with `count = var.enable_x ? 1 : 0` and reference as `aws_x.y[0]`; gate maps with `for_each = var.enable_x ? toset([...]) : toset([])`; gate nested blocks with `dynamic ... for_each = var.enable_x ? [1] : []`. Outputs of gated resources use `try(aws_x.y[0].attr, null)` and say "(null when enable_x = false)" in the description (see `outputs.tf`).
- Per-item collections use `for_each` over a local map (e.g. `local.lambda_functions`, `local.interface_endpoints`), and filtered maps such as `{ for k, v in local.lambda_functions : k => v if v.needs_db }`.
- New module input: add to `variables.tf` with a safe default. If prod or floci needs a non-default value, set it in BOTH `envs/prod/main.tf` and `envs/floci/main.tf` (floci uses small/cheap values and turns `enable_cicd`, `enable_security_services`, `enable_multi_az` off). Then update `infra/README.md` (feature-flag table / deploy steps) and `docs/` per CLAUDE.md.
- New module output: add to `modules/tendrai/outputs.tf` AND re-export it in both `envs/prod/outputs.tf` and `envs/floci/outputs.tf` (both currently mirror all 36 outputs). Mark secret ARNs `sensitive = true` like `db_master_secret_arn`.
- The shared env locals (`project = "tendrai"`, `project_tag = "TendrAI"`, `aws_region = "ap-southeast-1"`) must stay identical across envs.

## Re-addressing resources
- Renaming a resource, switching `count`<->`for_each`, or moving it into/out of a module changes its address: add a `moved { from = ... to = ... }` block so state follows instead of destroy/recreate. `envs/floci/moved.tf` is the example (flat root -> `module.tendrai.*`). Prod has no `moved.tf`; if a prod state predates the module, ask the user before planning.
- The planned split of `modules/tendrai` into smaller modules (README "Layout") needs `moved` blocks in every env.

## Naming and tagging
- Name everything `"${local.name}-<thing>"` where `local.name = "${var.project}-${var.environment}"` (`locals.tf`). Lambda-derived names use `replace(each.key, "_", "-")`. Globally unique names append the account id (`local.documents_bucket_name` etc.).
- Tags `Project`, `Environment`, `ManagedBy = "Terraform"` come from `default_tags` in `envs/prod/provider.tf` and `envs/floci/provider.tf`; do not repeat them per resource. Do add `tags = { Name = "${local.name}-<thing>" }` on every taggable resource (subnets also carry `Tier`). Note `envs/demo/providers.tf` uses its own set (`Project`, `Component`, `ManagedBy = "terraform"`).

## IAM (least privilege) — follow `iam.tf` / `cicd.tf`
- Write policies as `data "aws_iam_policy_document"` + `aws_iam_role_policy` (inline, one per role). Use `sid`s. Never `jsonencode` a hand-written policy.
- Resources must be specific ARNs (`aws_s3_bucket.documents.arn`, `"${...arn}/<prefix>/*"`, `aws_kms_key.data.arn`, a single queue/secret/state machine). No `"*"` actions.
- `resources = ["*"]` only where the API has no resource-level permissions. Existing cases:
  - `iam.tf`: `textract:*DocumentTextDetection`, Step Functions vended-log `logs:*LogDelivery*`, `xray:Put*`, `cloudwatch:GetMetricStatistics`, `cloudwatch:PutMetricData` (with a `cloudwatch:namespace` condition), EC2 app `ssmmessages:*Channel` / `ec2messages:*` (`SsmSessionChannels`) and `codedeploy-commands-secure:*` agent calls (`CodeDeployAgentCommands`).
  - `cicd.tf`: CodeDeploy `DescribeFleet` (autoscaling/ec2/elasticloadbalancing `Describe*`, `cloudwatch:DescribeAlarms`) and `LaunchFromAppTemplate` (`ec2:RunInstances`/`CreateTags` with an `ec2:LaunchTemplate` condition).
  - Add a comment saying why when you add one, and prefer a condition key.
- Trust policies: add `aws:SourceAccount` (and `aws:SourceArn` where the service sends it, e.g. the Pipes role) like `sfn_assume`, `pipes_assume`, `codebuild_assume`, `codedeploy_assume` (EC2's `ec2_assume` cannot: EC2 sends no source context). `iam:PassRole` must be scoped to role ARNs with an `iam:PassedToService` condition (see `PassAppInstanceRole` in `cicd.tf`).
- Lambda permissions come from flags in `local.lambda_functions` (`needs_db`, `needs_s3`, `needs_bedrock`) driving `dynamic "statement"` blocks and SG rules. Add a flag rather than a one-off policy.
- Bedrock: only `local.bedrock_model_arns` (in-region `ap-southeast-1` ARNs). Never add `global.*` or other-region profiles (CLAUDE.md data residency). Load the `aws-security-review` skill for any IAM change and explain change + risk to the user.

## KMS (`kms.tf`)
- `aws_kms_key.data` (`alias/${local.name}-data`):
  - S3 documents + CI/CD artifacts buckets, CodePipeline artifact store, CodeBuild.
  - RDS storage, Performance Insights, RDS-managed master secret; Secrets Manager `app_config`.
  - SQS jobs + DLQ, EC2 app EBS volumes (key policy grants the Auto Scaling service-linked role), Lambda env vars, Step Functions, Textract output.
- `aws_kms_key.logs` (`alias/${local.name}-logs`): CloudWatch log groups, CloudTrail, AWS Config, audit bucket, alarm SNS topic.
- Both have `enable_key_rotation = true`, 30-day deletion window. Any new data store must set its KMS key to one of these. A new service principal that encrypts with a key needs a key-policy statement with a `aws:SourceAccount` or encryption-context condition, plus IAM `kms:` actions scoped to the key ARN on the caller's role.

## Network and private endpoints
- No NAT. Private and workflow subnets share `aws_route_table.private` with no default route. AWS access is only via the S3 gateway endpoint and interface endpoints in `local.interface_endpoints` (`logs`, `monitoring`, `secretsmanager`, `kms`, `sqs`, `bedrock-runtime`, `ssm`, `ssmmessages`, `ec2messages`, `codedeploy`, `codedeploy-commands-secure`), created by `endpoints.tf` in the private subnets with `aws_security_group.vpc_endpoints` (443 from `var.vpc_cidr`).
- When code on the EC2 app or in a Lambda needs a new AWS service: add its endpoint suffix to `local.interface_endpoints` (update the comment), make sure the caller's SG has 443 egress to `aws_security_group.vpc_endpoints` (the EC2 app SG and every Lambda SG already do), and add the IAM permission. Never add a NAT gateway, IGW route or `0.0.0.0/0` egress from private tiers; ask the user if an endpoint does not exist for the service.
- SG rules use separate `aws_vpc_security_group_{ingress,egress}_rule` resources referencing SGs (`referenced_security_group_id`) or the S3 prefix list, one SG per component.

## Validate and plan safely
1. `terraform fmt -check -recursive infra` (run `terraform fmt -recursive infra` to fix).
2. For EVERY env you could affect (`prod`, `floci`, and `demo` if touched): `terraform -chdir=infra/envs/<env> init -backend=false` then `terraform -chdir=infra/envs/<env> validate`.
3. Plan only `terraform -chdir=infra/envs/floci plan`, and only with Floci running (`docker compose -f infra/envs/floci/docker-compose.floci.yml up -d`). Never `plan`/`apply` prod or demo, or run any command against real AWS, unless the user asks.
4. Read the plan: list every `must be replaced`, `destroy` and `moved` line to the user explicitly (VPC/subnet/RDS replacements lose data; see README "Migrating from earlier stacks").
5. Never commit `*.tfstate`, `*.tfplan`, `.build/`, `.env` (ignored by `infra/.gitignore`); keep `.terraform.lock.hcl` tracked.
