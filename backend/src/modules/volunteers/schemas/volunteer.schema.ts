/**
 * Volunteer schemas — /api/volunteers input.
 *
 * The legacy GET handler parsed the query with URLSearchParams over the raw
 * URL (status = sp.get("status") || undefined; analytics = sp.get("analytics")
 * === "1"; pagination triggered by a truthy page OR limit value) and the
 * PATCH handler validated body fields mid-handler AFTER the volunteer lookup
 * (404-before-400 ordering), so the body schema is a permissive envelope —
 * the exact field checks live in the service. Nothing the legacy accepted is
 * rejected here.
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

// ─── GET /api/volunteers ─────────────────────────────────────────────────────

export const listVolunteersQuerySchema = z.object({
  status: spGet.transform((v) => v || undefined),
  /** Analytics roll-up switch — legacy `sp.get("analytics") === "1"`. */
  analytics: spGet.transform((v) => v === "1"),
  /** Raw page/limit values — a truthy value switches the response to the
   *  { items, total, page, pages } envelope (legacy `if (pageRaw || limitRaw)`),
   *  empty strings do NOT (searchParams.get() returns "" — falsy). */
  page: spGet.transform((v) => v || undefined),
  limit: spGet.transform((v) => v || undefined),
});
export type ListVolunteersQuery = z.infer<typeof listVolunteersQuerySchema>;

// ─── PATCH /api/volunteers/:id ───────────────────────────────────────────────

/** Permissive body envelope: legacy shallow-copied `{ ...(req.body ?? {}) }`
 *  and validated known fields mid-handler (self-service field stripping for
 *  VOLUNTEERs, status whitelist, "Nothing to update"). The service applies
 *  the exact legacy checks. */
export const updateVolunteerBodySchema = z.any();
export type UpdateVolunteerBody = Record<string, unknown>;
