/**
 * Kit batch schemas — /api/kit-batches input.
 *
 * The legacy GET handler parsed the query with URLSearchParams over the raw
 * URL (status = sp.get("status") || undefined) and the POST/PATCH handlers
 * validated body fields mid-handler AFTER the auth gate (with the template /
 * batch lookups interleaved), so those body schemas are permissive envelopes
 * — the exact field checks live in the service. Nothing the legacy accepted
 * is rejected here.
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

// ─── GET /api/kit-batches ────────────────────────────────────────────────────

export const listKitBatchesQuerySchema = z.object({
  status: spGet.transform((v) => v || undefined),
});
export type ListKitBatchesQuery = z.infer<typeof listKitBatchesQuerySchema>;

// ─── POST /api/kit-batches ───────────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  known fields mid-handler (templateId, name, totalUnits, instructions)
 *  with the template lookup interleaved. The service applies the exact
 *  legacy checks in the original order. */
export const createKitBatchBodySchema = z.any();
export type CreateKitBatchBody = Record<string, unknown>;

// ─── PATCH /api/kit-batches/:id ──────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  name/instructions/status mid-handler after the batch lookup
 *  (404-before-400 ordering). The service applies the exact legacy checks. */
export const updateKitBatchBodySchema = z.any();
export type UpdateKitBatchBody = Record<string, unknown>;
