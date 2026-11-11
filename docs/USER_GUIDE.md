# TendrAI user guide

TendrAI helps LPS teams prepare tender responses. It does three things:

- **Reads the Tender pack.** The AI extracts the submission requirements, qualification requirements and categorized Clauses from the tender Documents. Every extracted item links back to its source. You set compliance on each Clause and export the compliance table.
- **Drafts the Business case.** The last processing stage drafts a first Business case (Version 1) from the Tender pack and comparable past business cases. It has the seven tabs of the business case template: Basic Info, Summary, Cash Flow, Product Plan, Resource Plan, Working and Labour Inputs. Every AI-drafted value is either **Cited** (to a historical record or the Tender pack) or marked as an **Estimate** until a person confirms it. The BD team reviews and edits the draft and saves its changes. A new Version starts only when the DRB has fully approved the current one. TendrAI runs the Final Check rules against the draft as you edit and against every saved Version. No Excel upload is needed.
- **Fills the MSPO templates.** The product, resource and billing plans are pre-filled from the latest saved Version for download.

A failed Final Check only warns you. It never blocks anything. The AI only ever writes Version 1: it never changes a Version a person saved, and reprocessing a tender never replaces its Business case.

## Demo note

The current build is a demo that runs entirely in your browser:

- All data is mock data held in memory. **Refreshing the page resets everything**, including your uploads and edits.
- "AI" results are pre-built sample results. Processing runs through the real stages, but faster than the live system. The drafted Business case uses a fixed set of sample lines, sized per tender and cited against the tender's own Clauses. All figures are fictitious.
- Sign-in uses built-in demo accounts. On the sign-in page, click **Demo accounts** and pick a person. That fills in the **Email** and the shared demo password, which is shown in the same panel. Then click **Sign in**.

## Roles

Your role is shown under your name in the top-right user menu. Buttons your role cannot use appear greyed out. Hover over one to see why.

| Role (account label) | What you can do |
|---|---|
| Bidding Manager | Create, edit and delete tenders. Change a tender's status. Upload, process, reorder, classify and delete Tender pack Documents. Edit Clauses and compliance. Find suitable templates, select templates and generate first drafts. Find and link certificates. Manage the template library. |
| Business Development (BD) | Edit Clauses and compliance. Review and edit the AI-drafted Business case and save changes to the working Version. Edit MSPO details and mapping, and download the MSPO templates. Manage the template library. Manage Final Check rules and MSPO mapping defaults. Archive and restore records in Historical data. |
| Presales, Delivery | Edit Clauses (category, compliance and remarks). View everything else. |
| Finance | Read-only on every tender. Also sees the **Total Won TCV** card (one total per quote currency, never mixed) and the TCV, Indirect cost, Direct cost and EBITDA columns on the tender list, each in its tender's currency. |
| DRB (Head of South East Asia; Head of Singapore Delivery & CEO, LPS; Senior Manager Financial P&A) | Read-only, except approving Business case Versions. Tenders open on a **Summary** tab and a **Business case** tab. Also sees the Won TCV card and the money columns. |

Every role can view tenders, open **View source**, export Clauses, view the Business case and download its Versions, preview and download library items, view the rules and read the **Audit log**.

## Getting around

The footer shows the TendrAI version at the bottom left, as v[major].[minor].[patch] (this release is v3.0.0; the frozen V2 is v2.0.0 and the V1 POC v1.0.0). The sign-in page shows it at the bottom left too.

The top bar has five pages: **Tenders**, **Templates**, **Business case management**, **Historical data** and **Audit log**. On the right are your user menu (with **Sign out**) and the light/night mode switch.

If you try to leave a screen with unsaved edits, TendrAI asks **Leave without saving?** first. Click **Discard changes and leave** to leave anyway.

## 1. Sign in

1. Enter your **Email** (`name@lpstech.com`) and **Password**.
2. Click **Sign in**. If the details are wrong, you will see "Incorrect username or password."

## 2. Create a tender and upload the Tender pack

*Bidding Manager*

1. On **Tenders**, click **Create tender**.
2. Fill in **Title**, **Type** (Agency or Commercial) and **Customer / agency**. These are required. You can also add the **GeBIZ reference number** and **SFDC CRM ID**.
   - Titles must be unique.
   - If another tender already uses the GeBIZ reference, you will see a warning.
