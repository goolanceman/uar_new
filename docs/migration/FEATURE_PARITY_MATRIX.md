# FEATURE_PARITY_MATRIX.md — UAR Migration (Agent 2)

Auditor: Agent 2 — New Platform Auditor · Date: 2026-11-16
Basis: static code inspection of `uarnew/backend` + `uarnew/frontend`. No tests executed — **nothing is marked VERIFIED**; every IMPLEMENTED status is code-evidence only.

**Column status at audit time:**
- **Legacy PHP** — `PENDING_AUDIT`. Agent 1's deliverable (`backend/docs/migration/LEGACY_API_INVENTORY.md`) did **not** exist when this file was produced (`ls backend/docs` → absent). The coordinator must reconcile once Agent 1 lands it.
- **Mobile** — `PENDING_AUDIT`. The mobile app (`../mobile`, Flutter) is audited by Agent 5; see `API_COMPATIBILITY_MATRIX.md` for the new backend's mobile-facing capabilities, which is the input Agent 5 needs.

Legend (from `docs/mobile_migration.md`): `IMPLEMENTED` · `PARTIALLY_IMPLEMENTED` · `MISSING` · `NEEDS_FIX` · `NOT_APPLICABLE` · `VERIFIED` (never without a test run). Plus `PENDING_AUDIT` for unaudited columns.

Status rules applied to **New Backend** and **Admin Frontend** columns: IMPLEMENTED = full flow found in code with file refs; PARTIALLY_IMPLEMENTED = flow exists but with gaps noted; NEEDS_FIX = works but has a concrete defect listed; MISSING = no implementation found.

---

## 1. Authentication & accounts

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Login (email+password, all roles) | PENDING_AUDIT | IMPLEMENTED — `routes/auth.ts:43` (JWT HS256, cookie+bearer, rate-limited 20/10min IP, 10/10min email) | IMPLEMENTED — `public/auth-pages.tsx`, `hooks/use-auth.tsx:66-73` | PENDING_AUDIT | IMPLEMENTED |
| Self-registration (DONOR/VOLUNTEER/BENEFICIARY only) | PENDING_AUDIT | IMPLEMENTED — `auth.ts:24` `ALLOWED_ROLES`, volunteers created PENDING (`auth.ts:110-112`) | IMPLEMENTED — `auth-pages.tsx` register flow | PENDING_AUDIT | IMPLEMENTED |
| Session introspection (`/me`) | PENDING_AUDIT | IMPLEMENTED — `auth.ts` `GET /me` | IMPLEMENTED — `use-auth.tsx:40-63` w/ retry | PENDING_AUDIT | IMPLEMENTED |
| Logout | PENDING_AUDIT | NEEDS_FIX — clears cookie only; bearer token stays valid to expiry (no revocation) `session.ts:178-188` | IMPLEMENTED — `use-auth.tsx` | PENDING_AUDIT | NEEDS_FIX |
| Password change (authenticated) | PENDING_AUDIT | IMPLEMENTED — `routes/profile.ts` `POST /password` | IMPLEMENTED — `shared/user-profile-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Forgot/reset password (email link) | PENDING_AUDIT | MISSING — no reset flow; admin issues temp passwords (`auth.ts:26-28`) | MISSING | PENDING_AUDIT | MISSING |
| Role-based access control (9 roles) | PENDING_AUDIT | IMPLEMENTED — 202 `requireRole` call sites; roles as string column (`prisma/schema.prisma:14`) | IMPLEMENTED — role-gated nav, `admin-app.tsx:51-103`, `portal-router.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Rate limiting on auth | PENDING_AUDIT | IMPLEMENTED — `lib/rate-limit.ts` in-memory (single-instance; resets on restart) | NOT_APPLICABLE | PENDING_AUDIT | IMPLEMENTED |

