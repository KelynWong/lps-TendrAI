# TendrAI Demo - Walkthrough

> **Legacy V1 POC — superseded.** This guide describes the frozen V1 proof of concept, where the AI drafted a costed business case. The current product (`frontend/`) does not: AI never generates costs or business cases. For the current app see [docs/USER_GUIDE.md](../../../docs/USER_GUIDE.md).

TendrAI reads a tender requirement document, drafts a costed business case for
Deal Review Board (DRB) approval, and exports the MSPO upload templates.
Follow the numbered steps below; they take about 15 minutes and cover the
whole workflow across four user roles.

## Read first

- **Everything is fictitious.** Companies, tenders, people, figures and
  documents are mock data.
- **Uploads are simulated.** Upload any file anywhere; only its name is used
  and nothing is stored or processed.
- **Refreshing the page resets the demo**, so feel free to try anything.
- **No submission form section**: as confirmed with John Price,
  agencies/customers do not provide a submission form, so the flow ends at DRB
  approval plus a manually recorded Won / Lost outcome.
- Every demo account uses the password `Demo2026!` (filled in automatically
  when you pick an account). Best on a desktop browser; the moon icon (top
  right) switches night mode.

## Part 1 - John Price, Bidding Manager
*Upload a tender and watch the AI draft the business case.*

1. Open the demo URL. On the sign-in page, click **Demo accounts** (below the
   purple Sign in button).
2. Click **John Price - Bidding Manager**; the email and password fill in.
3. Click **Sign in**.
4. You land on the **Dashboard**. The **Deal Pipeline** cards at the top are
   tenders that have been processed and have an AI-drafted business case
   awaiting review, with key figures: TCV, indirect cost, direct cost, EBITDA
   and any Final Check errors.
5. Scroll down to **Recent pursuits**: past tenders with their recorded
   outcome (Awaiting result / Won / Lost) and the same figures.
6. Click the card **ITT/2026/014 - National Contact Centre Modernisation
   Programme**.
7. Click the **Business Case** tab (below the 5-step workflow stepper) and
   click through the seven sub-tabs: Basic Info, Summary, Cash Flow, Product
   Plan, Resource Plan, Working, Labour Inputs. Hover any computed figure for
   its Excel-style formula.
8. Click **All tenders** (top left) to go back. The list covers the past year;
   try the filters above the table (title/reference search, Agency/Commercial,
   status).
9. Click the **Upload a tender requirement document** box (top of the page)
   and select any DOCX or PDF - any file works in this demo.
10. Wait while the processing pipeline (right-hand card) runs extraction,
    embedding, retrieval and draft generation (~10 seconds).
11. Sign out: click your name (top right) and choose **Sign out**.

## Part 2 - Felicia Phan, Business Development
*Review the draft, correct figures, export MSPO, explore the library.*

12. Click **Demo accounts** > **Felicia Phan - Business Development** >
    **Sign in**.
13. On the Dashboard, click the tender you just uploaded (top of the Deal
    Pipeline) and open its **Business Case** tab.
14. Notice the **orange badges** on the sub-tabs: they count AI-suggested
    values not yet reviewed. Each tab has a review toolbar (above the table)
    with progress, a needs-review filter and **Confirm all in this tab**.
15. Click any **Cited** badge: a source panel opens (right side) showing the
    historical document and matched section - or, on Basic Info, where in the
    tender the value was extracted. Click **View similarity details** for a
    side-by-side view; click outside the panel to close.
16. Correct a few AI figures: click an amber cell, type a new value, press
    Enter (the cell turns green). A purple unsaved-changes bar appears; click
    **Save changes** (right side of the bar). Every change lands in the audit
    log with old and new values.
17. On **Product Plan**, click **Export MSPO template (product plan)** (top
    right of the action row): it downloads the official MSPO template
    prefilled from the business case, ready for review and upload to MSPO
    whenever the case changes. Same on **Resource Plan**.
18. Click **Edit history** (next to the export button): the Audit log opens
    pre-filtered to this business case and tab.
19. In the **Audit log**, explore the filters: date range, action, tender,
    section.
20. Go to **Historical data** (top navigation) - the library the AI retrieves
    from. Notice the purple **Linked set** groups versus standalone documents;
    try the filters.
21. Click the **Upload historical documents** box (top) and select any
    document.
22. Click **Add another file to this set** and select a second document.
23. Set each file's **Type** (Tender Requirement / Proposal / Business Case),
    fill Sector, Customer and the shared Outcome, then click **Upload and
    embed**. (If a type is missing from the set, the app recommends completing
    or linking it - you can proceed anyway.)
24. Find **Business Case - Regional Bank Contact Centre** in the table and
    click its version number **v1.1** (right side of the row).
25. In the version history, click the **download icon** on the archived v1.0
    row - a .doc of the old version downloads. (Metadata edits bump the minor
    version; replacing the document bumps the major version.)
26. Sign out (top right).

## Part 3 - Ethan Lim, Business Sponsor
*First of two DRB approvals.*

27. Click **Demo accounts** > **Ethan Lim - Business Sponsor** > **Sign in**.
28. On the Dashboard, click the most recently uploaded tender and open
    **Business Case**.
29. Click **Approve business case (1 of 2)** (left side, below the sub-tabs).
    If AI values are still unreviewed, tick the acknowledgement checkbox in
    the dialog first. Two different sponsors must approve; editing after a
    first approval voids it.
30. Sign out.

## Part 4 - Eng Chuan Puay, Executive Sponsor
*Second approval, lock, record the outcome.*

31. Click **Demo accounts** > **Eng Chuan Puay - Executive Sponsor** >
    **Sign in**.
32. On the Dashboard, click the same tender and open **Business Case**.
33. Click **Approve business case (2 of 2)** and confirm **Approve and lock**.
    The case locks; every value becomes read-only.
34. In the tender header (top right), set **Tender outcome** to **Won**.
35. Go back to the **Dashboard**: the tender has moved from the Deal Pipeline
    into Recent pursuits with its outcome.

## Explore further

Different roles have different permissions; sign in as each to see the edit
rights change (everything else stays read-only):

| Account | Role | Can edit |
| --- | --- | --- |
| john.price@lpstech.com | Bidding Manager | Only role that can upload tender documents; exports MSPO |
| felicia.phan@lpstech.com | Business Development | Deal structure: Basic Info, quote lines, billing, FX, Summary rates, Cash Flow |
| chee.wee@lpstech.com | Presales Consultant | Business case Product Plan only |
| priya.nair@lpstech.com | Delivery Manager | Business case Resource Plan and Labour Inputs only |
| ecpuay@lpstech.com | Executive Sponsor | Approvals, margins, plus deal structure |
| ethan.lim@lpstech.com | Business Sponsor | Approvals, plus deal structure |

Badge reference: `Cited` (AI, grounded - click for source), `Estimate - no
source` (AI, unverified), `Cited - confirmed` (person confirmed the cited
value), `Cited - edited` (person changed it; original stays viewable),
`Confirmed` (human value, no citation).
