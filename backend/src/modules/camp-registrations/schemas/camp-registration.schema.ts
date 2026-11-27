/**
 * Camp registration schemas — request definitions for /api/camp-registrations.
 *
 * Legacy read the query with URLSearchParams.get() (silent coercion) and
 * validated POST/PATCH bodies mid-handler, interleaved with camp/beneficiary
 * lookups, capacity and workflow gates (registeredVia is only validated
 * AFTER the capacity check on POST; status is only validated after the
 * existence lookup on PATCH), so the query schema reproduces the sp.get()
 * expressions verbatim and the body schemas are permissive envelopes — the
 * exact field checks live in the service.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?q[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/camp-registrations?q&campId&status&page&limit ──────────────────

/** Legacy pageParams(): parseInt(sp.get(...) ?? default, 10) || default, page
 *  floored at 1, limit clamped to [1, 200] (default 24). */
export const listCampRegistrationsQuerySchema = z.object({
  q: spGet.transform((v) => v?.trim() || undefined),
  campId: spGet.transform((v) => v || undefined),
  status: spGet.transform((v) => v || undefined),
  page: spGet.transform((v) => Math.max(1, parseInt(v ?? "1", 10) || 1)),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, parseInt(v ?? "24", 10) || 24))),
});
export type ListCampRegistrationsQuery = z.infer<typeof listCampRegistrationsQuerySchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}` and validated
 *  fields mid-handler between DB lookups and workflow/capacity gates. The
 *  service applies the exact legacy checks with the original error messages
 *  and ordering. */
export const createCampRegistrationBodySchema = z.any();
export type CreateCampRegistrationBody = Record<string, unknown>;

export const updateCampRegistrationBodySchema = z.any();
export type UpdateCampRegistrationBody = Record<string, unknown>;