## 2. Fundraising

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Donations CRUD + admin management | PENDING_AUDIT | IMPLEMENTED — `routes/donations.ts` (GET public/`?mine=1`, POST guest, PATCH/DELETE admin, refund via PATCH) | IMPLEMENTED — `admin/donations-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Guest donation w/ online payment | PENDING_AUDIT | IMPLEMENTED — `routes/payments.ts` (Razorpay/Stripe/Cashfree orders + `/verify`; PayU explicitly rejected `payments.ts:100`) | IMPLEMENTED — `public/donate.tsx` (POST `/api/payments`, `/verify`, `session_id` return) | PENDING_AUDIT | IMPLEMENTED |
| Campaigns (CRUD, slug, analytics) | PENDING_AUDIT | IMPLEMENTED — `routes/campaigns.ts`, `routes/campaign-analytics.ts` | IMPLEMENTED — `admin/campaigns-view.tsx`, `public/campaigns.tsx`, `campaign-detail.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Receipts (numbered, list, public verify-by-number + printable HTML) | PENDING_AUDIT | IMPLEMENTED — `routes/receipts.ts` (list auth; `/:receiptNumber`, `/html` public) | PARTIALLY_IMPLEMENTED — donor list view `portal/donor/receipts.tsx`; **no public verify page / print UI consumes `/:receiptNumber(/html)`** | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |
| Certificates (issue, list, public verify-by-code + HTML) | PENDING_AUDIT | IMPLEMENTED — `routes/certificates.ts` | PARTIALLY_IMPLEMENTED — donor list `portal/donor/animals.tsx`/`causes.tsx` (`?limit=50`); **no verify-by-code page** | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |
| Adopt-a-Medicine causes + pledges | PENDING_AUDIT | IMPLEMENTED — `routes/causes.ts` (+`/pledges`, `?mine=1`), `routes/cause-analytics.ts`, `routes/pledges.ts` admin cancel | IMPLEMENTED — `admin/causes-view.tsx`, `portal/donor/causes.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Beneficiary sponsorships (+ auto-match) | PENDING_AUDIT | IMPLEMENTED — `routes/sponsorships.ts` (`/match` admin) | IMPLEMENTED — `admin/beneficiaries-view.tsx`, `portal/donor/sponsorships.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Recurring needs | PENDING_AUDIT | IMPLEMENTED — `routes/recurring-needs.ts` | IMPLEMENTED — `admin/beneficiaries-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Animal welfare (animals, pledges, reactions, analytics) | PENDING_AUDIT | IMPLEMENTED — `routes/animals.ts`, `animal-pledges.ts`, `animal-analytics.ts` | IMPLEMENTED — `admin/animals-view.tsx`, `portal/donor/animals.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Testimonials | PENDING_AUDIT | IMPLEMENTED — `routes/testimonials.ts` (public GET, admin CUD) | PARTIALLY_IMPLEMENTED — public display only (`public/home.tsx:193`); **no admin UI consumes POST/PATCH/DELETE `/api/testimonials`** | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |

