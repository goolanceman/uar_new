/**
 * Prescription schemas — request definitions for /api/prescriptions.
 *
 * Legacy validated POST/PATCH/dispense bodies mid-handler, interleaved with
 * beneficiary/encounter/camp/professional/inventory lookups (404-before-400
 * ordering) and with position-aware messages (`items[0].quantity …`,
 * `dispenses[1].itemId …`) that a schema-level parse cannot reproduce, so the
 * body schemas are permissive envelopes — the exact field checks live in the
 * service. The list query schema reproduces the legacy pageParams() and
 * searchParams.get() expressions verbatim.
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

// ─── GET /api/prescriptions?page&limit&beneficiaryId&campId&doctorId&status&q ──

/** Legacy pageParams(url, 50): Math.max(1, Math.trunc(Number(sp.get(...)) ||
 *  default)), limit clamped to [1, 200] (default 50). Number(null)/Number("")
 *  → 0 → the `|| default` fallback; Number("abc") → NaN → default.
 *  status/q stay raw — the service applies the exact legacy checks with the
 *  original messages. */
export const listPrescriptionsQuerySchema = z.object({
  page: spGet.transform((v) => Math.max(1, Math.trunc(Number(v) || 1))),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, Math.trunc(Number(v) || 50)))),
  beneficiaryId: spGet,
  campId: spGet,
  doctorId: spGet,
  status: spGet,
  q: spGet,
});
export type ListPrescriptionsQuery = z.infer<typeof listPrescriptionsQuerySchema>;

// ─── :id params ───────────────────────────────────────────────────────────────

/** The id reaches the existence lookup verbatim (no legacy trim/check). */
export const prescriptionIdParamSchema = z.object({
  id: z.string(),
});
export type PrescriptionIdParams = z.infer<typeof prescriptionIdParamSchema>;

// ─── POST / PATCH / dispense bodies ──────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}` and validated
 *  fields mid-handler between DB lookups (beneficiary/encounter/camp/
 *  professional existence, owner gates, per-line dispense validation against
 *  already-dispensed totals). The service applies the exact legacy checks
 *  with the original error messages and ordering. */
export const createPrescriptionBodySchema = z.any();
export type CreatePrescriptionBody = Record<string, unknown>;

export const updatePrescriptionBodySchema = z.any();
export type UpdatePrescriptionBody = Record<string, unknown>;

export const dispensePrescriptionBodySchema = z.any();
export type DispensePrescriptionBody = Record<string, unknown>;
