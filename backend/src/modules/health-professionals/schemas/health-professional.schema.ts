/**
 * Health professional schemas — request definitions for /api/health-professionals.
 *
 * Legacy read the query with URLSearchParams.get() (silent coercion) and
 * validated POST/PATCH bodies mid-handler, interleaved with organisation
 * lookups (name → kind → org gate → email → experienceYears on POST;
 * existence → ownership → verification gates → per-field checks on PATCH),
 * so the query schema reproduces the sp.get() expressions verbatim and the
 * body schemas are permissive envelopes — the exact field checks live in
 * the service.
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

// ─── GET /api/health-professionals?q&kind&orgId&verificationStatus&active ───

/** Legacy pageParams(): parseInt(sp.get(...) ?? default, 10) || default, page
 *  floored at 1, limit clamped to [1, 200] (default 24). */
export const listHealthProfessionalsQuerySchema = z.object({
  q: spGet.transform((v) => v?.trim() || undefined),
  kind: spGet.transform((v) => v || undefined),
  orgId: spGet.transform((v) => v || undefined),
  verificationStatus: spGet.transform((v) => v || undefined),
  /** Only "1"/"0" filter active; ANY other value is silently ignored (legacy). */
  active: spGet.transform((v) => v || undefined),
  page: spGet.transform((v) => Math.max(1, parseInt(v ?? "1", 10) || 1)),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, parseInt(v ?? "24", 10) || 24))),
});
export type ListHealthProfessionalsQuery = z.infer<typeof listHealthProfessionalsQuerySchema>;

// ─── POST / PATCH bodies ─────────────────────────────────────────────────────

/** Permissive body envelopes: legacy read `req.body ?? {}` and validated
 *  fields mid-handler between DB lookups (org existence, role gates). The
 *  service applies the exact legacy checks with the original error messages
 *  and ordering. */
export const createHealthProfessionalBodySchema = z.any();
export type CreateHealthProfessionalBody = Record<string, unknown>;

export const updateHealthProfessionalBodySchema = z.any();
export type UpdateHealthProfessionalBody = Record<string, unknown>;