## 3. People management

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Users & roles admin (CRUD, suspend) | PENDING_AUDIT | IMPLEMENTED — `routes/users.ts` (ADMIN only) | IMPLEMENTED — `admin/users-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Donor CRM | PENDING_AUDIT | IMPLEMENTED — `routes/donors.ts` (paginated, `q`) | IMPLEMENTED — `admin/donors-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Beneficiary registry + notes | PENDING_AUDIT | IMPLEMENTED — `routes/beneficiaries.ts` (`?mine=1` self-case, `/notes`) | IMPLEMENTED — `admin/beneficiaries-view.tsx`, `portal/beneficiary/hub.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Beneficiary request workflow (public apply → admin queue) | PENDING_AUDIT | IMPLEMENTED — `routes/beneficiary-requests.ts` (public POST, `?mine=1`, admin PATCH) | IMPLEMENTED — `portal/beneficiary/hub.tsx`, admin dashboard + `beneficiaries-view` | PENDING_AUDIT | IMPLEMENTED |
| Volunteer lifecycle (apply → approve → profile → tasks → attendance) | PENDING_AUDIT | IMPLEMENTED — `routes/volunteers.ts`, `volunteer-applications.ts` (`/mine`), `volunteer-tasks.ts`, `volunteer-attendances.ts` | IMPLEMENTED — `admin/volunteers-view.tsx`, `portal/volunteer/*`; **attendance POST is ADMIN-only and no portal UI creates attendance** (`routes/volunteer-attendances.ts:270` → volunteers can't clock in) | PENDING_AUDIT | NEEDS_FIX |
| Volunteer assignments | PENDING_AUDIT | IMPLEMENTED — `routes/volunteer-assignments.ts` (GET/POST admin) | MISSING — no view consumes it (verified vs all frontend API calls) | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |
| Public volunteer page + application | PENDING_AUDIT | IMPLEMENTED — public POST `/api/volunteer-applications` | IMPLEMENTED — `public/volunteer.tsx`, `portal/volunteer/application.tsx` | PENDING_AUDIT | IMPLEMENTED |

## 4. Food security programme

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Programmes, events, households CRUD | PENDING_AUDIT | IMPLEMENTED — `routes/food.ts` (programmes/events/households blocks) | IMPLEMENTED — `admin/food/{programmes,events,households}.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Public food event listing + registration + status check | PENDING_AUDIT | IMPLEMENTED — `food.ts` `GET /public`, `GET /applications/status`, `POST /events/:id/registrations` (guest) | IMPLEMENTED — `public/food-security.tsx`, `food-apply.tsx`, `portal/beneficiary/food.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Applications (apply → review) | PENDING_AUDIT | IMPLEMENTED — `food.ts` applications block | IMPLEMENTED — `admin/food/applications.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Food check-in + walk-in (desk ops) | PENDING_AUDIT | IMPLEMENTED — `food.ts` `POST /checkin`, `POST /events/:id/walkin` (rate-limited `lib/food.ts:47-54`) | IMPLEMENTED — `admin/food/desk.tsx`, `portal/volunteer/scan.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Batches, FEFO allocations, stock | PENDING_AUDIT | IMPLEMENTED — `food.ts` batches/allocations + `lib/food.ts` `fefoReserve` transactional reservation | IMPLEMENTED — `admin/food/batches.tsx`, `admin/food/events.tsx` allocations tab | PENDING_AUDIT | IMPLEMENTED |
| Food pledges (donor → admin fulfilment) | PENDING_AUDIT | IMPLEMENTED — `food.ts` pledges block | IMPLEMENTED — `admin/food/pickups.tsx`, `public/food-pledge.tsx`, `portal/donor/overview.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Event expenses + volunteer staffing | PENDING_AUDIT | IMPLEMENTED — `food.ts` `/events/:id/expenses`, `/events/:id/volunteers` | IMPLEMENTED — `admin/food/events.tsx` detail | PENDING_AUDIT | IMPLEMENTED |
| Insights (AI) | PENDING_AUDIT | IMPLEMENTED — `food.ts` `POST /insights` | IMPLEMENTED — `admin/food/insights.tsx` | PENDING_AUDIT | IMPLEMENTED |

## 5. Health programme

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Healthcare orgs + verification | PENDING_AUDIT | IMPLEMENTED — `routes/health-orgs.ts` | IMPLEMENTED — `admin/health/partners.tsx`, `portal/hospital/profile.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Health professionals + verification | PENDING_AUDIT | IMPLEMENTED — `routes/health-professionals.ts` | IMPLEMENTED — `admin/health/professionals.tsx`, `portal/hospital/*` | PENDING_AUDIT | IMPLEMENTED |
| Medical camps + partners + staff + registrations + attendance | PENDING_AUDIT | IMPLEMENTED — `routes/medical-camps.ts`, `camp-partners.ts`, `camp-staff.ts`, `camp-registrations.ts`, `camp-attendance.ts` | IMPLEMENTED — `admin/health/{camps,camp-ops,camp-detail,registrations}.tsx`, `admin/health/reports.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Appointments (book/manage, no-show) | PENDING_AUDIT | IMPLEMENTED — `routes/appointments.ts` (paginated) | IMPLEMENTED — `admin/health/appointments.tsx`, `portal/doctor/overview.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Clinical encounters + sign-off | PENDING_AUDIT | IMPLEMENTED — `routes/encounters.ts` (+`/:id/sign`, DOCTOR-only create) | IMPLEMENTED — `admin/health/clinical.tsx`, `portal/doctor/patients.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Vitals + screenings | PENDING_AUDIT | IMPLEMENTED — `routes/vitals.ts`, `screenings.ts` | IMPLEMENTED — `portal/doctor/vitals.tsx` (nurse), `admin/health/clinical.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Prescriptions + items + sign + dispense + print | PENDING_AUDIT | IMPLEMENTED — `routes/prescriptions.ts` (+`/sign`, `/dispense` PHARMACIST, `/print`) | PARTIALLY_IMPLEMENTED — sign + dispense UIs exist (`portal/doctor/{prescriptions,dispense}.tsx`); **no UI consumes `GET /:id/print`** | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |
| Lab orders + results | PENDING_AUDIT | IMPLEMENTED — `routes/lab-orders.ts` (LAB_TECH result entry) | IMPLEMENTED — `admin/health/diagnostics.tsx`, `portal/doctor/{labs,lab-tech}.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Referrals + follow-ups | PENDING_AUDIT | IMPLEMENTED — `routes/referrals.ts`, `follow-ups.ts` | IMPLEMENTED — `admin/health/referrals.tsx`, `portal/doctor/{referrals,followups}.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Medical documents | PENDING_AUDIT | IMPLEMENTED — `routes/medical-documents.ts` (URL-attached) | IMPLEMENTED — `admin/health/documents.tsx`, `portal/beneficiary/health.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Health AI insights | PENDING_AUDIT | IMPLEMENTED — `routes/health-ai.ts` (no rate limit — see audit §10.3) | IMPLEMENTED — `admin/health/ai-insights.tsx` | PENDING_AUDIT | NEEDS_FIX |
| Health timeline (cross-module) | PENDING_AUDIT | IMPLEMENTED — `routes/health-timeline.ts` | IMPLEMENTED — `portal/beneficiary/health.tsx`, `portal/doctor/patients.tsx` | PENDING_AUDIT | IMPLEMENTED |

## 6. Inventory, kits & distributions

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Inventory items CRUD + stock adjust | PENDING_AUDIT | IMPLEMENTED — `routes/inventory.ts` | IMPLEMENTED — `admin/inventory-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Demand forecast | PENDING_AUDIT | IMPLEMENTED — `routes/inventory-forecast.ts` | IMPLEMENTED — `admin/inventory-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Inventory transactions (purchases/dispenses) | PENDING_AUDIT | IMPLEMENTED — `routes/inventory-transactions.ts` | IMPLEMENTED — `admin/health/pharmacy.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Kit templates/batches/units + QR scan | PENDING_AUDIT | IMPLEMENTED — `routes/kit-templates.ts`, `kit-batches.ts`, `kit-units.ts`, `kit-scan.ts` (VOLUNTEER/ADMIN) | IMPLEMENTED — `admin/kits-view.tsx`, `portal/volunteer/scan.tsx`; **`GET /api/kit-stats` has no consumer** | PENDING_AUDIT | IMPLEMENTED |
| Distributions + ledger + `withTotals` | PENDING_AUDIT | IMPLEMENTED — `routes/distributions.ts` (`?mine=1`, `?withTotals=1`, `lib/distribution-ledger.ts`) | IMPLEMENTED — `admin/distributions-view.tsx`, `portal/volunteer/distributions.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Pad distributions (parallel flow) | PENDING_AUDIT | IMPLEMENTED — `routes/pad-distributions.ts` | IMPLEMENTED — `admin/distributions-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| School coverage | PENDING_AUDIT | IMPLEMENTED — `routes/school-coverages.ts` | IMPLEMENTED — `admin/distributions-view.tsx` | PENDING_AUDIT | IMPLEMENTED |

## 7. Green corridor & ambulance

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Ambulance fleet CRUD | PENDING_AUDIT | IMPLEMENTED — `routes/ambulances.ts` | IMPLEMENTED — `admin/ambulance-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Mission dispatch | PENDING_AUDIT | IMPLEMENTED — `routes/missions.ts` (state machine `lib/missions.ts`) | IMPLEMENTED — `admin/ambulance-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Corridor events + stats | PENDING_AUDIT | IMPLEMENTED — `routes/corridor-events.ts`, `corridor-stats.ts` | IMPLEMENTED — `admin/ambulance-view.tsx`, `public/green-corridor.tsx` | PENDING_AUDIT | IMPLEMENTED |

## 8. Platform services

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Settings (branding, email, gateways, feature flags) + public config | PENDING_AUDIT | IMPLEMENTED — `routes/settings.ts` (+`/public`, `/test`), `lib/settings-core.ts` | IMPLEMENTED — `admin/settings-view.tsx`, `use-branding.tsx` | PENDING_AUDIT | IMPLEMENTED |
| File upload/download/manager | PENDING_AUDIT | NEEDS_FIX — hardened store (`lib/files.ts` allowlist+traversal-safe) but **upload is ADMIN-only** (`routes/files.ts:62`), no self-service for staff/mobile | IMPLEMENTED — `admin/files-view.tsx`, `shared/file-picker.tsx` | PENDING_AUDIT | NEEDS_FIX |
| In-app notifications | PENDING_AUDIT | IMPLEMENTED — `routes/notifications.ts` (guest-visible global rows) | IMPLEMENTED — donor/volunteer overview | PENDING_AUDIT | IMPLEMENTED |
| Email notifications (SMTP) | PENDING_AUDIT | IMPLEMENTED — `lib/notify.ts` (nodemailer, settings-driven) | IMPLEMENTED — settings test (`/api/settings/test`) | PENDING_AUDIT | IMPLEMENTED |
| Push notifications (FCM/APNs/SMS/WhatsApp) | PENDING_AUDIT | MISSING — none in `lib/notify.ts` or deps | MISSING | PENDING_AUDIT | MISSING |
| Activity logs | PENDING_AUDIT | IMPLEMENTED — `routes/activity-logs.ts`, `logActivity` everywhere | IMPLEMENTED — `admin/activity-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Stats / dashboards | PENDING_AUDIT | IMPLEMENTED — `routes/stats.ts` (public), root `GET /api` aggregate | IMPLEMENTED — `admin/dashboard-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Reports (typed legacy, admin range, public FY, sponsorship coverage) | PENDING_AUDIT | IMPLEMENTED — `routes/reports.ts` (1018-1032 branch map) | IMPLEMENTED — `admin/reports-view.tsx`, `admin/health/reports.tsx`, `public/impact.tsx` | PENDING_AUDIT | IMPLEMENTED |
| Contact queries (public → admin queue) | PENDING_AUDIT | IMPLEMENTED — `routes/contact-queries.ts` | IMPLEMENTED — `public/contact.tsx`, admin dashboard | PENDING_AUDIT | IMPLEMENTED |
| Masters (MDM key-value) | PENDING_AUDIT | IMPLEMENTED — `routes/masters.ts` | IMPLEMENTED — `admin/masters-view.tsx` | PENDING_AUDIT | IMPLEMENTED |
| AI assistant widget | PENDING_AUDIT | NEEDS_FIX — `routes/assistant.ts` works but accepts anonymous calls w/ no rate limit (external-LLM cost abuse) | IMPLEMENTED — `shared/assistant-widget.tsx` | PENDING_AUDIT | NEEDS_FIX |
| Live donation feed (SSE, feature-flagged) | PENDING_AUDIT | IMPLEMENTED — `routes/events.ts` (`features.liveDonationFeed` gate, 503 when off) | IMPLEMENTED — `shared/donation-broadcasts.tsx` EventSource | PENDING_AUDIT | IMPLEMENTED |
| CSV export helpers | PENDING_AUDIT | PARTIALLY_IMPLEMENTED — client-side only (`shared/csv.tsx`); no backend export endpoints | IMPLEMENTED — `shared/csv.tsx` used by admin tables | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |

## 9. Cross-cutting quality rows

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|
| Consistent pagination on list APIs | PENDING_AUDIT | PARTIALLY_IMPLEMENTED — `page`/`limit` in only 22-33 of 71 routers (audit §10.4) | PARTIALLY_IMPLEMENTED — consumers send `?limit=` workarounds | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |
| Centralized validation | PENDING_AUDIT | PARTIALLY_IMPLEMENTED — `lib/validators.ts` used by `food.ts` only | IMPLEMENTED — zod + react-hook-form on forms | PENDING_AUDIT | PARTIALLY_IMPLEMENTED |
| Automated tests | PENDING_AUDIT | MISSING — 0 test files, no runner (audit §11) | MISSING — 0 test files | PENDING_AUDIT | MISSING |
| Refresh tokens / session revocation | PENDING_AUDIT | MISSING — 7-day stateless JWT only | NOT_APPLICABLE | PENDING_AUDIT | MISSING |

## Reconciliation notes for the coordinator
1. When `backend/docs/migration/LEGACY_API_INVENTORY.md` lands, replace every `PENDING_AUDIT` in the Legacy/Mobile columns and re-grade rows where legacy features have **no** row here yet (add rows, don't overwrite).
2. Row-level "Status" column is the aggregate of the two audited columns plus known defects; it does **not** incorporate legacy/mobile evidence.
3. Nothing here is VERIFIED — after Agent 3/4 implement missing pieces, run the e2e pass (tracker Phase 8) before promoting any row to VERIFIED.

---

## RECONCILIATION (Coordinator, after Agents 1 & 5a landed)

Agent 1 delivered `backend/docs/migration/LEGACY_API_INVENTORY.md` (187 API + 133 web routes, 15 feature groups) and Agent 5a delivered the mobile audit (`../../mobile/docs/MOBILE_MIGRATION_PLAN.md`). Column verdicts resolved:

### Mobile column — global verdict
The Flutter app is the unmodified **"Chatter" social template** (`appName = "Chatter"`, hardcoded LAN base URL, plaintext user-id "auth", 97 called endpoints are ALL legacy-template social endpoints; **zero UAR endpoints**; no UAR screens). Therefore for every row above: **Mobile = MISSING** (no UAR implementation exists to preserve), except rows that are staff/clinical roles → NOT_APPLICABLE. The mobile phase is a **rebuild** against the new backend (see API_COMPATIBILITY_MATRIX.md + MOBILE_MIGRATION_PLAN.md).

### Legacy column — domain verdicts (from Agent 1, code-cited)
| Legacy domain | Verdict for this migration |
|---|---|
| Auth: identity-based `addUser` (no tokens, static `apikey` header on 86/97 mobile endpoints) | Legacy only — anti-pattern, DO NOT port. New JWT flow is the target; add forgot-password + refresh/revocation (gap A-2/A-3). |
| Beneficiary KYC + verification workflows | Legacy: real feature. New backend: partially covered (beneficiary-requests + notes) — needs explicit verification workflow (Agent 3 gap A-4). |
| Volunteer management (application ~15 extra fields: geo, address, emergency, travel) | Legacy: richer. New backend: NEEDS_FIX — restore dropped fields (Agent 3 gap A-1). |
| Donor / Charity V2 (causes, donations, charity cards/gamification) | Causes/donations: IMPLEMENTED in new backend (superset). Charity-card gamification (points/tiers/expiry cron): social-game feature — **RETIRE** (documented decision) unless product says otherwise. |
| Social feed / reels / rooms / chat / audio spaces (Chatter core) | NOT_APPLICABLE — template ecosystem being retired with the mobile template; out of UAR scope for this migration. |
| Notifications (FCM push, topics) | Legacy: FCM push (creds empty). New backend: email only → add push transport behind settings flag (gap A-6, credential blocker documented). |
| Media storage (storage_type: S3/DO/local) | New backend: local uploads only — acceptable for now; driver abstraction deferred (debt D-1). |
| OTP verification (forgot password / account verify) | Legacy LEAKS OTPs in responses (AuthController.php L213/L306) — must NOT port the leak; implement secure OTP via email/SMS (gap A-2). |
| `IsAdmin` backdoor (user.id==1 / email match) | DO NOT PORT — security anti-pattern. |
| Scheduled jobs (points expiry, card sync) | Legacy: none actually scheduled. With charity cards retired: NOT_APPLICABLE. |

### Net backend gap list (feeds Agent 3)
- **A-1** VolunteerApplication: restore ~15 dropped fields (exact list from `backend/docs/migration/LEGACY_DATABASE_MAPPING.md` → volunteer_applications row) + API + admin UI
- **A-2** Forgot-password via secure OTP (email/SMS transport; NEVER return OTP in API response) + reset-password
- **A-3** Token refresh + revocation (logout invalidates; `POST /api/auth/refresh`)
- **A-4** Beneficiary verification workflow (documents + status machine + admin approve/reject)
- **A-5** File upload policy: role-scoped uploads for non-admins (KYC docs); file access control review
- **A-6** Push notification transport (FCM driver behind settings flag; credentials blocker documented)
- **A-7** Rate-limit public AI endpoints (assistant/chat, health-ai)
- **A-8** Backfill pagination on mobile-facing lists (backward-compatible: no param = current behavior)
- **A-9** Backend automated tests (vitest + supertest): auth, donations, files policy, volunteer application, forgot/reset
