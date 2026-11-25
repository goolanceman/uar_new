# Implicit State Machines — Audit & Fix List

Audit of every workflow in the app that behaves like a state machine but is not
modelled as one. Each entry lists where the machine lives today, what is wrong,
and the fix needed. Verified against the codebase on 2026-11-12.

> ## ✅ Remediation status (2026-11-13)
>
> The initial P1–P6 findings and confirmed follow-up defects have been **remediated**; deliberate free-toggle enums and feature gaps are called out separately:
>
> - **P1 fixed** — transition tables now live in `src/lib/lab-orders.ts`,
>   `src/lib/missions.ts`, `src/lib/camp-attendance.ts`; routes and UIs import
>   them (no hand-mirrored copies left). Generic guard helper: `src/lib/workflow.ts`.
> - **P2 items 1–7 fixed** — transition tables + `assertTransition` (409/400)
>   added to follow-ups, volunteer-applications, appointments,
>   camp-registrations, beneficiary-requests, donations, beneficiaries.
>   Every table was verified as a **superset of the UI's offered moves**
>   (e.g. appointments keep NO_SHOW/COMPLETED from PENDING; camp-registrations
>   keep CANCELLED from REJECTED) — no existing flow can hit a new rejection.
> - **Bug found & fixed during P2** — `PATCH /api/beneficiaries/:id` was
>   silently dropping `caseStatus` / `verificationStatus`, so the admin case
>   actions (send to verification / activate / verify / close / reject) never
>   persisted. The handler now applies both fields behind their transition
>   machines.
> - **P3 fixed** — `src/lib/user-status.ts::setUserStatus()` is the single
>   owner of cross-module User.status writes (volunteer approval, volunteer
>   status mirror), validated + audit-logged. `PATCH /api/users/:id` keeps its
>   one atomic update (status↔isActive↔self-lockout invariants) but sources
>   membership from the same lib.
> - **P4 documented** — receipt invariant written into
>   `payments/verify/route.ts` next to the atomic settlement.
> - **P5 fixed** — `kitBatchStatus()` extracted to `src/lib/kit.ts`; mission
>   progress now single-sourced in `src/lib/missions.ts`.
> - **P6 fixed** — `src/hooks/use-row-busy.ts` replaces all 12 hand-rolled
>   `busyId` states; volunteer application page uses a `"loading" | "ready" |
>   "refreshing"` union (no impossible boolean combos, no skeleton flash on
>   refresh); wizard step machine extracted to `src/hooks/use-wizard-steps.ts`.
> - **Round 2 (2026-11-13) — remaining backend machines enforced:**
>   VolunteerTask (`src/lib/volunteer-tasks.ts` — ASSIGNED→IN_PROGRESS→COMPLETED,
>   CANCELLED from open states; UI action buttons now derive from the shared
>   table), HealthcareOrg (`src/lib/health-orgs.ts` — PENDING→VERIFIED/REJECTED,
>   VERIFIED⇄SUSPENDED), CampPartner (`src/lib/camp-partners.ts` —
>   INVITED→ACCEPTED/DECLINED, terminal), AIInteraction (review-once machine in
>   `health-ai/[id]`), KitBatch (manual status sets now **rejected 409** — the
>   status is scan-derived via `kitBatchStatus()`), Cause (pause machine in
>   `src/lib/causes.ts` — pause any, resume to SEEKING/PARTIAL; SEEKING/PARTIAL/
>   ADOPTED are recompute-derived).
> - **Round 2 — status vocabularies shared frontend+backend** (kills the
>   dropdown-vs-API drift class): `src/lib/campaigns.ts`, `src/lib/animals.ts`,
>   `src/lib/ambulances.ts`, `src/lib/recurring-needs.ts`,
>   `src/lib/sponsorships.ts`, `src/lib/beneficiaries.ts` (case + verification
>   enums + tables, consumed by route AND view). Campaign / Animal / Ambulance /
>   RecurringNeed / Sponsorship remain deliberately membership-only
>   (free-toggle admin UX, programmatic writers) — documented in each lib.
> - **Round 3 (2026-11-13) — integrity and frontend fixes:** invalid Razorpay
>   signatures no longer mutate a pending donation to FAILED;
>   FoodDonationPledge transitions are guarded and stock receipt claims the
>   status atomically with batch/stock writes; food registration handovers are
>   conditional and distributed outcomes are immutable through the admin PATCH;
>   mission dispatch cannot bypass corridor/ambulance side effects and completion
>   disarms the corridor; food batch quality now maps QUARANTINED/REJECTED to
>   BLOCKED and has explicit inspection transitions; food-programme transitions
>   are shared by the API and status selector; Food event, registration,
>   pledge and batch workflows live in client-safe `src/lib/food-workflows.ts`
>   (server functions re-export the tables, and event action buttons consume
>   the same transition map); ContactQuery now has explicit reopen/resolve/close
>   transitions preserving resolution metadata.
> - **Round 3 — UI state alignment:** stale beneficiary search responses are
>   ignored and hidden while the query changes; lab technicians no longer see
>   the doctor-only review step; camp queue actions now match the API, including
>   CHECKED_IN→WAITING and source-valid NO_SHOW; referral actions derive from
>   the shared `src/lib/referrals.ts` transition graph; FormSheet close paths
>   honor `loading` and confirm dirty-form discards; portal logout clears local
>   auth even when the network request fails; row actions serialize and disable
>   other rows while one update is in flight. Camp staff status now uses the
>   shared `src/lib/camp-staff.ts` workflow in the admin API and roster UI.
> - **Remaining policy items:** Campaign, Animal, Ambulance, RecurringNeed, and
>   Sponsorship retain documented membership-only admin toggles; no irreversible
>   ordering was imposed.
> - **Deliberately NOT enforced** — P2 item 8 (Campaign / Cause / Ambulance /
>   Animal / AnimalPledge): these are admin-discretion operational enums set
>   via free dropdowns; adding an order would need a product decision. Value
>   validation unchanged. *(Superseded by round 2: Cause got a pause machine,
>   the rest got shared vocabularies.)*
> - **Convention note** — the camp-attendance table was normalized to
>   source-keyed (`from → [to…]`) like every other machine; its route check
>   was inverted (target-keyed) before.
>
> Verified after round 3: `bunx tsc --noEmit`, targeted ESLint, and
> `bunx next build` pass. Ad hoc smoke assertions cover food pledge/registration/
> programme/batch/event, referral, camp-staff, and camp-attendance transitions.
> Local API route smoke checks returned expected 401/405 responses (handlers
> compiled). The repository has no configured automated test script or
> checked-in test suite.

