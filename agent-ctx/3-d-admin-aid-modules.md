# Task 3-d — Admin Aid Modules (Kits / Inventory / Distributions)

**Agent:** 3-d (admin aid modules rebuild)
**Files touched (only these three):**
- `src/components/admin/kits-view.tsx`
- `src/components/admin/inventory-view.tsx`
- `src/components/admin/distributions-view.tsx`

**Status:** ✅ Complete — `bunx tsc --noEmit` clean, `bun run lint` exit 0.

---

## What was built

### 1. kits-view.tsx — "Aid & Distribution Kits" (generalized from Ration Kits)
- In-page copy generalized: PageHeader now "Aid & Distribution Kits"; empty states, QR
  label captions ("UAR {Kind} Kit"), sheet descriptions and wizard hints are **kind-aware**
  (e.g. "Scan unit — RATION kit batch #Diwali drive").
- **Kind system**: `KINDS = RATION|FOOD|EDUCATION|MEDICAL|HYGIENE|CLOTHING|EMERGENCY|CUSTOM`
  with per-kind lucide icon + dark-safe chip class + default code prefix
  (RATION→UAR-RK, FOOD→UAR-FD, EDUCATION→UAR-ED, MEDICAL→UAR-MD, HYGIENE→UAR-HY,
  CLOTHING→UAR-CL, EMERGENCY→UAR-EM, CUSTOM→UAR-CT).
- **Template FormSheet (md)** replaces the old centered Dialog: name, kind Select **with
  icons**, description, status Select (ACTIVE/RETIRED), image URL, items repeater
  (MDM UNIT options), cost ₹, codePrefix with live computed preview
  (`unit codes become {prefix}-YYYY-NNNNNN · first code ≈ {prefix}-2026-000001`).
  Sends kind/codePrefix/image/status to POST/PATCH (see API gaps).
- **Batches tab**: cards now show template **kind chip** (resolved via client-side
  templateId→template map), scanned/total badge, StatusBadge (shared primitive),
  progress, est. value. 2-step wizard (template → name/units/instructions) now lives in a
  **FormSheet (md)** with submitLabel switching Next/Create, step hint in footerExtra,
  totalUnits 1–500, summary incl. kind + prefix preview.
- **Detail Sheet**: batch DataFields (total/scanned/remaining), kind chip, unit table with
  status filter + code search + scannedAt/scannedByName/location; copy-code action kept;
  delete via ConfirmDialog.
- **QR label sheet kept** (qrcode lib, print grid, `.print-sheet`, 200/sheet cap with
  warning badge).
- **Templates tab**: `useViewPref("kit-templates")` + ViewSwitcher (table/grid/list),
  ExportMenu CSV (name/kind/status/items/cost/batches/prefix/description), grid cards show
  image thumb + kind chip + StatusBadge + prefix badge; **retired templates cannot start
  batches** — "Use" button disabled with hint chip/copy in all three views and disabled
  rows in the wizard picker.

### 2. inventory-view.tsx — rebuilt
- **Toolbar** (SectionCard header): debounced search (300ms), category Select (MDM
  INVENTORY_CATEGORY merged with categories present on items), **low-stock toggle**
  (quantity ≤ minStock), ViewSwitcher (`useViewPref("inventory")`), ExportMenu CSV,
  Add item.
- **StatCards**: Total items · **Low stock (clickable → toggles the low-stock filter,
  aria-pressed, ring highlight)** · Stock value · Expiring ≤30 days.
- **Item FormSheet (md)**: name, description, category (useMasters fallback + merged
  extras), unit (useMasters UNIT + merged extras), quantity ≥0, minStock ≥0, price ₹
  optional, location, expiryDate optional (dateRule). Unsaved-changes guard via touched
  flag.
- **Grid cards**: stock **Progress vs minStock** (amber when low, emerald healthy),
  expiry badge when ≤30 days (red), price chip, low-row tinting; table view (paginated
  PaginationBar + PageSizeSelect) and compact list view also included.
- **Detail Sheet**: DataFields + low-stock banner + **purchase history section** — tries
  `GET /api/inventory/:id` and renders `purchases[]` if the API ever returns them; today it
  405s, so shows "—" + explanatory note (forward-compatible).
- **Stock-in FormSheet (sm)**: quantity ≥1, price ₹, supplier, invoiceNumber → PATCH
  `addQuantity` (supplier/invoice sent; server logs to activity only — gap below).

