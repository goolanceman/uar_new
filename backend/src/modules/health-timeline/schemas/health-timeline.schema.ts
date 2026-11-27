/**
 * Health-timeline schemas — GET /api/health-timeline?beneficiaryId=.
 * The legacy handler read the raw URL search param (URLSearchParams.get()
 * semantics — the spGet preprocess), defaulting to "" (the "is required"
 * check ran in the handler, after the session gate and the BENEFICIARY
 * self-lookup — so the schema only reproduces the read, not the rejection).
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?beneficiaryId[a]=x) were different keys to
 * searchParams, so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

export const healthTimelineQuerySchema = z.object({
  beneficiaryId: spGet.transform((v) => v ?? ""),
});
export type HealthTimelineQuery = z.infer<typeof healthTimelineQuerySchema>;
