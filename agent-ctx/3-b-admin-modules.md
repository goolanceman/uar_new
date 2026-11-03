# Task 3-b — Admin modules rebuild (campaigns / causes / animals)

Agent: 3-b-admin-modules · Date: round 3
Scope: ONLY `src/components/admin/campaigns-view.tsx`, `src/components/admin/causes-view.tsx`, `src/components/admin/animals-view.tsx` (per ownership list).

## What was built

All three modules now follow the ROUND-3 "List-page pattern":

1. **Toolbar** (inside one `SectionCard` header row, wraps on mobile): debounced (300 ms) search input, filter Selects, `ViewSwitcher` (table/grid/list, persisted via `useViewPref` keys `uar-view-campaigns|causes|animals`), `ExportMenu` (CSV), primary action button.
2. **Table view**: sticky-styled header (`bg-muted/50`), hover rows, row click opens detail Sheet, right-aligned actions `DropdownMenu` (View / Edit / Duplicate / status actions / Delete) with `stopPropagation` so the dropdown never triggers the row click.
3. **Grid view**: responsive `sm:grid-cols-2 xl:grid-cols-3`; campaigns = rich accent cards (accent ring/dot, progress bar raised/target, days-left chip from `endDate`, featured/urgent/80G chips); causes = teal progress cards with condition + pledge-count badges; animals = species icon cards with vaccinated/sterilized mini badges.
4. **List view**: compact rows (icon + title + meta line + trailing value + StatusBadge + kebab menu).
5. **Client-side pagination** (`PaginationBar` + `PageSizeSelect`, default 10/page, auto reset to page 1 on filter change) since all three endpoints return raw arrays (legacy shape — envelope fallback handled).
6. **Skeletons per view** (`ViewSkeleton` renders table/grid/list variants), `EmptyState` with CTA (new record vs clear filters), sonner toasts on every mutation/error.
7. **Forms** = `FormSheet` (campaigns `lg` with 6 `FormSection`s: Basics / Funding / Schedule & place / Team & contact / Media & SEO / Budget; causes `md` with Patient / Sponsorship / Story; animals `lg` with Profile / Health & care / Story), using `TextField/TextareaField/SelectField/SwitchField/FieldGrid`, inline field errors via `@/lib/validators` rules (`required`, `amountRule`, `phoneRule`, `minLen`, date-range check for campaign endDate, URL check for videoUrl + gallery lines), JSON-snapshot **dirty tracking** + discard-confirm `ConfirmDialog` on close.
8. **Detail Sheets**: campaigns = full 360 (funding ProgressRing + minDonation/80G flags, schedule + days-left, coordinator with `copy` DataFields, budget-breakdown table with share % and total-vs-target, media/SEO with gallery thumbnails, reach + linked donation count via `GET /api/donations?campaignId=…&limit=1` reading `total` from the envelope); causes = fields + progress + **pledges Table** + adopted banner; animals = fields + disabled vacc/ster switches + pledges list.
9. **Campaign-specific actions**: Duplicate (POSTs full payload with `title + " (Copy)"`, slug omitted → server generates unique slug; COMPLETED/CANCELLED copies land as DRAFT), Activate/Pause quick actions, Complete behind `ConfirmDialog`, Delete blocked when `raisedAmount > 0` (disabled menu item labelled "Delete — has donations" + toast guard).
10. **Preserved behaviours**: causes certificate issuing (POST `/api/certificates`, `refType: "PLEDGE"`, opens `/api/certificates/:code/html` from toast), pause/resume toggle; animals adopt Dialog with user search (`GET /api/users?q=`) + ANIMAL_ADOPTION certificate + foster/critical status toggles; campaign ICONS/ACCENTS maps + ProgressRing + slug auto-slugify (hint: "Leave blank to auto-generate").
11. **CSV exports**: campaigns (24 cols incl. urgent/taxEligible/minDonation/coordinator/budget heads/SEO), causes (13 cols), animals (14 cols). Export operates on the filtered set.
12. Dark-mode: semantic tokens only (`bg-card`, `bg-muted/40`, `text-muted-foreground`); accent colors only as `/10` + `dark:text-*-400` variants; NO indigo/blue anywhere. All icon-only buttons carry `aria-label`; touch targets ≥44px on mobile (`size-11 md:size-9`).

## API gaps found (NOT fixed — outside file ownership)

1. **`GET /api/donations` currently 500s** — the route's include references `donorRef` which the Prisma client reports as an unknown field on `Donation` (schema/client mismatch). Seen in dev.log: `Unknown field 'donorRef' for include statement on model 'Donation'`. Impact here: the campaign detail Sheet's "Linked donations" count falls back to "…" (handled gracefully via `.catch`). Whoever owns donations routes (3-a / 5-c) must fix the include or regenerate/push Prisma.
2. **`PATCH /api/animals/:id` ignores `adoptedByName` / `adoptedById`** — the whitelist (name, species, breed, ageMonths, gender, story, healthStatus, vaccinated, sterilized, location, monthlyFood, status) drops both fields, so ADMIN adoptions save the status + certificate but NOT the adopter name (only VOLUNTEER sessions get auto-attribution). The view still sends both keys (forward-compatible). Route owner should add `adoptedByName`/`adoptedById` handling for ADMIN.
3. **`GET /api/campaigns|causes|animals` return raw arrays (no pagination envelope)** — views paginate client-side; fine at current scale, switch to server params if datasets grow.
4. Campaign `beneficiaries`/`volunteersEngaged` are not editable in the form (no admin endpoint accepts them in this round's contract) — displayed read-only in the 360 sheet.

## Verification

- `bunx tsc --noEmit` → **exit 0, clean** (one transient error in `inventory-view.tsx` (`setPageSafe`) observed mid-session had already been fixed by its owner by final run).
- `bun run lint` → **0 errors, 0 warnings**.
- No git commands, no dev-server restarts, no edits outside the three owned files.
