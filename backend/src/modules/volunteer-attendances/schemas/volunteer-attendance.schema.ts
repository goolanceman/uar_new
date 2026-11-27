/**
 * Volunteer attendance schemas — /api/volunteer-attendances input.
 *
 * Legacy parsed the query with URLSearchParams.get() (silent coercion, limit
 * clamped via parseInt) and validated the POST body fields mid-handler,
 * branching on the caller's role AFTER the volunteer lookups, so the query
 * schema reproduces the sp.get() expressions verbatim and the body schema is
 * a permissive envelope — the exact field checks live in the service.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?volunteerId[a]=b) were different keys to
 * searchParams, so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── Public register (ADMIN | VOLUNTEER) ─────────────────────────────────────

export const listAttendancesQuerySchema = z.object({
  volunteerId: spGet.transform((v) => v || undefined),
  from: spGet.transform((v) => v || undefined),
  to: spGet.transform((v) => v || undefined),
  // parseInt(sp.get("limit") ?? "200", 10) || 200, clamped to [1, 500].
  limit: spGet.transform((v) => Math.min(500, Math.max(1, parseInt(v ?? "200", 10) || 200))),
});
export type ListAttendancesQuery = z.infer<typeof listAttendancesQuerySchema>;

// ─── POST body ───────────────────────────────────────────────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}` and validated known
 *  fields mid-handler after the volunteer lookups (role-branched). The service
 *  applies the exact legacy checks with the original error messages. */
export const createAttendanceBodySchema = z.any();
export type CreateAttendanceBody = Record<string, unknown>;
