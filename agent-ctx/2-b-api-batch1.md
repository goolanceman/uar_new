# Task 2-b — API Routes Batch 1 (work record)

Agent: 2-b · Status: ✅ COMPLETE (all routes written, type-checked, smoke-tested end-to-end)

## Files (22 route files)

Rewrote legacy stubs (old `{success,data}` envelope / empty files) to CONVENTIONS: `force-dynamic`, raw `json(...)`, `ApiError` + `handleError`, helpers from `@/lib/session`:

- `src/app/api/auth/login/route.ts` — POST {email,password}; email lowercased; 401 "Invalid email or password"; 403 "Account suspended"; PENDING volunteers CAN log in; legacy plain password auto-upgraded to scrypt; sets session; `{user}` sans password.
- `src/app/api/auth/logout/route.ts` — POST → `{ok:true}`
- `src/app/api/auth/me/route.ts` — GET → `{user}` fresh sans password, `{user:null}` when no session
- `src/app/api/auth/register/route.ts` — POST {name,email,phone,city?,role}; dup 409; role ∈ DONOR|VOLUNTEER|BENEFICIARY; temp pw `UAR#####@`; VOLUNTEER→PENDING/inactive; → `{user, tempCreds:{email,password,fullName}}`
- `src/app/api/auth/profile/route.ts` — PATCH (auth) {name?,phone?,city?,pan?,about?,password:{current,next}}
- `src/app/api/users/route.ts` — GET (ADMIN) ?q&role&status; POST (ADMIN)
- `src/app/api/users/[id]/route.ts` — PATCH (ADMIN; status PENDING→isActive false, ACTIVE→true, SUSPENDED→false); DELETE (ADMIN; blocks self + last admin; detaches donations/notifications/activityLogs/beneficiary FKs, deletes volunteer profile)
- `src/app/api/volunteer-applications/route.ts` — GET ?mine=1 (auth) | (ADMIN) ?status&q; POST public/auth: motivation ≥20 chars, skills/availability JSON-stringified, links existing email (never downgrades ADMIN) or creates user with tempCreds → `{application, tempCreds?}`
- `src/app/api/volunteer-applications/mine/route.ts` — GET → `{application| null}` (latest)
- `src/app/api/volunteer-applications/[id]/route.ts` — PATCH (ADMIN) APPROVED→reviewedAt+user ACTIVE+volunteer profile upsert (skills/availability carried over); REJECTED→reviewedAt; DELETE
- `src/app/api/campaigns/route.ts` — GET ?category&status&q&featured&all=1 (DRAFT hidden unless ADMIN+all=1; featured desc, createdAt desc); POST (ADMIN) slug auto kebab + `-2,-3…`, createdBy session → 201
- `src/app/api/campaigns/[id]/route.ts` — GET by id→slug fallback; PATCH (ADMIN); DELETE (ADMIN) unlinks donations (campaignId→null) then deletes
- `src/app/api/donations/route.ts` — GET `mine=1` (auth) | `public=1`/no session → latest 8 COMPLETED, isAnonymous→"Anonymous" | signed-in admin → filters campaignId/status/q/limit(default 50); POST (public or auth) amount>0, session prefill donorName/donorEmail, pan persisted on user, receipt `UAR-RCPT-YYYY-#####` loop-unique, paymentStatus COMPLETED, campaign.raisedAmount increment → **201 `{donation incl campaign{title}}`**
- `src/app/api/donations/[id]/route.ts` — PATCH (ADMIN) {paymentStatus?,amount?} → recompute raisedAmount = Σ COMPLETED; DELETE same recompute → `{ok:true}`
- `src/app/api/stats/route.ts` — public aggregate (shape below)
- `src/app/api/reports/route.ts` — (ADMIN|VOLUNTEER) ?type=overview|donations|distributions|causes|animals&from&to
- `src/app/api/contact-queries/route.ts` — GET (ADMIN) ?status; POST public → 201, status PENDING
- `src/app/api/contact-queries/[id]/route.ts` — PATCH (ADMIN) RESOLVED→resolvedAt+resolvedBy=session.name (cleared otherwise); DELETE
- `src/app/api/testimonials/route.ts` — GET public (desc, 12); POST (ADMIN) rating clamped 1–5
- `src/app/api/testimonials/[id]/route.ts` — PATCH/DELETE (ADMIN)
- `src/app/api/settings/route.ts` — GET `{key:value}`; PATCH (ADMIN) flat upsert → returns object
- `src/app/api/activity-logs/route.ts` — GET (ADMIN) ?limit default 60, desc