### 3. distributions-view.tsx — rebuilt
- **General tab**: `useViewPref("distributions")` table/grid/list, type filter, debounced
  search (beneficiary/location/notes/campaign/type), ExportMenu CSV, paginated table.
- **Record-distribution FormSheet (lg)**: type Select (8 values), **beneficiary** =
  filter-input + native select fed by `/api/beneficiaries` (simplest robust searchable
  combo), campaign optional Select (`/api/campaigns?all=1`), quantity ≥1, value ₹
  (amountRule optional — **now persists**), **value-per-unit hint** (`≈ ₹X per unit`),
  location, distributedAt (date, defaults today, dateRule), repeatable item rows
  {name, qty} with **inventory pricePerUnit match hints** (est line total), notes.
- **Pad drives tab**: existing table columns kept; new grid/list views
  (`useViewPref("pad-drives")`); 4 StatCards kept (Schools icon now School).
- **Pad FormSheet (md)**: area, **schoolName = SearchableSelect** fed by
  `GET /api/school-coverages` (active-only suggestions, visits count per row, free-text
  fallback for new schools; on save a **new school is auto-registered** via
  `POST /api/school-coverages` with lastVisited — only when it didn't already exist),
  girlsCount ≥0, padsDistributed ≥0, awarenessSession SwitchField, sessionAttendees
  optional, **volunteerName** (see gap), distributionDate date, notes.
- **School registry mini-panel**: SectionCard listing schools with visitsCount/totalGirls/
  isActive/lastVisited + "Register school" → FormSheet (sm) posting schoolName/city/
  contactPerson/contactPhone/totalGirls to `/api/school-coverages`.
- Both tabs: read-only detail Sheets, ConfirmDialog deletes, view-matched skeletons,
  EmptyStates with CTAs, sonner toasts, dark-safe semantic tokens, no indigo/blue,
  aria-labels on all icon-only controls.

---

## Verification
- `cd /home/z/my-project && bunx tsc --noEmit` → **0 errors**
- `bun run lint` → **exit 0**
- Dev server not probed via HTTP (sandbox managed); compile verified via tsc.
  Note in dev.log: `GET /api/donations` 500s — **pre-existing, outside my files**
  (route includes `donorRef` but the running Prisma client doesn't know the field;
  schema.prisma *does* define the relation → looks like a stale `prisma generate`).
  I did not touch it per file-ownership rules.

## API gaps found (backend owners, not view bugs)
1. **`/api/kit-templates` POST/PATCH ignore `kind`, `codePrefix`, `image`, `status`**
   (schema v3 has them; route builds data without them). New templates therefore come
   back kind=RATION/default ACTIVE until the route is updated. Also
   `GET /api/kit-batches` includes template `{name, costPerUnit}` only — add
   `kind` (and `codePrefix`) to the include; the batch kind chip currently resolves
   client-side via the templates map. And `POST /api/kit-batches` hardcodes the
   `UAR-RK-` unit-code prefix — honor `template.codePrefix`/kind default so the UI
   hint "{prefix}-YYYY-NNNNNN" matches reality.
2. **`GET /api/inventory` returns no purchases and `GET /api/inventory/:id` doesn't
   exist** (405 — file only has PATCH/DELETE). Purchase history shows "—" + note.
   Also: POST/PATCH don't persist `expiryDate`, and the stock-in PATCH ignores
   `supplier`/`invoiceNumber` — no `InventoryPurchase` row is created. Suggested:
   support `GET /api/inventory/:id?include=purchases`, persist expiryDate, and create
   an InventoryPurchase on addQuantity when supplier/invoice present.
3. **`POST /api/pad-distributions` ignores `volunteerName`** (attributes to the session's
   volunteer profile only). The form keeps the field with an explanatory hint; either
   persist it (needs schema field) or drop it from the contract.
4. *(Observed, other agent's file)* `/api/donations` 500 — `donorRef` include vs stale
   Prisma client; needs `bunx prisma generate` / route re-check.

## Patterns used (for future agents)
- List-page standard: toolbar row (search + filters + ViewSwitcher + ExportMenu + Add) →
  table (PaginationBar + PageSizeSelect) / grid / list via `useViewPref` → skeletons per
  view → EmptyState with CTA → FormSheet for all writes → ConfirmDialog for deletes.
- View pref keys used: `uar-view-kit-templates`, `uar-view-inventory`,
  `uar-view-distributions`, `uar-view-pad-drives`.
