/**
 * Camp staff schemas — request definitions for /api/camp-staff.
 *
 * Legacy read the query with URLSearchParams.get() (silent coercion) and
 * validated POST/PATCH bodies mid-handler, interleaved with camp/professional/
 * volunteer lookups and role gates, so the query schemas reproduce the
 * sp.get() expressions verbatim and the body schemas are permissive
 * envelopes — the exact field checks live in the service. DELETE keeps its
 * query-parameter id (checked in the service for the legacy message).
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?campId[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/camp-staff?campId&status&page&limit ────────────────────────────

/** Legacy pageParams(): parseInt(sp.get(...) ?? default, 10) || default, page
 *  floored at 1, limit clamped to [1, 200] (default 24). */
export const listCampStaffQuerySchema = z.object({
  campId: spGet.transform((v) => v || undefined),
  status: spGet.transform((v) => v || undefined),
  page: spGet.transform((v) => Math.max(1, parseInt(v ?? "1", 10) || 1)),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, parseInt(v ?? "24", 10) || 24))),
});
export type ListCampStaffQuery = z.infer<typeof listCampStaffQuerySchema>;

// ─── DELETE /api/camp-staff?id= ──────────────────────────────────────────────

/** DELETE keeps its query-parameter id (as in the original route handler).
 *  The "id query parameter is required" check lives in the service so the
 *  legacy message is preserved verbatim. */
export const deleteCampStaffQuerySchema = z.object({ id: spGet });
export type DeleteCampStaffQuery = z.infer<typeof deleteCampStaffQuerySchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}` and validated
 *  fields mid-handler between DB lookups (camp existence, partner gates,
 *  professional/volunteer existence). The service applies the exact legacy
 *  checks with the original error messages and ordering. */
export const createCampStaffBodySchema = z.any();
export type CreateCampStaffBody = Record<string, unknown>;

export const updateCampStaffBodySchema = z.any();
export type UpdateCampStaffBody = Record<string, unknown>;
