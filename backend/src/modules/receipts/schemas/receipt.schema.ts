/**
 * Receipt schemas — /api/receipts input.
 *
 * Legacy parsed the list query with URLSearchParams.get() (parseInt-based
 * limit clamping) so the query schema reproduces the sp.get() expressions
 * verbatim; from/to stay raw strings — the service parses them into a date
 * range exactly like the legacy handler (invalid dates silently ignored).
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

// ─── GET /api/receipts?from&to&limit ──────────────────────────────────────────

/** parseInt(sp.get("limit") ?? "100", 10), clamped to [1, 200]; NaN → 100. */
export const listReceiptsQuerySchema = z.object({
  limit: spGet.transform((v) => {
    const n = parseInt(v ?? "100", 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 100;
  }),
  from: spGet,
  to: spGet,
});
export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;

// ─── :receiptNumber params ────────────────────────────────────────────────────

/** Receipt numbers are path segments — `:receiptNumber` is never empty when
 *  matched. The legacy handler applied a further decodeURIComponent() in-handler;
 *  the service preserves that exact call. */
export const receiptNumberParamSchema = z.object({
  receiptNumber: z.string().min(1),
});
export type ReceiptNumberParams = z.infer<typeof receiptNumberParamSchema>;
