# TendrAI user guide

TendrAI helps LPS teams prepare tender responses. It does three things:

- **Reads the Tender pack.** The AI extracts the submission requirements, qualification requirements and categorized Clauses from the tender Documents. Every extracted item links back to its source. You set compliance on each Clause and export the compliance table.
- **Checks the Business case.** The BD team builds the Business case in Excel and uploads it. Each upload becomes a new Version, and TendrAI runs the Final Check rules against it. The AI never generates costs or Business cases. Figures are taken from the workbook as read.
- **Fills the MSPO templates.** The product, resource and billing plans are pre-filled from the Business case for download.

A failed Final Check only warns you. It never blocks anything. A Business case whose layout does not match a known template **does** block MSPO template generation.

## Demo note

The current build is a demo that runs entirely in your browser:

- All data is mock data held in memory. **Refreshing the page resets everything**, including your uploads and edits.
- "AI" results are pre-built sample results. Processing runs through the real stages, but faster than the live system.
- Sign-in uses built-in demo accounts. On the sign-in page, click **Demo accounts** and pick a person. That fills in the **Email** and the shared demo password, which is shown in the same panel. Then click **Sign in**.

## Roles

Your role is shown under your name in the top-right user menu. Buttons your role cannot use appear greyed out. Hover over one to see why.

| Role (account label) | What you can do |
|---|---|
| Bidding Manager | Create, edit and delete tenders. Change a tender's status. Upload, process, reorder, classify and delete Tender pack Documents. Edit Clauses and compliance. Find suitable templates, select templates and generate first drafts. Find and link certificates. Manage the template library. |
| Business Development (BD) | Edit Clauses and compliance. Upload and delete Business case Versions. Edit MSPO details and mapping, and download the MSPO templates. Manage the template library. Manage Final Check rules and MSPO mapping defaults. Archive and restore records in Historical data. |
| Presales, Delivery | Edit Clauses (category, compliance and remarks). View everything else. |
| Finance | Read-only on every tender. Also sees the **Total Won TCV** card and the TCV, Indirect cost, Direct cost and EBITDA columns on the tender list. |
| DRB (Head of South East Asia; Head of Singapore Delivery & CEO, LPS; Senior Manager Financial P&A) | Read-only. Tenders open on a **Summary** tab and a **Business case** tab. Also sees the Won TCV card and the money columns. |

Every role can view tenders, open **View source**, export Clauses, preview and download library items, view the rules and read the **Audit log**.

## Getting around

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
3. Click **Create tender**. The tender opens with the status reason `In Progress (Draft)`.
4. On the **Tender** tab, under **Documents**, click **Add documents**.
5. Drag files into the box, or click it to browse. PDF, Word and Excel files are accepted. A file with the same name and size as one already in the pack is rejected as a duplicate.
6. Click **Confirm upload**. The files are stored as `Uploaded`, but nothing is processed yet.
7. Set **Role in the pack** for each Document, for example General Requirements or Technical Specification. "Suggested, please confirm" means the AI's classification has not been confirmed yet.
8. To reorder Documents, drag them by the grip handle. To remove a Document, use its bin icon. The file is kept recoverable for 30 days.

To change a tender's details later, use the pencil icon on the tender list. To change its status, use the pencil icon next to the tender's name and click **Save status**. Choosing `Won` or `Closed` makes the tender read-only. The tender list's **Needs attention** column flags processing failures, out-of-date results, failed Documents, a passed closing date, Final Check failures and unrecognised Business case layouts.

## 3. Process the Documents

*Bidding Manager*

1. Click **Process documents**. One processing job runs per tender. While it runs, you cannot change the Document set.
2. The job panel shows **Stage N of 6**:
   1. Read documents (text extraction)
   2. Build tender overview
   3. Extract submission requirements
   4. Extract qualification requirements
   5. Extract clauses
   6. Build compliance table
3. You can leave the page while the job runs. A large pack takes from a few minutes to about 20 minutes. The panel never shows a percentage.
4. When the job finishes, you see "Processing complete", and the **Submission**, **Qualification** and **Clauses** tabs unlock.

**If something goes wrong:**

- **One Document fails.** It shows `Failed` with a reason. Click **Retry** on that row. The other Documents carry on. Results are labelled "based on N of M documents" until you fix or remove the failed Document and reprocess.
- **The whole run fails.** Click **Retry processing**.
- **The Document set changes after a run.** A banner says the results are out of date. Click **Reprocess documents**. Before reprocessing, TendrAI tells you how much existing work there is. Compliance statuses, remarks and drafts are carried over for items that are found again.

## 4. Review requirements and Clauses with the source viewer

Every extracted item shows its source Document, Clause number and page. Click **View source** to open the viewer:

- The cited passage is highlighted, with a few sentences of context before and after it.
- Use **Previous page**, **Next page** or **Go to page** to move through the Document.

On the **Clauses** tab:

1. Filter by category (Commercial, Technical, Legal, Finance, HR), by Document (**All documents**) or by any column header.
2. Clause numbers are kept exactly as they appear in the source. **Check reference:** flags a cross-reference that does not match the Clause numbering.
3. To see who changed a Clause's compliance or remark and when, expand the arrow on that row.

