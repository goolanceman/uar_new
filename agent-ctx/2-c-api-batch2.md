# Task 2-c — API Routes Batch 2 (MDM, health/welfare/ops)

Agent: 2-c · Date: 2026-11-02 · All files compile & smoke-tested against the running dev server (200/201/401/403/409 as designed). Test artifacts cleaned up; seeded data untouched.

## Files created / rewritten (36)

**Shared helper**
- `src/lib/causes.ts` — `recomputeCause(causeId)`: raised = Σ ACTIVE pledges `amountPerMonth`; status SEEKING/PARTIAL/ADOPTED vs `monthlyCost`; adoptedById/Name = first (oldest ACTIVE) pledge's donor; returns cause incl pledges.

**MDM**
- `src/app/api/masters/route.ts` — GET `?categories=1` (distinct categories) / `?all=1` (ADMIN) / `?category=X` → active `{value,label}[]` by sortOrder / else `[]`; POST (ADMIN) upsert by `category_value`, log MASTER_UPSERT.
- `src/app/api/masters/[id]/route.ts` — PATCH (ADMIN) label/active/sortOrder/value (+409 on compound-unique clash); DELETE → `{ok:true}`.

**Adopt-a-medicine**
- `src/app/api/causes/route.ts` — GET `?condition&status&q` (patientName/city/code contains) incl ACTIVE pledges → desc createdAt (public); POST (ADMIN) code `UAR-MED-000N` loop-unique → 201.
- `src/app/api/causes/[id]/route.ts` — GET single; PATCH (ADMIN) fields; if `status` not provided → recomputeCause; DELETE (ADMIN) removes pledges first.
- `src/app/api/causes/[id]/pledges/route.ts` — POST public-or-auth `{amountPerMonth>0, months≥1, donorName?}` → donorName ?? session.name / "Anonymous Donor", ACTIVE pledge → recompute → 201 `{pledge, cause}`; log PLEDGE.
- `src/app/api/causes/pledges/route.ts` — GET (auth) `?mine=1&causeId=` incl `cause{code,patientName,condition,monthlyCost}`.
- `src/app/api/pledges/[id]/route.ts` — PATCH (ADMIN or donorId owner) status ACTIVE/COMPLETED/CANCELLED → recompute → `{pledge}`; DELETE (ADMIN) → recompute.

**Animal welfare**
- `src/app/api/animals/route.ts` — GET `?species&status&q` (name/location) desc (public); POST (ADMIN|VOLUNTEER) → 201.
- `src/app/api/animals/[id]/route.ts` — PATCH (ADMIN|VOLUNTEER); VOLUNTEER setting status ADOPTED stamps `adoptedByName=session.name`; DELETE (ADMIN, removes pledges first).
- `src/app/api/animals/pledges/route.ts` — POST public-or-auth `{animalId?|shelterFund?, kind, amount>0, frequency}` → 201 `{pledge}` (validates animalId, log ANIMAL_PLEDGE); GET (auth) `?mine=1&animalId=` incl `animal{name,species}`.
- `src/app/api/animal-pledges/[id]/route.ts` — PATCH (ADMIN) `{status}`; DELETE (ADMIN).

