/**
 * Ambulance schemas — request definitions for /api/ambulances.
 *
 * Legacy coerced every body field with String() mid-handler and validated
 * them after the caller's role gate, with a code-clash lookup between the
 * code checks, so the body schemas are permissive envelopes — the exact
 * checks (and their order/messages) live in the service. The query schema
 * reproduces the sp.get() expressions verbatim.
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

// ─── GET /api/ambulances?status=&type=&q= (auth) ─────────────────────────────

export const listAmbulancesQuerySchema = z.object({
  status: spGet.transform((v) => v || undefined),
  type: spGet.transform((v) => v || undefined),
  q: spGet.transform((v) => v?.trim() || undefined),
});
export type ListAmbulancesQuery = z.infer<typeof listAmbulancesQuerySchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}`, coerced fields
 *  with String() and validated them mid-handler (PATCH checks each present
 *  field between the existence and clash lookups). The service applies the
 *  exact legacy checks with the original error messages and ordering. */
export const createAmbulanceBodySchema = z.any();
export type CreateAmbulanceBody = Record<string, unknown>;

export const updateAmbulanceBodySchema = z.any();
export type UpdateAmbulanceBody = Record<string, unknown>;
