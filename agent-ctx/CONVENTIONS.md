# United Angel Reach — Build Conventions (READ FIRST)

## Project
- Next.js 16 App Router + TypeScript + Tailwind v4 + shadcn/ui (new-york) at `src/components/ui`.
- Prisma + SQLite. Server code imports: `import { db } from "@/lib/db"`. `.env` has DATABASE_URL.
- The sandbox exposes ONE route `/`. ALL navigation is hash-based via `src/lib/router.tsx`:
  - `navigate("/campaigns")`, `<Link href="/campaigns">`, `useRoute()` → `{path, segments, query, key}`, `matchPath("/campaigns/:slug", segments)`.
- `src/app/page.tsx` is OWNED BY THE COORDINATOR — never edit it.

## Canonical data model (prisma/schema.prisma) — field names are FIXED
- **User**: email(unique), name, password, role "ADMIN|VOLUNTEER|DONOR|BENEFICIARY", isActive Boolean, status "ACTIVE|PENDING|SUSPENDED", phone?, city?, pan?, about?, avatar?
- **Donation**: donorId?, donorName, donorEmail, donorPhone?, amount, currency "INR", type "ONE_TIME|RECURRING", category "GENERAL|FOOD_DISTRIBUTION|SANITARY_PADS|MEDICAL|AWARENESS|SAFETY|ANIMAL|MOBILITY|EDUCATION_SUPPORT|EMERGENCY", paymentMethod "UPI|RAZORPAY|STRIPE|CASH|BANK_TRANSFER", paymentStatus "PENDING|COMPLETED|FAILED|REFUNDED", receiptNumber (unique), transactionId?, campaignId?, message?, isAnonymous
- **Campaign**: title, slug? (unique), tagline?, description, category, targetAmount, raisedAmount, status "DRAFT|ACTIVE|PAUSED|COMPLETED|CANCELLED", icon ("shield-alert"|"smartphone"|"heart-handshake"|"baby"|"pill"|"paw-print"|"siren"|"package"|"flower-2"|"heart"), accent ("orange"|"cyan"|"fuchsia"|"amber"|"teal"|"lime"|"red"|"emerald"|"pink"), helpline?, featured, beneficiaries Int, volunteersEngaged Int, startDate, createdBy
- **Beneficiary**: name, phone?, email?, city?, category "WIDOW|ORPHAN|STUDENT|ELDERLY|DISABLED|SINGLE_MOTHER|POOR_FAMILY|PATIENT|DAILY_WAGE|OTHER", urgencyLevel "LOW|MEDIUM|HIGH|CRITICAL", familyMembers Int, monthlyIncome?, needs?, notes?, onboardedByName?, userId?
- **Volunteer**: userId (unique), skills (JSON string), availability (JSON string), assignedArea?, status "PENDING|ACTIVE|INACTIVE|SUSPENDED" → relations tasks[], attendances[], distributions[]
- **VolunteerTask**: volunteerId (REQUIRED → Volunteer.id), title, description?, type "DISTRIBUTION|KIT_SCAN|INVENTORY|EVENT|RESCUE|AMBULANCE", priority "LOW|MEDIUM|HIGH", location?, scheduledDate DateTime, status "ASSIGNED|IN_PROGRESS|COMPLETED|CANCELLED", completedAt?, notes?
- **VolunteerApplication**: userId?, fullName, email, phone, city, occupation?, skills?, availability?, motivation, status "PENDING|APPROVED|REJECTED", reviewNote?, reviewedAt?
- **Distribution**: type "FOOD|SANITARY_PADS|MEDICAL|ANIMAL_FEED|EDUCATION_MATERIAL|CLOTHING|CASH|OTHER", beneficiaryId?, volunteerId?, campaignId?, items?(JSON), quantity Int, value?, location?, notes?, distributedAt
- **PadDistribution**: schoolName?, area, girlsCount, padsDistributed, awarenessSession, sessionAttendees?, volunteerId?, distributionDate
- **InventoryItem**: name, category "FOOD_KIT|SANITARY_PADS|MEDICINE|ANIMAL_FEED|EQUIPMENT|CLOTHING|OTHER", quantity Int, minStock Int, unit, pricePerUnit?, location?
- **Cause** (adopt-a-medicine): code (unique "UAR-MED-0001"), patientName, age, city, condition "BP|DIABETES|THYROID|CARDIAC|ASTHMA|ARTHRITIS|OTHER", monthlyCost, durationMonths, story, status "SEEKING|PARTIAL|ADOPTED|PAUSED", raised Float, adoptedById?, adoptedByName? → pledges[]
- **Pledge**: causeId, donorId?, donorName, amountPerMonth, months, startDate, status "ACTIVE|COMPLETED|CANCELLED"
- **Animal**: name, species "DOG|CAT|COW|BIRD|OTHER", breed?, ageMonths, gender, story, healthStatus?, vaccinated, sterilized, location, status "AVAILABLE|FOSTERED|ADOPTED|CRITICAL", monthlyFood, adoptedById?, adoptedByName? → pledges[]
- **AnimalPledge**: animalId?, shelterFund?, donorId?, donorName, kind "FOOD|MEDICAL|VACCINATION|SHELTER", amount, frequency "ONE_TIME|MONTHLY", status
- **Ambulance**: code (unique), type "BLS|ALS|PTV|NEONATAL", status "AVAILABLE|ON_MISSION|MAINTENANCE", base, driverName, driverPhone?, crew?, equipment? (comma list)
- **Mission**: requestRef (unique "M-1001"), patientName, contact, emergencyType "CARDIAC|ACCIDENT|MATERNITY|BURN|RESPIRATORY|TRANSFER", priority "CRITICAL|HIGH|MEDIUM", pickup, destination, ambulanceId?, status "REQUESTED|DISPATCHED|EN_ROUTE|ARRIVED|COMPLETED|CANCELLED", progress 0-100, route (JSON [{name,congestion,lengthKm}]), corridorActive, vehiclesAlerted, timeSavedSec, etaMin? → events[]
- **CorridorEvent**: missionId, segment, method "V2X_5G|CELL_BROADCAST|BLE_MESH|FM_RDS|SIREN", congestion "LOW|MODERATE|HEAVY|GRIDLOCK", vehiclesAlerted, timeSavedSec, note?
- **KitTemplate**: name, description?, items (JSON [{name,qty,unit}]), costPerUnit → batches[]
- **KitBatch**: templateId, name, totalUnits, scannedUnits, instructions?, status "READY|IN_PROGRESS|DEPLETED" → units[]
- **KitUnit**: batchId, code (unique "UAR-RK-2026-000001"), status "READY|SCANNED|EXPIRED", scannedAt?, scannedById?, scannedByName?, location?
- **Master** (MDM): category, value, label, sortOrder, active — categories in use: CONDITION, ANIMAL_SPECIES, CITY, AVAILABILITY, SKILL, AMBULANCE_TYPE, EMERGENCY_TYPE, INVENTORY_CATEGORY, UNIT, BENEFICIARY_CATEGORY
- **ContactQuery**: name, email, phone?, subject, message, status "PENDING|RESOLVED|CLOSED"
- **Testimonial**: name, role, message, rating
- **ActivityLog**: userId?, actorName?, action, entityType, entityId?, details?
- **Setting**: key (unique), value, description?

