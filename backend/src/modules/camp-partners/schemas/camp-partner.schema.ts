/**
 * Camp partner schemas — request definitions for /api/camp-partners.
 *
 * Legacy read the query with URLSearchParams.get() (silent coercion) and
 * validated the POST/PATCH bodies mid-handler, interleaved with camp/org
 * lookups (the role check runs AFTER the camp+org 404s) and with a HOSPITAL
 * ownership gate before the status checks, so the query schema reproduces the
 * sp.get() expressions verbatim and the body schemas are permissive envelopes
 * — the exact field checks live in the service.
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

// ─── GET /api/camp-partners?campId&status&page&limit ─────────────────────────

/** Legacy pageParams(): parseInt(sp.get(...) ?? default) || default, page
 *  floored at 1, limit clamped to [1, 200] (default 24). */
export const listCampPartnersQuerySchema = z.object({
  campId: spGet.transform((v) => v || undefined),
  status: spGet.transform((v) => v || undefined),
  page: spGet.transform((v) => Math.max(1, parseInt(v ?? "1", 10) || 1)),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, parseInt(v ?? "24", 10) || 24))),
});
export type ListCampPartnersQuery = z.infer<typeof listCampPartnersQuerySchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}`, coerced fields
 *  with String() and validated known fields mid-handler after the camp/org
 *  lookups (POST) and the ownership gate (PATCH). The service applies the
 *  exact legacy checks with the original error messages and ordering. */
export const createCampPartnerBodySchema = z.any();
export type CreateCampPartnerBody = Record<string, unknown>;

export const updateCampPartnerBodySchema = z.any();
export type UpdateCampPartnerBody = Record<string, unknown>;
