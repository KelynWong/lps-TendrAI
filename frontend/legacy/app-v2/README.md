# TendrAI V2 (legacy, frozen)

The V2 web app as it was before V3. Kept for reference; do not change it unless asked.

V2 used AI only to read the tender pack (submission documents, qualification requirements,
categorised clauses and compliance tables). The BD team built the business case in Excel and
**uploaded** it: each upload became a version, was parsed in the browser, checked against the
Final Check rules, and drove the DRB views and the MSPO templates. A workbook whose layout was
not recognised blocked MSPO generation.

V3 (`frontend/`) keeps the V2 interface but replaces the upload: TendrAI drafts the business
case from the tender pack as the last processing stage, and the BD team edits it in the
seven-tab workspace ported from the V1 POC (`frontend/legacy/app-v1`). See
[docs/USER_GUIDE.md](../../../docs/USER_GUIDE.md).

The API, DB schema and Lambdas still implement the V2 upload flow until the V3 backend
follow-up is done.

## Running

All data is in-memory demo data; refreshing resets it.

```powershell
npm --prefix frontend/legacy/app-v2 install
npm --prefix frontend/legacy/app-v2 run dev
```

Sign-in accounts and the shared password are in `src/config.ts`.
