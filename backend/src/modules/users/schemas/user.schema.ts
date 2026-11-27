/**
 * User (admin directory) schemas — request definitions for /api/users*.
 *
 * The legacy handlers validated body fields sequentially with exact messages
 * interleaved with DB lookups (duplicate-email checks, last-admin guards), so
 * the body schemas are permissive envelopes and every field check stays in
 * the service in the legacy order. Query filters pass through raw strings —
 * the legacy trimmed only `q`.
 */
import { z } from "zod";

// ─── GET /api/users?q&role&status ────────────────────────────────────────────

/** Legacy: sp.get("q")?.trim() etc — absent → undefined; the service trims q. */
export const listUsersQuerySchema = z.object({
  q: z
    .any()
    .optional()
    .transform((v) => (typeof v === "string" && v ? v : undefined)),
  role: z
    .any()
    .optional()
    .transform((v) => (typeof v === "string" && v ? v : undefined)),
  status: z
    .any()
    .optional()
    .transform((v) => (typeof v === "string" && v ? v : undefined)),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// ─── POST/PATCH bodies (sequential checks — see service) ─────────────────────

/** Permissive body envelope: the legacy handlers validated every field
 *  mid-flow with exact messages and ordering (required → role → email →
 *  password → duplicates → last-admin guards), preserved in the service. */
export const userBodySchema = z.any();
export type UserBody = Record<string, unknown>;

// ─── Params (cuid ids — Express only matches non-empty) ──────────────────────

export const userIdParamSchema = z.object({
  id: z.string().min(1),
});
export type UserIdParams = z.infer<typeof userIdParamSchema>;
