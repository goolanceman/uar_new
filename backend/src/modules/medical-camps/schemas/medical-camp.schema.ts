/**
 * Medical camp schemas — request definitions for /api/medical-camps.
 *
 * Legacy read the query with URLSearchParams.get() (silent coercion) and
 * validated POST/PATCH bodies mid-handler, interleaved with the campaign
 * existence lookup and lifecycle-transition checks, so the query schema
 * reproduces the sp.get() expressions verbatim and the body schemas are
 * permissive envelopes — the exact field checks live in the service.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?page[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/medical-camps?q&status&city&campaignId&upcoming=1&withCounts=1&page&limit ──

/** Legacy pageParams(): parseInt(sp.get(...) ?? default, 10) || default, page
 *  floored at 1, take clamped to [1, 200] (default 24). */
export const listCampsQuerySchema = z.object({
  q: spGet.transform((v) => v?.trim() || undefined),
  status: spGet.transform((v) => v || undefined),
  city: spGet.transform((v) => v || undefined),
  campaignId: spGet.transform((v) => v || undefined),
  upcoming: spGet.transform((v) => v === "1"),
  withCounts: spGet.transform((v) => v === "1"),
  page: spGet.transform((v) => Math.max(1, parseInt(v ?? "1", 10) || 1)),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, parseInt(v ?? "24", 10) || 24))),
});
export type ListCampsQuery = z.infer<typeof listCampsQuerySchema>;

// ─── :id params ───────────────────────────────────────────────────────────────

/** The id reaches the existence lookup verbatim (no legacy trim/check). */
export const campIdParamSchema = z.object({
  id: z.string(),
});
export type CampIdParams = z.infer<typeof campIdParamSchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}` and validated
 *  fields mid-handler between DB lookups (campaign existence, lifecycle
 *  transition against the loaded row). The service applies the exact legacy
 *  checks with the original error messages and ordering. */
export const createCampBodySchema = z.any();
export type CreateCampBody = Record<string, unknown>;

export const updateCampBodySchema = z.any();
export type UpdateCampBody = Record<string, unknown>;
