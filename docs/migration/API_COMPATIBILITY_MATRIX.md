# API_COMPATIBILITY_MATRIX.md — New Backend vs Mobile-Facing Needs (Agent 2)

Auditor: Agent 2 — New Platform Auditor · Date: 2026-11-16
Purpose: the Flutter mobile app (`../mobile`, 310 dart files) currently talks to the **legacy PHP** backend. This matrix states, per legacy-style capability, what the **new backend** (`uarnew/backend`) already supports, what needs adaptation, and what it lacks entirely — so Agent 5 / the coordinator can plan the mobile cutover without re-reading the codebase.

Assessment basis: static code inspection of `uarnew/backend/src` (all 71 routers) and `frontend/src/lib/api-client.ts`. Legacy column (`../php`) is `PENDING_AUDIT` — Agent 1's `backend/docs/migration/LEGACY_API_INVENTORY.md` did not exist at audit time. Capability categories: **SUPPORTED** (works as-is for a mobile client) · **NEEDS ADAPTATION** (exists but with a gap the mobile app must code around, or backend change is cheaper) · **MISSING** (no implementation found).

---

## 1. Authentication & session

| # | Legacy-style capability (mobile expectation) | New backend state | Evidence | Category |
|---|---|---|---|---|
| 1.1 | Login with email+password returning a token | JWT HS256 (7-day TTL) from `POST /api/auth/login`; token returned in JSON body **and** set as cookie | `routes/auth.ts:43-87`, `lib/session.ts:70-99` | **SUPPORTED** |
| 1.2 | Token sent as header on every call | `Authorization: Bearer <jwt>` accepted on **all** endpoints (checked before cookie) | `lib/session.ts:190-200` | **SUPPORTED** |
| 1.3 | Role returned with login (client-side gating) | `role`, `name`, `email` are JWT claims; `GET /api/auth/me` re-derives the session | `lib/session.ts:56-62`, `routes/auth.ts` GET `/me` | **SUPPORTED** |
| 1.4 | Self-registration (donor/volunteer/beneficiary) | `POST /api/auth/register` — 3 roles only, volunteers land PENDING; rate-limited 10/10min/IP | `routes/auth.ts:24, 86-112` | **SUPPORTED** |
| 1.5 | "Remember me" / refresh token | **None** — single 7-day JWT, no refresh, no rotation. Mobile must re-login weekly or the backend needs a refresh endpoint | `lib/session.ts:64` | **NEEDS ADAPTATION** |
| 1.6 | Logout invalidates the token | Cookie cleared server-side, but a mobile-held bearer token stays valid to expiry (stateless, no blacklist) | `lib/session.ts:178-188` | **NEEDS ADAPTATION** |
| 1.7 | Password reset / forgot-password | **None** — admin issues temp passwords (`tempPassword()`); no email-link flow | `routes/auth.ts:26-28` | **MISSING** |
| 1.8 | Change password | `POST /api/profile/password` (current password required) | `routes/profile.ts` | **SUPPORTED** |
| 1.9 | Legacy plain-text password compat | scrypt hashes, but legacy cleartext values still verify — relevant if user DB is imported from PHP | `lib/session.ts:43-47` | **SUPPORTED** (migration bridge) |

## 2. Donor mobile flows

| # | Capability | New backend state | Evidence | Category |
|---|---|---|---|---|
| 2.1 | Guest donation (no login) | `POST /api/donations` accepts optional session; validates amount/campaign | `routes/donations.ts` POST `/` (`getSession` optional) | **SUPPORTED** |
| 2.2 | Online payment + verification | `POST /api/payments` (Razorpay/Stripe/Cashfree order creation) + `POST /api/payments/verify`; mobile renders provider checkout from the returned payload | `routes/payments.ts:86-170+` | **SUPPORTED** (Stripe redirect URL assumes web hash-route return — mobile should prefer Razorpay order flow or an in-app bridge) |
| 2.3 | My donations | `GET /api/donations?mine=1` | `routes/donations.ts` (auth) | **SUPPORTED** |
| 2.4 | My receipts | `GET /api/receipts?from&to&limit` (auth); single receipt + printable HTML are public by number | `routes/receipts.ts` | **SUPPORTED** |
| 2.5 | Cause pledges (Adopt-a-Medicine) | `POST /api/causes/:id/pledges` (guest OK), `GET /api/causes/pledges?mine=1`, admin list `GET /api/pledges` | `routes/causes.ts:65+`, `routes/pledges.ts` | **SUPPORTED** |
| 2.6 | Animal sponsorship | `POST /api/animals/pledges`, `GET /api/animals/pledges?mine=1`, `GET /api/animals` public browse | `routes/animals.ts:176+` | **SUPPORTED** |
| 2.7 | Food pledges | `POST /api/food/pledges` (guest), `GET /api/food/pledges?mine=1` | `routes/food.ts` | **SUPPORTED** |
| 2.8 | Beneficiary sponsorships (donor side) | `GET /api/sponsorships?mine=1`, cancel via `PATCH /api/sponsorships/:id` | `routes/sponsorships.ts` | **SUPPORTED** |
| 2.9 | Certificates for donors | `GET /api/certificates?limit=50` (auth); public verify by code | `routes/certificates.ts` | **SUPPORTED** |
| 2.10 | In-app notifications | `GET /api/notifications` (own + global), `PATCH` mark-read | `routes/notifications.ts:20-44` | **SUPPORTED** |
| 2.11 | Push notifications | **No FCM/APNs/SMS/WhatsApp** — email (SMTP, settings-driven) + in-app `Notification` rows only | `lib/notify.ts:11-16` | **MISSING** |