## ⚠️ Note for other agents

`verifyPassword(plaintext, stored)` — mission text said `verifyPassword(user.password, password)` but the canonical helper signature in `@/lib/session` is `(pw, stored)`; I used the CORRECT order (plaintext first). Same for profile password change.

## Verified by smoke test (dev server)
login (incl. UPPERCASE email), admin gates (401/403), full volunteer application → temp login (PENDING) → admin approve → user ACTIVE/VOLUNTEER + volunteer profile created, donation POST 201 + campaign increment + PATCH recompute + DELETE, user DELETE with FK detach, campaign slug lookup, reports all 5 types, contact/testimonial/settings/activity-logs CRUD. All test artifacts cleaned up (DB restored: campaign raisedAmount back to seed 276000, admin pan cleared, temp user/app/campaign/testimonial/query/setting deleted).

## Exact response shapes (for agents 5-*)

### POST /api/donations → 201
```jsonc
{
  "id": "cuid", "donorId": "cuid|null", "donorName": "Rahul Sharma", "donorEmail": "donor@demo.org",
  "donorPhone": null, "amount": 500, "currency": "INR", "type": "ONE_TIME|RECURRING",
  "category": "GENERAL|FOOD_DISTRIBUTION|SANITARY_PADS|MEDICAL|AWARENESS|SAFETY|ANIMAL|MOBILITY|EDUCATION_SUPPORT|EMERGENCY",
  "paymentMethod": "UPI|RAZORPAY|STRIPE|CASH|BANK_TRANSFER", "paymentStatus": "COMPLETED",
  "transactionId": null, "receiptNumber": "UAR-RCPT-2026-00011", "campaignId": "cuid|null",
  "message": null, "isAnonymous": false, "createdAt": "ISO", "updatedAt": "ISO",
  "campaign": { "title": "Sankalp Against Substance — Anti-Drug" }   // null-object omitted? — campaign object or null when no campaignId
}
```
Errors: 400 `{error}` (amount ≤ 0, missing donor name/email, bad campaignId). GET list rows additionally include `campaign: {title, accent}`.

### GET /api/stats (public, single object)
```jsonc
{
  "totals": {
    "raised": 735800,            // Σ COMPLETED donations
    "donations": 10,             // COMPLETED count
    "campaigns": 9,              // ACTIVE
    "beneficiaries": 6,
    "volunteers": 1,             // users role=VOLUNTEER status=ACTIVE
    "causesSeeking": 6, "causesAdopted": 1,
    "animals": 6, "animalsAvailable": 4,
    "kitsUnits": 24, "kitsScanned": 0,     // Σ kitBatch.totalUnits / scannedUnits
    "distributions": 3, "missions": 2,
    "vehiclesAlerted": 312,      // Σ mission.vehiclesAlerted
    "timeSavedMin": 11           // Σ timeSavedSec / 60, rounded
  },
  "monthly": [ { "month": "Jun", "amount": 0 }, … ],   // last 6 months incl. current, short EN month names, Σ COMPLETED (computed in JS)
  "byCampaign": [ { "title": "AI Green Corridor — ambulances that clear their own path", "raised": 821000, "target": 1500000 }, … ], // top 6 non-DRAFT by raisedAmount
  "byRole": [ { "role": "VOLUNTEER", "count": 2 }, … ],
  "distributionTypes": [ { "type": "FOOD", "count": 2 }, … ],
  "recentDonations": [ { "donorName": "Rahul Sharma|Anonymous", "amount": 25000, "campaign": "Sankalp Against Substance — Anti-Drug|null", "createdAt": "ISO" }, … ] // 5 latest COMPLETED
}
```
