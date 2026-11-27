/**
 * Stats schemas — Zod definitions for /api/stats requests.
 *
 * The legacy route parsed ?from=&to= with URLSearchParams.get semantics:
 * absent → null, arrays → first value, anything non-string (qs nested keys)
 * → null. Parsing never rejects; invalid date values are silently ignored by
 * the service (all-time defaults), exactly like the legacy loader.
 */

/** First value of a query param or null (legacy sp.get semantics). */
const firstStringOrNull = (v: unknown): string | null => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : null;
  return typeof v === "string" ? v : null;
};

import { z } from "zod";

export const statsQuerySchema = z.object({
  from: z.preprocess(firstStringOrNull, z.string().nullable()),
  to: z.preprocess(firstStringOrNull, z.string().nullable()),
});
export type StatsQuery = z.infer<typeof statsQuerySchema>;