## Summary

| # | Machine | States | Enforcement | Risk |
|---|---------|--------|-------------|------|
| 1 | LabOrder | 7 linear | Route `NEXT` map + UI duplicate | Duplication |
| 2 | Mission (ambulance) | 5 linear + CANCELLED | Route `FLOW` + UI duplicate | Duplication |
| 3 | FoodEvent | 16 states | Client-safe `src/lib/food-workflows.ts`; server re-export | UI/API aligned |
| 4 | FoodRegistration | 11 states | Shared admin/check-in transitions + conditional writes | Handover protected |
| 5 | CampAttendance | 7 states | Shared `src/lib/camp-attendance.ts` transitions | UI actions aligned |
| 6 | MedicalCamp | 5 states | Route `TRANSITIONS` | OK |
| 7 | MedicalReferral | 9 states | Shared `src/lib/referrals.ts` + role rules | UI actions aligned |
| 8 | Encounter sign | DRAFT→SIGNED | Route guard | OK |
| 9 | Prescription sign/dispense | 5 states | Route guards | OK |
| 10 | Donation settlement | PENDING→COMPLETED | WHERE-clause guard | OK |
| 11 | Receipt | PENDING→ISSUED | Side-effect of #10 | Coupled, implicit |
| 12 | KitUnit / KitBatch | READY→SCANNED / batch roll-up | Route guard | Batch status derived |
| 13 | VolunteerApplication | PENDING/APPROVED/REJECTED | Transition guard | Enforced |
| 14 | Donation (admin PATCH) | 5 states | Transition guard | Enforced |
| 15 | Appointment | SCHEDULED + 4 | Transition guard | Enforced |
| 16 | CampRegistration | REGISTERED + 3 | Transition guard | Enforced |
| 17 | Beneficiary caseStatus | 5 states | Shared transition guard + UI options | Enforced |
| 18 | Beneficiary verificationStatus | 4 states | Shared transition guard + UI options | Parallel to #17 |
| 19 | User account | ACTIVE/PENDING/SUSPENDED | Shared status writer + update invariants | Enforced |
| 20 | Campaign / Cause / Animal / AnimalPledge / Ambulance | misc | Value list only | No transitions |
| 21 | Distribution wizard (UI) | 4 steps | `src/hooks/use-wizard-steps.ts` | Explicit |
| 22 | Per-row busy mutex (UI) | idle/busy | `src/hooks/use-row-busy.ts` + disabled actions | Shared |
| 23 | Form lifecycle (UI) | open/loading/dirty | `FormSheet` close/dirty guard | Guarded |
| 24 | FoodDonationPledge | 6 states | Shared transition guard + transactional receive | Stock-safe |
| 25 | FoodProgramme | 7 states | Shared transitions + status selector | API/UI aligned |
| 26 | FoodBatch quality | 4 states | Shared inspection transitions + batch status derivation | Enforced |
| 27 | ContactQuery | PENDING/RESOLVED/CLOSED | Explicit reopen/resolve/close transitions | Enforced |
| 28 | HealthProfessional verification | PENDING/VERIFIED/REJECTED | Admin-only transition guard | Enforced |
| 29 | CampStaff assignment | ASSIGNED/CONFIRMED/ATTENDED/WITHDRAWN | Shared `src/lib/camp-staff.ts`, admin PATCH + roster actions | Enforced |

