/**
 * Volunteer assignment schemas — request definitions for
 * /api/volunteer-assignments.
 *
 * Legacy read the query with URLSearchParams.get() and validated both query
 * and body fields mid-handler with DB lookups interleaved (distribution/
 * campaign 404s run between the refId and volunteer checks), so the schemas
 * are permissive envelopes — the exact checks (and their order/messages)
 * live in the service.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?refId[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/volunteer-assignments?refType=&refId= (ADMIN) ──────────────────

export const listAssignmentsQuerySchema = z.object({
  refType: spGet.transform((v) => (v ? v.trim().toUpperCase() : "")),
  refId: spGet.transform((v) => (v ? v.trim() : "")),
});
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;

// ─── POST body ───────────────────────────────────────────────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}`, coerced fields
 *  with String() and validated them mid-handler between the record/volunteer
 *  lookups. The service applies the exact legacy checks with the original
 *  error messages and ordering. */
export const createAssignmentBodySchema = z.any();
export type CreateAssignmentBody = Record<string, unknown>;
