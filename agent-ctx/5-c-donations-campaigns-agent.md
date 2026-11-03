# Task 5-c — Fundraising admin modules → round-5 design system

Agent: donations-campaigns-agent · Date: round 5 · Status: DONE

## Scope (owned files — nothing else touched)
- `src/components/admin/donations-view.tsx`
- `src/components/admin/donors-view.tsx`
- `src/components/admin/campaigns-view.tsx`
- `src/components/admin/causes-view.tsx`

## What changed (per module)

### Donations
- Table view replaced with `DataTable` `height="fill"` `fillOffset={520}`, `skeletonRows={9}`,
  sticky header, built-in premium pager (old `PaginationBar` + `PageSizeSelect` block removed for
  the table view; kept for grid/list where the built-in pager doesn't apply). Page-size state
  (`limit`) stays the single source of truth, wired to `onPageSize`.
- Columns: Receipt # (mono), Donor (name+email+anon chip), Amount (right, mono, semibold),
  Type (hideBelow md), Category (lg), Method (lg), Status, Date (md), Campaign (lg), Actions.
  Row click opens detail; actions cell stops propagation.
- Detail: `FormSheet` → full-screen `DetailSheet` (eyebrow "Donations", title = receipt number,
  status chip = payment status, header actions = Edit + "80G receipt" opens
  `/api/receipts/:receiptNumber/html` when COMPLETED). Body uses `DetailSection` + `DetailGrid`
  + `DataField` with **every Donation field**: donor name/email/phone/PAN/anonymous/donorRef CRM
  link/message, amount/currency/type/frequency/category/campaign/nextChargeAt, method/provider/
  status/transactionId/gatewayOrderId/fees/netAmount/settlementDate, receipt number/status/
  issuedAt + the three-state 80G note (cash>₹2,000 warning kept), refund block (conditional),
  internal notes, record id/createdAt/updatedAt. Empty values fall back to "—".
- FormSheet add/edit stays `size="lg"`, validation + `dirty` unchanged.
- Toolbar consolidated: search (debounced), status/type/category/method selects, from/to dates,
  active-filter chips with per-chip x, Clear-all, live result count. Grid/list skeletons kept
  (table skeletons come from DataTable). EmptyState shared via `empty` node for all views.

### Donors (CRM)
- Same DataTable treatment (`fillOffset={520}`): Donor (avatar+org badge+email), Contact (lg),
  City (md), PAN (mono, lg), Lifetime (right mono), Gifts (right mono, md), Last gift (lg),
  Tags (lg), Actions.
- Detail: `FormSheet xl` → full-screen `DetailSheet` (eyebrow "Donors · CRM", title = donor name,
  status chip = type·segment, header action = Edit donor). Donor-360 keeps the tabs
  (Profile / Donations / Pledges & sponsorships / Certificates); profile cards converted to
  `DetailSection`+`DetailGrid`+`DataField` (identity, address, tax & prefs, comms, tags & notes);
  lifetime stats strip kept; related donations/pledges/certificate rows kept (80G receipt +
  certificate HTML open buttons intact).
- FormSheet add/edit stays `size="lg"` with rule-factory validation + dirty.

### Campaigns
- NEW KPI stat strip (computed from loaded rows, no extra API): Total campaigns, Active now,
  Raised all-time, Beneficiaries reached — with StatCard skeletons.
- Toolbar moved out of card-header into one body row: search, status/category selects, chips,
  clear-all, result count; ExportMenu + ViewSwitcher stay in the card header.
- Table view → `DataTable` `fillOffset={520}`: Campaign (icon chip + title + featured/urgent +
  slug mono), Category (lg), Status, Progress bar (md), Raised (right mono, "of target"),
  Deadline chip (lg), Actions. Client-side pagination via built-in pager; grid/list keep
  PaginationBar.
- Detail: raw `Sheet` → full-screen `DetailSheet` (eyebrow "Campaigns", title, status chip +
  featured/urgent, header actions = Edit + row menu, footer = Activate/Pause + Complete + Close).
  Body: Funding (ProgressRing + linked donations/min donation/80G/category/raised/target),
  Identity (title/slug/tagline/icon/accent/status/createdBy), Schedule & place (incl. days
  remaining), Team & contact (+ call-helpline link), Reach (beneficiaries/volunteers +
  description), Budget breakdown table (kept), Media & SEO (video link, gallery grid), Record
  (id/created/updated — interface extended with optional createdAt/updatedAt from API).
- FormSheet → `size="full"` composer, re-organised into Identity / Story / Goal & funding /
  Branding (icon + accent pickers kept) / Schedule & place / Team & contact / Media & SEO /
  Budget breakdown / Settings & visibility (80G, featured, urgent). Validation, slug auto-fill,
  budget math, unsaved-changes ConfirmDialog all preserved.

### Causes (Adopt-a-Medicine)
- DataTable `fillOffset={520}`: Code (mono), Patient (name + age·city), Condition badge (lg),
  Monthly (right mono), Progress (md), Status, Actions. Built-in pager for table; grid/list keep
  PaginationBar.
- Custom status chip maps removed in favour of the canonical `StatusBadge`
  (SEEKING/PARTIAL warning, ADOPTED purple, PAUSED warning; pledge ACTIVE/COMPLETED/CANCELLED).
- Detail: raw `Sheet` → full-screen `DetailSheet` (eyebrow "Adopt-a-Medicine", title = patient,
  code mono in description, status chip; header actions = Edit + Issue certificate (ADOPTED);
  footer = Pause/Resume + Delete + Close). Body: Sponsorship math (progress bar, monthly cost,
  duration, total needed, raised, still needed, active monthly pledge sum), Patient profile with
  every Cause field (code, name, age, city, condition, status, created — interface extended with
  optional createdAt), Adoption card, Story, Pledges table (+ "since" column, pledge interface
  extended with optional startDate).
- FormSheet `size="md"` → `size="lg"` per contract; validation unchanged.

## DataTable fill offsets used
All four: `fillOffset={520}` (measured: admin sticky header 56 + main padding 24 + PageHeader ~68
+ gap 24 + KPI strip ~108 + gap 24 + SectionCard header ~64 + toolbar ~36 + gaps 16 + pager ~44
+ main bottom padding 24 + admin footer ~41 ≈ 520). All four views share the same layout order:
PageHeader (primary Add action) → KPI strip → SectionCard(header actions: Export + ViewSwitcher)
→ toolbar row (filters + chips + clear-all + count) → DataTable / grid / list → pager (grid|list).

## Preserved features (verified)
- 80G receipt buttons: donations detail header + receipt section, donor-360 donations tab
  (`window.open('/api/receipts/<receiptNumber>/html')`).
- Certificate generation: causes issueCertificate flow + donor certificate open buttons.
- Donation edit fix (full PATCH body), refund two-step (FormSheet sm + ConfirmDialog),
  campaign accent/icon pickers, duplicate/activate/pause/complete/delete-guard,
  cause pause/resume, donor CRM aggregates (stats strip in Donor-360), MDM dropdowns
  (`useMasters("CITY"/"CONDITION")`), CSV exports (unchanged column sets).
- `useViewPref(moduleKey)` + ViewSwitcher present on all four; ConfirmDialog everywhere for
  deletes/refund/complete/discard.

## API gaps found (not edited — out of scope)
1. `GET /api/donations` does not accept `campaignId` as a documented filter — campaigns view
   works around it with `?campaignId=…&limit=1` and reads `total`; would be cleaner as an
   official param (behaviour already works, so no change requested).
2. `GET /api/causes` returns pledges including `startDate` (good) — no gap; noted only that the
   Cause rows don't include `updatedAt` (createdAt only) so the detail sheet shows Created.
3. Donor list endpoint computes `lifetimeValue/donationsCount/first/lastDonationAt` server-side
   (good); no gaps for the round-5 fields.

## Validation
- `bun run lint`: **my 4 files clean**. Two transient errors appeared in OTHER agents' files
  during my run (`reports-view.tsx` require() — since fixed by its owner;
  `volunteers-view.tsx` missing `Skeleton` import at time of writing — that agent is actively
  editing; not my scope).
- `tsc --noEmit`: zero errors in the four owned files (fixed one `DataField hint` misuse in
  causes-view; removed dead imports). Remaining tsc errors exist only in other agents' files
  (reports route, beneficiaries/inventory/users/volunteers views).
- dev.log: clean compiles, no runtime errors (`GET / 200`, settings API 200).
