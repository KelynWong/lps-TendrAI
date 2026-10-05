# LPS TendrAI — Demo Guide

Run the app with `cd app && npm run dev` → http://localhost:5173

## Demo accounts

Password for **all** accounts: `Demo2026!`
(A "Demo accounts" link at the bottom of the login card fills these in with one click.)

| Email | Name | Role | Can do |
|---|---|---|---|
| `john.price@lpstech.com` | John Price | Bidding Manager | Upload tender documents, upload + download the submission form. **Cannot** edit line items. |
| `chee.wee@lpstech.com` | Chee Wee | Presales | Add/modify/remove **product** lines (hardware, software, third-party). Cannot approve. |
| `priya.nair@lpstech.com` | Priya Nair | Delivery | Add/modify/remove **labour** lines (roles, man-days). |
| `felicia.phan@lpstech.com` | Felicia Phan | Business Development | Edit both plans, export MSPO templates. |
| `ethan.lim@lpstech.com` | Ethan Lim | Business Sponsor | Edit lines, adjust DRB indirect costs, **approve/reject**. |
| `ecpuay@lpstech.com` | Eng Chuan Puay | Executive Sponsor | Everything, including **margins and day rates**. Approve/reject. |

## App structure

- **Dashboard** — pipeline overview; click any pursuit to jump into it.
- **Tenders** — the heart of the demo. List of active/recent tenders with a working
  upload zone. Opening a tender shows three sections tied to that pursuit:
  **Overview & Intake** (document details + processing pipeline), **Business Case**
  (the 7-tab workspace), **Submission Form** (upload the customer's form → auto-fill).
- **Historical Data** — the tagged knowledge base the AI retrieves from.
- **Audit Trail** — immutable log of every action in the session.

## Suggested demo flow (~12 min)

### 1. Live upload — show the workflow end to end (John Price)
1. Sign in as **John Price** → **Tenders**.
2. Drag **any file from your desktop** (a PDF/DOCX — content doesn't matter, name it
   something like `MOM-ITT-2026-Contact-Centre.pdf` beforehand for effect) onto the
   upload zone. A new tender appears instantly and opens with the pipeline **running
   live**: upload → extraction (watch the scanned annex fail and get retried without
   killing the run) → embeddings → retrieval of comparable past deals → draft generation.
3. When it finishes, the **Business Case** and **Submission Form** sections unlock —
   open the Business Case and show a fully costed draft appeared from one file drop.

### 2. The seeded flagship deal — depth (stay as John)
4. Back to **Tenders** → open **ITT/2026/014 National Contact Centre Modernisation**
   (the richer, curated example; also reachable from the Dashboard).
5. Business Case: 7 tabs mirroring the Excel template everyone knows. Hover the blue
   **◆ citation badges** — grounded figures name the past deal they came from with a
   similarity score. Amber **◇ Estimate** badges are unverified AI estimates, uncited.
6. Try to edit a cell as John — read-only (role enforcement).

### 2b. Formula tracing (any user)
- Hover any computed value or row/column header — **Summary row labels**, Cash Flow
  column headers, the TCV/EBITDA figures on Basic Info, plan totals — to see an
  Excel-style *fx* tooltip showing exactly how the cell is linked and calculated
  across tabs (e.g. Internal Labour = SUMIFS over the Resource Plan by quote line).
  Good moment to say: "the model is the same one Finance already trusts in Excel."

### 3. Live recalculation (Chee Wee, then Priya)
7. Sign out → **Chee Wee** (Presales) → same tender → Product Plan: change *Agent
   workstations* qty 520 → 700 or add a line. Flip to **Summary** / **Cash Flow** —
   everything recomputes instantly on the DRAFT, and a purple **"Unsaved changes"**
   bar appears naming the touched areas. Nothing is stored (or audited) until you
   click **Save changes**; **Discard** reverts. If the case is half approved, Save
   pops a confirmation that saving voids the approval. Workflow buttons (submit /
   approve) stay disabled while changes are unsaved.
8. Optionally **Priya Nair** for the same on Resource Plan man-days (and that she
   *can't* touch the product plan).

### 4. The Deal Review Board (Eng Chuan Puay)
9. **John Price** → Business Case → **Submit for DRB approval**.
10. **Eng Chuan Puay** → Basic Info: edit a **Margin %** (exec-only) — TCV/EBITDA move
    live; this is the DRB what-if moment. In Summary, adjust Travel & Expense. Every
    change lands in the **Audit Trail** with name + timestamp.
11. **✓ Approve business case (1 of 2)** - approval now requires **two sponsors**.
    After EC's approval an amber banner warns that any further edit clears it.
    Optional demo beat: edit one cell as EC, watch the approval reset land in the
    Audit Log, approve again.
12. Sign in as **Ethan Lim** (Business Sponsor) and add the **second approval** -
    only now does the status flip to *Approved · Locked* and every cell go
    read-only.

### 5. Submission form — upload & auto-fill (John Price)
12. Sign in as **John Price** → tender → **Submission Form**. It's now unlocked:
    **drag in any file** as "the customer's submission form" (fake is fine). The system
    shows it reading the form, then presents it **13 of 16 fields auto-filled** from the
    approved business case, with the three non-derivable fields (signatory, bank
    guarantee, company stamp) flagged in amber for manual completion.
13. **Download prefilled form (DOCX)** — opens in Word; note internal costs and EBITDA
    are never exported. Status becomes *Submitted*.

### 6. Wrap-up
14. **Felicia Phan** (or a sponsor): Business Case → **Export MSPO templates (.xlsx)** —
    a 7-tab workbook ready for manual MSPO upload.
15. **Historical Data**: tagging (Agency/Commercial, Won/Lost), a duplicate held for
    review, an extraction failure that notified its uploader, version archiving that
    keeps citations valid.
16. **Audit Trail**: scroll the immutable record of everything just done.

## Quick test checklist (before presenting)

- [ ] Wrong password shows "Incorrect username or password."
- [ ] Nav shows only: Dashboard · Tenders · Historical Data · Audit Trail.
- [ ] Dropping a file on Tenders creates a new tender and the pipeline animates; the
      Business Case / Submission Form sections are disabled until it completes.
- [ ] John Price: no editable cells anywhere.
- [ ] Chee Wee: can edit Product Plan, cannot edit Resource Plan or approve.
- [ ] Priya Nair: the reverse.
- [ ] Eng Chuan Puay: margin & day-rate cells editable; approve button visible while unlocked.
- [ ] Editing any cost → Summary/Cash Flow/TCV update immediately; Final Check reacts.
- [ ] One sponsor approval shows the amber "1 of 2" banner; an edit clears it (check Audit Log)
- [ ] Second sponsor approval (different user) → case locks; Submission Form section accepts an upload, shows the
      auto-filled 13/16 result, downloads a DOCX.
- [ ] MSPO export downloads an .xlsx with 7 tabs.
- [ ] Past tenders (Won/Lost/Awaiting result) open read-only with their own numbers.
- [ ] Refresh the browser = full reset to seed data (in-memory demo state — tell the
      audience; it's also your reset button between runs).

## Talking points if asked "is this real AI?"

The web app is a proof of concept for the workflow and UI: uploads are accepted but the
"generated" business case is a prepared draft, and the form-fill is simulated. The
production design behind it is real and sits in `terraform/`: Cognito sign-in (the login
screen mimics its hosted UI), documents in encrypted S3, Titan Text Embeddings V2 +
pgvector retrieval, Bedrock generation — all in ap-southeast-1, nothing public except
the WAF-fronted load balancer.

- After downloading the submission form (status Submitted), the tender outcome (Won / Lost / Awaiting result) is recorded manually via the dropdown in the tender header - it feeds the Dashboard and the historical record.
