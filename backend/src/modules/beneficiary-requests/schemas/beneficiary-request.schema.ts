/**
 * Beneficiary-request schemas — /api/beneficiary-requests input.
 *
 * The GET query read the raw URL search params (URLSearchParams.get()
 * semantics — the spGet preprocess), and POST/PATCH bodies were coerced with
 * String(...) AFTER the session gate (POST) or the existence lookup (PATCH —
 * 404-before-400), throwing the legacy combined messages ("Name and request
 * details are required", "Invalid urgency level", "Invalid request status",
 * "Nothing to update"). That validation stays in the service to keep the
 * exact messages and ordering; these body schemas intentionally accept
 * anything — no new rejections.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?mine[a]=1) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/beneficiary-requests ──────────────────────────────────────────
// ?mine=1 flips to the caller's own list; ?status=<STATUS> filters the
// admin queue (legacy truthiness: any non-empty value other than "1" for
// `status` still filtered — only `mine` compared against "1").
export const listBeneficiaryRequestsQuerySchema = z.object({
  mine: spGet.transform((v) => v === "1"),
  status: spGet,
});
export type ListBeneficiaryRequestsQuery = z.infer<typeof listBeneficiaryRequestsQuerySchema>;

/** :id is a cuid string — a missing id never matches the route segment. */
export const beneficiaryRequestIdParamSchema = stringIdParamSchema;
export type BeneficiaryRequestIdParams = z.infer<typeof beneficiaryRequestIdParamSchema>;

// ─── POST / PATCH bodies ────────────────────────────────────────────────────
export const createBeneficiaryRequestBodySchema = z.any();
export type CreateBeneficiaryRequestBody = Record<string, unknown>;

export const updateBeneficiaryRequestBodySchema = z.any();
export type UpdateBeneficiaryRequestBody = Record<string, unknown>;