## 3. Volunteer mobile flows

| # | Capability | New backend state | Evidence | Category |
|---|---|---|---|---|
| 3.1 | My profile | `GET /api/volunteers/me` (auth) | `routes/volunteers.ts:151` | **SUPPORTED** |
| 3.2 | My tasks + status updates | `GET /api/volunteer-tasks?mine=1`, `PATCH /api/volunteer-tasks/:id` (ADMIN or VOLUNTEER) | `routes/volunteer-tasks.ts:271-273` | **SUPPORTED** |
| 3.3 | QR kit scanning | `POST /api/kit-scan` (VOLUNTEER/ADMIN); `GET /api/kit-units?mine=1` | `routes/kit-scan.ts:174`, `kit-units.ts` | **SUPPORTED** |
| 3.4 | Food event check-in + walk-in | `POST /api/food/checkin`, `POST /api/food/events/:id/walkin` (VOLUNTEER/ADMIN, rate-limited) | `routes/food.ts:121,133`, `lib/food.ts:47-54` | **SUPPORTED** |
| 3.5 | My distributions | `GET /api/distributions?mine=1` | `routes/distributions.ts:81` (auth) | **SUPPORTED** |
| 3.6 | Camp check-in assist / registrations | `GET/POST /api/camp-registrations`, `GET /api/camp-attendance` (VOLUNTEER in role list) | `routes/camp-registrations.ts:47-50`, `camp-attendance.ts:39` | **SUPPORTED** |
| 3.7 | Volunteer self attendance (clock-in) | **POST `/api/volunteer-attendances` is ADMIN-only**; volunteers can only read. Mobile self-clock-in needs a backend change | `routes/volunteer-attendances.ts:270` | **NEEDS ADAPTATION** |
| 3.8 | Volunteer application tracking | `POST /api/volunteer-applications` (public), `GET /mine` | `routes/volunteer-applications.ts:263-264` | **SUPPORTED** |
| 3.9 | Assignments visible to volunteer | `GET /api/volunteer-assignments` is ADMIN-only and has **no volunteer-scoped read**; unused by the web frontend too | `routes/volunteer-assignments.ts:267-268` | **NEEDS ADAPTATION** |

## 4. Beneficiary mobile flows

| # | Capability | New backend state | Evidence | Category |
|---|---|---|---|---|
| 4.1 | Help/raise request | `POST /api/beneficiary-requests` (guest OK), `GET ?mine=1` | `routes/beneficiary-requests.ts:23-38` | **SUPPORTED** |
| 4.2 | My beneficiary record | `GET /api/beneficiaries?mine=1` | `routes/beneficiaries.ts:50-56` | **SUPPORTED** |
| 4.3 | Food events + registration | `GET /api/food/events` (BENEFICIARY allowed; `?public=1`), `POST /api/food/events/:id/registrations` | `routes/food.ts:122,129` | **SUPPORTED** |
| 4.4 | Health timeline (read) | `GET /api/health-timeline` (auth, self-scoped) | `routes/health-timeline.ts:161` | **SUPPORTED** |
| 4.5 | My appointments / lab orders / prescriptions / documents / referrals (read) | All read endpoints accept the caller's scope; encounter detail explicitly includes BENEFICIARY | `routes/appointments.ts:18`, `lab-orders.ts:181`, `prescriptions.ts:213`, `medical-documents.ts:194`, `referrals.ts:231`, `encounters.ts:98` | **SUPPORTED** (read-only by design) |
| 4.6 | Camp registration (self) | `POST /api/camp-registrations` includes BENEFICIARY | `routes/camp-registrations.ts:48` | **SUPPORTED** |
| 4.7 | Appointment self-booking | **None** — appointments are staff/doctor-created only; no beneficiary-facing POST | `routes/appointments.ts:19` | **MISSING** |

