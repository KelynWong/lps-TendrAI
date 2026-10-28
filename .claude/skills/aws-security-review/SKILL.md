---
name: aws-security-review
description: Use when reviewing or making any change to infra/ (IAM policies, KMS key policies, security groups, VPC endpoints, S3/RDS/SQS settings), api/src/auth/, api/src/routes/, api/src/config.ts, Lambda code in lambdas/ that calls AWS, Bedrock model IDs, logging, secrets, or anything touching data residency (ap-southeast-1). Gives a grep-able checklist and the review output format.
---

# AWS security review (TendrAI)

Rules come from `CLAUDE.md` "Engineering constraints"; the intended posture is `infra/README.md` "Security posture summary". Module paths below are relative to `infra/modules/tendrai/`.

For any IAM, networking or auth change, tell the user in your reply what changed and what the risk is (CLAUDE.md). If a change affects security or data residency and the requirement is unclear, ask before writing code.

## Checklist (inspect each; cite file:line)

**1. Public exposure**
- `grep -rn '0.0.0.0/0\|::/0' infra/` - allowed only: `security_groups.tf` `alb_http` (80), `alb_https` (443), `alb_to_cognito` egress 443 (ALB auth action), and `vpc.tf` `public_internet` route on the public route table. Anything else is a finding.
- `aws_lb.main` (`alb.tf`) is the only `internal = false` resource. EC2 app instances in private subnets with no key pair, IMDSv2 `http_tokens = "required"` (`ec2.tf`), the app SG admits only the ALB on `app_port`, all subnets `map_public_ip_on_launch = false`, RDS `publicly_accessible = false` in private subnets (`rds.tf`). No NAT, no IGW route on `aws_route_table.private`.
- Every `aws_s3_bucket` has an `aws_s3_bucket_public_access_block` with all four flags `true` (`s3.tf`: documents, cicd_artifacts, audit_logs; `envs/demo/s3.tf`: web via CloudFront OAC).
- SG rules must reference SGs/prefix lists, not CIDRs (except `vpce_https` from `var.vpc_cidr`).
- Demo caveat: `envs/demo` is internet-facing CloudFront. It is internal-only only when `restrict_to_lps = true` with `allowed_cidrs`; check `envs/demo/demo.tfvars`. Its WAF is in us-east-1 because CloudFront requires it; it holds no tender data and must never be pointed at real data.

**2. IAM wildcards**
- `grep -rn '"\*"\|:\*"' infra/modules infra/envs` and every `actions`/`resources` list. No `"*"` actions, no `service:*` in identity policies.
- Accepted exceptions (API has no resource-level permissions; keep the comment): `iam.tf` `ReadBucketMetrics` (`cloudwatch:GetMetricStatistics`), `PutCustomMetrics` (with `cloudwatch:namespace` condition), `TextractPdfs`, `StateMachineLogging`, `XRayTracing`, `SsmSessionChannels`, `CodeDeployAgentCommands`; `cicd.tf` `DescribeFleet`, `LaunchFromAppTemplate` (with `ec2:LaunchTemplate` condition).
- KMS key policies (`kms.tf`): `resources = ["*"]` in a key policy means "this key"; acceptable. `EnableIAMUserPermissions` (`kms:*` for the account root) is the AWS default that delegates to IAM; acceptable. Service statements should carry `aws:SourceAccount` or an encryption-context condition; flag new ones without it.
- Trust policies: require `aws:SourceAccount` (and `aws:SourceArn` when possible) like `sfn_assume`, `pipes_assume`, `codebuild_assume`, `codedeploy_assume` (`ec2_assume` is the documented exception: EC2 sends no source context). `iam:PassRole` only on named roles with `iam:PassedToService`.
- Managed policies attached: `AWSLambdaVPCAccessExecutionRole`, `AWSXRayDaemonWriteAccess`, Config role. (The EC2 app and CodeDeploy roles use inline least-privilege policies instead of `AmazonSSMManagedInstanceCore` / `AWSCodeDeployRole`.) The EC2 app role must never list the RDS master secret. Flag any new AWS-managed or `*FullAccess` policy.
- Lambda access must come from `needs_db` / `needs_s3` / `needs_bedrock` in `locals.tf` `lambda_functions`, not ad-hoc statements.

**3. Encryption**
- At rest: S3 SSE `aws:kms` with `aws_kms_key.data` (logs key for audit bucket) + `bucket_key_enabled`; RDS `storage_encrypted = true`, `kms_key_id`, `performance_insights_kms_key_id`, `master_user_secret_kms_key_id`; SQS `kms_master_key_id`; Secrets Manager `kms_key_id`; log groups `kms_key_id = aws_kms_key.logs.arn`; EC2 launch template EBS `encrypted = true` + `kms_key_id`; Lambda `kms_key_arn`; SFN encryption; SNS `kms_master_key_id`. Keys: `enable_key_rotation = true`.
- In transit: `DenyInsecureTransport` (`aws:SecureTransport = false`) on every bucket policy and both SQS queue policies; `DenyUnencryptedObjectUploads` on documents; `rds.force_ssl = 1` in `aws_db_parameter_group.main`; ALB `ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"` with HTTP->HTTPS redirect when `enable_acm`; API verifies the RDS CA (`DB_SSL_CA_PATH` in `ec2.tf` `local.app_env`; the bundle ships in the CodeDeploy revision).
- A new store/queue/topic without one of the two CMKs is a finding.

