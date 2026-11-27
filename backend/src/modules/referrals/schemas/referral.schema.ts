/**
 * Referral schemas — request definitions for /api/referrals*.
 *
 * The legacy handlers read the body with hand-rolled optText()/String()
 * checks interleaved with DB lookups (404-before-400 ordering), so every
 * field check stays in the service: the query schema reproduces the
 * pageParams() coercion expressions verbatim and the body schemas are
 * permissive envelopes (no invented rejections).
 */
import { z } from "zod";

// ─── GET /api/referrals ──────────────────────────────────────────────────────

/** Legacy pageParams(url, 50): Math.max(1, Math.trunc(Number(v) || 1)) for
 *  page; limit Math.min(200, Math.max(1, Math.trunc(Number(v) || 50))). */
export const listReferralsQuerySchema = z.object({
  page: z.any().optional().transform((v) => Math.max(1, Math.trunc(Number(v) || 1))),
  limit: z.any().optional().transform((v) => Math.min(200, Math.max(1, Math.trunc(Number(v) || 50)))),
  beneficiaryId: z
    .any()
    .optional()
    .transform((v) => (typeof v === "string" && v ? v : undefined)),
  status: z
    .any()
    .optional()
    .transform((v) => (typeof v === "string" && v ? v : undefined)),
  priority: z
    .any()
    .optional()
    .transform((v) => (typeof v === "string" && v ? v : undefined)),
});
export type ListReferralsQuery = z.infer<typeof listReferralsQuerySchema>;

// ─── POST/PATCH bodies (checks interleaved with lookups — see service) ───────

/** Permissive body envelope: the legacy handler validated every field
 *  mid-flow between DB lookups, so the exact 400/404/409 messages and their
 *  ordering are preserved in the service. */
export const referralBodySchema = z.any();
export type ReferralBody = Record<string, unknown>;

// ─── Params (cuid ids — Express only matches non-empty) ──────────────────────

export const referralIdParamSchema = z.object({
  id: z.string().min(1),
});
export type ReferralIdParams = z.infer<typeof referralIdParamSchema>;
