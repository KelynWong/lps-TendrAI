# TendrAI — Terraform Infrastructure

Infrastructure-as-Code for **TendrAI**, an internal tender / business-case
generation system:

- Tender PDFs are uploaded and processed by the application on **EC2**.
- Embeddings via **Amazon Bedrock** (Titan Text Embeddings V2) are stored in
  **RDS PostgreSQL + pgvector**; generation uses **Bedrock (Claude)**.
- Documents live in **S3**; everything is encrypted at rest (**KMS CMKs**)
  and in transit (TLS); only the **ALB** is public-facing.
- Region is pinned to **ap-southeast-1** (data residency, NFR05) — a
  variable validation rejects any other region.

## Architecture → file mapping

| # | Diagram item | File(s) |
|---|--------------|---------|
| 1 | VPC 10.0.0.0/16, 2 AZs, public + private subnets, **no NAT** (PrivateLink egress) | `vpc.tf`, `security_groups.tf` |
| 2 | WAFv2 Web ACL (managed rules + rate limit) on the ALB | `waf.tf` |
| 3 | ACM certificate (DNS validated) + HTTPS listener, HTTP→HTTPS redirect | `acm.tf`, `alb.tf` |
| 4 | Cognito user pool / client / hosted UI / role groups + ALB `authenticate-cognito` | `cognito.tf`, `alb.tf` |
| 5 | EC2 launch template + ASG (min 1 / max 2), AL2023, IMDSv2, encrypted EBS, SSM (no SSH) | `ec2.tf`, `iam.tf` |
| 6 | RDS PostgreSQL 16 (gp3, KMS, private, TLS-forced), RDS-managed secret; pgvector via `CREATE EXTENSION vector` in the app | `rds.tf` |
| 7 | S3 `documents` + `cicd-artifacts` (KMS, versioning, public-access block, TLS-only) + S3 gateway endpoint | `s3.tf`, `endpoints.tf` |
| 8 | Interface VPC endpoints: bedrock-runtime, secretsmanager, kms, logs, monitoring, ssm, ssmmessages, ec2messages | `endpoints.tf` |
| 9 | Bedrock least-privilege IAM (`InvokeModel*` on Titan Embed V2 + Claude only, ap-southeast-1) | `iam.tf` |
| 10 | Two KMS CMKs with rotation: data (S3/EBS/RDS/Secrets) and logs/audit (CloudWatch/CloudTrail) | `kms.tf` |
| 11 | CloudWatch log groups, VPC flow logs, alarms (ALB 5xx, RDS CPU/storage, unhealthy hosts) + SNS | `cloudwatch.tf` |
| 12 | CI/CD: CodeStar Connection (GitHub) → CodePipeline → CodeBuild → CodeDeploy (onto the ASG) | `cicd.tf` |
| 13 | GuardDuty, Security Hub (FSBP standard), Inspector2 (EC2), CloudTrail (multi-region, log-file validation, KMS) | `security_services.tf`, `s3.tf` (audit bucket) |
| 14 | Secrets Manager: app config placeholder + RDS-managed DB secret | `secrets.tf`, `rds.tf` |

Supporting files: `versions.tf`, `providers.tf`, `variables.tf`, `locals.tf`,
`outputs.tf`, `common.tfvars`, `floci.tfvars`, `prod.tfvars`,
`docker-compose.floci.yml`.

## Feature flags

Expensive or emulator-fragile groups are gated by booleans (default **true**;
`floci.tfvars` manages them for local testing):

| Variable | Gates | Behaviour when `false` |
|----------|-------|------------------------|
| `enable_waf` | WAFv2 Web ACL + ALB association | No WAF |
| `enable_acm` | ACM cert, HTTPS listener, HTTP redirect | ALB serves plain HTTP :80 |
| `enable_cognito` | User pool, client, domain, groups, ALB auth action | Listener forwards without authentication (Cognito auth requires the HTTPS listener, so it also needs `enable_acm = true`) |
| `enable_cicd` | Connection, pipeline, CodeBuild, CodeDeploy + their IAM roles | No pipeline |
| `enable_security_services` | GuardDuty, Security Hub, Inspector2, CloudTrail + audit bucket | None created |
| `enable_multi_az` | RDS Multi-AZ | Single-AZ instance |

## Prerequisites

- **Terraform ≥ 1.6** — `winget install HashiCorp.Terraform` or
  `choco install terraform`
- **Docker Desktop** (for Floci)
- **AWS CLI v2** (for real deployments) — `winget install Amazon.AWSCLI`

## Local testing with Floci

