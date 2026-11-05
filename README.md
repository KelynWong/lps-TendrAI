# LPS-P2C — TendrAI

Internal LPS tool that reads tender requirement documents (AI extraction of submission
requirements, qualification requirements and categorized clauses, plus compliance tables),
drafts a first business case from the tender pack with AI for the BD team to review and edit,
validates it against Final Check rules, supports the Deal Review Board (DRB) approval (each full
approval archives that business case version read-only and starts the next version as a copy),
and fills MSPO templates from the latest saved figures.

This is **V3**: the V2 interface with the V1 POC's AI-drafted business case. The frontend
implements it; the API, DB and Lambdas still implement V2's Excel business case upload until the
[V3 backend follow-up](docs/USER_GUIDE.md#v3-backend-follow-up) is done.

| Folder | What it is |
|---|---|
| [`frontend/`](frontend/) | React + TypeScript (Vite) web app (V3). The business case workspace is in `frontend/src/businessCase/`. Frozen earlier versions: the V1 POC in [`frontend/legacy/app-v1`](frontend/legacy/app-v1/) and V2 (Excel upload) in [`frontend/legacy/app-v2`](frontend/legacy/app-v2/). |
| [`api/`](api/) | Node.js + TypeScript API server (Fastify, REST + WebSocket) — see [api/README.md](api/README.md). |
| [`lambdas/`](lambdas/) | Tender-processing workflow Lambdas (Python): text extractors, normalizer, Bedrock analyser, result loader, status updater. |
| [`infra/`](infra/) | Terraform: `modules/tendrai` (the AWS stack) and `envs/{prod,floci,demo}` — see [infra/README.md](infra/README.md). |
| [`db/`](db/) | PostgreSQL schema, seed data and schema docs — see [db/README.md](db/README.md). |
| [`docs/`](docs/) | [User guide](docs/USER_GUIDE.md); [executive summary](docs/EXECUTIVE_SUMMARY.md); architecture, API and runbooks to follow. |

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