## 5. Cross-cutting technical capabilities

| # | Capability | New backend state | Evidence | Category |
|---|---|---|---|---|
| 5.1 | JSON responses with a stable envelope | Bare JSON bodies, errors always `{ error: string }` via `handleError`; **no** `{success,data}` envelope (two legacy holdovers: root `GET /api`, `/api/health`) | `lib/session.ts:292-298`, `index.ts:47-82` | **NEEDS ADAPTATION** (mobile must parse dialect per endpoint; documented per-router in `NEW_PLATFORM_AUDIT.md` §6) |
| 5.2 | Pagination on list endpoints | `page`/`limit` in only 22-33 of 71 routers; many return unbounded arrays | audit §10.4 | **NEEDS ADAPTATION** (mobile must cap defensively) |
| 5.3 | File upload (photo/ID proof) from app | Custom multipart parser (`lib/multipart.ts`), allowlist MIME, 10 MB cap — but **`POST /api/files` is ADMIN-only**; staff roles attach documents by URL only | `routes/files.ts:60-62`, `lib/files.ts:18-49` | **NEEDS ADAPTATION** (widen upload roles + return URL contract) |
| 5.4 | File download | `GET /api/files/:id/file` public, traversal-safe, extension/mime-consistency enforced | `routes/files.ts:185+`, `lib/files.ts:107-110` | **SUPPORTED** |
| 5.5 | Push notifications | None (see 2.11) | `lib/notify.ts` | **MISSING** |
| 5.6 | Realtime updates | SSE `GET /api/events/stream` (public, feature-flagged, 503 when off) — consumable from mobile web views; native apps can read SSE but there is no polling fallback API | `routes/events.ts:20-31` | **SUPPORTED** (with caveat) |
| 5.7 | Server-driven config (branding, flags, gateway provider) | `GET /api/settings/public` — no auth | `routes/settings.ts:244` | **SUPPORTED** |
| 5.8 | API versioning | **None** — unversioned `/api/*`; mobile upgrades will be lock-step. Recommend `/api/v1` alias or header versioning before mobile cutover | `index.ts` mounts | **MISSING** |
| 5.9 | Brute-force/abuse protection | In-memory rate limit on login/register/food ops only; **not** on assistant/AI/donations/contact endpoints; resets on restart, single-instance | `lib/rate-limit.ts:1-10`, `routes/auth.ts:44-45,89` | **NEEDS ADAPTATION** (move to shared store before scaling) |
| 5.10 | CORS for webviews | Origin allowlist via `CORS_ORIGINS` with credentials — irrelevant for native HTTP but required if mobile uses webviews | `index.ts:40-53` | **SUPPORTED** |
| 5.11 | TLS/secure storage guidance | Cookie is Secure over HTTPS; bearer token in `localStorage` on web — mobile should use secure storage; no cert-pinning or token-binding server-side | `lib/session.ts:158-176` | **SUPPORTED** (client-side responsibility) |
| 5.12 | OpenAPI / API documentation | **None** — no swagger/openapi artifact in repo | repo scan | **MISSING** |

## 6. Recommendations for the mobile cutover (input to MOBILE_API_CONTRACT.md)

1. **Blockers before cutover**: add refresh-token or sliding-session support (1.5), volunteer self-attendance (3.7), widen file-upload roles (5.3), decide on an API versioning scheme (5.8), and add a documented response-envelope convention (5.1).
2. **Hard requirements from product**: push notifications (2.11/5.5) and password reset (1.7) are table-stakes for a mobile audience — schedule backend work in Phase 3.
3. **Mobile-team coding rules until then**: every list call must send defensive `limit`; every error handler must expect `{ error: string }`; payment flows must handle Stripe's web-oriented redirect (prefer Razorpay/Cashfree order objects).
4. When Agent 1's `LEGACY_API_INVENTORY.md` lands, diff its endpoint list against `NEW_PLATFORM_AUDIT.md` §6 — any legacy mobile API with no equivalent row here is a Phase-3 backend ticket.
