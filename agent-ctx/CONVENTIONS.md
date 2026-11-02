# United Angel Reach — Build Conventions (READ FIRST)

## Project
- Next.js 16 App Router + TypeScript + Tailwind v4 + shadcn/ui (new-york) at `src/components/ui`.
- Prisma + SQLite. Server code imports: `import { db } from "@/lib/db"`.
- The sandbox exposes ONE route `/`. ALL navigation is hash-based via `src/lib/router.tsx`:
  - `navigate("/campaigns")`, `<Link href="/campaigns">`, `useRoute()` → `{path, segments, query, key}`, `matchPath("/campaigns/:slug", segments)`.

## Brand & style
- Trust: **United Angel Reach (UAR)**, HQ Bengaluru, Karnataka — vision: scale to all of India.
- White + green (emerald primary). NEVER use indigo/blue Tailwind classes.
- Campaign accent palette (use real tailwind classes like `bg-orange-500`, `text-teal-700`, `border-amber-200`, `bg-rose-50`):
  - anti-drug `orange` · cyber-crime `cyan` · women-safety `fuchsia` · child-safety `amber` · medicine-adoption `teal` · animal-welfare `lime` · green-corridor `red` · ration-kits `emerald` · sanitary-pads `pink`
- Icons: lucide-react only.
- Layout: mobile-first; root wrapper `min-h-screen flex flex-col`; footer `mt-auto`; cards `p-6`, gaps `gap-4/gap-6`; long lists `max-h-96 overflow-y-auto scrollbar-thin`; touch targets ≥44px; aria-labels on icon buttons.
- Components are client components → add `"use client"` at top of every component file.

## Data fetching (standard)
- Use `src/lib/api-client.ts`: `get/post/patch/del` (throw Error with server message).
- Pattern: `const [data, setData] = useState(...)` + `useEffect` + a `load()` async fn. Show skeletons/spinners while loading, empty states, and toast on error (`toast.error` from `sonner`).
- Do NOT use react-query/zustand. Keep hooks local.

## Auth (client)
- `useAuth()` from `@/hooks/use-auth` → `{ user, loading, login, register, logout, refresh }`.
- `user.role`: ADMIN | VOLUNTEER | DONOR | BENEFICIARY. `user.status`: ACTIVE | PENDING | SUSPENDED.
- Demo accounts: admin@unitedangelreach.org/Admin@123 · donor@demo.org/Donor@123 · volunteer@demo.org/Volun@123 · applicant@demo.org/Temp@12345 (PENDING volunteer).

## MDM dropdowns (client)
- `useMasters("CATEGORY")` → `{ options: {value,label}[], loading }` (has fallbacks). `labelOf(options, value)` → label.

## Server API conventions (for API agents)
- File = `src/app/api/<resource>/route.ts` (+ `[id]/route.ts`). Export `async function GET/POST/PATCH/DELETE(req: Request)`.
- Helpers from `@/lib/session`: `getSession()`, `setSession()`, `clearSession()`, `hashPassword()`, `verifyPassword()`, `ApiError`, `json(data, status)`, `handleError(e)`, `requireAuth()`, `requireRole(...roles)`, `logActivity(actor, action, entity, detail)`.
- Wrap handler body in try/catch → `return handleError(e)`. Return arrays/objects directly via `json(...)`. Errors: `{ error: string }` with 400/401/403/404.
- Query params via `new URL(req.url).searchParams`.
- Prisma `db.<model>.findMany/findUnique/create/update/delete`, SQLite has no mode="insensitive" — filter with `contains`.
- Add `export const dynamic = "force-dynamic";` to every API route.
- Never import client code (`api-client`, `use-auth`) in API routes.

## i18n/tone
- English, warm & practical. ₹ amounts via `formatINR`. Dates via `formatDate/formatDateTime/timeAgo` (`@/lib/utils` also has `cn`, `formatNumber`, `titleCase`).

## Helplines (official, use exactly)
112 emergency · 108 ambulance · 1930 cyber fraud (cybercrime.gov.in) · 181 women (Sakhi/Abhayam) · 1091 women police · 1098 CHILDLINE · 14446 de-addiction · 14416 Tele-MANAS · 1933 drug trafficking (NCB MANAS) · 1962 animal rescue (AWBI).