---

## P1 — Fix: transition tables duplicated between server and client

The same legal-transition knowledge is hand-copied into route files and UI
components. A state rename or new state silently desynchronises them — the UI
offers a transition the server rejects with 409, or hides a legal one.

**1. LabOrder pipeline**
- Server: `src/app/api/lab-orders/[id]/route.ts` — `NEXT` map (~line 30)
- UI duplicate: `src/components/portal/doctor/lab-tech.tsx` — `NEXT_STEP` map (~line 34)
- Fix: move `NEXT` (with per-step labels + role gates) into `src/lib/`, import from both. UI already imports shared tables for food (`src/lib/food.ts`) — follow that pattern.

**2. Mission / ambulance dispatch**
- Server: `src/app/api/missions/[id]/route.ts` — `FLOW` array (line 42) + `PROGRESS` map (line 43)
- UI duplicate: `src/components/admin/ambulance-view.tsx` — `STEP_LABEL` (line 292), `STATUS_PROGRESS` (line 301), `NEXT_STEP` (line 309)
- Fix: extract `MISSION_FLOW`, `MISSION_PROGRESS`, `MISSION_STEP_LABEL` to `src/lib/missions.ts` (or `src/lib/food.ts` style domain file). The comment in ambulance-view.tsx says "mirrors PATCH /api/missions/:id" — mirroring by comment is the bug.

**3. CampAttendance patient journey**
- Server: `src/app/api/camp-attendance/route.ts` — `TRANSITIONS` (line 18), `ACTIVE_STATUSES` (line 16), `PATCH_STATUSES` (line 14)
- UI duplicate: `src/components/admin/health/shared.tsx` — `attTransitions()` (line 434)
- Fix: extract to `src/lib/health.ts`. Keep the side-effect rules (CANCELLED requires reason, CHECKED_OUT stamps checkOutAt, NO_SHOW only from CHECKED_IN/WAITING) next to the table.

**Deliverable:** one shared `src/lib/transitions/` (or per-domain lib files) holding states, allowed transitions, labels, and per-transition roles. Routes and components import; nothing hand-mirrors.

---

## P2 — Fix: status enums with no transition enforcement (any → any)

These routes validate that a status is in the allowed set but accept any jump,
including backwards and into terminal states. Ordering rules exist only in
comments and UI affordances, so a direct API call can produce impossible
sequences (e.g. REJECTED → APPROVED, COMPLETED → PENDING).

Priority order by business impact:

