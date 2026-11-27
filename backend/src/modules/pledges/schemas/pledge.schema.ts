/**
 * Pledge schemas — Zod definitions for every /api/pledges request.
 *
 * Legacy parsed the list query with URLSearchParams.get() (first value for
 * repeated params, silent coercion) and validated the PATCH body fields
 * mid-handler AFTER the pledge lookup and ownership gate (404 wins over 400),
 * so the query schema reproduces the sp.get() expressions verbatim and the
 * body schema is a permissive envelope — the exact field check ("status must
 * be ACTIVE, COMPLETED or CANCELLED") lives in the service.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?status[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── Admin list ──────────────────────────────────────────────────────────────

export const listPledgesQuerySchema = z.object({
  status: spGet.transform((v) => v || undefined),
  q: spGet.transform((v) => v || undefined),
});
export type ListPledgesQuery = z.infer<typeof listPledgesQuerySchema>;

// ─── Id params ───────────────────────────────────────────────────────────────

/** Pledge ids are cuid strings — `:id` segments are never empty. */
export const pledgeIdParamSchema = stringIdParamSchema;
export type PledgeIdParams = z.infer<typeof pledgeIdParamSchema>;

// ─── PATCH body ──────────────────────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and checked the
 *  status field only after the pledge lookup and ownership check. The service
 *  applies the exact legacy check with the original error message. */
export const updatePledgeBodySchema = z.any();
export type UpdatePledgeBody = Record<string, unknown>;
