/**
 * Encounter schemas — request definitions for /api/encounters.
 *
 * Legacy read the query with URLSearchParams.get() (Number()-based silent
 * coercion) and validated POST/PATCH bodies mid-handler, interleaved with
 * beneficiary/camp/professional lookups and owner gates, so the query schema
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

// ─── GET /api/encounters?page&limit&beneficiaryId&campId&doctorId&status&from&to ──

/** Legacy pageParams(): Math.max(1, Math.trunc(Number(sp.get(...)) || default)),
 *  limit clamped to [1, 200] (default 50). Number(null)/Number("") → 0 → the
 *  `|| default` fallback; Number("abc") → NaN → default. status/from/to stay
 *  raw — the service applies the exact legacy checks with original messages. */
export const listEncountersQuerySchema = z.object({
  page: spGet.transform((v) => Math.max(1, Math.trunc(Number(v) || 1))),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, Math.trunc(Number(v) || 50)))),
  beneficiaryId: spGet,
  campId: spGet,
  doctorId: spGet,
  status: spGet,
  from: spGet,
  to: spGet,
});
export type ListEncountersQuery = z.infer<typeof listEncountersQuerySchema>;

// ─── :id params ───────────────────────────────────────────────────────────────

/** The id reaches the existence lookup verbatim (no legacy trim/check). */
export const encounterIdParamSchema = z.object({
  id: z.string(),
});
export type EncounterIdParams = z.infer<typeof encounterIdParamSchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}` and validated
 *  fields mid-handler between DB lookups (beneficiary/camp existence,
 *  professional profile gate, signed-encounter amendment flow). The service
 *  applies the exact legacy checks with the original error messages and
 *  ordering. */
export const createEncounterBodySchema = z.any();
export type CreateEncounterBody = Record<string, unknown>;

export const updateEncounterBodySchema = z.any();
export type UpdateEncounterBody = Record<string, unknown>;
