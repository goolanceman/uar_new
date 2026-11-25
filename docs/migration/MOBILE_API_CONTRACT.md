# MOBILE_API_CONTRACT.md — frozen contract for the UAR mobile app

Status: **FROZEN for mobile development** (Phase 5). Basis: the verified live backend
(71 routers, 276 endpoints — see NEW_PLATFORM_AUDIT.md). Only the subset the mobile
app consumes is listed here. Every endpoint below was verified live during migration
testing unless marked otherwise.

## Base URL & auth

- `API_BASE_URL` — env-driven (`--dart-define=API_BASE_URL`), default `http://localhost:4000`. NEVER hardcoded.
- Auth: **JWT HS256** (`Authorization: Bearer <token>`). 7-day expiry.
- `POST /api/auth/login` `{email, password}` → `200 {user:{id,name,email,role,status,phone,city,avatar,pan,about}, token}` · errors: `401 {error}` · `403 {error}` (suspended)
- `POST /api/auth/register` `{name,email,phone,role?,city?}` → `200 {user, token, tempCreds:{email,password,fullName}}` (DONOR default; VOLUNTEER created PENDING; roles allowed: DONOR|VOLUNTEER|BENEFICIARY)
- `GET /api/auth/me` (Bearer) → `{user}` or `{user:null}`
- `POST /api/auth/refresh` (Bearer) → `{token}` (sliding 7d)
- `POST /api/auth/logout` (Bearer) → `{ok:true}` — **revokes the token server-side** (old token stops working)
- `POST /api/auth/forgot-password` `{email}` → always `200 {ok:true}` (no enumeration; OTP only via email/server log — never in response)
- `POST /api/auth/reset-password` `{email, otp, password}` → `{ok:true}` · `400/401` on bad OTP
- `PATCH /api/auth/profile` (Bearer) `{name?,phone?,city?,pan?,about?,password?:{current,next}}` → `{user}`

Roles: `ADMIN · VOLUNTEER · DONOR · BENEFICIARY · DOCTOR · NURSE · PHARMACIST · LAB_TECH · HOSPITAL` — mobile serves DONOR/VOLUNTEER/BENEFICIARY (ADMIN gets a read-only dashboard).

## Donor surface

| Method+Path | Auth | Request → Response |
|---|---|---|
| `GET /api/campaigns` | public | → `[{id,title,slug,description,tagline,category,status,targetAmount,raisedAmount,currency,accent,icon,coverImage,images,...}]` |
| `GET /api/campaigns/:id` | public | → campaign |
| `GET /api/donations?public=1` | public | → latest 12 COMPLETED, masked (`donorName` already masked/anon; no contact fields) |
| `POST /api/donations` | optional | `{amount>0,currency,type:ONE_TIME\|RECURRING,paymentMethod,campaignId?,donorName,donorEmail,donorPhone?,message?,isAnonymous?,pan?}` → `201 donation` (UPI = instant COMPLETED; gateway methods → PENDING + `checkoutPending:true`) |
| `GET /api/donations?mine=1&limit=` | Bearer | → my donations (full records) |
| `GET /api/donations/:id` | Bearer (ADMIN/VOLUNTEER) | → donation detail |
| `GET /api/receipts` | Bearer | → my receipts |
| `GET /api/receipts/:receiptNumber` | public | → receipt (verify) |
| `GET /api/receipts/:receiptNumber/html` | public | → printable HTML |
| `GET /api/causes`, `GET /api/testimonials` | public | → lists (donor browsing) |

## Volunteer surface

| Method+Path | Auth | Request → Response |
|---|---|---|
| `POST /api/volunteer-applications` | public | `{fullName,email,phone,city,state?,country?,postalCode?,addressLine1?,addressLine2?,occupation?,motivation,priorExperience?,emergencyContact?,emergencyPhone?,latitude?,longitude?,maxTravelDistance?}` → `201` (legacy-parity field set) |
| `GET /api/volunteer-applications/mine` | Bearer | → my applications (+status PENDING/APPROVED/REJECTED) |
| `GET /api/volunteers/me` | Bearer | → my volunteer profile |
| `GET /api/volunteer-tasks` | Bearer | → tasks (volunteer sees own) |
| `POST /api/volunteer-attendances` | Bearer (VOLUNTEER self / ADMIN) | check-in `{taskId,...}` (self-check-in per Agent-3 change) |
| `GET /api/volunteer-assignments?refType=&refId=` | Bearer (ADMIN) | → assignments |

## Beneficiary surface

| Method+Path | Auth | Request → Response |
|---|---|---|
| `GET /api/beneficiaries?mine=1` | Bearer | → own beneficiary record(s) incl. `kycStatus` |
| `POST /api/beneficiaries/:id/kyc` | Bearer (owner) | submit KYC → `kycStatus: SUBMITTED` |
| `POST /api/beneficiary-requests` | public | request → `201` |
| `GET /api/beneficiary-requests?mine=1` | Bearer | → my requests + statuses |

## Common

| Method+Path | Auth | Notes |
|---|---|---|
| `GET /api/settings/public` | public | `{orgName,logoUrl,features:{...}}` — gate UI by `features.*` flags |
| `GET /api/stats` | Bearer | dashboard totals |
| `GET /api/notifications` | Bearer | user notifications (optional `?page=&limit=`) |
| `POST /api/files` (multipart, `file` + `folder`) | Bearer | non-admins forced into `kyc/<userId>`; docs (pdf/docx/...) need auth to read; images public |
| `GET /api/events/stream` (SSE) | public | `event: donation` frames — gated by `features.liveDonationFeed` |
| `GET /api/food/public`, `GET /api/food/events?public=1` | public | food programme public data |

## Error shape (global)

Every error: `{ "error": "human message" }` with proper status (400 validation · 401 unauthenticated · 403 wrong role · 404 missing · 429 rate-limited · 500 server).

## CORS (Flutter web dev)

The backend allow-list must include the Flutter web dev origin (e.g. `http://localhost:8090`). Configured via `CORS_ORIGINS` (backend/.env / docker-compose env).
