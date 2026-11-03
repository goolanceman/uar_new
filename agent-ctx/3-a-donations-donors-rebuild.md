# Task 3-a — Admin Donations & Donors module rebuild (work record)

## Files touched (only these two)
- `src/components/admin/donations-view.tsx` — full rebuild (~1,500 lines)
- `src/components/admin/donors-view.tsx` — full rebuild (placeholder → Donor CRM)

## What was built

### Donations ledger (`donations-view.tsx`)
- **StatCards**: FY collected (server `completedSum` via `GET /api/donations?status=COMPLETED&from=<Apr-1>&limit=1`), all-time count, pending count, refunded total (sums `refundAmount ?? amount` over `status=REFUNDED` items, limit 500).
- **Server-side pagination + filters**: `page`, `limit` (PageSizeSelect), debounced 300 ms `q` (name/email/receipt/txn), status / type / category / method Selects, from–to date range; "Clear" chip when active; page clamps when the list shrinks.
- **ViewSwitcher** (persisted `useViewPref("donations")`): table (Receipt #, Donor + Anonymous badge, right-aligned amount, Type, Category, Method, StatusBadge, Date, Campaign, Actions dropdown), grid donor cards, compact list rows. Row/card click opens detail.
- **Detail sheet (FormSheet lg, no submit footer)**: Donor block, Payment block (fees / netAmount / settlementDate / gatewayOrderId / transactionId / provider / next-charge), Receipt block (receiptStatus, issuedAt, **80G note: cash > ₹2,000 not eligible**, amber vs emerald vs neutral notes), Refund block (conditional), Campaign block with link → `navigate("/admin/campaigns")`, Internal notes. "Open 80G receipt" → `/api/receipts/{receiptNumber}/html` in a new tab (only when COMPLETED + receiptNumber).
- **Record/Edit FormSheet (lg)**: sections Donor / Donation / Payment / Receipt & notes (receipt section only in edit). Create mode POSTs only what the API accepts and hides server-managed fields (status, fees, settlement, receiptStatus). Recurring reveals frequency + next-charge (required). Category = the 9 canonical values; methods include CARD & CHEQUE; provider MANUAL|RAZORPAY|CASHFREE|PAYU|STRIPE. Dirty = JSON compare of initial vs current form; validation via `@/lib/validators` rule factories (required/emailRule/phoneRule(true)/panRule(true)/amountRule/dateRule) with inline Field errors. Create toast shows the returned **receiptNumber**.
- **Refund**: FormSheet sm (amount ≤ donation + reason) → ConfirmDialog → `PATCH {refundAmount, refundReason}`; API flips status to REFUNDED.
- **Delete** via ConfirmDialog (campaign totals recalculated server-side). **Export CSV** (receipt, donor, email, amount, currency, type, category, method, status, date, campaign). Empty state with "Record donation" CTA + clear-filters; skeletons per active view; all icon buttons aria-labelled; semantic tokens only, no indigo/blue.

### Donor CRM (`donors-view.tsx`)
- **StatCards**: total donors (server `total`), major donors ≥ ₹10,000 lifetime, new this month (createdAt), repeat donors (donationsCount > 1) — computed over an unfiltered `limit=200` fetch.
- **List**: server pagination + debounced `q` + type/segment filters; table (Donor+org badge, Contact, City, PAN, right-aligned Lifetime, Gifts, Last gift, Tags, Actions), grid cards (initials avatar, org badge, lifetime, gifts, comms-pref icons Mail/SMS/WhatsApp, city/PAN chips), compact list. `useViewPref("donors")`.
- **Donor-360 sheet (FormSheet xl)**: stats strip (lifetimeValue, fyValue, donationsCount, receiptsIssued, activePledges) + Tabs — Profile (Identity/Address/Tax & prefs/Communication/Tags & notes DataFields, linked account, tags), Donations (mini-table with per-row "open 80G receipt" links), Pledges & sponsorships (medicine pledges + animal pledges with StatusBadges), Certificates (open `/api/certificates/{code}/html`).
- **Add/Edit FormSheet (lg)**: Identity (name, type, conditional organisation name, email — disabled on edit since PATCH doesn't accept email, phone/altPhone), Address (pincode rule), Tax & prefs (panRule optional, wants80g / anonymousByDefault switches, language, source, segment), Communication opt-in switches, Tags comma-input → JSON array, notes. Same dirty/JSON + rule-factory validation.
- **Delete** ConfirmDialog warns donations stay, CRM record removed. Export CSV (17 columns incl. lifetime, gifts, tags). Skeletons/empty states/toasts/aria throughout.

## Verification
- `bunx tsc --noEmit` → **clean (0 errors)**
- `bun run lint` → **clean (0 problems)**
- DB checked: 12 donations, 0 donors, 9 campaigns → Donors module opens on its empty state (expected).

## Environment note / API gaps discovered
1. **Stale Prisma client in the previously-running dev process**: `dev.log` showed `GET /api/donations?...` → 500 `Unknown field 'donorRef'` for requests made by this view. On-disk everything is consistent (schema.prisma has `donorRef Donor?`, generated client at `node_modules/.prisma/client` contains donorRef, `prisma db push` reports "already in sync") — the 500 came from the old dev-server process holding the pre-regeneration client in memory. No dev server is listening now, so the next automatic start loads the fresh client and the endpoint works. Nothing needed changing in API files.
2. `GET /api/donations` `completedSum` respects the request filters, so FY/all-time/pending/refunded stats need 4 tiny extra calls (`limit=1`); a dedicated stats endpoint (or unfiltered `completedSum`) would remove them.
3. No server-side **refunded total** — refunded donations (≤500) are summed client-side.
4. `GET /api/donors` has no aggregate params — donor stats ("new this month", "≥ ₹10k", "repeat") are computed over the newest 200 donors; server-side aggregates would be exact for >200 donors.
5. `PATCH /api/donors/:id` does not accept `email` (unique key) — edit form disables it with a hint.
6. `POST /api/donations` ignores client-sent `paymentStatus`/`fees`/`receiptStatus` (server derives them) — create form hides those fields and hints that offline methods enter as Pending.
