# LPS-P2C — TendrAI

Turns a tender requirement document into a first-cut business case, supports the Deal Review
Board (DRB) workflow, and auto-populates the tender submission form and MSPO templates.

This repository contains two deliverables:

| Folder | What it is |
|---|---|
| [`terraform/`](terraform/) | Infrastructure-as-Code for the AWS architecture (WAF → ALB + Cognito → EC2 → RDS pgvector, S3, Bedrock, CI/CD, GuardDuty/SecurityHub/Inspector/CloudTrail). Testable locally with **LocalStack + tflocal** before touching AWS — see [terraform/README.md](terraform/README.md). |
| [`app/`](app/) | React (Vite + TypeScript) proof-of-concept UI. All data is **hardcoded and fictitious** — it demonstrates the intended workflow and screens, not a live backend. |

## Running the POC web app

```bash
cd app
npm install
npm run dev     # http://localhost:5173
```

**Demo script and login credentials: see [DEMO_GUIDE.md](DEMO_GUIDE.md).**

### What the POC demonstrates

- **Sign-in screen** (mimics the Cognito hosted UI; all accounts use password `Demo2026!`) —
  permissions follow the stakeholder matrix: Bidding Manager uploads/submits, Presales edits
  procurement, Delivery edits labour, BD edits both + exports MSPO, Sponsors approve/reject,
  Executive Sponsor also edits rates and margins.
- **Tenders hub** — list of pursuits with a working upload zone: dropping any file
  creates a new tender, runs the simulated processing pipeline (extraction → Titan
  embeddings → pgvector retrieval → Bedrock generation, including a partial-failure
  retry per NFR07) and produces a draft business case. Each tender ties together its
  intake details, business case and submission form.
- **Business Case workspace** — the 7 sub-tabs of the Excel template (FR17):
  Basic Info, Summary, Cash Flow, Product Plan, Resource Plan, Working, Labour Inputs,
  plus a live **Final Check!** panel replicating the template's validations (FR15).
- **Live recalculation** (NFR11) — edit a quantity, unit cost, man-day or margin and watch
  Summary / Cash Flow / TCV / EBITDA recompute, using the template's logic
  (4% contingency, 4%/2% inflation with vendor-commitment exemption, finance cost from
  negative cash positions).
- **AI provenance** (NFR12/13, FR16) — every AI-populated value carries a badge:
  ◆ grounded with citation to a historical record, ◇ unverified industry estimate,
  ✓ human-confirmed (set automatically when a user edits a cell).
- **DRB workflow** (FR19/FR20) — submit → approve (locks all edits) → submission form
  unlock (FR21), prefilled DOCX download (FR22/23), MSPO 7-tab XLSX export (FR24).
- **Historical Data store** (FR02–FR11) — tagged documents, duplicate flagging,
  extraction-failure notification, archived versions.
- **Audit Log** (FR25/NFR06) — every action in the session is appended, immutable.

## Deploying the infrastructure

See [terraform/README.md](terraform/README.md). Short version:

```bash
# Local test (no AWS account needed)
cd terraform
docker compose -f docker-compose.localstack.yml up -d
pip install terraform-local          # provides tflocal
tflocal init
tflocal plan -var-file=localstack.tfvars

# Real AWS
terraform init
terraform plan -var-file=prod.tfvars
```

LocalStack Community does not emulate Bedrock, WAF, Cognito, ACM, CodePipeline or the
account-wide security services — those are behind `enable_*` flags that
`localstack.tfvars` switches off.

## Known simplifications in the POC

- 3-fiscal-year horizon (the template supports 15); cash-flow payment timing uses simple
  allocation rules instead of manual monthly entry.
- TCV is derived as direct cost × (1 + margin) per quote line (the template's Working-tab
  approach); the template also allows top-down TCV entry per category.
- Labour Inputs monthly distribution is even within each FY and read-only.
- Exchange rates are display-only; everything is priced in SGD.
- No backend: state lives in memory and resets on refresh.
