/**
 * Community admin schemas — request definitions for /api/community/admin/*.
 *
 * Every legacy handler read page/limit through pageParams() (parseInt
 * semantics: `parseInt(String(v)) || default`, page floored at 1, limit
 * clamped to [1, 100]) and coerced the remaining query/body fields by hand
 * mid-flow with exact bare error messages ("The title field is required.",
 * "Invalid document type id", …) whose ORDER differs per route (e.g. the
 * document-type PATCH checks the id BEFORE the title, the report-reason
 * PATCH the title first and never validates the id). Those hand-rolled
 * coercions are kept verbatim in the service — the schemas reproduce the
 * pagination math exactly and pass everything else through untouched.
 */
import { z } from "zod";

/** pageParams(q, defLimit) as a Zod transform — parseInt semantics verbatim.
 *  Every paged list also reads ?q= (raw passthrough). */
const pagedQuery = <T extends z.ZodRawShape = Record<never, never>>(
  defLimit: number,
  extra: T = {} as T
) =>
  z.object({
    page: z.any().optional().transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
    limit: z
      .any()
      .optional()
      .transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? String(defLimit)), 10) || defLimit))),
    q: z.any().optional(),
    ...extra,
  });

// ─── Directory lists ─────────────────────────────────────────────────────────

export const adminUsersQuerySchema = pagedQuery(50, { tier: z.any().optional() });
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export const adminPostsQuerySchema = pagedQuery(30, { type: z.any().optional() });
export type AdminPostsQuery = z.infer<typeof adminPostsQuerySchema>;

export const adminReelsQuerySchema = pagedQuery(30, { status: z.any().optional() });
export type AdminReelsQuery = z.infer<typeof adminReelsQuerySchema>;

/** ?type= stays raw — the Number()/isFinite coercion is semantic (service). */
export const adminReportsQuerySchema = pagedQuery(30, { type: z.any().optional() });
export type AdminReportsQuery = z.infer<typeof adminReportsQuerySchema>;

export const adminCausesQuerySchema = pagedQuery(30);
export type AdminCausesQuery = z.infer<typeof adminCausesQuerySchema>;

export const adminDonationsQuerySchema = pagedQuery(30, {
  causePostId: z.any().optional(),
  cause_post_id: z.any().optional(),
});
export type AdminDonationsQuery = z.infer<typeof adminDonationsQuerySchema>;

// ─── Config lists ────────────────────────────────────────────────────────────

export const reportReasonsQuerySchema = pagedQuery(50);
export const usernameRestrictionsQuerySchema = pagedQuery(50);

// ─── Profile verifications ───────────────────────────────────────────────────

export const verificationsQuerySchema = pagedQuery(30, { status: z.any().optional() });
export type VerificationsQuery = z.infer<typeof verificationsQuerySchema>;

export const verifiedMembersQuerySchema = pagedQuery(30);
export type VerifiedMembersQuery = z.infer<typeof verifiedMembersQuerySchema>;

// ─── Platform announcements ──────────────────────────────────────────────────

export const adminNotificationsQuerySchema = pagedQuery(20);
export type AdminNotificationsQuery = z.infer<typeof adminNotificationsQuerySchema>;

// ─── Bodies (permissive — checks live in the service in legacy order) ───────

export const adminBodySchema = z.any();
export type AdminBody = Record<string, unknown>;

// ─── Params ──────────────────────────────────────────────────────────────────

/** Numeric-ish ids stay strings until the service applies the exact legacy
 *  Number() coercion/check (or its deliberate absence — e.g. report reasons). */
export const adminIdParamSchema = z.object({ id: z.string() });
export type AdminIdParams = z.infer<typeof adminIdParamSchema>;

/** :userId segment for verification approve/reject. */
export const adminUserIdParamSchema = z.object({ userId: z.string() });
export type AdminUserIdParams = z.infer<typeof adminUserIdParamSchema>;
