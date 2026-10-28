# TendrAI — Terraform Infrastructure

Infrastructure-as-Code for **TendrAI**, an internal tender / business-case
generation system, matching the current architecture diagram:

- Users reach the web app through **WAF → ALB (ACM TLS, Cognito auth) → EC2**
  (an Auto Scaling group running the web application and API server
  together); the app stores tender documents in **S3** and metadata in
  **RDS PostgreSQL (pgvector)**, reading secrets from **Secrets Manager**.
- For every uploaded tender the app **queues a job on SQS**. An **EventBridge
  Pipe** starts a **Step Functions** workflow that extracts text (**Textract**
  for PDFs, Lambdas for Word/Excel), normalises it, prompts **Bedrock**
  (clauses & categories, submission and qualification requirements, draft
  submission documents) and loads the results into RDS — calling a
  **status-updater Lambda** after each step.
- Everything is encrypted at rest (**KMS CMKs**) and in transit (TLS); the
  private tiers have **no NAT** — AWS services are reached over the **S3
  gateway endpoint** and **PrivateLink**. Only the ALB is public-facing.
- **CodeConnections (GitHub/GitLab) → CodePipeline → CodeBuild → CodeDeploy**
  performs in-place deployments onto the EC2 Auto Scaling group (the
  CodeDeploy agent pulls each revision from S3); CodeBuild also updates the
  workflow Lambda code.
- Region is pinned to **ap-southeast-1** (data residency, NFR05) — a
  variable validation rejects any other region.

## Architecture → file mapping

| # | Diagram item | File(s) |
|---|--------------|---------|
| 1 | WAFv2 Web ACL (managed rules + rate limit) on the ALB | `waf.tf` |
| 2 | Public subnets, Application Load Balancer + security group (HTTPS 443; 80 only redirects), one instance target group | `alb.tf`, `security_groups.tf` |
| 3 | Cognito user pool / client / hosted UI / role groups + ALB `authenticate-cognito` | `cognito.tf`, `alb.tf` |
| 4 | **EC2** launch template (AL2023, IMDSv2, encrypted EBS, no key pair) + Auto Scaling group in the private subnets, CPU target tracking, instance role/profile, app security group (ALB only) | `ec2.tf`, `iam.tf`, `security_groups.tf` |
| 5 | RDS PostgreSQL 16 (gp3, KMS, private, TLS-forced, Multi-AZ), RDS-managed secret | `rds.tf` |
| 6 | Secrets Manager (app config + per-role DB secrets) reached via PrivateLink | `secrets.tf`, `endpoints.tf` |
| 7 | SQS tender-jobs queue + DLQ (KMS, TLS-only) reached via PrivateLink | `sqs.tf` |
| 8 | EventBridge Pipe: SQS → Step Functions (batch size 1) | `sqs.tf`, `iam.tf` |
| 9 | Step Functions tender-processing state machine (ASL definition, logging, X-Ray) | `step_functions.tf`, `statemachine/tender_processing.asl.json` |
| 10 | S3 documents bucket (uploads, extracted, normalized, drafts) + S3 gateway endpoint | `s3.tf`, `endpoints.tf` |
| 11 | S3 Glacier — lifecycle transitions on the documents bucket | `s3.tf` |
| 12, 13 | Text-extractor Lambdas (Word, Excel) in the workflow subnets; Textract for PDFs (called by Step Functions) | `lambda.tf`, `lambda/`, `statemachine/` |
| 14, 15, 17 | Text-normalizer, analyser (Bedrock) and result-loader Lambdas | `lambda.tf`, `lambda/`, `iam.tf` |
| — | Status-updater Lambda (app private subnet) called after every step | `lambda.tf`, `lambda/status_updater/` |
| 16 | Bedrock least-privilege IAM (`InvokeModel*` on approved models only) + `bedrock-runtime` PrivateLink | `iam.tf`, `locals.tf`, `endpoints.tf` |
| 18, 19 | Two KMS CMKs with rotation: data (S3/RDS/Secrets/SQS/EBS/Lambda/Textract) and logs (CloudWatch/CloudTrail/Config/SNS) | `kms.tf` |
| 20 | CloudWatch log groups, VPC flow logs, alarms (ALB, EC2/ASG: CPU, status checks, no healthy hosts; RDS, DLQ, failed executions, Lambda errors) + SNS | `cloudwatch.tf` |
| 21 | IAM roles: EC2 app instance, per-Lambda, Step Functions, Pipes, Flow Logs, CI/CD | `iam.tf`, `cicd.tf` |
| 22, 24 | CI/CD: CodeConnections (GitHub/GitLab) → CodePipeline → CodeBuild (+ Lambda code update) → CodeDeploy (EC2 in-place onto the ASG) | `cicd.tf` |
| 23 | ACM certificate (DNS validated) + HTTPS listener, HTTP→HTTPS redirect | `acm.tf`, `alb.tf` |
| 25–31 | Account-wide: GuardDuty, Security Hub (FSBP), Inspector2 (EC2 + Lambda), CloudTrail, Macie, AWS Config (+ rules), IAM Access Analyzer | `security_services.tf`, `s3.tf` (audit bucket) |
| — | VPC 172.16.0.0/16, 2 AZs, public / private / workflow subnets, **no NAT** | `vpc.tf`, `locals.tf` |

