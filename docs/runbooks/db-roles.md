# Runbook: bootstrap or rotate the database roles

## Purpose
Create the least-privilege Postgres login roles (`tendrai_app`, `tendrai_status_updater`, `tendrai_result_loader`), grant them access (`db/roles.sql`), and set each password from its Secrets Manager secret.

## When to use
- First deployment, after `db/schema.sql` has been applied.
- After every schema change, so new tables get their grants.
- After a password rotation (`db_role_password_version` bumped and applied).

## How it fits together
| Login role | Used by | Secret (Terraform) |
|---|---|---|
| `tendrai_app` | API server on EC2 (`DB_SECRET_ARN`) | `aws_secretsmanager_secret.db_role["app"]` |
| `tendrai_status_updater` | status updater Lambda | `db_role["status_updater"]` |
| `tendrai_result_loader` | result loader Lambda | `db_role["result_loader"]` |

Terraform generates each password with an ephemeral resource and writes it write-only, so it is never in state or plan output. The RDS master secret is readable only by operators: no app or Lambda role can read it. This runbook therefore runs on an operator's machine, with the operator's AWS credentials, through an SSM port-forward via the app instance.

## Prerequisites
- AWS CLI v2 and the Session Manager plugin (`winget install Amazon.SessionManagerPlugin`), signed in to the target account in `ap-southeast-1`.
- Your IAM identity can:
  - run `ssm:StartSession` on the app instance with `AWS-StartPortForwardingSessionToRemoteHost`;
  - call `secretsmanager:GetSecretValue` on the master secret and the three role secrets;
  - call `kms:Decrypt` on the data key.
- Node.js and `npm --prefix api install` done.
- Terraform outputs at hand: `rds_endpoint`, `db_master_secret_arn`, `db_role_secret_arns`, and an app instance id (`aws autoscaling describe-auto-scaling-groups`).

## Steps
1. Open the tunnel and leave this window running:
   ```powershell
   aws ssm start-session --target <app-instance-id> `
     --document-name AWS-StartPortForwardingSessionToRemoteHost `
     --parameters 'host=<rds-endpoint-hostname>,portNumber=5432,localPortNumber=15432'
   ```
2. In a second window, from the repo root:
   ```powershell
   $env:AWS_REGION = 'ap-southeast-1'
   $env:DB_HOST = 'localhost'; $env:DB_PORT = '15432'; $env:DB_NAME = 'tendrai'
   $env:DB_MASTER_SECRET_ARN = '<db_master_secret_arn>'
   $env:DB_APP_SECRET_ARN = '<db_role_secret_arns.app>'
   $env:DB_STATUS_UPDATER_SECRET_ARN = '<db_role_secret_arns.status_updater>'
   $env:DB_RESULT_LOADER_SECRET_ARN = '<db_role_secret_arns.result_loader>'
   npm --prefix api run db:roles
   ```
   Optional certificate check through the tunnel: set `DB_SSL_CA_PATH` to the RDS CA bundle and `DB_TLS_SERVERNAME` to the RDS endpoint hostname.
3. Restart the API so it reconnects with the new password:
   ```powershell
   aws ssm send-command --document-name AWS-RunShellScript --targets 'Key=tag:aws:autoscaling:groupName,Values=<asg-name>' `
     --parameters 'commands=["systemctl restart tendrai-app"]'
   ```
   The Lambdas read their secret on cold start. After a rotation, publish a new version or wait for the next cold start.

## Verification
- The script prints `db/roles.sql applied` and `<role>: password set from its secret` for each role. It never prints a password.
- The app's `/health` check is green behind the ALB, and processing a tender updates the job progress.

## Rotation
1. Bump `db_role_password_version` in `infra/envs/<env>/main.tf` (module input) and apply. This writes new passwords to the secrets.
2. Straight away, run steps 1–3 above. Between the apply and step 2, new database connections fail, because the database still holds the old passwords. Open connections keep working.

## Rollback
- Grants: edit `db/roles.sql` and re-run step 2. The file is idempotent.
- Passwords: there is no rollback. Re-run step 2 so the database matches the secrets again.

## Escalation
Database owner (platform team). Never hand out the master secret; run this runbook instead.
