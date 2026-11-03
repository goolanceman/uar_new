# R2-B — Design System & Shells — Work Record

Agent: R2-B (Design System & Shells) · Date: Round 2
Ownership respected: only `globals.css`, `src/components/shared/**`, `admin-app.tsx`, `public/layout.tsx`, `portal-layout.tsx` touched. No package installs, no git, no dev-server restarts, no edits to `page.tsx`/APIs/hooks/lib/prisma.

## Files created (shared components — contracts implemented VERBATIM)

| File | Export | Notes |
|---|---|---|
| `src/components/shared/page-header.tsx` | `PageHeader({ title, description?, icon?, actions?, className? })` + default export | Icon chip `bg-primary/10 text-primary`; title `text-lg sm:text-xl font-semibold tracking-tight`; muted description; actions right-aligned via `sm:ml-auto`, full-width row on mobile; bottom border for the "sticky-feel" separation. |
| `src/components/shared/stat-card.tsx` | `StatCard({ label, value, icon?, accent?, hint?, loading?, className? })` + default export | Static `Record<StatAccent, { chip, glow }>` for `emerald|orange|cyan|fuchsia|amber|teal|lime|red|pink` (default emerald), all dark-safe (`bg-*-500/10 text-*-600 dark:text-*-400`). Card = `card-hover` + `bg-card` + decorative corner glow blur. `loading` → Skeleton chip + lines. Icon chip top-left, value `text-2xl font-bold`, muted uppercase label + hint. |
| `src/components/shared/data-field.tsx` | `DataField({ label, value, icon?, mono?, copy?, className? })` + default export | Label `text-[11px] uppercase tracking-wide` muted; value `break-words`; `mono` → `font-mono text-xs`; `copy` → ghost icon Button (clipboard with `execCommand` fallback) + sonner `toast.success("Copied")`, only when value is a non-empty string; renders `—` for null/undefined/"". |
| `src/components/shared/empty-state.tsx` | `EmptyState({ icon?, title, hint?, children?, className? })` + default export | Centered dashed-border card (`border-2 border-dashed bg-muted/30`), muted round icon chip, title, hint, children action slot. |
| `src/components/shared/section-card.tsx` | `SectionCard({ title, description?, icon?, actions?, children, className?, bodyClassName? })` + default export | shadcn `Card` (tightened `gap-4 py-5`, body/header `px-5`), header row = icon chip + title + description left, actions right; `CardContent` body. |

All five: `"use client"`, `cn()` from `@/lib/utils`, lucide-only icons where used, aria-hidden on decorative chips, mobile-first, dark-safe tokens. Existing exports (`theme-toggle`, `assistant-widget`) untouched.

## Files modified

1. **`src/app/globals.css`** (append-only, nothing removed):
   - `@media print` block: `body * { visibility: hidden }`, `.print-sheet` (+children) visible, absolute/inset/width, `.no-print { display:none !important }`.
   - Global `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }` in `@layer base`.
   - `::selection` emerald tint + `.dark ::selection` variant.
   - `.dark ::-webkit-scrollbar-thumb` / `:hover` darker oklch variants.
   - `.card-hover` (hover shadow + `-translate-y-2px`, light+dark shadow).
   - `.shimmer` + `@keyframes shimmer` (light gradient + darker `.dark` variant).
   - `.text-balance { text-wrap: balance }` (explicit, per contract).
   - `@media (prefers-reduced-motion: reduce)` kill-switch for animations/transitions/smooth-scroll.

2. **`src/components/admin/admin-app.tsx`**:
   - `<ThemeToggle align="end" />` mounted in header, left of the user chip.
   - User chip upgraded to DropdownMenu (avatar-initials chip + name, `sm+`): label header with name/email/role → "View public site" (`navigate("/")`) → destructive "Sign out" (same `logout(); navigate("/")` flow). A `sm:hidden` icon sign-out Button keeps logout reachable on mobile (replaces the old always-visible icon button).
   - Sidebar: active item `rounded-xl` + `ring-1 ring-primary/40`, `min-h-11` touch targets, focus-visible ring, hover now uses sidebar tokens (`sidebar-accent`); group labels refined (`text-[10px] font-bold tracking-[0.12em]`).
   - Footer line now exactly: "United Angel Reach · Bengaluru, Karnataka → serving all of India".
   - All 16 view keys byte-identical (only the render/className layers changed).

3. **`src/components/public/layout.tsx`**:
   - Header is now sticky with `glass` backdrop; nav links/routes unchanged (/, /campaigns, /impact, /green-corridor, /about, /volunteer, /contact + /donate, /login, /profile, /donor, /admin links preserved exactly).
   - `<ThemeToggle align="end" />` in desktop right-actions; second `<ThemeToggle align="start" />` inside mobile sheet "Appearance" section.
   - Mobile panel replaced with a proper shadcn `Sheet` (side="right"): sections **Explore** (the 7 nav links), **Appearance** (theme), **Account** (profile/portals/logout or sign-in+donate); Donate CTA kept.
   - Donate CTA made prominent: emerald solid + Heart icon, `dark:bg-emerald-500`.
   - Dark-mode audit: active-nav `bg-emerald-50 text-emerald-700` → `bg-emerald-500/10 text-emerald-700 dark:text-emerald-400`; emergency strip `bg-red-50/ring-red-200/bg-white/70` → `bg-red-500/5 ring-red-500/20 bg-background/70`; logout hovers → `hover:bg-red-500/10`; red text gets `dark:text-red-400`. No `bg-white`/`bg-gray-*`/hardcoded blacks left in the shell (scrim overlay no longer needed — Sheet provides its own).
   - Footer rebuilt as 4-column grid **About / Programmes / Transparency / Contact**: About keeps brand + blurb + 80G + 12A badges; Programmes keeps all campaign links; Transparency = Impact dashboard, Green Corridor live ops, All campaigns, Volunteer links + 80G utilisation note + extra official helplines (14446 · 1933 · 1962); Contact unchanged.
   - Helpline strip (emerald band above bottom bar): 112 · 108 · 1930 · 181 · 1098 with labels, all `tel:` links.
   - Bottom bar: "© {dynamic year} United Angel Reach Trust · All rights reserved" + "Made in Bengaluru, for all of India".

4. **`src/components/portal/portal-layout.tsx`**:
   - Topbar now: logo/brand + role badge + **section title** (active nav label, `md+`, muted with divider) | nav tabs (unchanged keys/behaviour) | **ThemeToggle** + "View site" + avatar dropdown with Profile/Logout (sign-out flow unchanged).
   - Dark audit: shell was already semantic-token based; no hardcoded colors found. Accent map unchanged (solid `-600` chips are dark-safe).

## Verification
- `bun run lint` → clean (no findings).
- `bunx tsc --noEmit` → 0 errors project-wide.
- `dev.log` → compiles OK, no runtime errors after edits.

## Deviations from contracts
- **None on signatures.** All 5 shared exports match the requested props/defaults exactly.
- Minor intentional choices: (a) `StatCard` value uses `truncate` for tidy KPI alignment (hint carries detail); (b) `DataField` copy button is `size-7` on `sm+` / `size-9` on touch (dense-grid ergonomics, matches existing ThemeToggle sizing precedent); (c) admin mobile keeps a dedicated sign-out icon button because the dropdown chip is `sm+` only; (d) `PageHeader` uses a bottom border instead of literal `position: sticky` so it can't collide with the fixed 56px shell headers of the three shells.