All files in the table live in `modules/tendrai/`, alongside its
`versions.tf`, `variables.tf`, `locals.tf`, `outputs.tf` and `statemachine/`.
Lambda handler code lives in `lambdas/` at the repo root.

## Layout

```
infra/
  modules/
    tendrai/          the whole product stack as one module (inputs: variables.tf)
  envs/
    prod/             real AWS: provider, backend, module inputs, outputs
    floci/            local emulator: provider pointed at localhost:4566,
                      docker-compose.floci.yml, reset-floci.ps1, floci-inventory.ps1,
                      moved.tf (re-addresses the pre-module state)
    demo/             standalone static-site hosting for the V1 POC (S3 + CloudFront + WAF)
```

Each env is its own Terraform root with its own state. Module inputs are set
directly in `envs/<env>/main.tf`, so there are no `-var-file` flags. Run every
command with `-chdir`:

```powershell
terraform fmt -check -recursive infra
terraform -chdir=infra/envs/<env> init
terraform -chdir=infra/envs/<env> validate
terraform -chdir=infra/envs/<env> plan
```

Splitting `modules/tendrai` into smaller modules (network, data, compute,
workflow, security, CI/CD) is planned. When that happens, add `moved` blocks
to each env so existing state follows.

## Tender-processing workflow

```
EC2 app ──SendMessage (after commit)──▶ SQS tender-jobs ──EventBridge Pipe──▶ Step Functions
                                                                                  │
  stage 1  MarkReadingDocuments ──▶ ExtractDocuments [Map per document]
             textReady  → reuse textPrefix from the previous run
             pdf        → Textract (OutputConfig → extracted/<tenderId>/<documentId>/textract/)
             doc/docx   → text-extractor-word Lambda  → extracted/<tenderId>/<documentId>/word/
             xls/xlsx/csv → text-extractor-excel Lambda → extracted/<tenderId>/<documentId>/excel/
             any error  → that document Failed (the run continues)
           ReportDocuments (per-document status)
           mode = retry-document? → MarkCompleted (extract only; tender flagged out of date)
           NormalizeText → normalized/<tenderId>/<jobId>/tender.json   (no readable text → MarkFailed)
  stage 2  AnalyseOverview                  ┐
  stage 3  AnalyseSubmissionRequirements    │ analyser Lambda → Bedrock
  stage 4  AnalyseQualificationRequirements │ → analysis/<tenderId>/<jobId>/<task>.json
  stage 5  AnalyseClauses                   ┘
  stage 6  LoadResults (result-loader Lambda → RDS: overview, checklist, qualifications, clauses)
           MarkCompletedWithResults ──▶ Succeed        any step failure → MarkFailed → Fail
```

Stages 1–6 are `PROCESS_STAGES` in `api/src/types.ts`. Every status update
sends the status-updater Lambda the body of the API's
`POST /internal/jobs/:jobId/progress` (`api/src/routes/processing.ts`).
Only ids, S3 keys and counts pass between states, never document text.

SQS message contract (source of truth: `TenderJobMessage` in `api/src/lib/sqs.ts`):

```json
{ "tenderId": "<uuid>", "jobId": "<uuid>",
  "mode": "process | reprocess | retry-document",
  "requestedBy": "<user uuid>",
  "documents": [ { "documentId": "<uuid>",
                   "key": "tenders/<tenderId>/pack/<documentId>/source.pdf",
                   "fileType": "pdf", "textReady": false, "textPrefix": null } ] }
```

The status-updater Lambda writes progress straight to RDS as the
`tendrai_status_updater` role (`db/roles.sql`). Its writes must stay identical
to the API's progress endpoint, which remains for local runs; see the
`processing-workflow` skill.

The handlers under `lambdas/<function>/handler.py` (repo root) are **placeholders** that
document each function's input/output contract and return stub results so
the workflow runs end-to-end. Replace them with the real implementation (same
zip layout: `handler.lambda_handler`).

## Feature flags

Expensive or emulator-fragile groups are gated by booleans (default **true**;
`envs/floci/main.tf` manages them for local testing):

