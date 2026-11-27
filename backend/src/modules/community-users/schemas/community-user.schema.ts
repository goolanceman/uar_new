/**
 * Community user schemas — Zod definitions for every /api/community/users
 * request.
 *
 * Pagination mirrors the legacy community pageParams() exactly: parseInt
 * (not Number) coercion over String(q.x ?? default), NaN/"" falling back to
 * the default, page floored at 1, limit clamped to [1, 100]. The report body
 * is read raw by the service (legacy String(body.x ?? "") never rejects).
 * The :id param is extracted unvalidated — the legacy targetId() check
 * ("User id is required", bare 400 message) runs in the service so the error
 * body stays byte-identical.
 */
import { z } from "zod";

/** Legacy pageParams(): Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1). */
const legacyPage = z.preprocess(
  (v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1),
  z.number().int().min(1)
);

/** Legacy pageParams(): Math.min(100, Math.max(1, parseInt(String(q.limit ?? "20"), 10) || 20)). */
const legacyLimit = z.preprocess(
  (v) => Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20)),
  z.number().int().min(1)
);

// ─── GET /me/blocked ─────────────────────────────────────────────────────────

export const listCommunityUsersQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit,
});
export type ListCommunityUsersQuery = z.infer<typeof listCommunityUsersQuerySchema>;

// ─── GET /search, /search-chat, /:id/followers ───────────────────────────────

/** q — legacy String(req.query.q ?? ""): absent/empty → "" (no rejection). */
export const searchCommunityUsersQuerySchema = listCommunityUsersQuerySchema.extend({
  q: z.preprocess((v) => String(v ?? ""), z.string()),
});
export type SearchCommunityUsersQuery = z.infer<typeof searchCommunityUsersQuerySchema>;

// ─── :id param (extraction only — service renders the bare 400) ──────────────

export const communityUserIdParamSchema = z.object({ id: z.string() });
export type CommunityUserIdParams = z.infer<typeof communityUserIdParamSchema>;
