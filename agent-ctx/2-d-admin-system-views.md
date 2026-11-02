# Task 2-d — Admin System Views (Agent 2-d)

## Scope
Created EXACTLY 9 files in `src/components/admin/` (all `"use client"`, default-exported, matching imports in `admin-app.tsx`):

| # | File | Default export |
|---|------|----------------|
| 1 | `dashboard-view.tsx` | `DashboardView` |
| 2 | `donations-view.tsx` | `DonationsView` |
| 3 | `campaigns-view.tsx` | `CampaignsView` |
| 4 | `users-view.tsx` | `UsersView` |
| 5 | `volunteers-view.tsx` | `VolunteersView` |
| 6 | `masters-view.tsx` | `MastersView` |
| 7 | `reports-view.tsx` | `ReportsView` |
| 8 | `activity-view.tsx` | `ActivityView` |
| 9 | `settings-view.tsx` | `SettingsView` |

## Endpoints consumed (contract each view expects)

### dashboard-view.tsx
- `GET /api/stats` — KPIs + chart data. Read defensively with key fallbacks:
  - raised: `totalRaised | raised | totalDonationsAmount`
  - donations: `donationsCount | totalDonations | donations`
  - `beneficiaries`, `volunteers`, `kitsScanned | scannedUnits`, `kitsTotal | totalUnits`
  - corridor: `corridorTimeSavedSec | timeSavedSec | corridorTimeSaved` (seconds → minutes)
  - `monthlyDonations: [{month|label, amount|value}]` → AreaChart (h-56)
  - `byCampaign: [{name|title, raised|amount}]` → BarChart
  - `byRole: [{name|role, value|count}]` → PieChart + legend
  - `recentDonations: [{id, donorName, amount, paymentStatus, createdAt, campaignTitle|campaign.title}]`
- `GET /api/inventory?low=1` → array (or `{items:[]}`) → low-stock count → Alert card → `navigate("/admin/inventory")`
- `GET /api/volunteer-applications?status=PENDING` → count → Alert card → `navigate("/admin/volunteers")`
- `GET /api/activity-logs?limit=8` — reserved (mission listed it; dashboard renders stats-driven list; activity feed lives in activity-view)

### donations-view.tsx
- `GET /api/donations?limit=200&q&status` (debounced search 400ms, status filter)
- `GET /api/campaigns` (options for Select)
- `POST /api/donations` `{donorName, donorEmail, amount, type, paymentMethod, campaignId?, message?}`
- `PATCH /api/donations/[id]` `{paymentStatus, amount?}`
- `DELETE /api/donations/[id]`
- Client-side CSV export from loaded rows

### campaigns-view.tsx
- `GET /api/campaigns?all=1`
- `POST /api/campaigns` / `PATCH /api/campaigns/[id]` `{title, tagline?, description, category, targetAmount, icon, accent, helpline?, featured, status}` (slug left to server)
- Quick toggle `PATCH {status: ACTIVE↔PAUSED}`, `DELETE /api/campaigns/[id]` (Dialog confirm)
- 10 icons + 9 accents mapped to real Tailwind classes (no indigo/blue)

### users-view.tsx
- `GET /api/users?q&role&status`
- `POST /api/users` `{name,email,password,role,city?,phone?}`
- `PATCH /api/users/[id]` `{role, status, phone?, city?, password?}` (password only when provided)
- `DELETE /api/users/[id]` — disabled for own id via `useAuth()`

### volunteers-view.tsx (3 Tabs)
- Applications: `GET /api/volunteer-applications?status=PENDING|APPROVED|REJECTED|""(ALL)`, PENDING sorted first; Approve → `PATCH /api/volunteer-applications/[id] {status:"APPROVED"}` toast "Volunteer approved — portal unlocked"; Reject → Dialog reviewNote → `PATCH {status:"REJECTED", reviewNote}`
- Active: `GET /api/volunteers?status=ACTIVE` (reads `user.name/user.email` with `name/email` fallback)
- Tasks: `GET /api/volunteer-tasks` + `GET /api/volunteers?status=ACTIVE`; `POST /api/volunteer-tasks {title,type,priority,location?,scheduledDate:ISO,volunteerId}`; status quick-set `PATCH /api/volunteer-tasks/[id] {status}`

### masters-view.tsx
- `GET /api/masters?categories=1` (handles string[], `{category,count}`, `{category,_count}`)
- `GET /api/masters?all=1` — grouped client-side by category
- `POST /api/masters {category,value,label}` (add entry; new category seeds one entry `value:"default"` because Master requires value+label)
- `PATCH /api/masters/[id] {label}` (inline edit on blur/Enter) · `{active}` (Switch) · `DELETE /api/masters/[id]`
- Info banner: "Values here feed every dropdown across the site instantly"

### reports-view.tsx
- `GET /api/reports?type=overview|donations|distributions|causes|animals&from&to`
- overview expects `{monthly:[{month,donations,distributions}], byCampaign:[{name,raised}], byType:[{name,count}]}` (defensive pickers); LineChart ×2 lines + BarChart ×2
- donations/distributions/causes/animals → data tables + totals row in CardDescription; CSV export per tab

### activity-view.tsx
- `GET /api/activity-logs?limit=100`; client filter on action/entityType/actor; auto-refresh `setInterval(load, 15000)` with `clearInterval` cleanup; "Live" pulsing badge; manual Refresh

### settings-view.tsx
- `GET /api/settings` — normalized from array `[{key,value}]`, `{settings:{…}}`, or flat object → `Record<string,string>`
- `PATCH /api/settings` with FLAT body of all keys: `org.name, org.hq, org.vision, org.email, org.80g, org.pan, ops.lowStockAlerts("true"/"false"), ops.currency, assist.model`
- Sections: Organisation (Building2), Operations (Settings2, Switch), AI (Bot); Save → toast

## Notes for other agents
- All list endpoints tolerated as raw array OR `{items:[]}` — follow CONVENTIONS "return RAW arrays" and both work.
- `/api/stats` implementer: keys above are matched with fallbacks, any of the listed aliases work. Best primary keys: `totalRaised, donationsCount, beneficiaries, volunteers, kitsScanned, kitsTotal, corridorTimeSavedSec, monthlyDonations, byCampaign, byRole, recentDonations`.
- `/api/reports` implementer: primary keys `monthly, byCampaign, byType` for overview; raw arrays for the other types.
- `/api/settings` implementer: GET may return array of Setting rows or flat object — both handled; PATCH accepts flat `{key: value}` map.
- `DELETE /api/users/[id]` should 400 when deleting own account (client also disables the button).
- Masters "new category" creates seed entry `{value:"default"}` — API must accept it (category+value unique).
- No file outside the 9 views was touched; no dev/lint/db commands run.