| Variable | Gates | Behaviour when `false` |
|----------|-------|------------------------|
| `enable_waf` | WAFv2 Web ACL + ALB association | No WAF |
| `enable_acm` | ACM cert, HTTPS listener, HTTP redirect | ALB serves plain HTTP :80 |
| `enable_cognito` | User pool, client, domain, groups, ALB auth action | Listener forwards without authentication (needs `enable_acm = true`) |
| `enable_cicd` | Connection, pipeline, CodeBuild, CodeDeploy (EC2 in-place) + IAM roles | No pipeline; instances boot with no release until one is installed by hand (SSM) |
| `enable_security_services` | GuardDuty, Security Hub, Inspector2, CloudTrail, Macie, Config, Access Analyzer + audit bucket | None created |
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
cd infra\envs\floci

# 1. Start Floci
docker compose -f docker-compose.floci.yml up -d

# 2. Plain terraform; provider.tf in this folder points at localhost:4566
terraform init
terraform plan
terraform apply

# 3. Tear down
terraform destroy
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

The emulator provider exists only in `envs/floci`, so nothing in that
folder can reach real AWS. (This replaces the old `floci_override.tf`, which
had to be deleted before every real deployment.)

Notes:

- Floci auto-launches a web console (sidecar container `floci/floci-ui`) at
  **http://localhost:4500/console/aws** — a resource browser for the emulator.
  **Known quirk:** the sidecar is spawned hardcoded to us-east-1, so it shows
  only default resources. Re-pin it to ap-southeast-1 after each stack start:

  ```powershell
  docker rm -f floci-ui
  docker run -d --name floci-ui --network tendrai_default -p 4500:4500 `
    -e AWS_DEFAULT_REGION=ap-southeast-1 -e AWS_REGION=ap-southeast-1 `
    -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_SESSION_TOKEN=test `
    -e FLOCI_HOSTNAME=172.18.0.2 -e FLOCI_ENDPOINT=http://172.18.0.2:4566 `
    -e AWS_ENDPOINT_URL=http://172.18.0.2:4566 -e PORT=4500 -e FLOCI_CLOUD=aws `
    floci/floci-ui:latest
  ```

- The values shared by every environment — naming prefix
  (`project = "tendrai"`), the `Project = TendrAI` tag, region and VPC
  layout — are the `locals` at the top of each `envs/<env>/main.tf`. Keep
  them identical across envs.
- **Bedrock, Textract and EventBridge Pipes** have no emulation; their IAM
  policies and resource records are created but never exercised locally.
- Emulated EC2 is API-level: instances are records, not running VMs — the
  web app cannot be browsed "inside" the emulated Auto Scaling group. Run it
  locally (`npm run dev`), or host its static build on emulated S3 for an
  end-to-end deploy story. `envs/floci/main.tf` pins a placeholder `ami_id`
  because the emulator cannot resolve the public AL2023 AMI SSM parameter.

## Deploying to real AWS

```powershell
aws configure            # credentials for the target account; region ap-southeast-1
terraform -chdir=infra/envs/prod init
terraform -chdir=infra/envs/prod plan
terraform -chdir=infra/envs/prod apply
```

Before/after the first apply:

1. **Edit `envs/prod/main.tf`**: `domain_name`, `route53_zone_id` (or create the
   CNAMEs from the `acm_validation_records` output manually),
   `source_provider_type` / `source_repo_owner` / `source_repo_name`,
   `alarm_email`, EC2 (`instance_type`, `asg_*`) and Lambda sizing.
2. **Auto Scaling service-linked role**: the data CMK's key policy names
   `AWSServiceRoleForAutoScaling` so the ASG can launch instances with
   encrypted EBS. It exists in any account that has used EC2 Auto Scaling;
   in a brand-new account create it once before the first apply:
   `aws iam create-service-linked-role --aws-service-name autoscaling.amazonaws.com`.
3. **DNS**: point `domain_name` at the ALB (`alb_dns_name` output).
4. **CodeConnections connection**: finish the one-time GitHub/GitLab OAuth
   handshake in the console (Developer Tools → Settings → Connections →
   *Update pending connection*), otherwise the pipeline's Source stage stays
   stuck.
5. **First release**: instances boot with Node.js 22, the CloudWatch agent,
   the CodeDeploy agent and an enabled-but-empty `tendrai-app` systemd unit
   (`ec2.tf` user_data); there is no app on them until the pipeline's first
   CodeDeploy deployment. Until then the target group health check fails and
   the ASG may replace instances — expected. Later scale-out instances get the
   last successful revision automatically (CodeDeploy lifecycle hook).
6. **buildspec.yml** in the application repo must:
   - output a CodeDeploy EC2 revision: `appspec.yml` (files →
     `/opt/tendrai/app`; hooks that stop/start `tendrai-app` and a
     `ValidateService` check of `/health`), `dist/`, production
     `node_modules/`, `package.json` and `certs/rds-global-bundle.pem`
     (`DB_SSL_CA_PATH`; the instances have no internet access to fetch it)
     and `certs/cognito-jwks.json` from `npm --prefix api run fetch:jwks`
     (`COGNITO_JWKS_PATH`: the user pool's public signing keys the API
     verifies sign-in tokens against; fail the build if it is missing);
   - update the workflow Lambdas with `aws lambda update-function-code`.
   CodeBuild receives `ENVIRONMENT`, `AWS_ACCOUNT_ID`, `APP_PORT`,
   `APP_INSTALL_DIR` and the function names as `LAMBDA_STATUS_UPDATER`,
   `LAMBDA_TEXT_EXTRACTOR_WORD`, `LAMBDA_TEXT_EXTRACTOR_EXCEL`,
   `LAMBDA_TEXT_NORMALIZER`, `LAMBDA_ANALYSER`, `LAMBDA_RESULT_LOADER`.
   Note that a later `terraform apply` re-uploads the Lambda zips packaged
   from `lambdas/`.
7. **Bedrock model access**: enable Titan Text Embeddings V2 and the Claude
   models in the Bedrock console (ap-southeast-1) — model access is an
   account-level toggle, not a Terraform resource.
8. **Lambda code**: replace the placeholder handlers under `lambdas/` (or
   deploy real packages through the pipeline); the workflow contract is
   documented in each handler's docstring.
9. **pgvector**: after the app can reach the DB, it runs
   `CREATE EXTENSION IF NOT EXISTS vector;` (extension binaries ship with
   RDS PostgreSQL — nothing to do in Terraform).
10. **Secrets**: fill in the real values of the app-config secret
    (`app_config_secret_arn` output). The master credentials are generated
    and rotated by RDS (`db_master_secret_arn`, operators only); the app and
    the DB Lambdas log in with their own `db_role` secrets — apply them in
    Postgres with `npm --prefix api run db:roles`. The instances get only the
    secret ARNs (`DB_SECRET_ARN`, `APP_CONFIG_SECRET_ARN`) and read the values
    at start-up.
11. **Shell access**: `aws ssm start-session --target <instance-id>` (Session
    Manager; there is no SSH or key pair).
12. **State backend**: state is local by default. For team use enable the S3
    backend block in `envs/prod/versions.tf`.

### Migrating from earlier stacks

- **ECS Fargate revision → EC2**: expect `terraform plan` to destroy the ECS
  cluster, service, task definition, service auto scaling, ECR repository,
  the ECS IAM roles and the ECR interface endpoints, and to replace the
  blue/green target groups (now one instance target group), the app security
  group and the CodeDeploy application (compute platform `ECS` → `Server`).
  The ECR repository has `force_delete = false`, so delete its images first
  if any were pushed. VPC, subnets, ALB and RDS are kept.
- **Original flat `terraform/` root**: it ran the app on an EC2 Auto Scaling
  group in a 10.0.0.0/16 VPC. Changing the VPC CIDR replaces the VPC and
  everything in it, including **the VPC, subnets, ALB and RDS**. Take an RDS
  snapshot first (or keep `vpc_cidr = "10.0.0.0/16"` in `envs/<env>/main.tf`
  to retain the network).

## Security posture summary

- Encryption at rest: two customer-managed KMS keys (rotation on) cover S3,
  RDS, Secrets Manager, SQS, EBS volumes, Lambda environment variables,
  Textract output, CloudWatch Logs, CloudTrail, AWS Config and SNS.
- Encryption in transit: TLS-only S3 bucket and SQS queue policies,
  `rds.force_ssl = 1`, ALB TLS 1.2/1.3 policy with HTTP→HTTPS redirect.
- Network: only the ALB is internet-facing (HTTPS 443; port 80 only
  redirects); EC2 instances, Lambdas and RDS sit in private subnets with
  **no NAT** — egress is exclusively via VPC endpoints. The EC2 security
  group admits only the ALB on the app port; RDS admits only the EC2 app and
  the status-updater / result-loader Lambdas. One security group per
  component with referenced-SG rules only.
- Access: no SSH, no port 22 and no key pairs (Session Manager only), IMDSv2
  required; least-privilege IAM per role — the EC2 role reads only its own
  DB role secret and the app-config secret (never the RDS master secret);
  Lambdas get only the S3 / secret / Bedrock access their flag in
  `locals.lambda_functions` grants; Bedrock limited to approved models in
  ap-southeast-1; service roles carry `aws:SourceAccount` / `aws:SourceArn`
  confused-deputy conditions.
- Audit: CloudTrail multi-region with log-file validation (immutable trail),
  S3 object-level logging on the documents bucket, VPC flow logs, GuardDuty,
  Security Hub FSBP, Inspector2 (EC2 + Lambda), Macie, AWS Config rules
  (incl. IMDSv2 and encrypted volumes), IAM Access Analyzer.
