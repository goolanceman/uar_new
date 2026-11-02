# Task 2-f — Admin Operational Views (Agent: frontend-views)

## Status: COMPLETE ✅

Created exactly 7 default-export client components in `src/components/admin/`, all matching
`admin-app.tsx` imports. All files type-check clean (`tsc --noEmit` filtered = 0 errors).
No other files touched (page.tsx, API routes, schema untouched).

## Files created

| File | Export | Tabs / sections |
|---|---|---|
| `causes-view.tsx` | `CausesView` | Medicine causes cards + Pledges aggregate table |
| `animals-view.tsx` | `AnimalsView` | Residents card grid + Animal pledges aggregate table |
| `ambulance-view.tsx` | `AmbulanceView` | Live Ops (mission board + live corridor SVG) / Fleet / Corridor Analytics |
| `beneficiaries-view.tsx` | `BeneficiariesView` | Search + category chips, desktop table + mobile cards |
| `distributions-view.tsx` | `DistributionsView` | 5 type tabs + "School Pad Drives" tab |
| `inventory-view.tsx` | `InventoryView` | Search + category chips, stock table, quick-stock, low-stock banner |
| `kits-view.tsx` | `KitsView` | Batches (expand units + print labels) / Templates (dynamic item rows) / Unit Explorer |

## Endpoints consumed (per spec)

- **causes**: `GET /api/causes` (expects pledges[] embedded), `POST /api/causes`, `PATCH /api/causes/[id]` (edit + `{status:"PAUSED"/"SEEKING"}`), `DELETE /api/causes/[id]`, `PATCH /api/pledges/[id]` `{status:"CANCELLED"}`
- **animals**: `GET /api/animals` (expects pledges[] embedded), `POST /api/animals`, `PATCH /api/animals/[id]` (edit + status quick actions), `DELETE /api/animals/[id]`, `PATCH /api/animal-pledges/[id]` `{status:"CANCELLED"}` (convention: model name AnimalPledge → animal-pledges route)
- **ambulance**: `GET/POST /api/missions`, `PATCH /api/missions/[id]` `{action:"dispatch"|"advance"|"complete"|"cancel", ambulanceId?}`, `GET /api/corridor-events?missionId=`, `GET /api/ambulances` (+`?status=AVAILABLE`), `POST /api/ambulances`, `PATCH/DELETE /api/ambulances/[id]`, `GET /api/corridor-stats`
- **beneficiaries**: `GET /api/beneficiaries?q&category`, `POST /api/beneficiaries`, `PATCH /api/beneficiaries/[id]` (edit + `{isActive}` toggle), `DELETE /api/beneficiaries/[id]`
- **distributions**: `GET /api/distributions?type=X`, `POST /api/distributions` (walk-in: `beneficiaryId:null` + `walkInName` + notes prefix "Walk-in: …"), `DELETE /api/distributions/[id]`, `GET/POST /api/pad-distributions`, `DELETE /api/pad-distributions/[id]`
- **inventory**: `GET /api/inventory?category&q`, `POST /api/inventory`, `PATCH /api/inventory/[id]` (edit + `{addQuantity}` for +10/+50/−1), `DELETE /api/inventory/[id]`
- **kits**: `GET /api/kit-batches` (expects template embedded), `POST /api/kit-batches` (toast "N QR labels generated" from `res.count ?? units.length ?? totalUnits`), `GET /api/kit-units?batchId=`, `GET /api/kit-templates`, `POST/PATCH/DELETE /api/kit-templates[/id]` (409 → server error toasted), `GET /api/kit-units?q&status&limit=100`, `GET /api/kit-stats`

## API contract notes for API agents

- `GET /api/causes` & `GET /api/animals`: include pledges relation (Pledge / AnimalPledge) in response.
- `GET /api/kit-batches`: include `template` relation.
- `GET /api/kit-units`: optionally include `batch {name}` for the Unit Explorer "Batch" column (falls back to "—").
- `POST /api/kit-batches`: return `{count}` or `{units[]}` for the "N QR labels generated" toast.
- `GET /api/corridor-stats`: shape consumed defensively — `missions|totalMissions`, `vehiclesAlerted|totalVehiclesAlerted`, `timeSavedSec|totalSavedSec|timeSavedMin`, `avgSavedSec`, `bySegment:[{segment,savedSec}]`, `byMethod:[{method,count}]`. If endpoint missing, view derives KPIs client-side from missions.
- `PATCH /api/missions/[id]`: action-based (`dispatch` needs `ambulanceId`).
- `PATCH /api/inventory/[id]`: supports `{addQuantity}` incremental.

## UI details worth knowing

- Ambulance Live Ops polls missions + corridor events every 5s (interval cleaned up; only on Live tab).
- Corridor SVG: segment widths ∝ lengthKm, congestion colors LOW emerald / MODERATE amber / HEAVY orange / GRIDLOCK red; vehicle dots 3–5/segment turn emerald + shift to lane edge with CSS transition when segment alerted & corridor live (SMIL pulse rings + method badges from aggregated events); ambulance = white cross in red rounded square, x-position eased by `progress`.
- Fleet "Dispatch" dialog loads `?status=AVAILABLE` ambulances at open.
- Kits "Print labels" renders a print-only sheet (`#uar-print-labels`, `@media print` visibility isolation, capped at 120 labels) then calls `window.print()`.
- No alert()/confirm anywhere — delete flows use shadcn Dialog confirms. All icon buttons have aria-labels. Tables wrapped `overflow-x-auto`; unit lists `max-h-96 overflow-y-auto scrollbar-thin`. No indigo/blue classes anywhere.