## SQLite gotchas
- NO `skipDuplicates` in createMany; NO `mode: "insensitive"` — use `contains`.
- Filters compare plain strings (enums are strings): `where: { role: "ADMIN" }`.
- Generate receiptNumber: `UAR-RCPT-${year}-${String((count+1)).padStart(5,"0")}` — loop while exists.
- Kit codes: `UAR-RK-${year}-${String(n).padStart(6,"0")}` (global running number = total kit units + 1).

## Brand & style
- Trust: **United Angel Reach (UAR)**, HQ Bengaluru, Karnataka — vision: scale to serve all of India.
- White + green (emerald primary). NEVER use indigo/blue Tailwind classes.
- Campaign accents: anti-drug `orange` · cyber-crime `cyan` · women-safety `fuchsia` · child-safety `amber` · medicine-adoption `teal` · animal-welfare `lime` · green-corridor `red` · ration-kits `emerald` · sanitary-pads `pink`. Use real classes (`bg-orange-500`, `text-teal-700`, `border-amber-200`, `bg-rose-50`).
- Icons: lucide-react only. `formatINR/formatDate/formatDateTime/timeAgo/titleCase/formatNumber/cn` from `@/lib/utils`.
- Mobile-first; root `min-h-screen flex flex-col`; footer `mt-auto`; cards `p-6`, gaps `gap-4/6`; long lists `max-h-96 overflow-y-auto scrollbar-thin`; touch ≥44px; aria-labels on icon buttons.
- Every component file starts with `"use client"`.

## Data fetching (standard)
- `src/lib/api-client.ts`: `get/post/patch/del` (throw Error with server message).
- Pattern: `useState` + `useEffect` + `load()` async fn. Skeletons while loading, empty states, `toast` (sonner) on error/success.
- NO react-query/zustand.

## Auth
- Client: `useAuth()` from `@/hooks/use-auth` → `{ user, loading, login, register, logout, refresh }`. user = {id,name,email,role,status,phone?,city?}.
- Server: helpers in `@/lib/session`: `getSession()`, `setSession({userId,role,name,email})`, `clearSession()`, `hashPassword()`, `verifyPassword()` (supports legacy plain), `ApiError`, `json(data,status)`, `handleError(e)`, `requireAuth()`, `requireRole(...roles)`, `logActivity(actorName, action, entityType?, details?, userId?)`.
- Demo logins: admin@unitedangelreach.org/Admin@123 · donor@demo.org/Donor@123 · volunteer@demo.org/Volun@123 · applicant@demo.org/Temp@12345 (PENDING) · beneficiary@demo.org/Benef@123.

## MDM dropdowns (client)
- `useMasters("CATEGORY")` → `{options:{value,label}[], loading}` (has built-in fallbacks). `labelOf(options, value)`.

## API conventions (NEW routes)
- `src/app/api/<resource>/route.ts` (+ `[id]/route.ts`). `export const dynamic = "force-dynamic";`
- try/catch → `handleError(e)`. Return RAW arrays/objects via `json(...)` — NOT the old {success,data} envelope.
- Errors: `throw new ApiError("msg", 400|401|403|404)` → `{error: msg}`.
- Query params: `new URL(req.url).searchParams`. Params are strings — number/boolean coerce explicitly.
- Never import client code in API routes. `assistant-knowledge.ts` is server-safe.
- After mutations that matter, `await logActivity(session.name, "ACTION", "ENTITY", "details")`.

## Helplines (official, use exactly)
112 emergency · 108 ambulance · 1930 cyber fraud (cybercrime.gov.in) · 181 women (Sakhi/Abhayam) · 1091 women police · 1098 CHILDLINE · 14446 de-addiction · 14416 Tele-MANAS · 1933 drug trafficking (NCB MANAS) · 1962 animal rescue (AWBI).
