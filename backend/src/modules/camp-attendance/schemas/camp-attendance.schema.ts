/**
 * Camp attendance schemas — /api/camp-attendance input.
 *
 * The legacy GET handler parsed the query with a local pageParams()
 * (page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1); take =
 * Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24)))
 * and the POST/PATCH handlers validated body fields mid-handler AFTER the
 * auth gate (with the registration/attendance/doctor lookups interleaved —
 * 404-before-400 ordering), so those body schemas are permissive envelopes —
 * the exact field checks live in the service. Nothing the legacy accepted is
 * rejected here.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?campId[a]=b) were different keys to
 * searchParams, so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/camp-attendance ────────────────────────────────────────────────

export const listCampAttendanceQuerySchema = z.object({
  campId: spGet.transform((v) => v || undefined),
  status: spGet.transform((v) => v || undefined),
  /** Live dashboard summary switch — legacy `sp.get("summary") === "1"`. */
  summary: spGet.transform((v) => v === "1"),
  /** Legacy local pageParams(): Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1). */
  page: spGet.transform((v) => Math.max(1, parseInt(v ?? "1", 10) || 1)),
  /** Legacy local pageParams(): Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24)). */
  limit: spGet.transform((v) => Math.min(200, Math.max(1, parseInt(v ?? "24", 10) || 24))),
});
export type ListCampAttendanceQuery = z.infer<typeof listCampAttendanceQuerySchema>;

// ─── POST /api/camp-attendance (check-in) ────────────────────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}` and validated
 *  registrationId/method mid-handler. The service applies the exact legacy
 *  checks in the original order. */
export const checkInBodySchema = z.any();
export type CheckInBody = Record<string, unknown>;

// ─── PATCH /api/camp-attendance ──────────────────────────────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}` and validated
 *  id/status/doctorId/cancelReason mid-handler after the attendance lookup.
 *  The service applies the exact legacy checks. */
export const updateAttendanceBodySchema = z.any();
export type UpdateAttendanceBody = Record<string, unknown>;
