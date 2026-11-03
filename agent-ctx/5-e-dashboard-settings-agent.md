# Task 5-e — Dashboard widget customization + Settings integrations audit

Agent: dashboard/settings polish · Files touched: 5 (all within ownership)

## Files changed
| File | Change |
|---|---|
| `src/components/admin/dashboard-view.tsx` | Full rebuild (~1,030 lines): widget customization, date-range context, drill-downs, polish |
| `src/components/admin/settings-view.tsx` | Audit gaps filled (~1,860 lines): 12 new keys, per-section save, CSV export, test guards |
| `src/app/api/stats/route.ts` | `?from=&to=` range support + deltas + categories (backward compatible) |
| `src/app/api/settings/route.ts` | GET now merges server-side defaults; PATCH upsert unchanged; secrets masked |
| `src/app/api/settings/public/route.ts` | Unchanged (contract shape already correct) |

## Work Stream A — Dashboard
- **Customize popover** (SlidersHorizontal, PageHeader toolbar): 9 sections → `kpis, trend, mix, attention, donations, tasks, upcoming, activity, actions`. Persisted to localStorage **`uar-dash-widgets`**; read in `useEffect` post-mount (SSR-safe: first paint shows all, prefs merge over `ALL_WIDGETS_ON`). "Show all sections" resets. Hidden sections drop from the grid; paired rows (trend+mix, attention+donations, tasks+upcoming) auto-expand the survivor to `lg:col-span-5`.
- **Date-range**: ToggleGroup `FY / 30d / 90d / All` → `/api/stats?from&to` (FY = Apr 1 → now). Deltas vs previous equal-length window come from the API (`deltas.raised/donations.pct`), rendered as emerald/red TrendingUp/Down chips in StatCard hints (hidden when prev=0 → `pct:null`).
- **Drill-downs**: trend→/admin/reports, mix→donations, attention→activity, donations→donations, tasks & upcoming→volunteers, activity→activity; quick actions unchanged.
- **KPI row** (5): Funds raised (Δ), Donations (Δ), Active campaigns, Beneficiaries, Pending approvals (= pending volunteer applications + pending beneficiary requests).
- **New widgets**: Pending tasks (open ASSIGNED/IN_PROGRESS from `/api/volunteer-tasks`, StatusBadge) · Upcoming schedule (scheduled ≥ today) · Recent activity (`/api/activity-logs?limit=10`, timeAgo).
- **Polish**: per-section skeletons, staggered `animate-fade-in` (70ms steps, fill-mode both), greeting header via `useAuth()` name + FY label, charts on `var(--chart-1..5)` (+brand accents past 5 slices), no indigo/blue, responsive `grid-cols-1 → sm:2/3 → xl:5`.

## Work Stream B — Settings checklist
| Integration | Status | Keys |
|---|---|---|
| Org identity (name/address/HQ/email/phone/website/vision) | ✅ was present | `org.name/hq/address/email/phone/website/vision` |
| Registrations PAN/80G/12A/Darpan | ✅ was present | `org.pan/80g/reg12a/darpan` |
| Fiscal year start | ➕ ADDED (select 12 months, Apr default + note) | `finance.fyStartMonth` |
| Receipt signatory + footer | ✅ was present | `receipts.signatoryName/Role/footer` |
| Receipt number prefix | ➕ ADDED (org + receipts tab) | `receipts.prefix` |
| Default language en/hi/kn/ta/te + master-strings note | ➕ EXTENDED ta/te + note | `app.language` |
| Logging retention/level | ✅ was present | `logs.retentionDays/level` |
| Activity-log toggles | ➕ ADDED (logins/donations/distributions/admin edits) | `logs.track.logins/donations/distributions/adminEdits` |
| Export logs CSV | ➕ ADDED (`downloadCsv` from `/api/activity-logs?limit=2000`) | (action) |
| Payments UPI/test-live/currency/prefix/GSTIN | ✅ + ➕ GSTIN & mode badge | `finance.upiId/gatewayTestMode/currency`, `payments.gst` |
| Razorpay/Stripe key presence (masked write-only) | ➕ Stripe key added + 4 PresenceBadges + mode badge | `finance.razorpayKeyId`, `finance.stripeKeyId`, `finance.gatewayKeySecret/WebhookSecret` |
| SMS provider/sender/masked key/test | ✅ + test disabled until endpoint set | `notify.sms.provider/senderId/apiKey/endpoint/templateId` |
| Email SMTP full set + Test connection | ✅ kept (real TCP probe) + disabled until host set + invitation-templates note | `notify.email.*` |
| WhatsApp | ✅ + test disabled until number set | `notify.whatsapp.enabled/number` |
| Google Maps key | ✅ was present | `maps.provider/apiKey` |
| QR code base URL | ➕ ADDED ("QR codes & system mode" card) | `kits.qrBaseUrl` |
| Angel AI on/off | ➕ ADDED (switch + model) | `assist.enabled`, `assist.model` |
| Maintenance mode + warning | ➕ ADDED (amber alert while ON) | `app.maintenance` |
| Storage/Webhooks/Analytics/Captcha | ✅ kept | `storage.*`, `webhooks.*`, `analytics.*`, `captcha.*` |
| Per-section save | ➕ ADDED: every card gets "Save (n)" (render-fn, loading spinner, toasts, only its dirty keys PATCHed) | — |
| Unsaved-changes indicator | ✅ sticky bar (count + Reset + Save all) + beforeunload guard | — |
| Write-only secrets | ✅ GET masks (`te••••••••••••56` verified), SecretField shows "•••• saved" + tick, PATCH sends typed values only | — |

Legacy round-1 keys (`lang.default`, `payments.upi`, `sms.enabled`, `email.enabled`, …) remain in DB, superseded by canonical keys — intentionally NOT given duplicate UI fields.

## API changes
- **GET /api/stats** — optional `from`/`to` (ISO). With range: `range{from,to,previous}`, `deltas{raised,donations{current,previous,pct|null}}`, range-scoped `totals.raised/donations`, monthly buckets (cap 24, 'MMM YY labels >12), `categories`. Without: legacy shape + `categories`. Counts (campaigns/beneficiaries/etc.) stay all-time by design.
- **GET /api/settings** — now merges `DEFAULT_SETTINGS` (81 keys returned) under DB rows; secrets masked via existing pattern.
- **PATCH /api/settings** — unchanged upsert; subset PATCH verified.

## Validation
- `bunx eslint` on all 5 owned files → **clean**. `tsc --noEmit` filtered to owned files → **clean**.
- Curl-verified: `/api/stats` default + 30d + FY shapes; `/api/settings` GET 81 keys w/ masking; PATCH subset; `/api/settings/public` intact; `GET /` 200; dev.log compiles clean.
- Full-project `bun run lint`: remaining 7 errors are in `volunteers-view.tsx` (`'Skeleton' is not defined` — missing import) owned by the 5-d people-modules agent, in-flight while I finished; earlier their `campaigns-view.tsx` had 7 errors which they subsequently fixed. Not my files to touch.
- Note: dev server was OOM-killed once by the sandbox (dmesg) during concurrent agent load; restarted via `bun run dev` (setsid) and stable after.

## Gotchas for next agents
- `/api/stats` with `from/to` now returns range-scoped `totals.raised/donations` — public home hero uses all-time semantics (no params → unchanged).
- Settings section→key mapping lives in `SECTION_PREFIXES` (settings-view) — add new keys there + `DEFAULTS` + server `DEFAULT_SETTINGS` together.
- Dashboard widget prefs key `uar-dash-widgets` — keep IDs stable; removed IDs are ignored on read.