3. Click **Create tender**. The tender opens with the status reason `Pending (Draft)`. It stays Pending while the Tender pack is processed and the AI drafts the Business case, until the BD team first saves changes to it.
4. On the **Tender** tab, under **Documents**, click **Add documents**.
5. Drag files into the box, or click it to browse. PDF, Word and Excel files are accepted. A file with the same name and size as one already in the pack is rejected as a duplicate.
6. Click **Confirm upload**. The files are stored as `Uploaded`, but nothing is processed yet.
7. Set **Role in the pack** for each Document, for example General Requirements or Technical Specification. "Suggested, please confirm" means the AI's classification has not been confirmed yet.
8. To reorder Documents, drag them by the grip handle. To remove a Document, use its bin icon. The file is kept recoverable for 30 days.

To change a tender's details later, use the pencil icon on the tender list. To change its status, use the pencil icon next to the tender's name and click **Save status**. Choosing `Won` or `Closed` makes the tender read-only. While a tender is `Draft`, its status reason also follows the DRB approvals (section 9). The tender list's **Needs attention** column flags processing failures, out-of-date results, failed Documents, a passed closing date and Final Check failures on the latest Business case Version.

## 3. Process the Documents

*Bidding Manager*

1. Click **Process documents**. One processing job runs per tender. While it runs, you cannot change the Document set.
2. The job panel shows **Stage N of 7**:
   1. Read documents (text extraction)
   2. Build tender overview
   3. Extract submission requirements
   4. Extract qualification requirements
   5. Extract clauses
   6. Build compliance table
   7. Draft business case
3. You can leave the page while the job runs. A large pack takes from a few minutes to about 20 minutes. The panel never shows a percentage.
4. When the job finishes, you see "Processing complete". The **Submission**, **Qualification** and **Compliance** tabs unlock, and the **Business case** tab holds the AI first draft (Version 1).

**If something goes wrong:**

- **One Document fails.** It shows `Failed` with a reason. Click **Retry** on that row. The other Documents carry on. Results are labelled "based on N of M documents" until you fix or remove the failed Document and reprocess.
- **The whole run fails.** Click **Retry processing**.
- **The Document set changes after a run.** A banner says the results are out of date. Click **Reprocess documents**. Before reprocessing, TendrAI tells you how much existing work there is. Compliance statuses, remarks and drafts are carried over for items that are found again. The Business case is kept as it is: reprocessing never drafts over it.

## 4. Review requirements and Clauses with the source viewer

Every extracted item shows its source Document, Clause number and page. Click **View source** to open the viewer:

