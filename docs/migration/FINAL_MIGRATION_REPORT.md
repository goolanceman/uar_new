# FINAL_MIGRATION_REPORT.md — UAR Platform Migration

Date: 2026-11-17 · Coordinator: Augment (5-agent program per docs/mobile_migration.md)

## 1. Original architecture
- **Legacy**: Laravel 9 (`../php/admin`) + MySQL — 187 API + 133 web routes, 15 feature groups. Mix of real UAR business modules (beneficiary KYC, volunteer mgmt, charity V2 causes/donations, notifications) and the "Chatter" social ecosystem (feed/reels/rooms/chat/audio spaces). 86/97 mobile-called endpoints guarded only by a static `apikey` header; identity from untrusted body params; OTPs leaked in responses (AuthController.php L213/L306); IsAdmin backdoor; zero scheduled jobs; FCM credentials file empty.
- **Mobile**: Flutter "Chatter" template (`name: untitled`) — reels/stories/audio-rooms/cart. **Zero UAR functionality** (verified by Agent 5a: no UAR endpoints called, no token auth, hardcoded LAN base URL). 97 endpoints called are all template social APIs.

## 2. New architecture (target, achieved)
- **Backend** `uarnew/backend`: standalone Express + TypeScript + Prisma + **PostgreSQL 16** (Docker). 71 routers / 276 endpoints, JWT HS256 (cookie + Bearer, `ms` claim for exact revocation ordering), role-scoped RBAC (202 requireRole sites), settings-driven feature flags, SSE live-event hub, email via settings-driven SMTP, rate limiting, multipart uploads with per-role policy, 69-model Prisma schema, 14-test vitest/supertest suite on isolated `uar_test` DB.
- **Admin/frontend** `uarnew/frontend`: Next.js 16 single-route SPA — public site (campaigns/donate/verify pages), admin console (49 views), donor/volunteer/beneficiary portals, shadcn design system, `/api` proxied to the backend. `ignoreBuildErrors` removed.
- **Mobile** `../mobile`: rebuilt Flutter UAR app (12 files / 3,376 lines replacing the 310-file template) — env-based `API_BASE_URL` (--dart-define), Bearer auth with single-retry refresh + server-side revocation, role shells:
  - **Donor**: campaigns + detail, donate (UPI instant / gateway-gated), My Gifts (donations + receipts + printable HTML), profile
  - **Volunteer**: legacy-parity application form (geo/emergency/travel fields), status gate, tasks + self check-in
  - **Beneficiary**: KYC card (status badge + submit with file upload), requests list + new request
  - **Admin**: read-only dashboard (stats + activity log)
  - Forgot/reset password flows; org branding + feature flags from `/api/settings/public`

## 3. Feature verdicts (see FEATURE_PARITY_MATRIX.md for the full matrix)
- UAR business domains (fundraising, people, food, health, inventory, corridor, platform): new backend is a **superset** of legacy — legacy parity gaps closed in this migration (A-1..A-8).
- Legacy social ecosystem (feed/reels/rooms/chat/audio): **RETIRED** with the template — NOT_APPLICABLE for UAR scope (documented decision).
- Charity-card gamification (points/tiers/expiry cron): RETIRED (documented decision).

## 4. Changes
- **Backend**: VolunteerApplication +15 legacy fields; PasswordReset model + forgot/reset OTP flow (no enumeration, no OTP leakage); User.tokenValidAfter + JWT `ms` claim (exact revocation); /api/auth/refresh; beneficiary KYC state machine (PENDING→SUBMITTED→VERIFIED/REJECTED + endpoints); file policy (any authed user uploads → forced `kyc/<userId>`; docs auth-to-read, images public); AI rate limits; optional pagination on 4 list endpoints; BLOCKERS.md (FCM creds).
- **Frontend**: testimonials admin CRUD; volunteer assignments panel; volunteer self-check-in; public verify pages (certificate/receipt); forgot-password flow; rich application review; tsc clean + build gate enforced.
- **Mobile**: full lib/ replacement (git-preserved); contract-driven API layer; role shells; web platform enabled.
- **Database**: additive Prisma pushes only (tokenValidAfter, kyc fields, application fields, PasswordReset); all legacy data migrated earlier (69/69 models verified).

## 5. Test results
- Backend: `bun run typecheck` ✓ · `bun run test` **14/14 × 5 consecutive runs** (auth incl. revocation + forgot/reset, donations incl. exact increment + masking, files policy, volunteer legacy fields, SSE 503-gate).
- Frontend: `tsc --noEmit` ✓ · `next build` ✓ (no type-ignore).
- Mobile: `flutter analyze` no issues · `flutter test` 2/2 · `flutter build web --dart-define=API_BASE_URL=http://localhost:4000` ✓.
- Live integration: Flutter web served at `http://127.0.0.1:8090` (flutter run -d web-server) — CORS preflight 204; **15/15 mobile-facing endpoints conformance sweep PASS from the Flutter origin**; role E2E (donor donate→receipt · volunteer apply→mine · beneficiary request→mine) all PASS; test rows cleaned afterwards.
- Platform: SSE donation broadcast verified through the Next.js proxy; settings flag `features.liveDonationFeed` exposed + gated.

## 6. Outstanding / known limitations
1. **FCM push (A-6)**: blocked on a Firebase service-account JSON (legacy credential file empty) — see backend/docs/migration/BLOCKERS.md.
2. **Storage driver abstraction (D-1)**: uploads are local-disk only; S3/DO parity deferred.
3. **User.role as free string**: Prisma enum tightening deferred (debt, not a gap).
4. **Gateway checkout on mobile**: providers need live keys; UI gates on `finance.gatewayEnabled` + `gatewayKeyId` (hidden when unconfigured — current state).
5. Contract drift notes: `POST /api/volunteer-applications` returns `{application}` (wrapped); `GET /api/volunteers/me` shape `{volunteer, application}` — documented in MOBILE_API_MAPPING.md; the app handles both.

## 7. How to run everything
- Platform: `docker compose up -d` (postgres + api) · frontend: `cd frontend && bun run dev` (:3000/:3001) · mobile web: `cd ../mobile && flutter run -d web-server --web-port 8090 --dart-define=API_BASE_URL=http://localhost:4000` (or open build/web via any static server).
