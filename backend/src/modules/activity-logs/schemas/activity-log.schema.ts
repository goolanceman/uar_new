/**
 * Activity log schemas — GET /api/activity-logs input.
 *
 * The legacy handler parsed the query with URLSearchParams over the raw URL:
 *   `sp.get("limit") ? parseInt(sp.get("limit"), 10) : 60`
 * so the schema reproduces that exactly — absent/empty → 60, parseInt
 * coercion ("5.9" → 5, "abc" → NaN → no take clause), the FIRST value for
 * repeated params, and silent acceptance of anything else. Nothing the
 * legacy accepted is rejected here.
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

export const listActivityLogsQuerySchema = z.object({
  limit: spGet.transform((v) => (v !== undefined && v !== "" ? parseInt(v, 10) : 60)),
});
export type ListActivityLogsQuery = z.infer<typeof listActivityLogsQuerySchema>;
