/**
 * Volunteer application schemas — /api/volunteer-applications input.
 *
 * The legacy handlers parsed the query with URLSearchParams over the raw URL
 * (mine === "1"; status/q read via sp.get()) and validated the body fields
 * mid-handler AFTER the DB lookups (session-profile fallback on POST,
 * 404-before-400 and the owner/admin branch split on PATCH), so the body
 * schemas are permissive whole-body envelopes — the exact field rules and
 * their messages live in the service. Nothing the legacy accepted is
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

// ─── GET /api/volunteer-applications ─────────────────────────────────────────

export const listApplicationsQuerySchema = z.object({
  /** Legacy `sp.get("mine") === "1"` — switches to the caller's own list. */
  mine: spGet.transform((v) => v === "1"),
  /** Raw status filter — legacy applied it verbatim when truthy (no trim). */
  status: spGet.transform((v) => v || undefined),
  /** Search term — legacy read sp.get("q")?.trim() and filtered when truthy. */
  q: spGet.transform((v) => (v !== undefined ? v.trim() : undefined)),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

// ─── POST /api/volunteer-applications ────────────────────────────────────────

/** Permissive whole-body envelope: the signed-in profile fills omitted
 * identity fields and every field rule (with its exact legacy 400 message)
 * runs in the service after the session-user lookup. */
export const applyBodySchema = z.any();
export type ApplyBody = Record<string, unknown>;

// ─── PATCH /api/volunteer-applications/:id ───────────────────────────────────

/** Permissive whole-body envelope: the owner resubmit merges the body over
 * the stored record and the admin review machine validates status/notes
 * mid-handler (legacy order) — all in the service. */
export const updateApplicationBodySchema = z.any();
export type UpdateApplicationBody = Record<string, unknown>;
