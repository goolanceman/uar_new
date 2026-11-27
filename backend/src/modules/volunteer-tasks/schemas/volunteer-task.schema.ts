/**
 * Volunteer task schemas — /api/volunteer-tasks input.
 *
 * The legacy GET handler parsed the query with URLSearchParams over the raw
 * URL (mine = truthy presence flag; filters = sp.get(...) || undefined;
 * q = sp.get("q")?.trim() || undefined; pagination triggered by a truthy
 * page OR limit value). The POST/PATCH handlers validated body fields
 * mid-handler AFTER the auth gate (with the volunteer/task lookups
 * interleaved), so those body schemas are permissive envelopes — the exact
 * field checks live in the service. Nothing the legacy accepted is rejected
 * here.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?status[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/volunteer-tasks ────────────────────────────────────────────────

export const listVolunteerTasksQuerySchema = z.object({
  /** Truthy presence flag — legacy `if (sp.get("mine"))` ("" does NOT count). */
  mine: spGet.transform((v) => v !== undefined && v !== ""),
  status: spGet.transform((v) => v || undefined),
  type: spGet.transform((v) => v || undefined),
  volunteerId: spGet.transform((v) => v || undefined),
  refType: spGet.transform((v) => v || undefined),
  refId: spGet.transform((v) => v || undefined),
  /** Legacy `sp.get("q")?.trim() || undefined`. */
  q: spGet.transform((v) => (v !== undefined ? v.trim() || undefined : undefined)),
  /** Raw page/limit values — a truthy value switches the response to the
   *  { items, total, page, pages } envelope (legacy `if (pageRaw || limitRaw)`),
   *  empty strings do NOT (searchParams.get() returns "" — falsy). */
  page: spGet.transform((v) => v || undefined),
  limit: spGet.transform((v) => v || undefined),
});
export type ListVolunteerTasksQuery = z.infer<typeof listVolunteerTasksQuerySchema>;

// ─── POST /api/volunteer-tasks ───────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  known fields mid-handler (title, volunteerId, scheduledDate, type,
 *  priority, refType/refId) with the volunteer lookup interleaved. The
 *  service applies the exact legacy checks in the original order. */
export const createVolunteerTaskBodySchema = z.any();
export type CreateVolunteerTaskBody = Record<string, unknown>;

// ─── PATCH /api/volunteer-tasks/:id ──────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  notes/status mid-handler after the task lookup (404-before-400 ordering).
 *  The service applies the exact legacy checks. */
export const updateVolunteerTaskBodySchema = z.any();
export type UpdateVolunteerTaskBody = Record<string, unknown>;