**4. In-region AI (data residency)**
- `variables.tf` `bedrock_text_model_id` / `bedrock_embed_model_id` and `envs/*/main.tf` values must be plain in-region model IDs (`anthropic....`, `amazon.titan-embed-text-v2:0`). Reject `global.`, `apac.`, `us.`, `eu.` prefixes and any inference-profile ARN. Lambdas get them as `BEDROCK_*_MODEL_ID` env vars (`lambda.tf`); `grep -rn 'modelId\|global\.\|inference-profile\|region' lambdas/ api/src/` for hard-coded IDs or regions.
- `locals.tf` `bedrock_model_arns`: exactly the two configured `foundation-model/` ARNs in `var.aws_region`. Any wildcard, any `inference-profile/` ARN, or any other region is a High finding (cross-region profiles route requests out of ap-southeast-1).
- Any `region =`, SDK client region or bucket region other than `ap-southeast-1` (e.g. `BACKUP_BUCKET_REGION` in `api/src/config.ts`) needs explicit user sign-off.

**5. Logging and audit**
- Account level (`security_services.tf`, behind `enable_security_services`): CloudTrail multi-region with log-file validation and S3 data events, GuardDuty, Security Hub FSBP, Inspector2, Macie, Config, Access Analyzer. VPC flow logs `traffic_type = "ALL"` (`cloudwatch.tf`). Retention `var.log_retention_days` (90 default; floci 1).
- App/Lambda logs: no document text, prompt/response bodies, business-case figures or personal data. `grep -rn 'log\.\(info\|warn\|error\|debug\)\|console\.\|print(\|logger\.' api/src lambdas` and check the payloads. Log IDs (tenderId, documentId, userId), not tender/customer names or emails.
- S3 keys must be built from IDs (see `api/src/lib/s3.ts` key helpers, `tenders/<tenderId>/...`); flag keys containing names.
- Audit log is append-only: `db/schema.sql` trigger `audit_entries_append_only`; `grep -rn 'UPDATE audit_entries\|DELETE FROM audit_entries\|DROP TRIGGER' api db`. Only inserts via `api/src/lib/audit.ts`.

**6. Secrets**
- Only Secrets Manager (`secrets.tf` app_config, db_role secrets, RDS-managed master secret). The EC2 app gets only ARNs (`DB_SECRET_ARN` = `db_role["app"]`, `APP_CONFIG_SECRET_ARN`) in the user_data env file (`ec2.tf`) and reads the values at start-up; Lambdas via `DB_SECRET_ARN`. No secret values in `.tf`, `envs/*/main.tf`, `*.tfvars`, Lambda `environment`, EC2 user_data, CodeBuild env vars, build artifacts or logs.
- `git ls-files | grep -iE '\.env$|tfstate|\.pem|\.key'` must be empty; `api/.env.example` must hold placeholders only. Secret-ARN outputs `sensitive = true`.

**7. API auth (`api/src/auth/`, `api/src/routes/`)**
- `registerAuth` resolves the user for every `/api/` URL; anything outside `/api/` (e.g. `/health`) is unauthenticated, so must expose nothing.
- Every mutating route calls `assertCan(req, '<perm>')` and/or `assertNotReadOnly(req)` from `rbac.ts`; reads of financial data check `viewFinancials`. Count per file: `grep -cE "app\.(get|post|put|patch|delete)\(" f` vs `grep -cE "assertCan|assertNotReadOnly|canDo" f`. Never rely on the UI hiding a button.
- `AUTH_MODE=dev` must stay blocked in production (`config.ts`); identity tokens must be signature-verified (never `decodeJwt` alone for authorization data); Cognito groups map via `GROUP_ROLE`.
- Auth is offline by design (`api/src/auth/index.ts`, `auth/jwks.ts`): tokens are verified only against the bundled `COGNITO_JWKS_PATH` keys through `BundledJwksCache`. Flag any change that fetches keys at runtime, falls back to decoding without verifying, or uses `x-amzn-oidc-data` claims for anything other than email/name of the same verified `sub`. Users are keyed by `cognito_sub`; an email already bound to another sub must stay refused. A Cognito interface endpoint does not help: user pools with a domain (needed by the ALB sign-in) are incompatible with PrivateLink.
- Every body/query validated with zod (`lib/validate.ts`); SQL parameterised.

## Review output format
Report findings sorted by severity, one block each:
```
[High|Medium|Low|Info] <title>
Where: <path>:<line>
Why:   <risk, who could exploit it, what data>
Fix:   <concrete change; note if it needs user sign-off>
```
End with "Checked, no issues" for checklist sections that passed, and state any assumption. Do not apply fixes during a review unless asked.
