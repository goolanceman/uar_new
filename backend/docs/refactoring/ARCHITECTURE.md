# Enterprise Refactoring — Agent Execution Guide

This document is the binding template for refactoring route modules into the
target architecture. The pilot module is `src/modules/faqs` (+ thin
`src/routes/faqs.ts`) — read it first; it is the canonical example.

## Target flow

```
src/routes/<name>.ts            → endpoint definitions ONLY (preserved export path!)
src/modules/<name>/index.ts     → composition root (wires repo → service → controller)
src/modules/<name>/controllers/ → HTTP layer only
src/modules/<name>/services/    → business logic only
src/modules/<name>/repositories/→ interface + Prisma implementation
src/modules/<name>/schemas/     → Zod request schemas
```

## Hard rules (violations = rejected work)

1. **Preserve behavior 100%.** Same routes, methods, paths, status codes,
   response bodies, error messages, log event names, cache keys, ordering of
   side effects. When in doubt, match the legacy code exactly.
2. **Respect the layer map.** The former `src/lib/**` has been dissolved:
   - `src/infrastructure/**` — auth/session, logging, cache + rate-limit,
     storage (+ upload-token signing), media serializers, external services
     (Agora, Pusher WS server), uploads (multer), notifications (email/SMS/
     WhatsApp/gateway + SSE hub), database (Prisma client, transactions)
   - `src/jobs/workers/**` — background workers (video transcoder)
   - `src/domains/**` — shared business logic used by multiple modules
     (community/*, charity/*, codes, settings, recurring, files, …)
   - `src/modules/<name>/services/*.domain.ts` — module-private domain logic
   - `src/shared/**` — errors, middleware, validators, utils, constants
   These are read-only for module refactors. Import from them freely. The
   only files a module refactor may create/modify:
   - `src/routes/<your-module>.ts` (rewrite thin — keep `export const router`)
   - `src/modules/<your-module>/**` (create)
3. **Route files must not contain:** `db.` calls, business logic, data
   mapping, try/catch, `handleError`, inline validation. Only middleware
   registration + controller references + `export const router`.
4. **Controllers must not:** call `db.` directly, contain business rules.
   They extract `req.session!` / validated data, call the service, send the
   response, and forward errors via `next(error)` inside try/catch.
5. **Services must not:** import express, touch req/res, or contain Prisma
   calls. They enforce rules, log domain events, throw app errors.
6. **Repositories** own ALL Prisma access for the module. Wrap operations
   that can fail with unique/FK violations in `mapPrismaError(() => ...)`.
7. **Zod schemas** must reproduce the legacy validation semantics exactly:
   same required/optional fields, same error messages, same coercions
   (`Number(...)`, `String(...)` → `z.coerce.number()` / `z.string()`).
   If legacy silently accepted something, the schema must too. Do not
   invent new rejections. Read controllers via `validatedBody/Query/Params`.
8. **Auth gates:** if the legacy handler called `await requireAuth(req)` /
   `requireRole(...)` / `requireElevated(req)` as its FIRST step, use the
   middleware wrappers `authenticate` / `authorize(...roles)` / `elevated`
   from `@/shared/middleware/auth` on the route. If the gate happens
   mid-handler (after other work), keep the call inside the controller to
   preserve ordering. The middleware attaches the session as `req.session`.
9. **Special middleware** (multer uploads, raw-body webhooks, stream helpers)
   stays on the route registration in its original position.
10. Do not touch any other route file, module, or test. Do not run the full
    test suite (orchestrator runs it). Verify with `npx tsc --noEmit`.

## Template (copy the faqs module structure)

- `schemas/<name>.schema.ts`: one schema per request shape; reuse
  `pageQuerySchema()` / `idParamSchema` / field schemas from
  `@/shared/schemas/common` when the semantics match exactly.
- `repositories/<name>.repository.interface.ts`: contract with row/DTO types.
- `repositories/<name>.repository.ts`: `PrismaXRepository implements X`.
- `services/<name>.service.ts`: constructor-injects the interface.
- `controllers/<name>.controller.ts`: constructor-injects the service;
  class-based arrow-function handlers.
- `index.ts`: module composition root exporting the controller instance
  (`export const <name>Controller = new XController(new XService(repo))`)
  plus class exports.
- `src/routes/<name>.ts`: `export const router = Router()` with
  `validate({...})`, auth middleware, controller handlers — in the EXACT
  legacy route order.
