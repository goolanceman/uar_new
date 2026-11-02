# C-1 — campaign-data.ts (public content core) — COMPLETED

## Deliverable
- File: `src/components/public/campaign-data.ts` (ONLY file touched in src/)
- Size: **116,740 bytes**
- Zero imports (pure data + types), well-commented per-section.

## Shape compliance (EXACT per mission spec)
- Exports `interface CampaignContent` + `export const CAMPAIGN_CONTENT: Record<string, CampaignContent>`.
- `helpline?: string` (plain number string — NOT the old `{name,number}` object shape), `heroTag` present, no `short` field.
- `keyFacts: {value, suffix?, label}` — first item authored to fit the col-span-2 hero stat.
- `charts` inline type `{title, desc?, type, data, xKey?, nameKey, valueKey, colors?}` — local per-accent palette constants defined in-file (no imports). Grouped-bar (green-corridor with/without) authored in long-format rows using `xKey` + `nameKey` + `valueKey`.
- Accents all exist in `shared.tsx` ACCENT_MAP; icons are lucide names; helplines official only (112/108/1930/181/1091/1098/14446/14416/1933/1962).

## Slugs written (9/9, keys = DB slugs)
`anti-drug` (orange/shield-alert/14446) · `cyber-crime` (cyan/smartphone/1930) · `women-safety` (fuchsia/heart-handshake/181) · `child-safety` (amber/baby/1098) · `medicine-adoption` (teal/pill) · `animal-welfare` (lime/paw-print/1962) · `green-corridor` (red/siren/108) · `ration-kits` (emerald/package) · `sanitary-pads` (pink/flower-2)

## Verification
- `bunx tsc --noEmit 2>&1 | grep campaign-data` → **no matches (zero type errors in this file)**.
- NOTE for consumers: mission spec made `helpline` a plain string; the pre-existing `campaign-detail.tsx` (lines ~216-220) still used `content.helpline.number/.name` from the old shape — those consumer-side errors belong to the public-pages agent (5-a-1) per mission ("other errors are NOT yours to fix"). Consumers should use `tel:${content.helpline}` and render the number directly.
- All 5 consumers import only `CAMPAIGN_CONTENT` (verified by grep) — no other symbols removed/needed.
- Did NOT run dev server, did NOT modify any other file.
