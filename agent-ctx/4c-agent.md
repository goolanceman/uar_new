# 4-c — Agent record (public-site finish + beneficiary hub backend)

## Status: COMPLETE — tsc clean · lint clean

## Files touched (only the 5 owned)
1. `src/components/public/about.tsx`
2. `src/components/public/contact.tsx`
3. `src/components/public/green-corridor.tsx`
4. `src/components/public/auth-pages.tsx`
5. `src/components/portal/beneficiary/hub.tsx`

## What was done
### about.tsx — Legal & Financial transparency section
- New Section after "Governance & transparency". Registration card grid (PAN · 80G approval · 12A · NGO Darpan), each a small bordered Card: icon chip (IdCard/Stamp/ScrollText/Landmark), mono value, "Verified" tick (BadgeCheck, emerald pill) when the settings value exists, "On request" dashed chip otherwise.
- Data from the existing `GET /api/settings/public` fetch with `orgWithFallbacks` (graceful); skeleton cards while loading.
- "Annual reports & audited financials" placeholder Card: 3 dashed "coming soon" chips (Annual report / Audited financials / Form 10B), note "Quarterly fund utilisation is reported publicly on the Impact page" (inline hash-Link to /impact) + outline Button hash-Link to `/tax-exemption`.

### contact.tsx — guided form polish
- Rewritten on shared primitives: `FieldGrid`, `TextField`, `TextareaField` from `@/components/shared/form-fields`.
- Validators: `required("Name")`, `emailRule()`, `phoneRule(true)` (optional), `required("Subject")`, `minLen(10,"Message")` via `fieldError`; inline errors under each field, cleared on change; single guidance toast instead of per-field toasts.
- Success screen state (role="status" aria-live) after `POST /api/contact-queries` — same endpoint/payload as before; "Send another message" resets. Helpline strip + info cards kept; info cards converted to dark-safe tokens (`bg-emerald-500/15 dark:` etc.).

### green-corridor.tsx — dead public stats fixed
- `CorridorLiveStats`: on `/api/corridor-stats` failure/401 (verified: 401 signed-out) → renders "Live ops board — staff sign-in" card: Radio icon header, awareness copy kept, red Button hash-Link to `/login` + demo volunteer chip.
- Fallback counters fetched from public `/api/stats` (`totals.missions / vehiclesAlerted / timeSavedMin` — payload inspected: all three exist) shown as 3 stat tiles in the right column of the CTA card; if that fetch also fails the CTA text-only card still renders (no silent empty section).
- Empty/`null` stats response also routed to the failed branch (was an infinite skeleton before). Loading skeletons unchanged; signed-in path unchanged.

### auth-pages.tsx — inline validation + role cards + credential chips
- Login: inline errors via `emailRule()` + `minLen(6,"Password")` under fields (TextField + Field/PasswordInput); errors clear on type.
- Demo account chips reworked: each account is a pill with click-to-fill (label + email) **and a copy button** copying `email / password` (aria-label per account); password list printed under the chips (matches CONVENTIONS demo logins).
- Register: role Select replaced by 3 radio-card buttons (DONOR=Heart, VOLUNTEER=HandHeart, BENEFICIARY=HeartHandshake) with `role="radiogroup"/"radio"` + `aria-checked`, selected = emerald tint + Check badge, per-role hint kept. Inline validation: `required+minLen(3)` name, `emailRule()`, `phoneRule()` (required), `minLen(6,"Password")` + strength policy (8+/mixed case/number → inline), confirm-match inline. Register payload/endpoint unchanged (temp-creds flow intact).
- Temp-creds dialog kept with per-field copy buttons.

### portal/beneficiary/hub.tsx — REAL backend for requests
- **ALL localStorage persistence removed** (`SavedRequest`, `storageKey`, `loadRequests`, `saveRequests`, `removeRequest`, Trash2 gone).
- Submit → `POST /api/beneficiary-requests` `{name, phone, category, urgency, details}` (verified 201, links userId/beneficiary), toast on success, requests reloaded.
- "My requests" → `GET /api/beneficiary-requests?mine=1` (verified array rows with status/reviewNote/createdAt); rendered with shared `StatusBadge` (PENDING|IN_REVIEW|APPROVED|FULFILLED|REJECTED all tone-mapped), reviewNote shown in a "Case team note" callout when present, `formatDateTime(createdAt)` "Submitted …" + urgency. List is `max-h-96 overflow-y-auto scrollbar-thin`.
- Case record (`/api/beneficiaries?mine=1`), support received (distributions filtered by case id), helplines, programmes kept; every section has skeleton-while-loading + `EmptyState` fallback; load errors toast.
- Form rebuilt on FieldGrid/TextField/SelectField/TextareaField with `required/phoneRule(true)/minLen(10)` inline validation.

## Verification
- `bunx tsc --noEmit` → **0 errors** (one pass fix: `TextField` has no `autoComplete` prop — removed from usages rather than touching shared form-fields, which I don't own).
- `bun run lint` → **clean, no output**.
- Root route 200; dev.log shows ✓ Compiled (the only logged API error is the pre-existing `/api/volunteer-attendances` Invalid-Date issue — outside my file list, left untouched).
- Endpoint smoke tests: `/api/corridor-stats` 401 signed-out (drives CTA branch), `/api/stats` totals present, POST beneficiary-request → 201 + `?mine=1` returns it, POST contact-queries → 201. Test row deleted afterwards.

## Notes for next agents
- `TextField` (form-fields) lacks `autoComplete`/`id` props — needed if you wire more public forms.
- `/api/beneficiary-requests` POST accepts optional phone; validates name+details server-side (matches my client rules).
- No package installs, no git, no dev-server restarts performed.