1. **Beneficiary** — `src/app/api/beneficiaries/route.ts` (~line 122): `caseStatus` (INTAKE|VERIFICATION|ACTIVE|CLOSED|REJECTED) and `verificationStatus` (PENDING|DOCUMENTS_REQUESTED|VERIFIED|REJECTED) are two parallel machines on one entity with zero transitions. Suggested: INTAKE→VERIFICATION→ACTIVE→CLOSED forward-only; VERIFIED/REJECTED terminal on the second; rejection only from PENDING/DOCUMENTS_REQUESTED.
2. **Donation admin PATCH** — `src/app/api/donations/[id]/route.ts` (line 18): PENDING|COMPLETED|FAILED|REFUNDED|CANCELLED free-set. Money-related — COMPLETED→PENDING breaks receipt/campaign-total invariants (see #10/#11). Suggested: PENDING→{COMPLETED,FAILED,CANCELLED}; COMPLETED→{REFUNDED} only.
3. **VolunteerApplication** — `src/app/api/volunteer-applications/[id]/route.ts` (line 17): PENDING|APPROVED|REJECTED free-set. Approving also mutates the User machine (below) — a REJECTED→APPROVED flip re-triggers onboarding with no audit of the sequence.
4. **Appointment** — `src/app/api/appointments/[id]/route.ts` (line 14): SCHEDULED then CONFIRMED|COMPLETED|CANCELLED|NO_SHOW free-set. Suggested: NO_SHOW only from CONFIRMED; COMPLETED only from CONFIRMED.
5. **CampRegistration** — `src/app/api/camp-registrations/[id]/route.ts` (line 14): REGISTERED then CONFIRMED|CANCELLED|REJECTED free-set.
6. **BeneficiaryRequest** — `src/app/api/beneficiary-requests/[id]/route.ts` (line 15): PENDING|IN_REVIEW|APPROVED|FULFILLED|REJECTED free-set. Suggested: PENDING→IN_REVIEW→{APPROVED,REJECTED}→FULFILLED.
7. **Follow-up** — `src/app/api/follow-ups/[id]/route.ts` (line 15): PENDING then DONE|MISSED|CANCELLED free-set.
8. **Value-set-only, lower priority** (operational, self-correcting): Campaign (`campaigns/[id]/route.ts` line 110), Cause (`causes/[id]/route.ts`), Ambulance (`ambulances/[id]/route.ts` line 41), Animal (`animals/[id]/route.ts` line 89), AnimalPledge (`animal-pledges/[id]/route.ts` line 30).

**Fix pattern:** reuse the `TRANSITIONS: Record<string, string[]>` table already
established in `medical-camps/[id]/route.ts` and `camp-attendance/route.ts` —
reject with 409 on illegal source→target, allow no-op (from === to) field edits
to pass through, matching `assertEventTransition()` in `src/lib/food.ts`.

---

## P3 — Fix: User account status mutated as a side effect

`User.status` (ACTIVE|PENDING|SUSPENDED — schema line 23) has no owning route.
It is flipped indirectly by volunteer-application approval
(`volunteer-applications/[id]/route.ts`) and read by every `requireRole` call.
PENDING→ACTIVE on approval and back-transitions are unguarded and unlogged as a
state change.
- Fix: give the User machine an explicit owner (e.g. `PATCH /api/users/:id/status` or a lib function `setUserStatus(userId, to, reason)`) that the application route calls, so the transition is validated and `logActivity`'d in exactly one place.

## P4 — Fix: receipt machine coupled to payment settlement

`receiptStatus PENDING→ISSUED` is set inside `settleCompleted()` in
`src/app/api/payments/verify/route.ts` alongside `paymentStatus`. The idempotency
guard covers `paymentStatus: "PENDING"` only. If a receipt issue ever fails
after the payment update commits (currently same `updateMany`, so atomic — safe
today), or if admin PATCH on donations (#P2-2) touches either field, the two
machines drift.
- Fix: document the invariant "receiptStatus == ISSUED iff paymentStatus == COMPLETED (for gateway donations)" in `src/lib/` and add an assertion or DB-level check when donation PATCH gains transition rules.

## P5 — Fix (minor): derived statuses computed in three places

- Mission `progress` is derived from status via `PROGRESS` (server, missions route) and recomputed in the UI (`STATUS_PROGRESS`, ambulance-view). Already covered by P1-2 — fix together.
- KitBatch `status` (READY|IN_PROGRESS|DEPLETED) is derived from scanned-unit counts inside `src/app/api/kit-scan/route.ts` (line 57 `batchStatus`). Single computation point, but the thresholds/derivation are inline — extract to a pure function when batch rules change.

## P6 — Fix (UI, low risk): flag clusters acting as state machines

These are implicit machines in React state. No data corruption risk, but they
cause the classic invalid-combo bugs (e.g. double-submit, skeleton flash):

- **Distribution wizard** — `src/components/admin/distributions-view.tsx`: `wizardStep` (1–4) + `wizardMaxStep` high-water mark, per-step validation, revisit rules in `Stepper` (line 4024). Fix: extract step machine (`canGoTo`, `advance`, `maxReached`) into a hook so the rules aren't inline in a 4000-line view.
- **Per-row busy mutex** — `busyId: string | null` duplicated across 9 admin views (campaigns, animals, volunteers, masters, ambulance, food desk/insights/pickups/applications). Fix: extract a `useRowBusy()` hook — one implementation, one set of invariants (clear in `finally`, ignore when another row busy).
- **Volunteer application form** — `src/components/portal/volunteer/application.tsx` lines 100–117: `loading | refreshing | submitting` booleans can represent impossible combos (loading + submitting). Fix: collapse to a discriminated union status (`"idle" | "loading" | "ready" | "submitting"`) — no library needed.
- **FormSheet** — `src/components/shared/form-sheet.tsx` already centralises open × submitting × dirty; keep new views on it instead of ad-hoc dialogs.

## Reference implementation

`src/lib/food.ts` is the model to follow: exported status list, transition
table, `assertEventTransition()` helper, and derived view-sets
(`FOOD_PUBLIC_EVENT_STATUSES`, `FOOD_OPERATIONAL_STATUSES`) — consumed by both
routes and components. Target state: every machine in section A/P2 lives in
`src/lib/<domain>.ts` with a transition table; routes validate with it; UIs
derive button labels from it; no hand-mirrored maps.
