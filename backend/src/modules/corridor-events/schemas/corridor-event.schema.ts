/**
 * Corridor event schemas — GET /api/corridor-events input.
 *
 * The legacy handler parsed the query with URLSearchParams over the raw URL:
 *   missionId = sp.get("missionId") || undefined
 *   limit = Math.min(200, Math.max(1, Math.trunc(Number(sp.get("limit")) || 50)))
 * The schemas below reproduce those expressions verbatim (Number/Math
 * semantics, first value for repeated params, silent acceptance of junk —
 * e.g. ?limit=abc → NaN || 50 → 50, exactly like legacy).
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?method[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

export const listCorridorEventsQuerySchema = z.object({
  missionId: spGet.transform((v) => v || undefined),
  method: spGet.transform((v) => v || undefined),
  congestion: spGet.transform((v) => v || undefined),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, Math.trunc(Number(v) || 50)))),
});
export type ListCorridorEventsQuery = z.infer<typeof listCorridorEventsQuerySchema>;
