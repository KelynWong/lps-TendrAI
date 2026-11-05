---
name: frontend-design-system
description: Use when building or changing any UI in frontend/src (pages, components/*.tsx, ui/*.tsx, styles.css, v2.css, theme/tokens.css), e.g. adding a page, table, tab strip, button, toast, banner, dialog, status pill or source/citation viewer. Holds the design tokens, shared components and UI rules to reuse instead of inventing new styles.
---

# TendrAI frontend design system

Rules from `CLAUDE.md` apply: use existing tokens and shared components only. No new colours,
fonts or one-off styles. If a token or component is missing, stop and ask. Do not touch
`frontend/legacy/app-v1/` (frozen V1 POC) or `frontend/legacy/app-v2/` (frozen V2) unless asked. Verify with `npm --prefix frontend run build`
(runs `tsc -b`; there is no linter or test runner).

## Tokens (`frontend/src/theme/tokens.css`)
Always reference `var(--token)`. Dark mode overrides the same names under `:root[data-theme='dark']` (tokens.css:70), so never hard-code a hex value.

| Group | Variables (light values) |
|---|---|
| Brand (tokens.css:9) | `--brand-purple` #7a1a7f, `--brand-purple-hover` #5f1264, `--brand-purple-pressed` #480e4c, `--brand-purple-subtle` #f6e8f7, `--brand-magenta` #a100b5 (login screen only) |
| Spacing, 4px base (tokens.css:36) | `--sp-1` 4px, `--sp-2` 8px, `--sp-3` 12px, `--sp-4` 16px, `--sp-6` 24px, `--sp-8` 32px, `--sp-12` 48px. There is no `--sp-5/7/9-11`. |
| Type scale (tokens.css:45) | `--fs-label` 12px (minimum anywhere), `--fs-dense` 13px (tables, toasts), `--fs-body` 14px, `--fs-h3` 16px, `--fs-h2` 20px, `--fs-h1` 24px |

Other tokens, summarised:
- Neutrals: `--ink`, `--ink-secondary`, `--ink-disabled`, `--surface`, `--surface-subtle`, `--surface-sunken`, `--border`, `--border-strong`.
- Semantic, status only, never decoration, always with icon + text: `--success`, `--warning`, `--error`, `--info`, each with a `-tint` background.
- Shape and focus: `--radius` 4px, `--focus-ring` (applied to every `:focus-visible`, styles.css:29).
- Layout heights for sticky offsets: `--topbar-h` 52px, `--bc-bar-h` 56px, `--bc-tabs-h` 42px. Tooltip: `--tip-bg`.
- Font: Inter, then Segoe UI and system fonts (tokens.css:64). Icons come from `lucide-react`, at size 16 in buttons.

Do not copy the hard-coded hex values in `.pill-draft`, `.pill-active`, `.pill-closed`, `.pill-approved`, `.pill-pending`, `.pill-rejected`, `.pill-agency` or `.pill-commercial` (styles.css:261-268). They are existing exceptions, not a pattern to follow.

## Shared components (import, never re-implement)
`frontend/src/ui/ui.tsx`
- `Button` (ui.tsx:14): `variant` is `'primary' | 'secondary' | 'ghost' | 'danger'`, default `secondary`. Optional props are `compact` and `icon` (a LucideIcon).
- `IconButton` (ui.tsx:34): `label` is required (it becomes the aria-label and the title). Also takes `danger` and `reason`, which explains a disabled state in the tooltip.
- `Banner` (ui.tsx:70): `kind` is `info | success | warning | error | locked`. Optional `actions`.
- `EmptyState` (ui.tsx:93), `ConfirmDialog` (ui.tsx:119), `Stepper` (ui.tsx:194), `TabsBar` + `TabDef` (ui.tsx:214-225), `CloseIcon`.

`frontend/src/ui/toast.tsx`: `ToastProvider`, `useToast()` returning `push(kind, title, detail?)`, `ToastKind`.

`frontend/src/ui/citation.tsx`: `CitationProvider`, `useCitation()` returning `show(CitationInfo)`, `CitationInfo`, `SpreadsheetDocumentViewer`.

`frontend/src/components/`
- `common.tsx`: `useSort`, `SortTh`, `useColFilters`, `PAGE_SIZES`, `usePagedTable`, `Pager`, `TextCell`, `StatusPill`.
- `bc.tsx`: `ChecksPanel`, `FailedChecksList`, `BcSection`, `DrbSummarySection`, `DrbBcSection`.
- `../businessCase/`: the V3 business case workspace. `Workspace.tsx` (sticky summary bar, seven workbook tabs, save bar), `tabs/*.tsx`, `cells.tsx` (`Fx`, `NumCell`, `DateCell`, `AddRowButton`, `ProvenanceBadge`, `ProvenanceLegendItems`), styles in `workspace.css` (ported from the V1 POC, tokens only).
- `rfp.tsx`: `PackSection`, `TenderPackSection`, `SubmissionSection`, `QualSection`, `ClausesSection`, `isTenderLocked`, `docCounts`, `useJobSim`.
- `library.tsx`: `LibraryUpload`, `TagPicker`, `bumpVersion`, `certProblems`, `LibraryKind`.
- `upload.tsx`: `UploadDialog`, `StagedFile`, `formatSize`.
- `ProgressStages.tsx` (demo stage simulator) and `backToTender.tsx` (`BackToTender` link).

## Buttons (styles.css:89-125)
- `.btn` default height is 40px, padding `0 var(--sp-4)`, and labels never wrap. Use `compact` for 32px (`.btn-compact`), in toolbars, banners and pagers.
- `primary` is a filled brand purple button. Use one per view or dialog for the main action.
- `secondary` has a purple outline. Use it for the other actions.
- `ghost` has no border. Use it for Cancel and low-emphasis actions.
- `danger` is red and only for destructive actions.
- `IconButton` is 32×32 and icon-only. Always give it `label`, and give `reason` when it is disabled.
- Disabled buttons explain why in `title` (see `rfp.tsx:322`). Hide nothing for permissions. The API enforces roles too.

## Toast vs Banner vs Dialog
- Toast (`useToast().push`): transient feedback after an action completes. Examples: "Processing started" (rfp.tsx:228), "Version N deleted" (bc.tsx:765), and an invalid input error (bc.tsx:276). Toasts always auto-dismiss: success/info after 5s, warning/error after 8s (toast.tsx:24). At most 3 stack top-right. Never put something the user must keep seeing in a toast. `App.tsx` also raises success toasts from selected audit actions (`CONFIRM_FROM_AUDIT`).
- Banner: persistent, page or section level state that stays while the condition holds. Examples: tender locked or archived (`kind="locked"`, TendersPage.tsx:149), results out of date or partial (rfp.tsx:126-145), Final Check failures (`warning`, which warns and never blocks), unsaved business case edits on the MSPO tab (`info`), and view-only role (`info`, RulesPage.tsx:47). Put the fix action in `actions` as a compact Button.
- `ConfirmDialog`: destructive or irreversible actions (`danger`), leaving with unsaved changes (`lib/leaveGuard.tsx:46`), and short forms or uploads (`wide`, e.g. Create tender, `UploadDialog`). `confirmLabel` names the action ("Delete version", never "OK"). Cancel holds the default focus. Use `confirmDisabled` for required input. Never use `window.confirm`.

## Tabs and sticky rules
- Use `TabsBar` for every tab strip. It handles keyboard arrows, `disabled` + `disabledHint`, and `badge` counts.
- Sticky variants (styles.css:289-291):
  - `sticky` alone sits below the BC summary bar (`--bc-bar-h`).
  - `sticky stickyAtTop` is the top-level tender tabs (TendersPage.tsx:159).
  - `sticky stickyBelow` is the second strip stacked under it (rfp.tsx:549).
- Table headers (`table.grid th`) are sticky. Inside tender tabs they are offset by one or two `--bc-tabs-h` (styles.css:302-308). Inside a `.scroll-x` pane they stick at 0. When you add a new sticky layer, use these height tokens. Do not use magic pixel offsets.
- Only `main` scrolls. The shell stays fixed (styles.css:18-22).

## Fixed-height list pages and pagination
- List pages (Tenders, Historical data/Repository, Audit) use `<div className="fill-page">` with `<div className="table-viewport">` holding the `table.grid`, then `<Pager {...usePagedTable(rows)} />` (v2.css:47-55, AuditPage.tsx:77-124).
- The page itself never scrolls. The table scrolls inside the viewport, and the pager stays visible.
- Rows per page come from the user's choice of `PAGE_SIZES` [10, 20, 50, 100], default 20. Changing the size keeps the same first record (common.tsx:206). The v2.css:48 comment mentions a ResizeObserver, but none exists in the code. Do not rely on one.
- Rows are a fixed height: 36px, or 30px for `.tiny` (styles.css:151-152).

## Source viewer (70%)
- To show a source, call `useCitation().show({...})` with a `CitationInfo` (citation.tsx:10). `CitationProvider` (mounted in App.tsx:157) renders `DocumentViewer`.
- The modal is `width: max(70vw, 720px)`, `height: min(90vh, 100%)`, and goes full width at 1024px or below (styles.css:430-438). It traps focus, closes on Esc, and returns focus to the trigger.
- PDF/Word go through `@docmentis/udoc-viewer` and highlight the cited passage. Excel goes through `SpreadsheetDocumentViewer`.
- Every AI-extracted item must keep a link back to its source through this viewer. Do not build another viewer.

## Status vocabulary
- Status types live in `frontend/src/types.ts`: `TenderStatus`, `TenderStatusReason`, `RepoStatus`, `PackDocStatus`, `ExtractReviewState`, `ComplianceStatus`, checklist `status` and draft `status`. They mirror the enums in `db/schema.sql` and `api/src/types.ts`. Keep all three in sync, and never invent a status name.
- Render statuses with `<StatusPill value={...} />` (common.tsx:317). It maps each value to a class:
  - `pill-won` is green: Done, Won, Comply, Generated, Available.
  - `pill-lost` is red: Failed, Lost, Do not comply.
  - `pill-submitted` is blue: In progress, Extracting text, Analysing, Processing.
  - `pill-review` is amber: Needs review, Clarify, Partially comply.
  - `pill-draft`, `pill-pending`, `pill-approved`, `pill-rejected`, `pill-active` and `pill-closed` cover the tender status reasons.
  - `pill-neutral` covers Uploaded and anything unknown. `pill-archived` covers Archived.
- `Uploaded` displays as "Uploaded, not processed".
- For a new status value, add it to the map in `StatusPill`, not inline. Reuse an existing pill class. If none fits, ask.
- Provenance badges: `.badge-ai`, `.badge-human`, `.badge-sector`, `.badge-neutral` (styles.css:240-244, v2.css:4).
