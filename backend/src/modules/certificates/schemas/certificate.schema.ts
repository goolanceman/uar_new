/**
 * Certificate schemas — /api/certificates input.
 *
 * Legacy parsed the list query with URLSearchParams.get() (parseInt-based
 * limit clamping) and validated the POST body fields mid-handler AFTER the
 * auth gate, so the query schema reproduces the sp.get() expressions verbatim
 * and the body schema is a permissive envelope — the exact field checks live
 * in the service.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?limit[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── Authenticated list ──────────────────────────────────────────────────────

/** parseInt(sp.get("limit") ?? "50", 10), clamped to [1, 200]; NaN → 50. */
export const listCertificatesQuerySchema = z.object({
  limit: spGet.transform((v) => {
    const n = parseInt(v ?? "50", 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 50;
  }),
});
export type ListCertificatesQuery = z.infer<typeof listCertificatesQuerySchema>;

// ─── :code params ────────────────────────────────────────────────────────────

/** Certificate codes are path segments — `:code` is never empty when matched.
 *  The legacy handler applied a further decodeURIComponent(code) in-handler;
 *  the service preserves that exact call. */
export const certificateCodeParamSchema = z.object({
  code: z.string().min(1),
});
export type CertificateCodeParams = z.infer<typeof certificateCodeParamSchema>;

// ─── POST body ───────────────────────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  known fields mid-handler (type, recipientName, recipientEmail, userId,
 *  meta normalization). The service applies the exact legacy checks with the
 *  original error messages. */
export const createCertificateBodySchema = z.any();
export type CreateCertificateBody = Record<string, unknown>;
