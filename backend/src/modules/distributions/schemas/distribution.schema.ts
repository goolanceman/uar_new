/**
 * Distribution schemas — /api/distributions input.
 *
 * The legacy GET handler parsed the query with URLSearchParams over the raw
 * URL (never rejecting: bad numbers fell back to the default limit/offset)
 * and the POST/PATCH handlers validated body fields mid-handler AFTER the
 * auth gate (with the volunteer/recurring-need lookups interleaved —
 * 404/403-before-400 ordering), so those body schemas are permissive
 * envelopes — the exact field checks live in the service. Nothing the legacy
 * accepted is rejected here.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?type[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/distributions?type=&q=&from=&to=&…&limit=&offset= ──────────────

export const listDistributionsQuerySchema = z.object({
  /** legacy: if (sp.get("mine")) — any non-empty value (even "0") means mine */
  mine: z.preprocess((v) => {
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.length > 0;
  }, z.boolean()),
  /** legacy: sp.get("withTotals") === "1" */
  withTotals: z.preprocess((v) => (Array.isArray(v) ? v[0] : v) === "1", z.boolean()),
  /** Raw pass-through — the legacy buildWhere trims/uppercases/filters these
   *  itself (type list, date parsing); the repository keeps that exact code. */
  type: spGet,
  q: spGet,
  from: spGet,
  to: spGet,
  volunteerId: spGet,
  beneficiaryId: spGet,
  campaignId: spGet,
  kitBatchId: spGet,
  itemId: spGet,
  /** legacy: Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 50))) */
  limit: z
    .preprocess((v) => Math.trunc(Number(Array.isArray(v) ? v[0] : v) || 50), z.number())
    .transform((n) => Math.min(500, Math.max(1, n))),
  /** legacy: Math.max(0, Math.trunc(Number(sp.get("offset")) || 0)) */
  offset: z
    .preprocess((v) => Math.trunc(Number(Array.isArray(v) ? v[0] : v) || 0), z.number())
    .transform((n) => Math.max(0, n)),
});
export type ListDistributionsQuery = z.infer<typeof listDistributionsQuerySchema>;

// ─── Params ──────────────────────────────────────────────────────────────────

/** Extraction-only param schema — the service renders the legacy 404. */
export const distributionIdParamSchema = stringIdParamSchema;
export type DistributionIdParams = z.infer<typeof distributionIdParamSchema>;

// ─── POST /api/distributions ─────────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  type/quantity/location/value/kitQuantity mid-handler with the volunteer and
 *  recurring-need lookups interleaved. The service applies the exact legacy
 *  coercions and checks in the original order. */
export const createDistributionBodySchema = z.any();
export type CreateDistributionBody = Record<string, unknown>;

// ─── PATCH /api/distributions/:id ────────────────────────────────────────────

/** Permissive body envelope: the ownership 404/403 fire BEFORE body
 *  processing — service keeps that order. */
export const updateDistributionBodySchema = z.any();
export type UpdateDistributionBody = Record<string, unknown>;
