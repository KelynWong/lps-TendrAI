# TendrAI demo hosting (terraform-demo)

Minimal AWS stack that hosts the built TendrAI demo as a static site for
**internal LPS users only**:

- **S3** (private, ap-southeast-1): holds the built app. No public access;
  CloudFront reads it via an Origin Access Control enforced by the bucket policy.
- **CloudFront**: HTTPS entry point, default *.cloudfront.net certificate,
  SPA fallback (404 -> index.html).
- **WAF (CloudFront scope, us-east-1)**: default **block** with a custom 401
  response; a single allow rule for the LPS egress CIDRs. Only traffic from the
  LPS network (offices + VPN) can load the page.

This folder is independent of `../terraform` (the full product architecture)
and targets **real AWS only** - Floci does not emulate CloudFront or WAF.

## Connect to your AWS account (one-time)

Terraform uses the standard AWS credential chain. Easiest path with the AWS CLI
(installed at `C:\Program Files\Amazon\AWSCLIV2\aws.exe` if `aws` is not on PATH):

```powershell
# Option A - access keys (personal/sandbox account):
# IAM console -> Users -> your user -> Security credentials -> Create access key
aws configure          # paste key id + secret, region ap-southeast-1, output json

# Option B - IAM Identity Center / SSO (typical corporate account):
aws configure sso      # follow the browser login
$env:AWS_PROFILE = "name-you-gave-the-profile"   # set in each new shell

# Verify before terraform touches anything:
aws sts get-caller-identity
```

When `get-caller-identity` prints your account id, Terraform will work with no
extra configuration. The credentials need rights for S3, CloudFront and WAFv2
(AdministratorAccess in a sandbox account is fine).

## Deploy

```powershell
# 1. Build the app
cd ..\app
npm run build

# 2. Configure access mode
cd ..\terraform-demo
copy demo.tfvars.example demo.tfvars
# default in the example: restrict_to_lps = false (PUBLIC demo, no WAF).
# Later: set restrict_to_lps = true + fill allowed_cidrs, apply again.

# 3. Deploy (note: quote -var-file in PowerShell)
terraform init
terraform plan '-var-file=demo.tfvars'
terraform apply '-var-file=demo.tfvars'
```

The `demo_url` output is the link to share.

**Public mode caveat:** with `restrict_to_lps = false` anyone who has the URL
can open the demo. The data is fictitious, so the exposure is the interface
itself; treat the URL as unlisted and flip the WAF on once IT provides the
CIDRs (just edit demo.tfvars and `terraform apply`).

## Updating the app

```powershell
cd ..\app; npm run build
cd ..\terraform-demo
terraform apply '-var-file=demo.tfvars'
# then run the invalidate_command output, e.g.:
# aws cloudfront create-invalidation --distribution-id EXXXX --paths "/*"
```

## Access control notes

- A user "cannot access" almost always means their public IP is not in
  `allowed_cidrs`: they are off-VPN, or an office egress range is missing.
  Blocked users see a plain **401**.
- 403 is deliberately NOT mapped to index.html; only S3 404s are. This stops
  the WAF block from ever serving the app shell to outsiders.
- To add a range: edit `demo.tfvars`, `terraform apply` (takes a minute or two
  to propagate through CloudFront).

## Teardown

```powershell
terraform destroy '-var-file=demo.tfvars'
```

`force_destroy = true` on the bucket lets destroy empty it. Cost while running
is a few cents: S3 storage for ~1 MB of assets plus CloudFront requests from a
handful of internal users.
