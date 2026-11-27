/**
 * Mission schemas — /api/missions input.
 *
 * The legacy GET handler parsed the query with URLSearchParams over the raw
 * URL (never rejecting: bad numbers fell back to the default limit) and the
 * POST/PATCH handlers validated body fields mid-handler AFTER the auth gate
 * (with the mission lookup interleaved — 404-before-400 ordering), so the
 * body schemas are permissive envelopes — the exact field checks live in the
 * service. Nothing the legacy accepted is rejected here.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?status[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/missions?status=&q=&ambulanceId=&limit= ────────────────────────

export const listMissionsQuerySchema = z.object({
  /** legacy: sp.get("status") || undefined */
  status: spGet.transform((v) => v || undefined),
  /** legacy: sp.get("q")?.trim() || undefined */
  q: spGet.transform((v) => v?.trim() || undefined),
  /** legacy: sp.get("ambulanceId") — truthy check only (no trim) */
  ambulanceId: spGet.transform((v) => v || undefined),
  /** legacy: Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 200))) */
  limit: z
    .preprocess((v) => Math.trunc(Number(Array.isArray(v) ? v[0] : v) || 200), z.number())
    .transform((n) => Math.min(500, Math.max(1, n))),
});
export type ListMissionsQuery = z.infer<typeof listMissionsQuerySchema>;

// ─── Params ──────────────────────────────────────────────────────────────────

/** Extraction-only param schema — the service renders the legacy 404. */
export const missionIdParamSchema = stringIdParamSchema;
export type MissionIdParams = z.infer<typeof missionIdParamSchema>;

// ─── POST /api/missions ──────────────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  patientName/contact/emergencyType/priority/pickup/destination mid-handler
 *  with the requestRef loop interleaved. The service applies the exact legacy
 *  coercions and checks in the original order. */
export const createMissionBodySchema = z.any();
export type CreateMissionBody = Record<string, unknown>;

// ─── PATCH /api/missions/:id ─────────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  status/action/progress/ambulanceId mid-handler after the mission lookup
 *  (404-before-400 ordering). The service applies the exact legacy checks. */
export const updateMissionBodySchema = z.any();
export type UpdateMissionBody = Record<string, unknown>;
