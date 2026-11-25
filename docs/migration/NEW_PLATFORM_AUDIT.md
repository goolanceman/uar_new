# NEW_PLATFORM_AUDIT.md — UAR New Platform (Agent 2)

Auditor: Agent 2 — New Platform Auditor
Date: 2026-11-16
Scope: `uarnew/backend` (Express + TypeScript + Prisma + PostgreSQL) and `uarnew/frontend` (Next.js 16 SPA)
Method: static code inspection only. Every claim carries a file path. No tests were executed — no status below marked VERIFIED.

Companion deliverables:
- `docs/migration/FEATURE_PARITY_MATRIX.md` (legacy column = `PENDING_AUDIT` — Agent 1's `LEGACY_API_INVENTORY.md` did not exist at audit time)
- `docs/migration/API_COMPATIBILITY_MATRIX.md` (mobile-facing capability assessment)

---

## 1. Executive summary

The new platform is a deliberately simple, consistent two-tier system: a standalone Express API (71 routers, 276 endpoints, all mounted under `/api/*`) and a single-route Next.js hash-routed SPA that proxies `/api` to the backend via a Next rewrite (`frontend/next.config.ts:16-23`). Auth is a hand-rolled but standards-compliant HS256 JWT (no external JWT lib), delivered via httpOnly cookie **and** `Authorization: Bearer` (dual-mode, built for cross-site iframe embedding) — `backend/src/lib/session.ts`. Persistence is Prisma 6 + PostgreSQL with 69 models, snake_case `@@map` tables (`backend/prisma/schema.prisma`). There are **no automated tests on either side** (verified below).

Overall the codebase is unusually disciplined for its size (single response/error convention, a real workflow-state machine lib, hardened file store), but the audit found concrete gaps: no refresh-token/revocation, unbounded list endpoints in ~38 of 71 routers, anonymous access to the AI assistant endpoint (external LLM cost exposure, no rate limit), file downloads with no access control, role logic scattered as string literals, and a significant set of routers mounted but never consumed by the frontend (dead weight for this repo, candidates for mobile).

## 2. Stack and versions

### 2.1 Backend (`backend/package.json`)

| Concern | Choice | Version | Evidence |
|---|---|---|---|
| Runtime | Node/Bun (tsx runner in prod) | tsx ^4.19.2, bun-types 1.3.4 (frontend scripts drive backend via bun) | `backend/package.json` scripts `dev`/`start` use `tsx` |
| Framework | Express | ^4.21.2 | `backend/package.json` |
| Language | TypeScript | ^5 | `backend/package.json` devDeps |
| ORM | Prisma + @prisma/client | ^6.11.1 | `backend/package.json` |
| Database | PostgreSQL | postgres:16-alpine (compose) | `docker-compose.yml` `image: postgres:16-alpine` |
| Validation | hand-rolled (`lib/validators.ts`) — no zod/yup | — | `backend/src/lib/validators.ts` |
| Uploads | custom multipart parser (`lib/multipart.ts`); `multer` ^1.4.5-lts.1 is a declared dep but unused in `src/` | — | `grep -r multer backend/src` → 0 hits |
| Email | nodemailer | ^10.5.0 | `backend/src/lib/notify.ts:16` |
| AI | z-ai-web-dev-sdk | ^0.0.17 | `backend/src/routes/assistant.ts`, `routes/health-ai.ts` |
| Realtime | native SSE (`res.write`) — no socket.io | — | `backend/src/routes/events.ts` |
| Tests | **none** (no jest/vitest/mocha, no test script, no spec files) | — | §9 |

### 2.2 Frontend (`frontend/package.json`)

| Concern | Choice | Version | Evidence |
|---|---|---|---|
| Framework | Next.js (App Router, single route) | ^16.1.1 | `frontend/package.json` |
| React | ^19.0.0 | | `frontend/package.json` |
| UI | shadcn/radix primitives (48 files in `src/components/ui`), Tailwind CSS ^4 | | `frontend/src/components/ui/*` |
| State | zustand ^5.0.6, @tanstack/react-query ^5.82.0 (declared; data fetching is mostly raw `api()` calls), react-hook-form ^7.60.0 + zod ^4.0.2 (form side) | | `frontend/package.json` |
| Charts | recharts ^2.15.4 | | `frontend/package.json` |
| Next config | `output: "standalone"`, `typescript.ignoreBuildErrors: true`, rewrite `/api/:path*` → `BACKEND_URL` | | `frontend/next.config.ts:8-23` |

Note: `ignoreBuildErrors: true` means CI/build does **not** type-check the frontend; only `backend` has a `typecheck` script (`backend/package.json`).

## 3. Entry points and runtime topology

```
Browser ── hash-routed SPA (frontend/src/app/page.tsx)
   │  fetch("/api/...")  relative
   ▼
Next.js 16 (port 3000)  ──rewrite /api/:path*──▶  Express (port 4000)  ──Prisma──▶ PostgreSQL 16
        ▲                                             │  fs reads/writes
        └── src/middleware.ts: path→#/hash redirect   ▼
                                                 UPLOAD_DIR (./upload, bind-mounted)
```

- **Backend entry**: `backend/src/index.ts` — CORS (origin allowlist from `CORS_ORIGINS`, credentials), `express.json({limit:"10mb"})`, `GET /api/health`, `GET /api` (root dashboard aggregate, `index.ts:51-82`), 70 `app.use("/api/…", router)` mounts (one per router file), catch-all `/api` 404 (`index.ts:85-87`), global error handler delegating to `handleError` (`index.ts:89-96`).
- **All 71 router files in `backend/src/routes/` are mounted** (verified: `diff <(ls src/routes) <(grep -oE 'from "./routes/[a-z-]+"' src/index.ts)` → identical).
- **Frontend entry**: `frontend/src/app/page.tsx` — hash decides experience: `#/admin/*` → `components/admin/admin-app.tsx` (ADMIN only), `#/donor/*` → `components/portal/portal-router.tsx` DonorPortal, `#/volunteer/*` → VolunteerPortal (PENDING volunteers get application-tracking only), `#/beneficiary` → BeneficiaryPortal, `#/hospital/*` → PartnerPortal, medical roles (DOCTOR/NURSE/PHARMACIST/LAB_TECH) → MedicalPortal, else → `components/public/public-site.tsx` (public pages: `/`, `/about`, `/campaigns`, `/green-corridor`, `/programs/food-security`, `/food-assistance/apply`, `/donate`, `/volunteer`, `/contact`, `/impact`, `/login`, `/register`, `/profile` — `public-site.tsx:56-93`).
- `frontend/src/middleware.ts` redirects clean paths (`/donate`) to hash equivalents (`/#/donate`) so QR/shared links work; API, `_next`, and files pass through.

## 4. Auth architecture

Source of truth: `backend/src/lib/session.ts`.

### 4.1 Token
- Hand-rolled **JWT HS256, RFC 7519** (no jsonwebtoken dep): header fixed `{alg:HS256,typ:JWT}`; payload `{sub, role, name, email, iat, exp}`; HMAC-SHA256 via node `crypto` (`session.ts:70-99`). TTL = 7 days (`session.ts:64`, matches cookie maxAge `session.ts:166`).
- `SESSION_SECRET` must be ≥16 chars or the process refuses to start (no hardcoded fallback — `session.ts:17-25`).
- Verification: timing-safe signature compare, expiry check, `sub` presence (`session.ts:101-131`). No `alg` header check (header is ignored — signature can only verify with the server secret, so algorithm-confusion is not exploitable here, but the implementation is bespoke).

### 4.2 Delivery — cookie AND bearer
- `setSession()` sets an httpOnly cookie `uar_session`; `SameSite=None; Secure` over HTTPS (iframe-friendly), `Lax` over plain HTTP (`session.ts:158-176`).
- `getSession()` accepts `Authorization: Bearer <jwt>` **first**, then cookie (`session.ts:190-200`). Frontend mirrors this: token stored in `localStorage["uar_token"]`, sent as Bearer; cookie remains primary for normal browsing (`frontend/src/lib/api-client.ts:6-12, 40-42`).
- `POST /api/auth/logout` clears the cookie; note tokens themselves are **stateless with no revocation** — logout cannot invalidate a bearer token.

### 4.3 Passwords
- scrypt `salt:hash` (32-byte key, 16-byte random salt) with timing-safe compare; **legacy plain-text passwords still verify** (`session.ts:31-49`) — intentional migration bridge, but it means legacy cleartext hashes remain valid credentials.
- Self-register (`POST /api/auth/register`) allows only `DONOR | VOLUNTEER | BENEFICIARY` (`backend/src/routes/auth.ts:24`); anything else silently downgrades to DONOR (`auth.ts:99`). VOLUNTEER self-registrations are created `status:"PENDING", isActive:false` pending admin approval (`auth.ts:110-112`).
- `GET /api/users` create (`routes/users.ts`) is ADMIN-only and enforces the full role set + min-6-char passwords (`users.ts:16-19`).

### 4.4 Authorization model
- Roles live as a **plain string** on `User.role` (Prisma comment enumerates `ADMIN | VOLUNTEER | DONOR | BENEFICIARY | DOCTOR | NURSE | PHARMACIST | LAB_TECH | HOSPITAL` — `backend/prisma/schema.prisma:14-15`). No Prisma enum, no permission table; `SessionUser.role` is typed `string` on the frontend (`frontend/src/hooks/use-auth.tsx:10-13`).
- Guard helpers: `requireAuth()`, `requireRole(req, ...roles)`, `isAuthenticated()`, `getSession()` (`session.ts:245-262`). Guards are **called inside each handler** (no router-level middleware) — see §8 for the 25 endpoints with no guard.
- `publicUser()` projects safe user fields (`session.ts:264-289`); `User.status` + `isActive` are combined, with SUSPENDED overriding (`session.ts:275`).
- Frontend route protection is client-side only (`page.tsx` AuthGate, admin-app checks `user.role`) — the backend is the real boundary, which is correct for a SPA, but means deep-link protection depends on each API guard.

## 5. Database architecture

- `backend/prisma/schema.prisma` — **69 models**, PostgreSQL, `@@map` snake_case table names, cuid string PKs, no Prisma enums (status fields are commented strings).
- **No `prisma/migrations/` directory** — schema is applied with `prisma db push` (`backend/package.json` `db:push`; `docker-compose.yml` runs `prisma db push` in the api container). History is not migration-tracked.

### 5.1 Model groups (all names verbatim from `schema.prisma`)

| Domain | Models | Count |
|---|---|---|
| Identity | `User` | 1 |
| Fundraising | `Donor`, `Donation`, `Campaign`, `Cause`, `Pledge`, `BeneficiarySponsorship`, `Certificate`, `Testimonial` | 8 |
| Beneficiary | `Beneficiary`, `RecurringNeed`, `BeneficiaryNote`, `BeneficiaryRequest` | 4 |
| Volunteer | `Volunteer`, `VolunteerApplication`, `VolunteerTask`, `VolunteerAttendance` | 4 |
| Food security | `FoodProgramme`, `FoodEvent`, `FoodRegistration`, `FoodCheckIn`, `Household`, `HouseholdMember`, `FoodBatch`, `FoodStockAllocation`, `FoodEventExpense`, `FoodDonationPledge` | 10 |
| Health | `HealthcareOrg`, `HealthProfessional`, `MedicalCamp`, `CampPartner`, `CampStaff`, `CampRegistration`, `CampAttendance`, `Appointment`, `Encounter`, `VitalObservation`, `ScreeningRecord`, `Prescription`, `PrescriptionItem`, `MedicationDispense`, `DiagnosticOrder`, `MedicalReferral`, `FollowUp`, `MedicalDocument`, `CampExpense` | 19 |
| Inventory & distribution | `InventoryItem`, `InventoryPurchase`, `InventoryDistribution`, `InventoryTransaction`, `Distribution`, `PadDistribution`, `KitTemplate`, `KitBatch`, `KitUnit` | 9 |
| Animal welfare | `Animal`, `AnimalReaction`, `AnimalPledge` | 3 |
| Green corridor | `Ambulance`, `Mission`, `CorridorEvent` | 3 |
| Education/community | `SchoolCoverage`, `Master` (MDM generic key-value masters) | 2 |
| Platform services | `Notification`, `ActivityLog`, `Setting`, `FileAsset`, `ContactQuery`, `AIInteraction` | 6 |
| **Total** | | **69** |

- Seed: `backend/prisma/seed.ts` creates demo users for every role (ADMIN/DONOR/VOLUNTEER/VOLUNTEER-PENDING/BENEFICIARY/HOSPITAL) plus rich demo data for each programme.
- Data migration from SQLite legacy: `backend/scripts/migrate-sqlite-to-pg.ts` (`db:migrate-data` script).

## 6. Full API inventory

Method/path/auth/roles extracted from every handler by static scan (script-assisted, spot-verified by reading `camp-staff.ts`, `reports.ts`, `payments.ts`, `donations.ts`, `files.ts`, `events.ts`, `notifications.ts`, `medical-camps.ts`, `volunteers.ts`). **276 endpoints across 71 routers.**

Auth legend: `public` = no session required · `optional` = session read if present, behaviour differs (e.g. `?mine=1`) · `auth` = any authenticated role (`requireAuth`) · `role` = `requireRole(...)` with listed roles · `conditional` = guard inside handler per query branch.

**`routes/activity-logs.ts`** — mount `/api/activity-logs`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |

**`routes/ambulances.ts`** — mount `/api/ambulances`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/animal-analytics.ts`** — mount `/api/animal-analytics`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `_req`, `ADMIN` |

**`routes/animal-pledges.ts`** — mount `/api/animal-pledges`

| Method | Path | Auth | Roles |
|---|---|---|---|
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/animals.ts`** — mount `/api/animals`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | public | — |
| POST | / | role | `ADMIN`, `VOLUNTEER` |
| POST | /pledges | optional | — |
| GET | /pledges | auth | — |
| GET | /reactions | public | — |
| POST | /reactions | optional | — |
| GET | /:id | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN` |

**`routes/appointments.ts`** — mount `/api/appointments`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `VOLUNTEER` |
| POST | / | role | `ADMIN`, `VOLUNTEER`, `DOCTOR` |
| GET | /:id | role | `ADMIN`, `VOLUNTEER`, `DOCTOR` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER`, `DOCTOR` |
| DELETE | /:id | role | `ADMIN` |

**`routes/assistant.ts`** — mount `/api/assistant`

| Method | Path | Auth | Roles |
|---|---|---|---|
| POST | /chat | optional | — |

**`routes/auth.ts`** — mount `/api/auth`

| Method | Path | Auth | Roles |
|---|---|---|---|
| POST | /login | public | — |
| POST | /register | public | — |
| GET | /me | optional | — |
| POST | /logout | public | — |
| PATCH | /profile | auth | — |

**`routes/beneficiaries.ts`** — mount `/api/beneficiaries`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `VOLUNTEER`, `DOCTOR`, `NURSE` |
| POST | / | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN` |
| GET | /:id/notes | role | `ADMIN`, `VOLUNTEER` |
| POST | /:id/notes | role | `ADMIN`, `VOLUNTEER` |

**`routes/beneficiary-requests.ts`** — mount `/api/beneficiary-requests`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `BENEFICIARY`, `DONOR`, `VOLUNTEER`, `ADMIN` |
| POST | / | optional | — |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN` |

**`routes/camp-attendance.ts`** — mount `/api/camp-attendance`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `VOLUNTEER`, `HOSPITAL`, `DOCTOR`, `NURSE` |
| POST | / | role | `ADMIN`, `VOLUNTEER`, `NURSE` |
| PATCH | / | role | `ADMIN`, `VOLUNTEER`, `NURSE`, `DOCTOR` |

**`routes/camp-expenses.ts`** — mount `/api/camp-expenses`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |

**`routes/camp-partners.ts`** — mount `/api/camp-partners`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `HOSPITAL` |
| POST | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN`, `HOSPITAL` |

**`routes/camp-registrations.ts`** — mount `/api/camp-registrations`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `VOLUNTEER`, `HOSPITAL`, `DOCTOR`, `NURSE` |
| POST | / | role | `ADMIN`, `VOLUNTEER`, `NURSE`, `BENEFICIARY` |
| GET | /:id | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |

**`routes/camp-staff.ts`** — mount `/api/camp-staff`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN` |
| DELETE | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |

**`routes/campaign-analytics.ts`** — mount `/api/campaign-analytics`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `_req`, `ADMIN` |

**`routes/campaigns.ts`** — mount `/api/campaigns`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | optional | — |
| POST | / | role | `ADMIN` |
| GET | /:id | public | — |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/cause-analytics.ts`** — mount `/api/cause-analytics`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `_req`, `ADMIN` |

**`routes/causes.ts`** — mount `/api/causes`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | public | — |
| GET | /pledges | auth | — |
| POST | / | role | `ADMIN` |
| GET | /:id | public | — |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |
| POST | /:id/pledges | optional | — |

**`routes/certificates.ts`** — mount `/api/certificates`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN` |
| GET | /:code | public | — |
| GET | /:code/html | public | — |

**`routes/contact-queries.ts`** — mount `/api/contact-queries`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | public | — |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/corridor-events.ts`** — mount `/api/corridor-events`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |

**`routes/corridor-stats.ts`** — mount `/api/corridor-stats`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |

**`routes/distributions.ts`** — mount `/api/distributions`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `VOLUNTEER`, `ADMIN` |
| GET | /:id | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN`, `VOLUNTEER` |

**`routes/donations.ts`** — mount `/api/donations`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | optional | — |
| GET | /:id | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/donors.ts`** — mount `/api/donors`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |
| GET | /:id | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/encounters.ts`** — mount `/api/encounters`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `DOCTOR`, `NURSE` |
| POST | / | role | `DOCTOR` |
| GET | /:id | role | `ADMIN`, `DOCTOR`, `NURSE`, `BENEFICIARY` |
| PATCH | /:id | role | `ADMIN`, `DOCTOR` |
| POST | /:id/sign | role | `ADMIN`, `DOCTOR` |

**`routes/events.ts`** — mount `/api/events`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | /stream | public | — |

**`routes/files.ts`** — mount `/api/files`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |
| GET | /:id | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |
| GET | /:id/file | public | — |

**`routes/follow-ups.ts`** — mount `/api/follow-ups`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `DOCTOR`, `NURSE`, `VOLUNTEER` |
| POST | / | role | `DOCTOR`, `ADMIN`, `NURSE` |
| GET | /:id | role | `ADMIN`, `DOCTOR`, `NURSE`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `DOCTOR`, `NURSE`, `VOLUNTEER` |

**`routes/food.ts`** — mount `/api/food`

| Method | Path | Auth | Roles |
|---|---|---|---|
| POST | /allocations | role | `ADMIN` |
| PATCH | /allocations/:id | role | `ADMIN` |
| GET | /applications | role | `ADMIN`, `VOLUNTEER` |
| POST | /applications | optional | — |
| GET | /applications/status | public | — |
| PATCH | /applications/:id | role | `ADMIN` |
| GET | /batches | role | `ADMIN`, `VOLUNTEER` |
| POST | /batches | role | `ADMIN` |
| PATCH | /batches/:id | role | `ADMIN` |
| POST | /checkin | role | `ADMIN`, `VOLUNTEER` |
| GET | /events | role | `ADMIN`, `VOLUNTEER`, `BENEFICIARY` |
| POST | /events | role | `ADMIN` |
| GET | /events/:id | role | `ADMIN` |
| PATCH | /events/:id | role | `ADMIN` |
| GET | /events/:id/expenses | role | `ADMIN`, `VOLUNTEER` |
| POST | /events/:id/expenses | role | `ADMIN` |
| GET | /events/:id/registrations | role | `ADMIN`, `VOLUNTEER` |
| POST | /events/:id/registrations | optional | — |
| GET | /events/:id/volunteers | role | `ADMIN` |
| POST | /events/:id/volunteers | role | `ADMIN` |
| DELETE | /events/:id/volunteers | role | `ADMIN` |
| POST | /events/:id/walkin | role | `ADMIN`, `VOLUNTEER` |
| GET | /households | role | `ADMIN`, `VOLUNTEER` |
| POST | /households | role | `ADMIN` |
| PATCH | /households/:id | role | `ADMIN` |
| DELETE | /households/:id | role | `ADMIN` |
| POST | /insights | role | `ADMIN` |
| GET | /pledges | role | `DONOR`, `ADMIN`, `VOLUNTEER` |
| POST | /pledges | optional | — |
| PATCH | /pledges/:id | role | `ADMIN` |
| GET | /programmes | role | `ADMIN` |
| POST | /programmes | role | `ADMIN` |
| GET | /programmes/:id | role | `ADMIN` |
| PATCH | /programmes/:id | role | `ADMIN` |
| GET | /public | public | — |
| GET | /registrations | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /registrations/:id | role | `ADMIN` |

**`routes/health-ai.ts`** — mount `/api/health-ai`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | auth | — |
| PATCH | /:id | role | `ADMIN`, `DOCTOR` |

**`routes/health-orgs.ts`** — mount `/api/health-orgs`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `HOSPITAL` |
| POST | / | role | `ADMIN` |
| GET | /:id | role | `ADMIN`, `HOSPITAL` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/health-professionals.ts`** — mount `/api/health-professionals`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `HOSPITAL` |
| POST | / | role | `ADMIN`, `HOSPITAL` |
| GET | /:id | role | `ADMIN`, `HOSPITAL` |
| PATCH | /:id | role | `ADMIN`, `HOSPITAL` |

**`routes/health-timeline.ts`** — mount `/api/health-timeline`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |

**`routes/inventory-forecast.ts`** — mount `/api/inventory-forecast`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `_req`, `ADMIN`, `VOLUNTEER` |

**`routes/inventory-transactions.ts`** — mount `/api/inventory-transactions`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |

**`routes/inventory.ts`** — mount `/api/inventory`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN`, `VOLUNTEER` |
| GET | /:id | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN` |

**`routes/kit-batches.ts`** — mount `/api/kit-batches`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/kit-scan.ts`** — mount `/api/kit-scan`

| Method | Path | Auth | Roles |
|---|---|---|---|
| POST | / | role | `VOLUNTEER`, `ADMIN` |

**`routes/kit-stats.ts`** — mount `/api/kit-stats`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |

**`routes/kit-templates.ts`** — mount `/api/kit-templates`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/kit-units.ts`** — mount `/api/kit-units`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |

**`routes/lab-orders.ts`** — mount `/api/lab-orders`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `DOCTOR`, `ADMIN` |
| GET | /:id | role | `ADMIN`, `DOCTOR`, `LAB_TECH`, `NURSE` |
| PATCH | /:id | role | `ADMIN`, `DOCTOR`, `LAB_TECH` |

**`routes/masters.ts`** — mount `/api/masters`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/medical-camps.ts`** — mount `/api/medical-camps`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | optional | — |
| POST | / | role | `ADMIN` |
| GET | /:id | auth | — |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/medical-documents.ts`** — mount `/api/medical-documents`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN`, `DOCTOR`, `NURSE` |
| GET | /:id | auth | — |
| DELETE | /:id | role | `ADMIN` |

**`routes/missions.ts`** — mount `/api/missions`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |

**`routes/notifications.ts`** — mount `/api/notifications`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | optional | — |
| PATCH | / | auth | — |

**`routes/pad-distributions.ts`** — mount `/api/pad-distributions`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `VOLUNTEER`, `ADMIN` |
| GET | /:id | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN`, `VOLUNTEER` |

**`routes/payments.ts`** — mount `/api/payments`

| Method | Path | Auth | Roles |
|---|---|---|---|
| POST | / | public | — |
| POST | /verify | public | — |

**`routes/pledges.ts`** — mount `/api/pledges`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| PATCH | /:id | auth | — |
| DELETE | /:id | role | `ADMIN` |

**`routes/prescriptions.ts`** — mount `/api/prescriptions`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| POST | / | role | `DOCTOR` |
| GET | /:id | auth | — |
| PATCH | /:id | role | `ADMIN`, `DOCTOR` |
| POST | /:id/dispense | role | `ADMIN`, `PHARMACIST` |
| POST | /:id/sign | role | `ADMIN`, `DOCTOR` |
| GET | /:id/print | auth | — |

**`routes/profile.ts`** — mount `/api/profile`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET |  | auth | — |
| PATCH |  | auth | — |
| GET | /analytics | auth | — |
| POST | /password | auth | — |

**`routes/receipts.ts`** — mount `/api/receipts`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| GET | /:receiptNumber | public | — |
| GET | /:receiptNumber/html | public | — |

**`routes/recurring-needs.ts`** — mount `/api/recurring-needs`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `VOLUNTEER` |
| POST | / | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN` |

**`routes/referrals.ts`** — mount `/api/referrals`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `DOCTOR`, `NURSE`, `HOSPITAL` |
| POST | / | role | `DOCTOR`, `ADMIN` |
| GET | /:id | role | `ADMIN`, `DOCTOR`, `NURSE`, `HOSPITAL` |
| PATCH | /:id | role | `ADMIN`, `DOCTOR`, `HOSPITAL` |

**`routes/reports.ts`** — mount `/api/reports`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | conditional | public: `?fy=` · role `ADMIN`/`VOLUNTEER`: `?type=` · role `ADMIN`: `?from=`/`?to=`/`?compare=` (guards inside handler, reports.ts:1018-1032) |
| GET | /sponsorship-coverage | role | `ADMIN` |

**`routes/school-coverages.ts`** — mount `/api/school-coverages`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `VOLUNTEER` |
| POST | / | role | `ADMIN`, `VOLUNTEER` |

**`routes/screenings.ts`** — mount `/api/screenings`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `DOCTOR`, `NURSE` |
| POST | / | role | `ADMIN`, `DOCTOR`, `NURSE` |

**`routes/settings.ts`** — mount `/api/settings`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| PATCH | / | role | `ADMIN` |
| POST | /test | role | `ADMIN` |
| GET | /public | public | — |

**`routes/sponsorships.ts`** — mount `/api/sponsorships`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | auth | — |
| GET | /match | role | `ADMIN`, `VOLUNTEER` |
| POST | / | role | `ADMIN`, `VOLUNTEER` |
| PATCH | /:id | auth | — |
| DELETE | /:id | role | `ADMIN` |

**`routes/stats.ts`** — mount `/api/stats`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | public | — |

**`routes/testimonials.ts`** — mount `/api/testimonials`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | public | — |
| POST | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/users.ts`** — mount `/api/users`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |
| GET | /:id | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/vitals.ts`** — mount `/api/vitals`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `DOCTOR`, `NURSE` |
| POST | / | role | `ADMIN`, `NURSE`, `DOCTOR` |

**`routes/volunteer-applications.ts`** — mount `/api/volunteer-applications`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | optional | — |
| GET | /mine | auth | — |
| PATCH | /:id | role | `ADMIN` |
| DELETE | /:id | role | `ADMIN` |

**`routes/volunteer-assignments.ts`** — mount `/api/volunteer-assignments`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |

**`routes/volunteer-attendances.ts`** — mount `/api/volunteer-attendances`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN`, `VOLUNTEER` |
| POST | / | role | `ADMIN` |

**`routes/volunteer-tasks.ts`** — mount `/api/volunteer-tasks`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| POST | / | role | `ADMIN` |
| PATCH | /:id | role | `ADMIN`, `VOLUNTEER` |
| DELETE | /:id | role | `ADMIN` |

**`routes/volunteers.ts`** — mount `/api/volunteers`

| Method | Path | Auth | Roles |
|---|---|---|---|
| GET | / | role | `ADMIN` |
| GET | /me | auth | — |
| PATCH | /:id | role | `ADMIN` |
| GET | /:id | role | `ADMIN` |

### 6.1 Endpoints mounted but never consumed by the frontend (dead for this repo)

Cross-referencing all 276 endpoints against every `get/post/patch/del/api(` call in `frontend/src` (98 consuming files):

- `GET /api/kit-stats` (`routes/kit-stats.ts`) — no frontend caller.
- `GET /api/certificates/:code` + `/html` — public verification pages exist in code but no frontend view calls them (donor portal lists certificates via `GET /api/certificates?limit=50` only).
- `GET /api/receipts/:receiptNumber` (+ `/html`) — frontend fetches the list (`GET /api/receipts?from=&to=`) and renders inline; the per-receipt public endpoints have no caller.
- `GET /api/health-timeline` — consumed only by beneficiary/doctor portals; fine. `POST /api/health-ai` is consumed (`admin/health/ai-insights.tsx`).
- `volunteer-assignments` (`GET/POST /api/volunteer-assignments`) — mounted and role-guarded but **no frontend view calls it** (only referenced type-level).
- `/api/testimonials` POST/PATCH/DELETE — admin mutation endpoints with no UI caller; frontend only renders the public `GET` (`public/home.tsx:193`).

These are retention candidates for mobile rather than dead code to delete — but per today's evidence they are unused by the new frontend.

## 7. Frontend view inventory

173 component files under `frontend/src/components`: **public 19, admin 49 (incl. `admin/food/*` 10, `admin/health/*` 16), portal 36 (incl. `portal/donor/*` 8, `portal/volunteer/*` 9, `portal/doctor/*` 12, `portal/hospital/*` 4, `portal/beneficiary/*` 3, layout+router 2), shared 21, ui (shadcn primitives) 48.** Hooks: `hooks/use-auth.tsx` (session context, login/register/logout/refresh with retry), `hooks/use-branding.tsx`. Router: `frontend/src/lib/router.ts` (hash-based `useRoute`/`navigate`).

API consumption per view (primary calls; full extraction in the audit scratch):

| Area | View | Consumes |
|---|---|---|
| admin | `dashboard-view` | `/api/stats`, `/api/settings/public`, `/api/activity-logs`, `/api/beneficiary-requests?status=PENDING`, `/api/contact-queries?status=PENDING`, `/api/volunteer-applications?status=PENDING`, `/api/volunteer-tasks`, `/api/inventory?limit=100` |
| admin | `donations-view` | `/api/donations` CRUD + filtered counts (`page=1&limit=1&status=…`), `/api/campaigns?all=1` |
| admin | `donors-view` | `/api/donors` CRUD (`page`,`limit`,`q`) |
| admin | `campaigns-view` / `causes-view` | `/api/campaigns`, `/api/campaign-analytics`, `/api/causes`, `/api/cause-analytics`, `/api/certificates` |
| admin | `beneficiaries-view` | `/api/beneficiaries` + `/notes`, `/api/beneficiary-requests`, `/api/recurring-needs`, `/api/sponsorships` (+`/match`), `/api/distributions`, `/api/inventory`, `/api/donors?limit=200` |
| admin | `volunteers-view` | `/api/volunteers` (+`?analytics=1`), `/api/volunteer-applications`, `-assignments`, `-attendances`, `-tasks`, `/api/distributions?limit=50`, `/api/activity-logs?limit=150` |
| admin | `food/*` (overview, applications, events, desk, pickups, batches, households, programmes, insights) | `/api/food/*` (applications, events(+expenses/volunteers/walkin), registrations, checkin, pledges, batches, households, programmes, allocations, insights, public), `/api/inventory`, `/api/kit-templates` |
| admin | `health/*` (overview, partners, professionals, camps, camp-ops, camp-detail, registrations, attendance, appointments, clinical, prescriptions, pharmacy, diagnostics, documents, referrals, reports, ai-insights) | `/api/health-orgs`, `/api/health-professionals`, `/api/medical-camps`, `/api/camp-*`, `/api/appointments`, `/api/encounters`(+`/sign`), `/api/prescriptions`, `/api/lab-orders`, `/api/medical-documents`, `/api/screenings`, `/api/vitals`, `/api/follow-ups`, `/api/referrals`, `/api/health-ai`, `/api/health-timeline`, `/api/inventory-transactions`, `/api/reports` |
| admin | `distributions-view` | `/api/distributions`, `/api/pad-distributions` (+`withTotals=1`), `/api/school-coverages`, `/api/inventory`, `/api/kit-batches`, `/api/beneficiaries`, `/api/volunteers` |
| admin | `inventory-view` / `kits-view` | `/api/inventory`, `/api/inventory-forecast`, `/api/kit-templates`, `/api/kit-batches`, `/api/kit-units?batchId=` |
| admin | `ambulance-view` | `/api/ambulances`, `/api/missions`, `/api/corridor-events?limit=300`, `/api/corridor-stats` |
| admin | `animals-view` | `/api/animals`, `/api/animal-pledges`, `/api/animal-analytics`, `/api/certificates`, `/api/users?q=` |
| admin | `users-view` / `masters-view` / `files-view` / `settings-view` / `reports-view` / `activity-view` | `/api/users`, `/api/masters`, `/api/files`, `/api/settings` (+`/test`, `/public`), `/api/reports?from&to&compare`, `/api/reports/sponsorship-coverage`, `/api/activity-logs` |
| portal | donor (`overview`, `donations`, `causes`, `animals`, `sponsorships`, `receipts`, `profile`) | `/api/donations?mine=1`, `/api/causes(/pledges)?mine=1`, `/api/animals/pledges?mine=1`, `/api/food/pledges?mine=1`, `/api/sponsorships?mine=1`, `/api/certificates?limit=50`, `/api/receipts?from&to`, `/api/auth/me`, `/api/auth/profile`, `/api/notifications`, `/api/settings/public` |
| portal | volunteer (`application`, `overview`, `tasks`, `distributions`, `scan`, `inventory`, `camps`, `profile`) | `/api/volunteer-applications(/mine)`, `/api/volunteers/me`, `/api/volunteer-tasks?mine=1`, `/api/distributions?mine=1`, `/api/kit-scan`, `/api/kit-units?mine=1`, `/api/inventory`, `/api/medical-camps?upcoming=1`, `/api/camp-attendance`, `/api/camp-registrations`, `/api/food/checkin`, `/api/food/events`, `/api/volunteer-attendances?volunteerId=`, `/api/notifications` |
| portal | beneficiary (`hub`, `health`, `food`) | `/api/beneficiaries?mine=1`, `/api/beneficiary-requests(?mine=1)`, `/api/distributions?limit=200`, `/api/health-timeline`, `/api/appointments`, `/api/lab-orders`, `/api/prescriptions`, `/api/medical-documents`, `/api/referrals`, `/api/follow-ups`, `/api/camp-registrations`, `/api/medical-camps?upcoming=1`, `/api/food/events?public=1&mine=1`, `/api/food/events/:id/registrations` |
| portal | doctor/nurse/pharmacist/lab-tech (`overview`, `camps`, `patients`, `prescriptions`, `labs`, `lab-tech`, `vitals`, `dispense`, `referrals`, `followups`) | `/api/appointments`, `/api/follow-ups`, `/api/medical-camps?upcoming=1`, `/api/camp-attendance`, `/api/encounters`(+`/sign`), `/api/health-timeline?beneficiaryId=`, `/api/vitals`, `/api/screenings`, `/api/health-ai`, `/api/prescriptions`(+`/sign`,`/dispense`), `/api/lab-orders`, `/api/referrals`, `/api/health-orgs`, `/api/inventory?category=MEDICINE`, `/api/beneficiaries?q=` |
| portal | hospital (`overview`, `camps`, `profile`) | `/api/health-orgs`, `/api/health-professionals`, `/api/medical-camps?upcoming=1`, `/api/referrals`, `/api/camp-partners?mine=1`, `/api/camp-staff` |
| public | `home`, `campaigns`, `campaign-detail`, `donate`, `food-security`, `food-apply`, `food-pledge`, `green-corridor`, `impact`, `volunteer`, `contact`, `profile-page`, `auth-pages` | `/api/campaigns`, `/api/stats`, `/api/testimonials`, `/api/settings/public`, `/api/causes`(+`/:id/pledges`), `/api/animals(/pledges)`, `/api/donations?public=1`, `/api/medical-camps?campaignId=`, `/api/donations` (guest POST), `/api/payments` + `/api/payments/verify`, `/api/food/events?public=1`, `/api/food/public`, `/api/food/applications` + `/status`, `/api/food/pledges`, `/api/corridor-stats`, `/api/reports?fy=`, `/api/volunteer-applications(/mine)`, `/api/contact-queries`, `/api/auth/profile` |
| shared | `assistant-widget`, `donation-broadcasts`, `file-picker`, `user-profile-view`, `user-analytics-view`, `available-to-distribute`, csv/table/form primitives | `/api/assistant/chat`, `EventSource("/api/events/stream")`, `/api/files`, `/api/profile`, `/api/profile/password`, `/api/profile/analytics`, `/api/distributions?kitBatchId=`, `/api/kit-units?batchId=&status=SCANNED` |

## 8. Conventions (backend)

- **Response**: handlers return `json(res, data)` with **no envelope** — bare arrays/objects. Success/error shape is implicit; errors are `{ error: string }` via `handleError` (`backend/src/lib/session.ts:292-298`). Two legacy exceptions keep an old envelope: root `GET /api` returns `{success:true,data:{…}}` (`index.ts:60-79`).
- **Error path**: every handler wraps `try { … } catch (e) { return handleError(e, res); }`; `ApiError(message, status)` is the only throwing mechanism; the global express error handler re-delegates to `handleError` (`index.ts:89-96`).
- **Audit**: `logActivity(actor, action, entityType, detail, userId)` writes `ActivityLog` and swallows its own failures (`session.ts:305-320`); used pervasively on mutating routes.
- **Codes**: human-readable entity codes via `lib/codes.ts` (`nextFoodApplicationRef`, `nextBeneficiaryCode`, `generateUniqueCode`, …).
- **Workflow state machines**: `lib/workflow.ts` `assertTransition` + per-domain transition maps (e.g. `FOOD_EVENT_STATUSES`, `FOOD_REGISTRATION_TRANSITIONS` in `lib/food.ts`) — a genuine strength, applied to food, distributions, pledges.
- **Rate limiting**: in-memory bucket `checkRateLimit` (`lib/rate-limit.ts:33`) — used **only** by `routes/auth.ts` (login 20/10min per IP, 10/10min per email; register 10/10min) and food operations (`lib/food.ts:47-54`). Documented as single-instance best-effort (no Redis).
- **Validators**: `lib/validators.ts` (PAN/phone/PIN/email/UPI regexes + normalizers) — but **only `routes/food.ts` imports it** (verified: `grep -l 'lib/validators' routes/*.ts` → 1 file). The file's own header admits the duplication: "Backend routes duplicate these rules; keep both in sync" (`lib/validators.ts:1-4`). Every other router re-implements inline `String(...).trim()` + ad-hoc checks.
- **Frontend conventions**: `api-client.ts` throws on `!res.ok` after reading `{error}`; 401 (except login/register) clears the token and hard-navigates to `#/login` (`api-client.ts:59-66`); views are plain function components fetching in `useEffect` (react-query is a dependency but barely used).

## 9. Environment configuration

`backend/.env` keys (values redacted; key names verified):

| Key | Consumer | Notes |
|---|---|---|
| `PORT` | `index.ts:38` | default 4000 |
| `DATABASE_URL` | Prisma | compose overrides to `postgres:5432` service host |
| `SESSION_SECRET` | `lib/session.ts:17` | must be ≥16 chars or boot fails |
| `UPLOAD_DIR` | `lib/files.ts:66` | default `./upload`; bind-mounted volume |
| `CORS_ORIGINS` | `index.ts:40` | comma list; empty-Origin tools always allowed |

Frontend env: `BACKEND_URL` (rewrite target, `frontend/next.config.ts:8`). No `.env.example` is committed for either side.

## 10. Gaps and inconsistencies (within the new platform)

1. **Response-shape drift**: ~19 routers return `{items, total}` (`donations.ts`, `donors.ts`, `donors.ts` paginated lists, `medical-camps.ts`, `appointments.ts`, …), while others return bare arrays (`beneficiaries.ts`, `causes.ts`, `campaigns.ts`, `masters.ts`, `distributions.ts`, `food.ts` list branches, `volunteers.ts`, `notifications.ts`) and a few return bespoke objects (`kit-stats.ts` `{units,batches,…}`). Consumers must know each router's dialect.
2. **25 endpoints with no auth guard** (full list in §6). By design for most (public site data, guest donation + payment, certificate/receipt public verification by unguessable code, SSE broadcast), but three deserve scrutiny: `GET /api/files/:id/file` (any FileAsset downloadable by anyone with the id — no ownership checks; mitigation: cuid ids + `lib/files.ts` hardening), `GET /api/animals/reactions` (public reads of donor reactions incl. names), `GET /api/reports` public branch (aggregates only).
3. **`POST /api/assistant/chat` and `POST /api/health-ai` have no rate limit** — assistant accepts anonymous calls (`optional` auth) and proxies to an external LLM (`z-ai-web-dev-sdk`); cost/abuse exposure. `lib/rate-limit.ts` exists but is not applied here.
4. **No pagination on ~38 of 71 routers** — only 22-33 route files read `page`/`limit` (`grep 'sp.get("page")'` hit list in audit notes); e.g. `GET /api/volunteers`, `/api/campaigns`, `/api/causes`, `/api/inventory` return unbounded `findMany` lists (some cap via `take`, e.g. `corridor-events?limit=300` client-side).
5. **Validation duplication & drift risk**: `lib/validators.ts` used by exactly 1 router (`routes/food.ts`); every other router hand-rolls validation inline. No schema library (zod on backend is absent — zod exists only in the frontend).
6. **Role checks as string literals in 202 `requireRole` call sites** — no central permission map; adding a role requires grepping every route. `User.role` is a string column (no Prisma enum), so typos compile silently.
7. **Auth lifecycle gaps**: no refresh token, no token revocation/blacklist, logout only clears the cookie (a copied bearer token stays valid 7 days), password reset flow absent (admin sets temp passwords; `tempPassword()` in `routes/auth.ts:26-28`), and legacy plain-text passwords remain valid (`session.ts:43-47`).
8. **Duplicated logic**: campaign/cause/animal pledge flows re-implement near-identical donor-pledge create/list/cancel logic in three routers (`causes.ts:65+`, `animals.ts:176+`, `food.ts` pledges) against three models (`Pledge`, `AnimalPledge`, `FoodDonationPledge`); distribution + pad-distribution routers are structural twins (`distributions.ts` vs `pad-distributions.ts`).
9. **Dead/unwired endpoints** (§6.1): `GET /api/kit-stats`, certificate/receipt public verify pages, `volunteer-assignments` — mounted, role-guarded, zero frontend callers.
10. **`frontend/next.config.ts` `ignoreBuildErrors: true`** — TypeScript errors cannot fail the frontend build; combined with `reactStrictMode: false`.
11. **`multer` declared but unused** (`backend/package.json` vs custom `lib/multipart.ts`) — minor dependency drift.
12. **No tests anywhere** (§11) and no CI config in-repo.
13. **`GET /api/volunteer-attendances` is `role(ADMIN, VOLUNTEER)` but `POST` is ADMIN-only** — volunteers can view but never clock their own attendance from the portal (attendance rows are seeded/admin-created); the volunteer overview reads attendance but has no way to create it.
14. **Uploads restricted to ADMIN** — `POST /api/files` is `requireRole(ADMIN)` (`routes/files.ts:62`); doctors/nurses/volunteers attach documents only by URL, so mobile photo-upload flows (camp photos, ID proofs) have no self-service path.
15. **Notification channels are email + in-app only** (`lib/notify.ts:11-16` nodemailer; `Notification` model) — no SMS/WhatsApp/push, though phone numbers are collected and validated everywhere.

## 11. Testing status

**There are no automated tests.** Verified:
- `find backend frontend -name '*.test.*' -o -name '*.spec.*' -o -name '__tests__'` (excluding node_modules) → **0 files**.
- No `jest`/`vitest`/`mocha` config or dependency on either side (`backend/package.json`, `frontend/package.json`).
- No `test` script in either `package.json`; backend has only `typecheck`.
- No CI workflow directory (`.github/workflows/` absent from repo root).

Consequence: the parity matrix must treat every IMPLEMENTED status as *code-evidence only*; nothing can be marked VERIFIED without an actual run.

## 12. Role portal completeness (frontend)

| Role | Portal surface (files) | Assessment |
|---|---|---|
| ADMIN | `admin/admin-app.tsx` + 48 view files (donations, donors, campaigns, causes, ambulance, animals, beneficiaries, volunteers, users, distributions, inventory, kits, masters, reports, activity, files, settings, dashboard; `food/*` 10 files; `health/*` 16 files) | **Complete** — deepest surface in the app |
| DONOR | `portal/donor/*` — overview, donations, causes (adopt-a-medicine), animals, sponsorships, receipts, profile + shared analytics | **Complete** |
| VOLUNTEER | `portal/volunteer/*` — application, overview, tasks, distributions, scan (QR kit-scan + food check-in), inventory, camps, profile; PENDING state gets application tracking (`portal-router.tsx:63-101`) | **Complete**, except self-attendance (gap #13) |
| BENEFICIARY | `portal/beneficiary/*` — **3 files**: hub (requests + distributions), health (read-only timeline/appointments/orders), food (event registration) | **Thin** — read-mostly; no profile editing, no appointment self-booking |
| DOCTOR | `portal/doctor/*` — overview, camps, patients, prescriptions, labs, referrals, follow-ups, vitals + shared patient picker | **Complete** for clinical workflows |
| NURSE | reuses `portal/doctor/vitals.tsx` + camps — nav is a subset (`portal-router.tsx:207-208`) | **Thin** — vitals/screenings/camps only |
| PHARMACIST | reuses `portal/doctor/dispense.tsx` only (`portal-router.tsx:209-210`) | **Very thin** — one screen |
| LAB_TECH | reuses `portal/doctor/lab-tech.tsx` only (`portal-router.tsx:211`) | **Very thin** — one screen |
| HOSPITAL | `portal/hospital/*` — overview, camps, profile (`portal-router.tsx:260+`) | **Moderate** — camp-partner oriented |
| Guest/public | public-site 19 files incl. donate with gateway checkout, food apply/pledge, volunteer apply | **Complete** |

---

## 13. Final counts

| Metric | Value |
|---|---|
| Backend routers (files, all mounted) | **71** |
| Backend endpoints (method-level) | **276** |
| Endpoints by guard | 202 `role` · 37 `auth` · 14 `optional` · 25 `public`/conditional (incl. `reports` branch) — counts from static scan, ±0 after camp-staff comment fix |
| Prisma models | **69** |
| Frontend component files | **173** (125 feature + 48 ui) — public 19, admin 49, portal 36, shared 21 |
| Automated tests | **0** |

### Top 10 gaps
1. Zero automated tests (both sides) — nothing verifiable by CI.
2. Anonymous, un-throttled AI endpoints (`/api/assistant/chat`, `/api/health-ai`) — external-LLM cost abuse.
3. No token revocation / refresh / password-reset; legacy plain-text passwords still verify (`session.ts:43-47`).
4. `GET /api/files/:id/file` public: any stored file downloadable with its id, no access control.
5. Response-shape drift (`{items,total}` vs bare arrays vs bespoke) across ~71 routers.
6. ~38/71 routers return unbounded lists (no pagination).
7. Validators centralized (`lib/validators.ts`) but used by only 1/71 routers; per-route hand-rolled validation elsewhere.
8. Role permissions as 202 scattered string-literal `requireRole` calls; `User.role` is a free string column (no enum).
9. Uploads ADMIN-only + notifications email-only — blocks mobile photo/self-service and push use-cases.
10. Frontend builds with `ignoreBuildErrors: true`; mounted-but-unwired endpoints (`kit-stats`, `volunteer-assignments`, public certificate/receipt verify) with zero UI consumers.