Local testing uses [Floci](https://floci.io/aws/) — an MIT-licensed AWS
emulator (no auth token, all services unlocked, free for commercial use).
All commands run **on your machine** (PowerShell), never inside the container —
the container is the fake AWS endpoint on `localhost:4566`; Terraform is the
client talking to it.

```powershell
cd terraform

# 1. Start Floci
docker compose -f docker-compose.floci.yml up -d

# 2. Activate the emulator provider override (gitignored copy; first time only)
copy floci_override.tf.example floci_override.tf

# 3. Plain terraform, pointed at localhost:4566 by the override
terraform init
terraform plan  -var-file=common.tfvars -var-file=floci.tfvars
terraform apply -var-file=common.tfvars -var-file=floci.tfvars

# 4. Tear down
terraform destroy -var-file=common.tfvars -var-file=floci.tfvars
docker compose -f docker-compose.floci.yml down
```

For a full **fresh-start cycle** — destroy, wipe the emulator (including the
sidecar containers compose doesn't own), start clean, delete the default VPC
so the console shows only TendrAI resources, apply, and re-pin the web console
to ap-southeast-1 — run:

```powershell
.\reset-floci.ps1               # full cycle
.\reset-floci.ps1 -SkipDestroy  # emulator already gone/broken; just rebuild
```

For a full **fresh-start cycle** (destroy -> wipe emulator -> clean start ->
remove the default VPC -> apply -> re-pin the console region) run:

```powershell
.eset-floci.ps1
```

> ⚠ Delete `floci_override.tf` (or rename it back to `.example`) before
> deploying to real AWS — while it exists, every terraform command targets
> the emulator.

Notes:

- Floci auto-launches a web console (sidecar container `floci/floci-ui`) at
  **http://localhost:4500/console/aws** — a resource browser for the emulator.
  **Known quirk:** the sidecar is spawned hardcoded to us-east-1, so it shows
  only default resources. Re-pin it to ap-southeast-1 after each stack start:

  ```powershell
  docker rm -f floci-ui
  docker run -d --name floci-ui --network terraform_default -p 4500:4500 `
    -e AWS_DEFAULT_REGION=ap-southeast-1 -e AWS_REGION=ap-southeast-1 `
    -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_SESSION_TOKEN=test `
    -e FLOCI_HOSTNAME=172.18.0.2 -e FLOCI_ENDPOINT=http://172.18.0.2:4566 `
    -e AWS_ENDPOINT_URL=http://172.18.0.2:4566 -e PORT=4500 -e FLOCI_CLOUD=aws `
    floci/floci-ui:latest
  ```

- `common.tfvars` holds the values shared by every environment — naming
  prefix (`project = "tendrai"`), the `Project = TendrAI` tag, region and VPC
  layout. Always pass it before the environment file.
- Floci advertises support for Cognito, ACM, WAFv2, the CodePipeline family
  and the security services, so `floci.tfvars` starts with WAF/Cognito/ACM
  **on** and CI/CD + security services **off** — flip them on to probe
  emulation depth; if a service errors on apply, flip its flag back off.
- **Bedrock** has no emulation anywhere; only an IAM policy is created, which
  is harmless locally.
- The AL2023 AMI SSM lookup cannot resolve against an emulator, so
  `floci.tfvars` pins a dummy `ami_id`.
- Emulated EC2 is API-level: instances are records, not booted VMs — the web
  app cannot be browsed "inside" emulated EC2. Run it locally (`npm run dev`),
  or host its static build on emulated S3 for an end-to-end deploy story.

## Deploying to real AWS

```powershell
aws configure            # credentials for the target account; region ap-southeast-1
cd terraform
del floci_override.tf    # IMPORTANT — stop targeting the emulator

terraform init
terraform plan  -var-file=common.tfvars -var-file=prod.tfvars
terraform apply -var-file=common.tfvars -var-file=prod.tfvars
```

Before/after the first apply:

1. **Edit `prod.tfvars`**: `domain_name`, `route53_zone_id` (or create the
   CNAMEs from the `acm_validation_records` output manually), `github_owner`
   / `github_repo`, `alarm_email`.
2. **DNS**: point `domain_name` at the ALB (`alb_dns_name` output).
3. **CodeStar connection**: finish the one-time GitHub OAuth handshake in the
   console (Developer Tools → Settings → Connections → *Update pending
   connection*), otherwise the pipeline's Source stage stays stuck.
4. **Bedrock model access**: enable Titan Text Embeddings V2 and the Claude
   models in the Bedrock console (ap-southeast-1) — model access is an
   account-level toggle, not a Terraform resource.
5. **pgvector**: after the app can reach the DB, it runs
   `CREATE EXTENSION IF NOT EXISTS vector;` (extension binaries ship with
   RDS PostgreSQL — nothing to do in Terraform).
6. **Secrets**: fill in the real values of the app-config secret
   (`app_config_secret_arn` output); DB credentials are generated and
   rotated by RDS in Secrets Manager (`db_master_secret_arn`).
7. **State backend**: state is local by default. For team use add an S3
   backend (S3 bucket + DynamoDB lock table or S3 lockfile) in `versions.tf`.

## Security posture summary

- Encryption at rest: two customer-managed KMS keys (rotation on) cover S3,
  EBS, RDS, Secrets Manager, CloudWatch Logs, CloudTrail and SNS.
- Encryption in transit: TLS-only S3 bucket policies, `rds.force_ssl = 1`,
  ALB TLS 1.2/1.3 policy with HTTP→HTTPS redirect.
- Network: only the ALB is internet-facing; app and DB sit in private
  subnets with **no NAT** — egress is exclusively via VPC endpoints.
- Access: no SSH/key pairs (SSM Session Manager), IMDSv2 enforced,
  least-privilege IAM (Bedrock limited to two model families in
  ap-southeast-1).
- Audit: CloudTrail multi-region with log-file validation (immutable trail),
  S3 object-level logging on the documents bucket, VPC flow logs, GuardDuty,
  Security Hub FSBP, Inspector2.