**Beneficiaries / Distributions / Pads / Inventory** (rewrote legacy `{success,data}`-envelope stubs to raw-JSON + auth conventions)
- `src/app/api/beneficiaries/route.ts` + `[id]/route.ts` — GET (auth) `?q&category&active=0/1`; POST (ADMIN|VOLUNTEER) stamps `onboardedByName` → log BENEFICIARY_ADD; PATCH (ADMIN|VOLUNTEER) + `isActive`; DELETE (ADMIN).
- `src/app/api/distributions/route.ts` + `[id]/route.ts` — GET (auth) `?type&q&limit&mine=1` (mine resolves session→volunteer profile, no profile → `[]`) incl beneficiary/volunteer.user/**campaign{title,accent}**; POST (VOLUNTEER|ADMIN) volunteerId from profile (ADMIN w/o profile → null) → log DISTRIBUTION; PATCH/DELETE (ADMIN).
- `src/app/api/pad-distributions/route.ts` + `[id]/route.ts` — GET (auth) `?q` desc distributionDate (volunteer {id,name} attached manually); POST (VOLUNTEER|ADMIN) log PAD_DRIVE; PATCH/DELETE (ADMIN).
- `src/app/api/inventory/route.ts` + `[id]/route.ts` — GET (auth) `?category&q&low=1` (low = `quantity <= minStock`, filtered in memory — SQLite can't compare columns) orderBy name; POST (ADMIN|VOLUNTEER) log STOCK_ADD; PATCH `{addQuantity}` → clamp ≥0 or set fields; DELETE (ADMIN, purges purchase/distribution rows).

**Ration kits**
- `src/app/api/kit-templates/route.ts` + `[id]/route.ts` — GET (auth) incl `_count.batches`; POST (ADMIN) items JSON.stringify; PATCH incl items→string; DELETE blocked 409 `"Template has batches"`.
- `src/app/api/kit-batches/route.ts` + `[id]/route.ts` — GET `?status` incl `template{name,costPerUnit}` + `_count.units`; POST (ADMIN) `totalUnits 1..500` → batch + N units, codes `UAR-RK-<year>-NNNNNN` from global unit count, collision-checked in a loop → 201 `{batch}`; log KIT_BATCH "N units"; PATCH name/instructions/status; DELETE removes units then batch.
- `src/app/api/kit-units/route.ts` — GET (auth) `?batchId&status&q&mine=1&limit` incl `batch{name,template{name}}`, orderBy code asc.
- `src/app/api/kit-scan/route.ts` — POST (VOLUNTEER|ADMIN) trim/uppercase code; 404 "Kit code not found"; 409 "already scanned at …" / "unit expired"; marks SCANNED + increments batch, DEPLETED when full.
- `src/app/api/kit-stats/route.ts` — `{units:{total,ready,scanned}, batches[10] w/ templateName, recentScans[8]}`.

**Green corridor**
- `src/app/api/ambulances/route.ts` + `[id]/route.ts` — GET (auth) `?status&type`; POST (ADMIN) unique code 409; PATCH (ADMIN); DELETE blocked 409 while ON_MISSION.
- `src/app/api/missions/route.ts` — GET (auth) `?status&q` incl ambulance, latest 50; POST (ADMIN|VOLUNTEER) ref `M-100N` loop-unique, random 4-segment route from the 8-junction pool (LOW 30/MOD 30/HEAVY 25/GRIDLOCK 15 %, lengthKm 0.8–3.2), etaMin = Σkm/11*60+5 → 201.
- `src/app/api/missions/[id]/route.ts` — PATCH actions `dispatch|advance|complete|cancel`: dispatch validates REQUESTED + AVAILABLE ambulance → corridor events for MODERATE (BLE_MESH 30–60 veh/40–80 s), HEAVY (CELL_BROADCAST 80–140/140–240), GRIDLOCK (V2X_5G 140–220/280–420, note "BLE_MESH fallback relayed to offline vehicles"), sets corridorActive/etaMin−Σsaved/60 (min 3); advance +25 % → EN_ROUTE/ARRIVED; complete → progress 100 + ambulance AVAILABLE; cancel frees ambulance. Each action logged.
- `src/app/api/corridor-events/route.ts` — GET `?missionId&limit` incl `mission{requestRef}` desc.
- `src/app/api/corridor-stats/route.ts` — missions total/completed/active, vehiclesAlerted, timeSavedMin, avgSavedSec, byMethod, bySegment (groupBy).

**Volunteer self-service**
- `src/app/api/volunteers/route.ts` — GET (ADMIN) `?status` incl `user{name,email,phone,city}` desc joinedAt (legacy POST removed — registration belongs to volunteer-applications).
- `src/app/api/volunteers/me/route.ts` — `{volunteer incl tasks desc | null, application | null}`.
- `src/app/api/volunteer-tasks/route.ts` + `[id]/route.ts` — GET `mine=1` (auth, own tasks desc scheduledDate) else ADMIN `?status&type&q` incl volunteer.user; POST (ADMIN) → log TASK_ASSIGN; PATCH ADMIN-any / VOLUNTEER-own-task (verified via session profile, else 403), `completedAt` set/cleared on status; DELETE (ADMIN).

## Conventions kept
`export const dynamic = "force-dynamic"` everywhere · try/catch → `handleError(e)` · RAW `json()` payloads · `ApiError(msg, 4xx)` · `requireAuth/requireRole/getSession` from `@/lib/session` · `logActivity` after mutations · no skipDuplicates / no mode:"insensitive" · no touching other agents' routes or frontend.

## Gotchas discovered (for other agents)
- **`Distribution` has NO Prisma relation to Campaign** (only `campaignId`) — include `campaign` manually (batched findMany + map). Route already does this.
- **`PadDistribution` has NO relation to Volunteer** — same manual-join pattern applied.
- `Distribution.beneficiaryId`/`volunteerId`, `PadDistribution.beneficiaryId`, `Mission.ambulanceId` are optional FKs → default SetNull, DELETEs safe.
- `Cause.pledges`, `Animal.pledges`, `KitBatch.units`, `KitTemplate.batches` are REQUIRED relations → delete children first (or 409).

## kit-scan response shape (exact)
```jsonc
// POST /api/kit-scan  {code, location?} → 201
{
  "unit": {
    "id": "...", "batchId": "...", "code": "UAR-RK-2026-000025",
    "status": "SCANNED", "scannedAt": "2026-11-02T20:12:34.193Z",
    "scannedById": "...", "scannedByName": "Anjali Rao", "location": "HQ Store",
    "createdAt": "..."
  },
  "batch": { "name": "QA Batch", "scannedUnits": 1, "totalUnits": 3 }
}
// errors: 404 {"error":"Kit code not found"} · 409 {"error":"already scanned at 2 Nov 2026, 8:12 pm"} · 409 {"error":"unit expired"}
```

## Verified end-to-end (dev server)
MDM upsert/list/delete · cause pledge (guest) → PARTIAL → cancel → SEEKING · kit template→batch(3 units)→scan→409 rescan→stats · ambulance create/dup-409/delete · mission create→dispatch(events+eta+counts)→advance→complete→ambulance AVAILABLE · corridor-stats aggregates · volunteer me/task assign/own-task complete/mine=1 · beneficiary/distribution(mine=1 + campaign join)/pad/inventory add+restock/low · donor-role 403s on all admin+voluteer endpoints · kit-template DELETE 409 with batches. QA rows deleted afterwards.
