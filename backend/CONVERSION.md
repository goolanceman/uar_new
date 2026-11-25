# Backend Conversion Guide — Next.js route handler → Express router

All API routes are being converted from Next.js route handlers
(`src/app/api/**/route.ts`) into a standalone Express server (`backend/`).
Read the REFERENCE conversions first:

- `backend/src/routes/auth.ts` — login/register/me/logout/profile patterns
- `backend/src/routes/donations.ts` — dynamic [id] params, query params, body, transactions, fire-and-forget emails

## File mapping

- One router file per top-level API module: `backend/src/routes/<module>.ts`
  exporting `export const router = Router()`.
- `src/app/api/<mod>/route.ts`           → `router.get("/", …)` / `router.post("/", …)`
- `src/app/api/<mod>/[id]/route.ts`      → `router.get("/:id", …)`, `router.patch("/:id", …)`, `router.delete("/:id", …)`
- `src/app/api/<mod>/[id]/sub/route.ts`  → `router.post("/:id/sub", …)` (same router file)
- Nested modules like `src/app/api/food/events/[id]/expenses/route.ts`
  → `router.post("/events/:id/expenses", …)` inside `food.ts`.
- NEVER edit `backend/src/index.ts` — routers are mounted centrally at integration time.

## Mechanical conversion rules (apply to every handler)

| Next.js | Express |
|---|---|
| `export async function GET(req: NextRequest)` | `router.get("/", async (req, res) => { … })` |
| `export async function PATCH(req: NextRequest, ctx: Ctx)` + `const { id } = await ctx.params` | `router.patch("/:id", async (req, res) => { … const { id } = req.params; … })` (delete `type Ctx`) |
| `const body = await req.json().catch(() => ({}));` | `const body = req.body ?? {};` |
| `new URL(req.url).searchParams` / `req.nextUrl.searchParams` | `new URL(req.url, "http://localhost").searchParams` |
| `req.headers.get("x")` | `(req.headers["x"] as string \| undefined)` |
| `await getSession()` | `getSession(req)` (sync) |
| `await requireAuth()` | `requireAuth(req)` (sync) |
| `await requireRole("ADMIN", …)` | `requireRole(req, "ADMIN", …)` (sync) |
| `await isAuthenticated()` | `isAuthenticated(req)` |
| `await setSession(session)` | `setSession(res, session)` |
| `await clearSession()` | `clearSession(res)` |
| `return json(data)` | `return json(res, data)` |
| `return json(data, 201)` | `return json(res, data, 201)` |
| `return handleError(e)` | `return handleError(e, res)` |
| `import { NextRequest } from "next/server"` | remove |
| `export const dynamic = "force-dynamic";` | remove |
| `Response.json(...)` / `NextResponse.json(...)` raw usage | `json(res, ...)` or `res.status(n).json(...)` |
| HTML/binary responses (`new Response(html, {headers})`) | `res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(html)` |

Keep ALL business logic, comments, regexes, validation, activity logging,
notification side-effects EXACTLY as in the original. Copy code verbatim
except for the mechanical changes above.

## Libraries

- `@/lib/db`, `@/lib/session`, `@/lib/rate-limit`, `@/lib/files`, etc. already
  exist in `backend/src/lib/` — import them with the SAME `@/lib/...` paths
  (tsconfig paths are configured). DO NOT modify existing backend libs.
- `backend/src/lib/certificates-pdf.ts` and `backend/src/lib/api-org.ts` are
  the copies of the old `src/app/api/_lib/*` (import them from `@/lib/…`).
- If an import is missing from `backend/src/lib/`, copy the file from
  `src/lib/<name>.ts` into `backend/src/lib/<name>.ts` (check `ls` first;
  another agent may have copied it — do not duplicate).
- Multipart uploads (files routes): use `multipart` middleware + `readForm(req)`
  from `@/lib/multipart` — see that file's docs; `saveUpload(file)` keeps its
  native `File` signature.

## Verification (mandatory)

After writing your routers:
```
cd backend && bun run typecheck
```
Fix every error in YOUR files (and in any lib file you had to copy). Never
touch files under `src/` (the frontend) or another agent's routers. Do not
create test scripts at the repo root.

## Report format

Finish with: list of routers created, list of route files converted, any
routes intentionally skipped, and the typecheck result.