## 5. Edit the compliance table

*BD, Bidding Manager, Presales, Delivery*

1. On **Clauses**, change a Clause's **Category** or **Compliance**, or click **Add remark** to type in **Remarks**. Changed cells are highlighted.
2. Click **Save changes**, or click **Discard changes** to undo.
3. Click **Export Excel** or **Export Word** to download the compliance table. The Excel file has a Compliance dropdown on every row.
   - If some Clauses are still `Unset` or have no remark, TendrAI warns you first. You can choose **Download anyway**.
4. Click **View history** to open the Audit log filtered to this tender's Clause changes. Click **Back to tender** to return.

## 6. Submission checklist and first drafts

*Bidding Manager. Other roles can view and download.*

The **Submission** tab lists each Document to submit, with its required format and source.

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

## 8. Upload the Business case and read the Final Check results

*BD uploads. Everyone else views.*

1. Open the tender's **Business case** tab and click **Upload business case**. After the first upload, the button reads **Upload new version**.
2. Add one Excel workbook (`.xlsx` or `.xlsm`). You can also add a **Comment** describing what changed. Click **Confirm upload**.
3. TendrAI reads the workbook and runs the enabled Final Check rules. No AI is involved.
4. On **Versions**, each row shows the result: **All passed**, **N failed** or **Layout not recognised**. Expand a row to see each rule's **Result** (Pass, Fail, Warning or Not checked), **Tabs involved**, **Expected** and **Actual**. Click **View source** to see the workbook tabs.

What the results mean:

- **Failed checks warn, but nothing is blocked.** The DRB review and MSPO generation stay available.
- **Layout not recognised.** The Version is stored, but the checks do not run, and MSPO generation is blocked until you upload a workbook based on the current template.

To remove a Version, use its bin icon. Other Versions are not affected.

## 9. DRB review

DRB members open a tender to read-only **Summary** and **Business case** tabs:

- **Summary** shows TCV (contract value), Direct cost, Indirect cost, EBITDA, each read from the business case cell set under **Business case figures** on the MSPO mapping (by default Summary B6, B14, B24, B50 and C50), the Final Check result with any failed checks listed, and the project details.
- **Business case** shows the uploaded workbook itself, opening on its Summary sheet.
- If the newest Version's layout was not recognised, the DRB sees the latest readable Version, with a note.

The Bidding Manager records the outcome by changing the tender status.

## 10. Generate the MSPO templates

*BD*

1. Create the quote line in MSPO first.
2. On **Business case** > **MSPO templates**, click **Edit details**.
3. Fill in **MSPO quote line**, **Fiscal years**, **Man-days per month**, and the **Last row** of each plan. The fiscal years and last rows are read from the Version, so correct them only if the workbook differs. Click **Save changes**.
4. Check the **Preview** of each plan.
5. Click **Download product plan**, **Download billing plan** or **Download resource plan**.
6. In Excel, fill in the "From MSPO" and "Manual" columns before you upload the file to MSPO.

If Final Checks failed, the downloads still work but carry a warning. If the layout was not recognised, the download buttons are disabled.

To change which workbook tab and first cell fill a column for this tender only, click **Edit mapping**. **Reset this tender to the defaults** undoes those changes.

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
  - Click **Add rule**, or use the pencil icon on a rule. Choose a rule type: "A cell must equal another cell", "A cell must be within a range" or "Every line must meet a condition".
  - While you edit, the rule is tested against a sample Business case.
  - Click **Add rule** or **Save rule** to finish. To pause a rule instead of deleting it, switch it off.
- **MSPO mapping defaults.** Click **Edit defaults** to set which Business case tab and cell fills each MSPO template column, or whether the column is From MSPO, Manual or Calculated. Click **Save defaults**. Columns a tender has adjusted keep that tender's value.

## 13. Historical data

The **Historical data** page lists every tender, proposal, Business case and BOM record. Expand a row to see its stored Documents and Business case version history.

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
| Processing job | Stage 1-6 | The current stage (see section 3). The tender list also shows "Processing in progress", "Processing failed", "Not processed" or "Results out of date" |
| Compliance | `Unset` | Not assessed yet |
| | `Comply` / `Partially comply` / `Do not comply` | LPS's position on the Clause |
| | `Clarify` | A clarification is needed from the customer |
| Checklist item | `Not started` / `In progress` / `Done` | Defined for submission items, but not shown on the current screens |
| First draft | `Needs review` | Generated, still to be checked by a person |
| Tender | `Draft`, `Active`, `Won`, `Closed` | The tender's lifecycle; `Won` and `Closed` are read-only |
| Tender status reason | `In Progress (Draft)`, `Pending (Draft)`, `In Approval (Draft)`, `Approved (Draft)`, `Rejected (Draft)`, `In Progress (Active)`, `Won (Won)`, `Revised (Closed)`, `Lost (Closed)` | The detail under each status |
| Historical record | `Open`, `Closed`, `Won`, `Lost`, `Archived` | `Archived` files need a restore before you can open them |
