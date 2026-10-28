# LPS-P2C — TendrAI

Internal LPS tool that reads tender requirement documents (AI extraction of submission
requirements, qualification requirements and categorized clauses, plus compliance tables),
validates uploaded Excel business cases against Final Check rules, supports the Deal Review
Board (DRB) workflow, and fills MSPO templates.

| Folder | What it is |
|---|---|
| [`frontend/`](frontend/) | React + TypeScript (Vite) web app. The V1 POC lives in [`frontend/legacy/app-v1`](frontend/legacy/app-v1/). |
| [`api/`](api/) | Node.js + TypeScript API server (Fastify, REST + WebSocket) — see [api/README.md](api/README.md). |
| [`lambdas/`](lambdas/) | Tender-processing workflow Lambdas (Python): text extractors, normalizer, Bedrock analyser, result loader, status updater. |
| [`infra/`](infra/) | Terraform: `modules/tendrai` (the AWS stack) and `envs/{prod,floci,demo}` — see [infra/README.md](infra/README.md). |
| [`db/`](db/) | PostgreSQL schema, seed data and schema docs — see [db/README.md](db/README.md). |
| [`docs/`](docs/) | [User guide](docs/USER_GUIDE.md); architecture, API and runbooks to follow. |

## Quick start

```powershell
# Frontend — http://localhost:5173
npm --prefix frontend install
npm --prefix frontend run dev

# API — http://localhost:8080 (copy api/.env.example to api/.env first)
npm --prefix api install
npm --prefix api run dev
```

Local infrastructure testing runs against the Floci emulator — see
[infra/README.md](infra/README.md#local-testing-with-floci).
