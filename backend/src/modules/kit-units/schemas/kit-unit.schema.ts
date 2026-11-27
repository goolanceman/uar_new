/**
 * Kit unit schemas — GET /api/kit-units input.
 *
 * The legacy handler parsed the query with URLSearchParams over the raw URL:
 *   batchId/status = sp.get(...) || undefined, q = sp.get("q")?.trim() || undefined
 *   mine = truthy presence flag ("0" counts — any non-empty value does, as in
 *          the legacy `if (sp.get("mine"))`)
 *   limit = Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 200)))
 * The schemas reproduce those expressions verbatim and reject nothing the
 * legacy accepted.
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

export const listKitUnitsQuerySchema = z.object({
  batchId: spGet.transform((v) => v || undefined),
  status: spGet.transform((v) => v || undefined),
  q: spGet.transform((v) => (v !== undefined ? v.trim() || undefined : undefined)),
  mine: spGet.transform((v) => v !== undefined && v !== ""),
  limit: spGet.transform((v) => Math.min(500, Math.max(1, Math.trunc(Number(v) || 200)))),
});
export type ListKitUnitsQuery = z.infer<typeof listKitUnitsQuerySchema>;
