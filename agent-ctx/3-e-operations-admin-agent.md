# Task 3-e — Ambulance & Volunteers admin modules rebuild (work record)

## Scope (touched ONLY these two files)
1. `src/components/admin/ambulance-view.tsx` — restructured into 3 Tabs.
2. `src/components/admin/volunteers-view.tsx` — rebuilt (2 Tabs).

## Ambulance view — what changed
- **Tabs**: Fleet / Missions / Corridor log (`Tabs` + per-tab components; each loads its own data on mount).
- **Fleet tab**
  - 4 StatCards (Fleet size / Available / On mission / Maintenance).
  - Toolbar: debounced-less search input + `ViewSwitcher` (table/grid/list, persisted `uar-view-ambulance-fleet`) + `ExportMenu` CSV + "Add ambulance".
  - Table view (mobile falls back to cards), Grid cards, compact List rows; row actions = View / Edit / Delete (icon buttons, aria-labelled).
  - Add/Edit via **FormSheet (md)** with shared field primitives: code (hint "Format: KA-01-UAR-101", uppercase), type `SelectField` (useMasters AMBULANCE_TYPE), base, driverName, driverPhone (`phoneRule(true)`), crew/equipment comma lists. Validation errors shown per-field (`required`/`phoneRule` from `@/lib/validators`). Unsaved-changes guard via `dirty`.
  - Delete via **ConfirmDialog**.
  - Detail Sheet: DataField grid + Crew & equipment card + **Mission history** (`GET /api/missions` filtered client-side by `ambulanceId`, max-h scroll).
- **Missions tab**
  - Status pill filters kept (ALL/REQUESTED/DISPATCHED/EN_ROUTE/ARRIVED/COMPLETED/CANCELLED).
  - `ViewSwitcher` (table/list, `uar-view-ambulance-missions`) + `ExportMenu` CSV + "New mission".
  - Table columns: Request ref · Patient(+contact) · Type/priority badges · Route pickup→destination · Ambulance · ETA · Status(+corridor zap) · Actions (primary next-step button + DropdownMenu with View/Dispatch/Advance/Complete/Cancel).
  - Primary action mapping: REQUESTED→Dispatch · DISPATCHED/EN_ROUTE→Advance · ARRIVED→Complete (emerald).
  - **Create+Dispatch FormSheet (xl)**: patient, contact (`phoneRule()`), emergencyType (`useMasters("EMERGENCY_TYPE")` w/ fallback), priority, pickup, destination, repeatable route-segment editor {name, congestion Select, lengthKm number} with add/remove + **SEGMENT_POOL quick-add chips** (8 pooled segments, custom ones allowed), ambulance Select (AVAILABLE only; optional → "Create & dispatch" vs "Create mission" — dispatch PATCH runs right after POST).
  - Dispatch-existing **FormSheet (md)** for REQUESTED missions (summary + available-ambulance Select, inline error when none).
  - Advance/Complete run directly; **Cancel uses ConfirmDialog** ("…corridor disarmed. Any assigned ambulance returns to AVAILABLE.").
  - Detail Sheet: stats grid (vehiclesAlerted, timeSaved via `formatDuration`, ETA, ambulance, route), **route segments timeline** (numbered ol + congestion tones), **corridor events list** (`GET /api/corridor-events?missionId=`), action footer.
- **Corridor log tab**
  - `GET /api/corridor-events?limit=200`; StatCards (events / Σ vehicles alerted / Σ time saved via formatDuration).
  - Filters: method Select (5 methods), congestion Select (4 levels), search (segment/ref/note). Client-side filtering (API has no method/congestion params — see gaps).
  - Table (time, mission ref, segment, method badge, congestion badge, vehicles, saved) + List view; `ExportMenu` CSV.

## Volunteers view — what changed
- **Applications tab** (kept approve/reject + temp-creds)
  - Card grid + status pills + read-only detail Sheet kept (StatusBadge now used).
  - Approve/Reject polished: **FormSheet (sm)** captures review note → **ConfirmDialog** confirms (approve: "Approve & create account"; reject: destructive). Temp-creds Dialog unchanged (shown from PATCH response `application.tempCreds`).
- **Volunteers tab**
  - Toolbar: search + `ViewSwitcher` (table/grid/list, `uar-view-volunteers`) + `ExportMenu` CSV (11 cols). Status pills (ALL/PENDING/ACTIVE/INACTIVE/SUSPENDED).
  - Row actions: View / Edit / quick Activate|Suspend.
  - **Edit FormSheet (md)** → `PATCH /api/volunteers/:id`: skills + availability (comma lists), assignedArea, emergencyContact, idProof, status Select (PENDING|ACTIVE|INACTIVE|SUSPENDED, hint "Mirrors to the linked account…"). Old users-API fallback removed (backend exists now).
  - Quick actions via **ConfirmDialog** (Activate/Suspend with account-mirroring copy).
  - **Detail Sheet (sm:max-w-xl)** with Tabs:
    - **Stats strip** (StatTiles): tasksAssigned / tasksCompleted / daysPresent / totalHours from `GET /api/volunteers/:id` → stats.
    - **Profile**: user + volunteer DataFields, skills/availability chips, Edit + quick status buttons.
    - **Tasks**: list (priority/status badges, max-h scroll) + "Assign task" → **FormSheet**: title, type Select (`useMasters("TASK_TYPE")`), priority, location, scheduledDate (date) → `POST /api/volunteer-tasks` with volunteerId.
    - **Attendance**: `GET /api/volunteer-attendances?volunteerId=` table (date / check-in / check-out / hours / location) + "Record attendance" → **FormSheet**: date, checkIn/checkOut (time; checkOut>checkIn validated), hours number 0–24 step .5, location, notes → `POST /api/volunteer-attendances` (checkIn/out sent as `${date}T${time}:00`).
  - Detail refreshes stats/tasks/attendance after mutations; list reloads after edit/status changes.
- Cross-cutting: skeletons everywhere, EmptyState with CTAs, sonner toasts, dark-safe semantic tokens + opacity accents, no indigo/blue, aria-labels on all icon buttons, aria-pressed pills, sr-only live region on missions.

## Status
- `bunx tsc --noEmit` → **clean** (exit 0).
- `bun run lint` → **clean** (no output).
- APIs used: `/api/ambulances`, `/api/missions` (+`[id]` PATCH actions), `/api/corridor-events`, `/api/volunteers`(+`/:id` GET/PATCH), `/api/volunteer-tasks`, `/api/volunteer-attendances`, `/api/volunteer-applications`, `/api/masters` — all verified against route sources.

## API gaps (for coordinator / API agent)
1. `POST /api/missions` **ignores the client `route` segments** — it always generates its own 4-segment simulated route. The planned-route editor in the create sheet is advisory only; either accept `route` in POST or document as server-simulated.
2. `GET /api/missions` has no `ambulanceId` param → fleet detail "mission history" filters the latest 50 client-side (older history unreachable). Suggest `?ambulanceId=`.
3. `GET /api/corridor-events` has no `method`/`congestion`/`q` params → corridor log filters client-side (limit 200 cap). Suggest server params.
4. `PATCH /api/volunteers/:id` accepts `skills`/`availability` as raw strings; the UI sends the comma-joined string (matches JSON-string column). If the API later expects arrays, the view needs a 1-line change.
5. `GET /api/volunteers/:id` caps tasks at 50 / attendances at 60 (fine for the sheet; noted).
