# Task 3-f — Admin modules rebuild (settings test probes, settings UI, reports, masters, activity)

Agent: 3-f (admin settings/reports/masters/activity)
Scope kept: ONLY the five listed files were touched. No git, no dev-server restarts, no schema edits.

## Files changed

1. `src/app/api/settings/test/route.ts` — REPLACED simulated test with REAL probes (ADMIN-only, POST {channel}, never throws):
   - `email`: requires `notify.email.enabled === "true"`, else `{ok:false,message:"SMTP not enabled…"}`. Real `node:net` TCP connect to host:port with 3s timeout; ok on connect; message includes `host:port`. No mail is ever sent.
   - `sms`: not enabled → not-configured failure; else HTTP HEAD→GET fallback probe of `notify.sms.endpoint` with 4s AbortController timeout; ok on ANY HTTP response; message includes provider.
   - `whatsapp`: config presence check (enabled + business number).
   - `gateway`: config presence check (`finance.gatewayEnabled` + `finance.razorpayKeyId`); message includes key prefix + test/live mode from `finance.gatewayTestMode`.
   - All probes wrapped; probe errors convert to structured `{ok:false, latencyMs, message}`; logActivity records OK/FAILED per attempt.

2. `src/components/admin/settings-view.tsx` — extended to 9 tabs (new **Integrations** tab):
   - Secrets & keys: `isSecretKey()` treats last segment ending Secret/Password/Key/Token as secret (+ `finance.razorpayKeyId`; `captcha.siteKey` excluded as public). New `SecretField`: password-type masked input, per-field show/hide, green "configured" tick when saved value non-empty, placeholder `••••••••` + "leave blank to keep" hint. Typed edits live in separate `secretEdits` state; PATCH sends a secret ONLY when the admin typed one; Reset clears drafts.
   - Payments tab: gateway provider Select (RAZORPAY|CASHFREE|PAYU|STRIPE), keySecret + webhookSecret (secret), testMode Switch, **Test gateway** button → real gateway probe.
   - Email tab: SMTP username, password (secret), replyTo (+ replyTo email validation).
   - SMS tab: apiKey (secret), DLT templateId.
   - Integrations tab: Storage (provider S3|R2|SPACES|LOCAL, bucket, region, accessKey secret, cdnBase), Webhooks (url with https validation, event checkbox-chips payment.captured|payment.failed|refund.processed|receipt.issued stored comma-separated, signing secret), Analytics (ga4Id with G-… format check, metaPixel), Security (captcha NONE|RECAPTCHA|HCAPTCHA|TURNSTILE, siteKey, secretKey secret), Maps (GOOGLE|MAPMYINDIA, apiKey secret).
   - Test buttons wired to the real API for channels email/sms/whatsapp/gateway with updated copy ("real TCP… no mail is sent"). Kept dirty tracking, sticky save bar, beforeunload guard, en/hi/kn + region tab, dark-safe tokens, aria labels, toasts.

3. `src/components/admin/reports-view.tsx` — rebuilt with FY selector (kept) + report-type Tabs:
   - **Impact**: untouched existing content (KPIs, monthly/category charts, programme impact, top donors) + original sectioned CSV.
   - **Donations**: `GET /api/donations?from=<fy>-04-01&to=<fy+1>-03-31&limit=500`, grouped client-side — by-method table, by-status table (StatusBadge), 12-month trend ComposedChart (same colors), failed/refunded/cancelled list (scrollable, max-h).
   - **Distributions**: `GET /api/distributions?limit=200` + `GET /api/pad-distributions`, FY-filtered client-side — pie share by type (PIE_COLORS reused), totals-by-type table, top-10 locations table, pad drives by area table.
   - **Finance**: reconciliation from the same donations fetch — gross / fees / expected net / recorded net / variance / refund total, settlement coverage % with Progress bar, provider-level table (gross/fees/net/settled).
   - Header Export CSV acts on the ACTIVE tab (sectioned CSV per tab incl. its tables) + Print. Per-tab skeletons (TabSkeleton) + EmptyStates. Lazy per-tab fetch, refetch on FY change.

4. `src/components/admin/masters-view.tsx` — polished (tabs + inline edit + active switch kept):
   - Per-category **Export** (downloadCsv: value,label,sortOrder,active).
   - **Import** paste-box in a FormSheet: parses `value,label,sortOrder` lines, live parsed-count + unparsed-line errors preview, sequential POST /api/masters (server upserts by category+value), per-row results list in-sheet + per-failed-row toast + summary toast, reload after.

5. `src/components/admin/activity-view.tsx` — polished:
   - entityType **multi-select chips** (aria-pressed toggle, multi included-filter, "Reset filters" clears).
   - **CSV export** of filtered entries (time/actor/action/entity/entityId/details/IP) via shared downloadCsv.
   - Proper **client-side pagination**: fetch pool = latest 500 (API has no cap), PaginationBar + PageSizeSelect (25/50/100), page resets on filter/pageSize change, clamped after 15s refresh. Load-more removed.
   - Skeleton rows upgraded to row-shaped skeletons. 15s live auto-refresh kept (visibility-aware), expandable detail panel kept.

## Checks
- `bunx tsc --noEmit` → clean (exit 0, no output).
- `bun run lint` → clean (no warnings/errors).
- Route file imports only server-safe modules (`node:net`, `@/lib/session`, `../_lib/org`); no client imports.

## Notes / gaps for coordinator
- Pre-existing (NOT mine): `GET /api/donations` returned a 500 earlier in dev.log — "Unknown field `donorRef`" — because the running Prisma client was generated before the round-3 schema push. The generated client at `node_modules/.prisma/client` (05:03) and pushed DB (05:19) now include `donorRef`; a dev-server restart will fix it. My Donations/Finance report tabs consume that endpoint and will work once the server reloads with the fresh client.
- `GET /api/settings` still returns secret values unmasked (route not in my ownership). My UI masks display and only PATCHes typed secrets, so it is safe either way; if the route later masks values (per round-3 contract), the same UI keeps working (configured-tick is presence-based).
- Sandbox egress may block outbound SMTP/HTTP, so real email/sms probes can legitimately return ok:false ("timed out/unreachable") — that is the intended real behavior, not a bug.
- New setting keys introduced (no seed needed — client falls back to defaults, PATCH upserts): finance.gatewayProvider, finance.gatewayKeySecret, finance.gatewayWebhookSecret, finance.gatewayTestMode, notify.email.username, notify.email.password, notify.email.replyTo, notify.sms.apiKey, notify.sms.templateId, storage.provider/bucket/region/accessKey/cdnBase, webhooks.url/events/secret, analytics.ga4Id/metaPixel, captcha.provider/siteKey/secretKey, maps.provider/apiKey.
