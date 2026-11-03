# Task 3-c — Admin Beneficiaries (case management) + Users rebuild — work record

**Agent:** 3-c-coder
**Files touched (ONLY these two):**

- `src/components/admin/beneficiaries-view.tsx` (full rebuild, ~1,590 lines)
- `src/components/admin/users-view.tsx` (full rebuild, ~1,240 lines)

## Status

- `bunx tsc --noEmit` → **0 errors in my two files** (project-wide there is 1 transient error in `src/components/admin/campaigns-view.tsx:1719` — another agent's file, mid-edit at the time of my check).
- `bun run lint` → **0 errors/warnings in my two files** (1 pre-existing warning in `campaigns-view.tsx` — unused eslint-disable).
- No git, no dev-server restarts, no edits outside my file list.

## beneficiaries-view.tsx — what was built

- **Directory**: `GET /api/beneficiaries` (ADMIN/VOLUNTEER), full client filters: debounced search (name/guardian/phone/city/case worker), category, caseStatus, verificationStatus. Client-side pagination (`PaginationBar` + `PageSizeSelect`, default 25/page).
- **StatCards (4)**: Total cases (emerald) · Active cases `caseStatus=ACTIVE` (teal) · Awaiting verification `verificationStatus=PENDING` (amber) · Critical urgency (red).
- **Views**: `useViewPref("beneficiaries")` + `ViewSwitcher` — table (Name+guardian / Category / Urgency StatusBadge / City / Case status / Verification / Case worker / Actions), responsive grid cards, compact scrollable list. Row click opens detail sheet; action cell stops propagation.
- **Add/Edit = FormSheet size lg** with 4 FormSections: Identity (name*, guardian, age, gender Select MALE|FEMALE|OTHER, phone* `phoneRule()`, email `emailRule(true)`), Address (address, city, state, PIN* `pinRule()`), Case (category, urgency, caseStatus, verificationStatus, caseWorker, intakeDate date input, photoConsent SwitchField), Need (familyMembers, monthlyIncome/monthlyNeed ₹, needs, documents Textarea with hint "comma-separated document refs", notes). Validation via `@/lib/validators`; dirty tracking + unsaved-changes guard.
- **Category options**: `useMasters("BENEFICIARY_CATEGORY")` labels merged over the canonical 10 schema values (WIDOW…OTHER) so masters labels win but the POST/PATCH-valid enum is always complete (the hook's built-in fallback has non-enum values like FAMILY/CHILD, which the API would 400 on).
- **Detail Sheet with Tabs** (`key={id}` resets tab per record): Overview (all fields as DataField, grouped Identity/Address/Case/Need) · Case notes (`GET/POST /api/beneficiaries/:id/notes` — timeline with author+time, add-note textarea + button, per-state loading/empty) · Assistance history (`/api/distributions?limit=200` fetched once, cached in a ref, filtered by `beneficiaryId`) · Requests (`GET /api/beneficiary-requests` cached, filtered client-side by `beneficiaryId`). Long lists `max-h-96 overflow-y-auto scrollbar-thin`.
- **Quick case actions** (Actions dropdown): Send to verification (INTAKE→VERIFICATION), Activate case (VERIFICATION→ACTIVE), Mark verified (`verificationStatus: "VERIFIED"`), Close case → **ConfirmDialog** (`caseStatus: "CLOSED"`), Reject case → **ConfirmDialog** (`caseStatus: "REJECTED"`). All `PATCH /api/beneficiaries/:id`; rows updated in place (list + open detail sheet).
- Delete (ADMIN only) → ConfirmDialog. CSV export (20 columns) via `ExportMenu`. Skeletons match the active view; EmptyStates with clear-filters + CTA; sonner toasts everywhere; semantic tokens only (dark-safe), no indigo/blue; icon buttons aria-labelled; list/grid rows keyboard-accessible (`role="button"` + Enter/Space).

## users-view.tsx — what was built

- `GET /api/users?limit=500`, client filters (search + role + status), client pagination.
- **Table**: User (initials avatar + name + "You" chip + email), **inline Role Select** (per-row; change → ConfirmDialog → `PATCH { role }`), StatusBadge, City, Phone, PAN, Joined, Actions. Grid + list views via `useViewPref("users")`.
- **Add FormSheet (md)**: name*, email* `emailRule()`, password* `minLen(6)`, role Select, city, phone.
- **Edit FormSheet (lg)**: name*, email (hint "changing the email affects sign-in"), phone `phoneRule(true)`, city, PAN `panRule(true)`, about Textarea, role, status Select, isActive SwitchField, optional new-password `minLen(6)`.
- **Role-change guards**: inline + in-form changes both go through ConfirmDialog; client-side last-admin guard (cannot demote the only ADMIN — self-demote warning text too). Self-delete + last-admin delete guards kept (button disabled with explanatory aria-label + runtime guards in confirm).
- **Detail Sheet**: Account (name/email/role/status/active/ID) · Profile (phone/city/PAN/about/joined/updated) · Giving history for DONOR (completed donations + total, `GET /api/donations?limit=500`, note "latest 500 records"; API failure → friendly "unavailable" message instead of endless skeleton) · Volunteer record for VOLUNTEER (`GET /api/volunteers`, matched by `userId`) · Linked case for BENEFICIARY (`GET /api/beneficiaries`, matched by `userId`) · Security block (Last login "Not tracked" + Account created `createdAt`).
- CSV export (9 columns), skeleton/empty/toast parity, dark-safe tokens.

## API gaps found (backend not in my file list)

1. **`PATCH/POST /api/beneficiaries` ignore most new fields** — current route only persists name, phone, email, city, address, category, urgencyLevel, familyMembers, monthlyIncome, needs, notes, isActive. The UI sends (but the API silently drops): `guardian, age, gender, state, pincode, monthlyNeed, documents, caseStatus, caseWorker, verificationStatus, photoConsent, intakeDate`. The **quick case actions (advance/mark verified/close/reject) PATCH `caseStatus`/`verificationStatus` and will no-op** until the route accepts them. Backend agent should add these to POST + PATCH with the same enums/regexes (phone/pin/email).
2. **`GET /api/beneficiaries` doesn't accept `caseStatus`/`verificationStatus` query params** — I filter client-side, so this is only a nice-to-have for server pagination later.
3. **`GET /api/beneficiaries/:id` doesn't exist** — detail view works from the list row (fine for now; only needed if deep-links land on a single case).
4. **`/api/users` POST has no server-side min-length check** on password (PATCH enforces ≥6) — client enforces 6.
5. Unrelated (other agent): `src/app/api/donations/route.ts` currently 500s (`include: { donorRef }` — unknown field; schema relation is `donor`/`donorRefId`). My users-view donor-stats call handles the failure gracefully, but the donations module + my donor summary need that route fixed.

## Notes for next agents

- View prefs persist under `uar-view-beneficiaries` / `uar-view-users`.
- Category label map: masters labels override canonical 10; if masters add NEW non-enum categories they are intentionally not offered for writes (API 400s on them).
- Donor/volunteer/beneficiary "linked record" lookups reuse the list endpoints and are fetched on detail open (no polling).