- The Document opens in the viewer for its file type: PDF and Word in the document viewer, Excel in the spreadsheet viewer (with the workbook's sheet tabs).
- The cited passage is found and highlighted in the Document (in Excel, the cell holding it), and the viewer scrolls to it. If the passage cannot be found, the viewer opens at the cited page and says so.
- Below the Document, the passage is repeated with a few sentences of context before and after it.
- The same viewer opens from a **Cited** badge in the Business case: a figure drafted from the tender pack opens that pack Document; a figure drafted from a past business case opens that case's workbook on the cited tab (Product Plan or Resource Plan), with the past line highlighted. Past business cases open only for BD, Presales, Finance and the DRB.
- In the demo, every stored Document is a generated file (`npm --prefix frontend run mock-docs`, after changing the mock data). A Document uploaded during a demo session has no file, so the viewer shows a page preview of the passage instead.

On the **Compliance** tab (the extracted Clauses):

1. Filter by category (Commercial, Technical, Legal, Finance, HR), by Document (**All documents**) or by any column header.
2. Clause numbers are kept exactly as they appear in the source. **Check reference:** flags a cross-reference that does not match the Clause numbering.
3. Under each AI-chosen **Category** you see how sure the AI was, for example "AI 93% sure, high" (high is 90% and up, medium 75% and up). A low score shows "check", so review those categories first. The score disappears once a person sets the category or reviews the Clause. Categories are never locked to a team: anyone who edits compliance can change them.
4. To see who changed a Clause's compliance or remark and when, expand the arrow on that row.

## 5. Edit the compliance table

*BD, Bidding Manager, Presales, Delivery*

1. On **Compliance**, change a Clause's **Category** or **Compliance**, or click **Add remark** to type in **Remarks**. Changed cells are highlighted.
2. Click **Save changes**, or click **Discard changes** to undo.
3. Click **Export Excel** or **Export Word** to download the compliance table. The Excel file has a Compliance dropdown on every row.
   - If some Clauses are still `Unset` or have no remark, TendrAI warns you first. You can choose **Download anyway**.
4. Click **View history** to open the Audit log filtered to this tender's Clause changes. Click **Back to tender** to return.

## 6. Submission checklist and first drafts

*Bidding Manager. Other roles can view and download.*

The **Submission** tab lists each Document to submit, with its required format and source. It is the master list: two kinds of row are prepared on the other tabs, and link to them with their progress.

- The compliance table row shows **Prepared on the Compliance tab** and how many Clauses have been assessed.
- CV, certification, key personnel and track record rows show **Evidence on the Qualification tab** and how many requirements have evidence linked.

1. Click **Find suitable templates**.
   - Agency templates are matched by agency name.
   - Generic templates are offered where no agency template fits.
   - A suggested template is filled in for each matching row.
2. To change the template for a row, use **Matching template**. Choose **None - prepared manually** if no template applies.
3. Click **Generate draft**. A first draft is created from the template. Sections that could not be filled are marked `[TO COMPLETE]`.
4. Preview (eye icon) or download the draft.

Changing the template on a row that already has a draft asks you to confirm **Change template and discard draft**. To add a missing template, click **Upload template**. It opens the Templates page, with **Back to tender**.

## 7. Qualifications and evidence

The **Qualification** tab lists Role, Experience, Certification and Past project requirements. Click a chip to filter by kind.

*Bidding Manager:*

1. Click **Find matching certificates** to link library certificates to Certification requirements automatically.
2. To pick one by hand, use **Certificate on file**. Choose **None linked** to clear it. Expired certificates are flagged.
3. Preview or download the linked certificate. If a certificate is missing, click **Upload certification**.

## 8. Review and edit the AI-drafted Business case

*Only BD edits the Business case. Every other role, including Presales and Delivery, views it read-only.*

The tender's **Business case** tab has three tabs: **Business case**, **Versions** and **MSPO templates**. They unlock once the Tender pack has been processed and Version 1 has been drafted.

**The workspace (Business case tab)**

- The bar at the top shows the live **TCV**, **Total cost**, **EBITDA** and the **Final Check** result. Click the Final Check pill to see every rule's **Expected** and **Actual** values. For a failed rule, **Go to ...** opens the tab to fix.
- The seven tabs follow the business case template: **Basic Info** (deal information, quote lines, billing plan, exchange rates), **Summary** (applied contingency, inflation and PRC %, other indirect costs, finance cost), **Cash Flow** (vendor payment columns, labour and repayments per month), **Product Plan**, **Resource Plan**, **Working** (margin per quote line) and **Labour Inputs** (monthly man-days per labour line).
- Every value is recalculated as you edit, using the template's logic (4% contingency, 4%/2% inflation with the vendor-commitment exemption, finance cost on negative cash positions).
- The number on each tab is how many AI-drafted values on it nobody has reviewed yet. The top bar also says how many of those are low-confidence.

**Currencies and exchange rates**

- Every figure is calculated in the **Quote Currency** set on Basic Info.
- A Product Plan line can be priced in its vendor's currency: pick it under the unit cost. The line converts into the quote currency, and the converted unit cost is shown underneath.
- Day rates come from the SGD rate card and convert the same way.
- Conversion uses the **Applied Rate (to 1 USD)** in the Basic Info exchange rate table. A new AI draft starts with the company **Exchange rate defaults** (section 12). Changing an applied rate re-prices every line priced in that currency, for this business case only.
- Changing the Quote Currency converts the amounts keyed in the old one: billing lines, Cash Flow vendor payments, travel and other indirect costs. A billing plan that equalled the TCV still equals it.

**Figure badges**

Click **Hint** to show the legend.

| Badge | Meaning |
|---|---|
| **Cited · DOC-ID · 91% match, high** | AI drafted from a past business case. The % is how closely that case matches this tender: high is 88% and up, medium 80% and up, otherwise low. Click it to see the source and the Tender pack Clause it answers. |
| **Cited · tender pack · extracted** | Read directly from this tender's documents. |
| **Estimate · no source · low** | AI drafted industry estimate: no comparable past case was found. Check these first. |
| **Manual · Salesforce** | Not AI-populated. Look the value up in Salesforce and key it in. |
| **Cited · confirmed** / **Cited · edited** | A person confirmed or changed a cited value. The citation and the AI's match % are kept, so you can still see what the value was based on. |
| **Confirmed** | Entered or confirmed by a person. |

**Which past cases the AI uses.** Won business cases filed in Historical data are preferred sources; lost and closed ones are used, weighted lower; BD can exclude any case (section 13). A tender never cites its own business case.

**Who sees past prices.** Past business cases contain other customers' prices. Only BD, Presales, Finance and the DRB see the case name and its figures when they open a citation. Other roles (Bidding Manager, Delivery) see "past case" with the match % and the tender Clause, but not the case or its prices.

Editing a value confirms it. **Confirm all in this tab** confirms the remaining AI-drafted values on a tab, after you have reviewed them. **Show only items needing review** hides everything already confirmed. Manual (Salesforce) fields are never confirmed in bulk.

**How Versions work**

Version numbers only go up when the DRB approves. Version 1 is the AI draft. When all three DRB members have approved the latest Version, it is archived and the next Version starts as a copy of it (see section 9). So if v3 is the latest, v1 and v2 are both fully approved and read-only.

**Saving your changes**

1. Your edits stay as a draft. The purple bar shows **Unsaved changes** and what they change.
2. Optionally type a comment, then click **Save changes to vN**. The save updates the latest (working) Version; it does not create a new Version. **Discard** throws the draft away. Leaving the tender with unsaved edits asks you first.
3. TendrAI runs the Final Check rules on the saved figures. The toast says whether any failed.
4. If some DRB members have already approved the working Version, saving **voids** their approvals: they approved the figures before your change. The save bar warns you first, and the Version needs approving again.

The billing plan always bills the TCV, split evenly: any edit that changes the TCV re-divides it across the billing lines, so the billing total always equals the TCV. Billing amounts cannot be typed; change the **Billing frequency** (Monthly, Quarterly or Yearly) to regenerate the lines, or add and remove lines. Changing quantities or unit costs does not move the Cash Flow vendor columns: Final Check flags the gap ("Cash Flow reconciles with the plans"), and you fix it on Cash Flow.

**Versions tab**

- Each row shows who last saved the Version, where it came from (**AI first draft** or **Copy of approved vN**), how many saves it has had and the last change, the comment and the Final Check result (**All passed** or **N failed**).
- **DRB approvals** lists each DRB member with the date and time they approved that Version, or **pending**.
- **View** (eye icon) opens that Version on the **Business case** tab. Approved Versions open read-only, with **View latest (vN)** to go back. Unsaved edits to the latest Version are kept while you look.
- Expand a row to see every save made to that Version (when, who, what changed, comment, and any approvals it voided), then each rule's **Result** (Pass, Fail, Warning or Not checked), **Tabs involved**, **Expected** and **Actual**.
- The download icon saves that Version as an Excel workbook (`.xlsx`) in the template's tab layout. You can also click **Download vN (.xlsx)** in the workspace.
- Versions cannot be deleted: earlier Versions are approved and archived, and the latest is the working Version. Use **Discard** to throw away unsaved edits.

**Failed checks warn, but nothing is blocked.** The DRB review and MSPO generation stay available.

## 9. DRB review

**Approving a Version** *(DRB)*

1. Open the tender's **Business case** tab. The button above the workbook reads **Approve vN (n of 3 approved)** for the latest Version.
2. Click it and confirm. The button is greyed out, with the reason in its tooltip, when you are viewing an earlier Version, have already approved, or the Version is an unchanged copy of an approved one. **Versions** lists who has approved each Version and when. If AI-drafted values in the Version are still unreviewed, you must tick the acknowledgement first. Failed Final Checks are shown but do not block approval.
3. A Version is approved once **all three** DRB members have approved it. The last approver confirms **Approve and archive**. Then:
   - The approved Version is archived and stays **read-only** for good. It cannot be edited or deleted.
   - TendrAI adds an identical working copy as the next Version ("Copy of approved vN"). Any later changes are saved to it.
   - The working copy cannot be approved until someone saves changes to it.
4. Only the latest Version can be approved. If the BD team saves changes before everyone has approved, the approvals given so far are voided and the Version needs approving again.

**Tender status follows the Business case.** While the tender's status is `Draft`:
- it is `Pending (Draft)` from creation until the BD team first saves changes to the Business case
- saving changes sets it to `In Progress (Draft)`
- the first approval sets the reason to `In Approval (Draft)`
- the last approval sets it to `Approved (Draft)`
- saving changes after approvals (which voids them, or starts the next round) sets it back to `In Progress (Draft)`

Each change is recorded in the audit log with the approval. `Active`, `Won` and `Closed` tenders are never changed automatically.

DRB members open a tender to read-only **Summary** and **Business case** tabs:

- **Summary** shows TCV (contract value), Direct cost, Indirect cost, EBITDA, each read from the business case field set under **Business case figures** on the MSPO mapping (by default Summary > TCV, Direct cost, Indirect cost, EBITDA and EBITDA %), the Final Check result with any failed checks listed, and the project details. It always uses the latest saved Version, and warns when AI-drafted values in it have not been reviewed.
- **Summary** also shows how many DRB members have approved the latest Version, and when a Version was last approved.
- **Business case** has two tabs: the workspace (the latest saved Version, read-only, with its badges and **Download vN (.xlsx)**), and **Versions**, where you view earlier Versions and approve.

**Outcome and lessons learned.** The Bidding Manager records the outcome by changing the tender status to `Won (Won)` or `Lost (Closed)`.

- The tender leaves the **Tenders** page and is filed in **Historical data** as a Tender record with its Tender pack (so is a `Revised (Closed)` tender).
- The tender's last approved Business case is then filed in **Historical data** as a source for future AI drafts: a won case is **preferred**, a lost one **standard**.
- On the closed tender, **Outcome and lessons learned** lets the Bidding Manager or BD record what decided the result (price, scope, compliance gaps, customer feedback). The lessons are saved with the filed business case, and every change is in the audit log.

## 10. Generate the MSPO templates

*BD*

1. Create the quote line in MSPO first.
2. On **Business case** > **MSPO templates**, choose the **Business case version** that fills the templates. It defaults to the latest approved Version. If you pick one the DRB has not approved, a warning says so, but you can still generate from it.
3. Click **Edit details**. Fill in **MSPO quote line**, **Fiscal years** and **Man-days per month**. Every line of the chosen Version is included, and the fiscal years follow its project period. Click **Save changes**.
4. Check the **Preview** of each plan. Product plan rows carry the quantity planned for each fiscal year and the line's Vendor Commitment.
5. Click **Download product plan**, **Download billing plan** or **Download resource plan**.
6. In Excel, fill in the "From MSPO" and "Manual" columns before you upload the file to MSPO.

Every figure is written exactly as saved in the chosen Version, with no rounding: margin %, billing amounts, unit prices, and the per-month man-days of the resource plan. Amounts are in the Version's quote currency. If you chose the latest Version and the workspace has unsaved edits, a banner says so: save them to include them. If Final Checks failed, the downloads still work but carry a warning.

Each template column is filled from a field of the business case in TendrAI, for example **Product Plan > Unit cost** or **Summary > Gross margin %**. The app is the source of truth: the mapping does not point at Excel cells. To fill a column from a different field for this tender only, click **Edit mapping** and pick the field. **Reset this tender to the defaults** undoes those changes.

## 11. Templates (library)

The **Templates** page has three tabs: **Templates**, **Certifications** (the badge counts expired certificates) and **Boilerplate**.

- **Upload** (Bidding Manager, BD). Click **Upload template**, **Upload certification** or **Upload boilerplate**, then fill in the details for each file:
  - Templates need an agency and type.
  - Certifications need the issuing body, certificate number, issue date and expiry date.
  - Boilerplate can have tags.
- **Replacing a file.** Uploading under an existing name creates a new version. The old version moves to the version history, and only the latest version is matched to tenders.
- **Each row.** Preview, download, edit details (pencil icon) or delete (**Delete from library**). Expand a row to see and download earlier versions.

## 12. Business case management (rules admin)

*BD edits. Other roles see it read-only.*

- **Final Check rules.**
  - Each rule has an on/off switch, a description of what it checks, the tabs involved, and a severity (Fail or Warning).
  - Rules read business case fields in TendrAI, the same way the MSPO mapping does, for example "Basic Info > Billing amounts (total) = Summary > TCV". They do not point at Excel cells.
  - Click **Add rule**, or use the pencil icon on a rule. Choose a rule type: "A field must equal another field", "A field must be within a range" or "Every line must meet a condition", then pick the fields. Fields with one value per line (such as Product Plan > Line totals) are added up when compared with a single figure.
  - Built-in rules include the Cash Flow checks carried over from the template's Final Check list: "Cash Flow reconciles with the plans" (Fail) and "No large cash flow mismatch" (Warning).
  - "No large cash flow mismatch" warns only when the largest monthly cash shortfall is above the **Allowed shortfall (% of TCV)**, which starts at 15%. Short gaps are normal, because LPS pays vendors for hardware and licences before the customer's first bills arrive; AI drafts typically peak at 12-14% of the TCV. The result shows the largest shortfall and its share of the TCV. Set the value to 0 to warn on any month with a mismatch.
  - While you edit, the rule is tested against a saved Business case Version.
  - Click **Add rule** or **Save rule** to finish. To pause a rule instead of deleting it, switch it off.
- **MSPO mapping defaults.** Click **Edit defaults** to set which business case field fills each MSPO template column, or whether the column is From MSPO, Manual or Calculated. Each plan only offers the fields its rows can use (for example, product fields on the product plan; Summary fields everywhere). Click **Save defaults**. Columns a tender has adjusted keep that tender's field.
- **Exchange rate defaults.** The company rates for each currency, in units to 1 USD. They start at the planning rates. Click **Edit rates**, change them, then **Save rates**. Every new AI-drafted business case copies these as its applied rates. Existing business cases keep their own rates, which BD can still adjust on a case's Basic Info tab (where the company default is shown beside the applied rate). Changes are audited.

## 13. Historical data

The **Historical data** page lists the records of Won and Closed tenders: tender, proposal, Business case and BOM records. Open tenders (`Draft` and `Active`) are on the **Tenders** page instead. Expand a row to see its stored Documents and Business case version history.

**AI draft source** (Business case records). This column decides how the AI may use a past business case when it drafts a new one:
- **Preferred:** cited first. This is the default for won cases.
- **Standard:** used, but weighted lower. This is the default for lost and closed cases.
- **Excluded:** never used, for example a stale or unrepresentative case.

Open business cases are not used. BD changes the setting; the change is audited and applies to the next drafts (existing drafts keep their citations). Expanding a filed business case also shows its lessons learned. Past business case files can only be downloaded by BD, Presales, Finance and the DRB.

*BD:*

- Click **Archive** on a `Closed`, `Won` or `Lost` record to compress it.
- An archived record stays searchable, but you must click **Restore files** before you can open its files. A restore can take several hours.
- After you use the restored files, click **Archive again**.

## 14. Audit log

The **Audit log** records every action: who, role, tender, section, action and detail, newest first.

- To narrow the list, use **From** and **To**, or filter any column. Click **Clear filters** to reset.
- For long entries, click **Show all** to read the full detail.
- Entries cannot be edited or deleted.

## Statuses

| Kind | Status | Meaning |
|---|---|---|
| Document | `Uploaded` | Stored, not processed |
| | `Extracting text` | Text is being read from the file |
| | `Text ready` | Text read, waiting for analysis |
| | `Analysing` | AI extraction running |
| | `Done` | Included in the results |
| | `Failed` | Could not be read; the reason is shown. Use **Retry** |
| Processing job | Stage 1-7 | The current stage (see section 3). The tender list also shows "Processing in progress", "Processing failed", "Not processed" or "Results out of date" |
| Compliance | `Unset` | Not assessed yet |
| | `Comply` / `Partially comply` / `Do not comply` | LPS's position on the Clause |
| | `Clarify` | A clarification is needed from the customer |
| Checklist item | `Not started` / `In progress` / `Done` | Defined for submission items, but not shown on the current screens |
| First draft | `Needs review` | Generated, still to be checked by a person |
| Business case Version | **AI first draft** / **Copy of approved vN** | Version 1 is TendrAI's draft; each later Version starts as a copy of the Version the DRB just approved. People's saves update the latest Version |
| | **Approved, read-only** | Approved by every DRB member; archived and never changed |
| Tender | `Draft`, `Active`, `Won`, `Closed` | The tender's lifecycle; `Won` and `Closed` are read-only |
| Tender status reason | `In Progress (Draft)`, `Pending (Draft)`, `In Approval (Draft)`, `Approved (Draft)`, `Rejected (Draft)`, `In Progress (Active)`, `Won (Won)`, `Revised (Closed)`, `Lost (Closed)` | The detail under each status |
| Historical record | `Open`, `Closed`, `Won`, `Lost`, `Archived` | `Archived` files need a restore before you can open them |

## V3 backend follow-up

V3 (this guide) is implemented in the frontend demo only. The backend still implements the V2 Excel upload flow. Before V3 can run against the API, these changes are needed (each is its own reviewed change):

- **Database** (`db/schema.sql`, through a migration): store the business case itself on `bc_versions` (the seven tabs and the provenance of each value), plus `origin` (`ai-draft` or `approved-copy`), `created_at`, `saved_by`, and an append-only table of saves per version (who, when, change summary, comment, approvals voided). Version numbers only increase on full DRB approval. Remove `layout_unrecognised` and the uploaded file key. Add DRB approvals per version (append-only table: version, approver, timestamp) and `approved_at` / `copy_of` on `bc_versions`; approved versions must be immutable in the database too (no update or delete). Allow processing stage 7 (`processing_jobs.stage` CHECK is 1-6 today). Mirror any new enum in `api/src/types.ts` and `frontend/src/types.ts`.
- **API** (`api/src/routes/businessCase.ts`): replace presign / confirm upload with "save business case" (validated body, BD role only, updates the latest unapproved version, voids its approvals, audit entry with the changes) and an `.xlsx` export. Add "approve version" (DRB role only, latest version only; the last approval archives the version and creates the working copy in one transaction) and remove version delete. Remove the server-side workbook parse (`api/src/domain/bcWorkbook.ts`) or keep it only for importing V2 versions. Add stage 7 to `PROCESS_STAGES`. Update `api/README.md`.
- **Processing workflow** (`infra/modules/tendrai`, `lambdas/analyser`, `lambdas/result_loader`): add the "Draft business case" stage: retrieve comparable historical business cases, have Bedrock (in-region model in `ap-southeast-1` only) draft the lines with a citation or an "estimate" marker on each, and load them as Version 1 only when the tender has no Business case yet. Needs a new versioned prompt (see the bedrock-prompts guidance) and an evaluation set.
- **Added since the first V3 cut** (frontend only so far):
  - **Clause classification confidence:** `categoryConfidence` on clauses. The classifier must return a score per clause.
  - **Line currency:** `currency` on product lines, with conversion at the business case's exchange rates.
  - **Feedback loop:** on historical records, `aiSource` (preferred / standard / excluded), `refId`, `tenderId` and `lessons`. Retrieval must weight preferred cases above standard ones and never use excluded ones.
  - **Lessons learned** on tenders.
  - **Tender status reason** updated by approvals and saves, in the same transaction.
  - **Role check** so only BD, Presales, Finance and DRB receive historical business case excerpts and files.
  - **MSPO mapping by field:** `mspo_mapping_defaults` and `tender_mspo_mappings` store a business case field key instead of tab / first cell / span. `map_span` and the per-tender row counts go.
  - **Exchange rate defaults:** a company table of rates to 1 USD, copied into each new draft.
  - **Final Check rules by field:** `final_check_rules.definition` stores business case field keys (`left`, `right`, `target`, e.g. `summary.tcv`) instead of `{tab, ref}` cell references; update `db/seed.sql`, the schema comment and `api/src/domain/finalChecks.ts` to match. The cash flow mismatch rule's `value` is the allowed shortfall as a % of the TCV, and each version's cash flow totals need the peak monthly shortfall.
- **Security and data residency review**: the draft prompt sends tender text and historical business case figures to Bedrock. Confirm this is acceptable before building it.
