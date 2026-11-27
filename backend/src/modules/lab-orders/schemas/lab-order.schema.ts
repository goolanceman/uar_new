/**
 * Lab order schemas — request definitions for /api/lab-orders.
 *
 * Legacy read the query with URLSearchParams.get() (silent coercion, Number()
 * based pagination) and validated POST/PATCH bodies mid-handler, interleaved
 * with beneficiary/camp/encounter lookups, linear state-machine gates and
 * role gates, so the query schema reproduces the sp.get() expressions
 * verbatim and the body schemas are permissive envelopes — the exact field
 * checks live in the service.
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

// ─── GET /api/lab-orders?beneficiaryId&campId&status&q&page&limit ────────────

/** Legacy pageParams(url, defLimit = 50): Math.max(1, Math.trunc(Number(v) || 1)),
 *  limit clamped to [1, 200] (default 50) — "abc"/0/absent fall back, fractions truncate. */
export const listLabOrdersQuerySchema = z.object({
  beneficiaryId: spGet.transform((v) => v || undefined),
  campId: spGet.transform((v) => v || undefined),
  status: spGet.transform((v) => v || undefined),
  q: spGet.transform((v) => v || undefined),
  page: spGet.transform((v) => Math.max(1, Math.trunc(Number(v) || 1))),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, Math.trunc(Number(v) || 50)))),
});
export type ListLabOrdersQuery = z.infer<typeof listLabOrdersQuerySchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}` and validated
 *  fields mid-handler between DB lookups and transition/role gates. The
 *  service applies the exact legacy checks with the original error messages
 *  and ordering. */
export const createLabOrderBodySchema = z.any();
export type CreateLabOrderBody = Record<string, unknown>;

export const updateLabOrderBodySchema = z.any();
export type UpdateLabOrderBody = Record<string, unknown>;
