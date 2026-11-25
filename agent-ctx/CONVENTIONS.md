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

# ================= ENHANCEMENT ROUND 2 CONTRACTS (READ ALL) =================

## Theme / dark mode (MANDATORY for every file you touch)
- ThemeProvider (next-themes, class strategy) is already mounted in `src/app/layout.tsx`.
- Dark palette already exists in `globals.css` (.dark block). USE SEMANTIC TOKENS ONLY in new/edited UI: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border`, `bg-accent`, `bg-muted/40`… NEVER `bg-white`, `text-black`, `bg-gray-50` (they break dark mode).
- Campaign accent colors (emerald/orange/cyan/fuchsia/amber/teal/lime/red/pink): use opacity variants (`bg-emerald-500/10`, `text-emerald-600 dark:text-emerald-400`, `border-emerald-500/20`) so they hold in dark mode. NEVER indigo/blue.
- Shared switcher: `<ThemeToggle align="end" />` from `@/components/shared/theme-toggle`.

## Formatting lib (NEW code MUST use it — zero redundancy)
`import { formatINR, formatINRCompact, amountInWords, formatDate, formatDateLong, formatDateTime, financialYear, formatDuration, initials, titleCase } from "@/lib/format";`
- `amountInWords(125000)` → "Rupees One Lakh Twenty Five Thousand Only" (for 80G receipts/certificates).

## Settings API (Agent A implements; C/D/F consume)
- `GET /api/settings` → flat map `{ "org.name": "…", "finance.upiId": "…" }` (ADMIN only).
- `PATCH /api/settings` body = partial flat map → upsert each key (ADMIN only).
- `GET /api/settings/public` → `{ orgName, orgHq, orgAddress, orgEmail, orgPhone, org80g, orgPan, orgReg12a, orgDarpan, upiId, signatoryName, signatoryRole, defaultLanguage, vision }` (no auth).
- `POST /api/settings/test` body `{ channel: "email"|"sms"|"whatsapp"|"gateway" }` → `{ ok: true, latencyMs, message }` (simulated connectivity check, ADMIN).
- Canonical keys (seed defaults for all):
  org.name, org.hq, org.address, org.email, org.phone, org.pan, org.80g, org.reg12a, org.darpan, org.website, org.vision,
  receipts.signatoryName, receipts.signatoryRole, receipts.footer,
  finance.upiId, finance.razorpayKeyId, finance.gatewayEnabled, finance.currency,
  notify.email.enabled, notify.email.host, notify.email.port, notify.email.from, notify.email.fromName, notify.email.secure,
  notify.sms.enabled, notify.sms.provider, notify.sms.senderId, notify.sms.endpoint,
  notify.whatsapp.enabled, notify.whatsapp.number,
  logs.enabled, logs.level, logs.retentionDays,
  app.language, app.timezone, assist.model

## 80G Receipts API
- `GET /api/receipts?from&to&limit` → donations that have receiptNumber, newest first, with campaignTitle. ADMIN: all; DONOR session: own only (filter by donorId or donorEmail).
- `GET /api/receipts/:receiptNumber` → `{ donation, org: { name, address, hq, email, phone, pan, reg80g, signatoryName, signatoryRole, footer } }`.
- `GET /api/receipts/:receiptNumber/html` → `text/html` self-contained print-ready A4 80G receipt (inline CSS only, letterhead + amount in words + 80G reg no + donor PAN + signature block + `<script>window.onload=()=>window.print()</script>`). Public with receipt number as capability.

## Certificates API (Certificate model is in schema — pushed)
- Fields: id, code `UAR-CERT-YYYY-NNNNN`, type, recipientName, recipientEmail?, userId?, title, description?, refType?, refId?, issuedBy?, meta?(JSON string), issuedAt.
- `POST /api/certificates` (ADMIN) body `{ type, recipientName, recipientEmail?, userId?, title?, description?, refType?, refId?, meta? }` → `{ certificate }` (auto code, issuedBy = session name, logActivity).
- `GET /api/certificates?limit` → ADMIN: all; DONOR/VOLUNTEER: own (userId match). Order newest.
- `GET /api/certificates/:code` → detail. `GET /api/certificates/:code/html` → print-ready A4 certificate HTML (bordered award layout, org letterhead, seal placeholder circle, signature block, type-aware wording).

## Notifications API
- `GET /api/notifications?limit=20` → latest (session user's, fall back to global). `PATCH /api/notifications` body `{ id, isRead }` or `{ all: true }`.

## Reports API (enhance existing /api/reports)
- `GET /api/reports?fy=2025` → single consolidated object:
  `{ fy, kpis: { totalDonations, donationCount, avgDonation, donorCount, newDonorsThisFy }, monthly: [{ month:"Apr", amount, count } x12 ], categories: [{ category, amount }], topDonors: [{ name, amount, count } x10], programmes: { kits: { totalUnits, scannedUnits }, pads: { sessions, pads, girls, schools }, corridor: { missions, events, vehiclesAlerted, timeSavedMin }, animals: { available, adopted, activePledges }, medicine: { total, seeking, adopted, monthlyPledged } }, fyTotals: { amount, count } }`
- FY = April→March. `fy` param is the START year (2025 ⇒ FY 2025-26); default = current.

## Kit QR labels (Agent D)
- `qrcode` package is ALREADY installed (with @types). Client-side: `import QRCode from "qrcode"; const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 160 });`
- Kit label sheets: printable grid `qrcode.toDataURL(unit.code)` + code text + org name, `@media print` A4 grid, one row per kit unit.

## Theme in shells (Agent B)
- Admin header, public header (desktop+mobile), portal topbar each mount `<ThemeToggle align="end" />`.

## Round-2 rules (ALL agents)
- NO package installs (qrcode pre-installed; anything else → report need in final message).
- NO git commands. NO dev-server restarts. NO edits to `src/app/page.tsx`, `prisma/schema.prisma`, or files outside your ownership list.
- Every file you EDIT must remain `tsc`-clean and lint-clean (`bun run lint`), dark-mode safe, responsive (mobile-first), aria-labelled, with loading skeletons + empty states + sonner toasts.
- Public pages read org identity via `GET /api/settings/public` (with graceful fallbacks).

# ================= ROUND 3 CONTRACTS (READ ALL — CURRENT TRUTH) =================

## Auth (FIXED — round 3)
- Session works via httpOnly cookie AND `Authorization: Bearer` header (api-client sends it automatically from localStorage `uar_token`). Do NOT touch auth plumbing.
- `src/lib/api-client.ts` exports `get/post/patch/del` + `getToken/setToken`. Do not reimplement fetch elsewhere.

## Shared design-system primitives (MANDATORY for every list/form you build)
Import from `@/components/shared/`:
- `FormSheet` (`form-sheet.tsx`): ALL add/edit goes here. Props: `{open,onOpenChange,title,description,children,onSubmit,submitLabel,cancelLabel,loading,dirty,size:"sm"|"md"|"lg"|"xl",footerExtra}`. Sticky header/footer, Esc-safe, unsaved-changes guard. NEVER centered Dialog forms.
- `FormSection`, `FieldGrid` (`form-fields.tsx`): drawer sections + 2-col grid.
- `Field, TextField, TextareaField, SelectField, SwitchField` (`form-fields.tsx`): bound to plain form state objects. TextField props include prefix (₹), step/min/max.
- `StatusBadge, toneForStatus, humanize` (`status-badge.tsx`): ONE status pill for all modules.
- `ConfirmDialog` (`confirm-dialog.tsx`): ALL deletes/critical actions. Props: `{open,onOpenChange,title,recordName,description,confirmLabel,loading,onConfirm}`.
- `ExportMenu, downloadCsv, CsvColumn` (`csv.tsx`): CSV export on every list.
- `ViewSwitcher, useViewPref, PaginationBar, PageSizeSelect, DataViewMode` (`view-switcher.tsx`): every list page offers table/grid/list where useful; preference persists via localStorage `uar-view-<module>`.
- `PageHeader, SectionCard, StatCard, EmptyState, DataField` exist from round 1 — keep using them.

## Validation lib (MANDATORY for forms)
`@/lib/validators`: `validPan, validPhone, validPin, validEmail, validUpi, normalizePhone`, rule factories `required(label)`, `panRule(optional)`, `phoneRule(optional)`, `emailRule(optional)`, `pinRule(optional)`, `amountRule({min,max,optional,label})`, `dateRule(optional)`, `minLen(n,label)`. Backend routes enforce the same regexes — keep both in sync. PAN regex `^[A-Z]{5}[0-9]{4}[A-Z]{1}$`, phone `^(\+91[\-\s]?)?[6-9]\d{9}$`, PIN `^[1-9][0-9]{5}$`.

## Schema v3 (PUSHED — SQLite in sync) — new/changed models
- **Donor** (NEW): type "INDIVIDUAL|ORGANISATION|CORPORATE", organizationName?, name, email(unique), phone?, altPhone?, address?, city?, state?, pincode?, pan?, language?, source "WEB|OFFLINE|IMPORT|REFERRAL|EVENT"?, category "MAJOR|MONTHLY|ONE_TIME|CORPORATE|CSR"?, wants80g, anonymousByDefault, emailOptIn, smsOptIn, whatsappOptIn, tags?(JSON array string), notes?, userId? → donations[]
- **Donation** (+): donorRefId?→Donor, recurringFrequency? "WEEKLY|MONTHLY|QUARTERLY|YEARLY", nextChargeAt?, paymentProvider? "RAZORPAY|CASHFREE|PAYU|STRIPE|MANUAL", gatewayOrderId?, fees Float, netAmount?, settlementDate?, receiptStatus "PENDING|ISSUED|CANCELLED|REISSUED", receiptIssuedAt?, refundAmount?, refundReason?, refundedAt?, internalNotes?; paymentMethod now includes CHEQUE; paymentStatus adds CANCELLED
- **Campaign** (+): urgent, minDonation?, taxEligible, videoUrl?, gallery?(JSON), budgetBreakdown?(JSON [{head,amount}]), coordinatorName?, coordinatorPhone?, seoTitle?, seoDescription?
- **KitTemplate** (+): kind "RATION|FOOD|EDUCATION|MEDICAL|HYGIENE|CLOTHING|EMERGENCY|CUSTOM", codePrefix? (unit codes: use template.codePrefix or UAR-RK), image?, status "ACTIVE|RETIRED"
- **Beneficiary** (+): caseStatus "INTAKE|VERIFICATION|ACTIVE|CLOSED|REJECTED", caseWorker?, verificationStatus "PENDING|DOCUMENTS_REQUESTED|VERIFIED|REJECTED", guardian?, age?, gender?, photoConsent, intakeDate?; relations caseNotes[], requests[]
- **BeneficiaryNote** (NEW): beneficiaryId, authorName?, note → use `/api/beneficiaries/:id/notes`
- **BeneficiaryRequest** (NEW): beneficiaryId?, userId?, name, phone?, category, urgency "LOW|MEDIUM|HIGH|CRITICAL", details, status "PENDING|IN_REVIEW|APPROVED|FULFILLED|REJECTED", reviewNote?, reviewedBy?, reviewedAt?
- **VolunteerAttendance** (+): hours Float?
- **Setting** (+): isSecret Boolean (masked in GET responses)

## API surface (NEW or CHANGED — routes are canonical)
- `GET /api/donations` (admin, paginated): params `page,limit(≤500),status,type,category,method,from,to,q` → `{items,total,page,pages,completedSum}` (OLD callers' `Array.isArray` shims still work via items). POST: offline methods (CASH/BANK_TRANSFER/CHEQUE) → PENDING; auto-upserts Donor by email; 80G cash>₹2000 → still recorded but NOT tax-eligible (client must not promise 80G).
- `GET/PATCH/DELETE /api/donations/:id` — PATCH accepts donorName,donorEmail,donorPhone,amount,currency,type,recurringFrequency,nextChargeAt,category,paymentMethod,paymentProvider,paymentStatus,transactionId,gatewayOrderId,campaignId,message,isAnonymous,pan,fees,settlementDate,receiptStatus,internalNotes,refundAmount,refundReason. GET by id includes campaign + donorRef (ADMIN,VOLUNTEER).
- `GET /api/donors?q&type&category&page&limit` → `{items[+lifetimeValue,donationsCount,firstDonationAt,lastDonationAt],total,page,pages}` (ADMIN). POST creates (validates PAN/phone/PIN; links user by email).
- `GET /api/donors/:id` → donor + donations[] + pledges[] + animalPledges[] + certificates[] + stats {lifetimeValue,fyValue,donationsCount,receiptsIssued,activePledges}. PATCH (identity/prefs/tags/notes). DELETE detaches donations first.
- `PATCH /api/volunteers/:id` (NEW — ADMIN): skills,availability,assignedArea,emergencyContact,idProof,status(PENDING|ACTIVE|INACTIVE|SUSPENDED); mirrors status onto User row. `GET /api/volunteers/:id` → volunteer + user + tasks[] + attendances[] + stats {tasksAssigned,tasksCompleted,daysPresent,totalHours}.
- `GET /api/volunteer-attendances?volunteerId&from&to&limit` (ADMIN,VOLUNTEER) · `POST` (ADMIN) `{volunteerId,date,checkIn?,checkOut?,hours?,location?,notes?}` — upserts per (volunteerId,date).
- `GET /api/school-coverages?q&active=1` (ADMIN,VOLUNTEER) · `POST` `{schoolName,address?,city?,contactPerson?,contactPhone?,totalGirls,lastVisited?,isActive?}` — upserts by name, bumps visitsCount.
- `GET /api/beneficiary-requests?status` (ADMIN,VOLUNTEER) · `?mine=1` (any auth) · `POST` (public/auth) `{name,phone?,category?,urgency?,details?}` links caller's beneficiary record. `PATCH /api/beneficiary-requests/:id` status/reviewNote/urgency (ADMIN,VOLUNTEER).
- `GET/POST /api/beneficiaries/:id/notes` — case-note timeline (ADMIN,VOLUNTEER).
- `GET /api/beneficiaries` — ADMIN,VOLUNTEER only for the directory; `?mine=1` returns caller's own case (any auth). **Do NOT call the directory endpoint from donor/beneficiary clients.**
- `POST /api/campaigns` / `PATCH /api/campaigns/:id` — NOW accept slug,startDate,endDate,location,urgent,taxEligible,minDonation,videoUrl,gallery,budgetBreakdown,coordinatorName,coordinatorPhone,seoTitle,seoDescription (validated; slug uniqueness 409).
- `PATCH /api/users/:id` — NOW persists email,pan,about,avatar (validates PAN/email; 409 on duplicate email).
- `POST /api/distributions` — NOW persists value + photos.

## List-page pattern (STANDARD — apply to every admin list you touch)
1. Fetch with server params: `page`, `limit`, `q`, filters; read `{items,total,page,pages}` envelope (fall back to array for legacy endpoints).
2. Toolbar: search input (debounced 300ms) + filter Selects + ViewSwitcher + ExportMenu + primary "Add" Button — all in one `SectionCard` header row, wraps on mobile.
3. Table view: `<Table>` sticky header, hover rows, StatusBadge, right-aligned `Actions` dropdown (View / Edit / Delete). Row click opens detail Sheet.
4. Grid view: responsive card grid (`sm:grid-cols-2 xl:grid-cols-3`), card = icon/media + title + 2 key facts + StatusBadge + progress where applicable.
5. List view: compact rows (avatar/icon + title + meta line + trailing value), max-h with scroll.
6. PaginationBar + PageSizeSelect under the table. Loading = Skeletons matching the active view. Empty = EmptyState with CTA.
7. Add/Edit = FormSheet (size lg for ≥10 fields, md otherwise, xl for multi-section like missions). Delete = ConfirmDialog.
8. Detail = read-only Sheet with SectionCards + DataField grids + related-records tabs where applicable.

## ROUND-5 COMPONENT CONTRACTS (NEW — all list/detail/form work MUST use these)

### FormSheet — `src/components/shared/form-sheet.tsx`
Slide-over for ALL add/edit. Sizes: `sm|md|lg|xl|full` — every size ≥60vw on desktop (60/68/76/88/100). `size="full"` = full-screen workbench for detail-heavy forms (distributions, campaign composer). Props: `open, onOpenChange, title, description, badge?, onSubmit, submitLabel, loading, dirty, footerExtra`. Mobile = full-screen always.

### DetailSheet — `src/components/shared/detail-sheet.tsx`
Full-screen slide-over for VIEWING a record (distributions view, campaign view, any detail-heavy read). Props: `open, onOpenChange, eyebrow, title, description, status?, actions?, footer?, loading`. Exports `DetailSection({title, description?, actions?, children})` and `DetailGrid({cols:1|2|3|4})` for key-value grids (pair with DataField).

### DataTable — `src/components/shared/data-table.tsx`
THE standard table for every list page. Props: `columns: DataTableColumn<T>[]` (`{key, header, className?, align?, mono?, hideBelow?: 'sm'|'md'|'lg', accessor?}`), `rows, rowKey, loading, skeletonRows=8, height: 'fill'|'auto'|'max-h-… class', fillOffset=260, onRowClick, children(row,col), empty?, page, pages, total, pageSize, onPage, onPageSize, itemLabel`.
- `height="fill"` makes the card fill the viewport minus `fillOffset` px, header sticky, body scrollable.
- Built-in pagination footer: range count, page-size select, numbered pages + first/last.
- Loading shows skeleton rows automatically. Empty shows built-in empty state unless `empty` given.
- Cell content: use `children={(row,col)=>…}` render prop.

### Existing shared components (keep using)
`form-fields.tsx` (TextField/SelectField/TextareaField/…), `page-header.tsx`, `section-card.tsx`, `stat-card.tsx`, `status-badge.tsx`, `confirm-dialog.tsx`, `empty-state.tsx`, `csv.tsx` (toCSV/downloadCSV), `view-switcher.tsx` (useViewPref/ViewSwitcher/DataViewMode), `theme-toggle.tsx`, `data-field.tsx`.

### Sidebar tokens (light-mode fix — DO NOT revert)
Sidebar uses `bg-sidebar` + `text-sidebar-foreground` tokens. In light mode sidebar is OFF-WHITE (`--sidebar: oklch(0.985 0.004 145)`), nav text `text-sidebar-foreground/75`. Never hardcode dark sidebar colors or `text-foreground` inside sidebar.

### Print documents (redesigned round-5)
80G receipts: `/api/receipts/:receiptNumber/html` — neutral ink palette + 80G watermark. Certificates: `/api/certificates/:code/html` — ivory paper, hairline frame, UAR watermark rings, gold seal. Shared shell: `src/app/api/_lib/org.ts printDocument`. Do NOT reintroduce all-green designs.

# ================= SETTINGS ROUND 3 — SINGLE SOURCE OF TRUTH =================

## src/lib/settings-core.ts (client-safe; the ONLY place these live)
- `SETTING_DEFAULTS` — every canonical key+default (org.*, brand.*, finance.*, notify.email/sms/whatsapp.*, storage.*, webhooks.*, analytics.*, captcha.*, maps.*, kits.*, logs.*, app.*, receipts.*, assist.*, matching.*, features.*).
- `isSecretKey(key)` / `maskValue(v)` / `SECRET_KEYS` set.
- `validateSettingValue(key, value): string | null` — per-key validation shared by PATCH endpoint AND settings view. PATCH rejects unknown keys + invalid values (400).
- `SECTION_PREFIXES` + `keysForSection(section, keys)` — settings-card → keys mapping (incl. new "flags" section).
- `FLAG_CATALOG: {key,label,description,effect}[]` — every feature flag + what it gates. `isFlagOn(v)`, `publicFeatures(map)`.
- `CURRENCIES` (22 ISO currencies w/ symbol/decimals/locale), `getCurrency(code)`, `formatMoney(amount, code)`, `currencyUnitName(code)`.

## src/lib/notify.ts (server-only) — real outbound transports
- `loadSettings()` → full settings map (raw values incl. secrets).
- sendEmail/sendSms/sendWhatsApp → `ChannelResult {ok, skipped?, latencyMs, message}`; silent no-op (skipped) when flag off/unconfigured; NEVER throw.
- verifyEmail/verifySms/verifyWhatsApp/verifyGateway — real connectivity checks (SMTP verify, Twilio ping, WhatsApp Cloud API, Razorpay/Stripe/Cashfree REST) used by POST /api/settings/test.
- notifyDonation / notifyContactQuery / emailShell — branded transactional helpers.
- PATCH secret round-trip: values containing "•" are IGNORED (keep stored secret).

## POST /api/settings/test — {channel: email|sms|whatsapp|gateway} → {ok, latencyMs, message} (ADMIN)

## GET /api/settings/public — now also returns:
`currency`, `currencySymbol`, `gatewayEnabled`, `gatewayProvider`, `gatewayKeyId?` (public Razorpay/Stripe key, only when gateway enabled), `features: Record<string,boolean>` (publicFlags: features.* + finance.gatewayEnabled + assist.enabled + app.maintenance).

## Payments (real gateways, no SDKs — REST via fetch)
- POST /api/payments {receiptNumber} → provider order/session: RAZORPAY (Orders API + checkout.js), STRIPE (Checkout Session redirect), CASHFREE (drop-in session). PAYU → clear unsupported error.
- POST /api/payments/verify — Razorpay HMAC-SHA256 signature verify / Stripe session retrieve / Cashfree payments list; only PENDING→COMPLETED, idempotent.
- Gateway donations are created PENDING (donations POST, paymentProvider set); UPI deep-link stays INR-only (UPI rails); 80G cash>₹2000 rule only when currency=INR.
- NEVER expose gateway secrets client-side — only `gatewayKeyId` (public identifier) via /api/settings/public.

## Transactional notifications (fire-and-forget, never break main flow)
- Donation PENDING→COMPLETED (verify or admin PATCH) → notifyDonation (email+SMS+WhatsApp per flags).
- Contact query → ack email; Volunteer application/approval/rejection → emails; Mission DISPATCHED → SMS to mission contact.
- Feature gates: features.currencySwitcher / features.recurringDonations / features.anonymousDonations gate donate page UI; assist.enabled hides assistant widget; app.maintenance shows public banner.
