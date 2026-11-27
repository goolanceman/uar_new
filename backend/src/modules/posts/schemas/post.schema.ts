/**
 * Post schemas — request definitions for /api/posts*.
 *
 * The legacy handlers read query values through pageParams() (parseInt
 * semantics) and bodies with hand-rolled String()/numField()/mediaIdsField()
 * coercions, so the body schemas are permissive envelopes and the exact
 * coercions live in the schema transforms / service helpers. The :id path
 * params stay permissive here: the legacy idParam() trim check (400 "Id is
 * required") is reproduced in the service.
 */
import { z } from "zod";

// ─── Shared coercions (legacy pageParams from lib/community/serializers) ─────

/** Legacy pageParams(): parseInt(String(v ?? "1"), 10) || 1 — "2abc" parses
 *  as 2 (parseInt semantics), NaN/absent fall back to the default. */
const legacyPage = z
  .any()
  .optional()
  .transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1));

/** Legacy pageParams(): parseInt(String(v ?? def), 10) || def, capped at 100. */
const legacyLimit = (def: number) =>
  z
    .any()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? String(def)), 10) || def)));

/** Raw passthrough (legacy read req.query values with String(...) in place). */
const rawQuery = z.any().optional();

// ─── GET queries ──────────────────────────────────────────────────────────────

/** GET /api/posts?type=latest|random&page=&limit= — the main feed. */
export const listFeedQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(20),
  type: z.any().optional().transform((v) => String(v ?? "latest")),
});
export type ListFeedQuery = z.infer<typeof listFeedQuerySchema>;

/** GET /api/posts/saved — the session user's saved posts. */
export const savedPostsQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(20),
});
export type SavedPostsQuery = z.infer<typeof savedPostsQuerySchema>;

/** GET /api/posts/search?q= (legacy searchPost). */
export const searchPostsQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(20),
  q: z.any().optional().transform((v) => String(v ?? "")),
});
export type SearchPostsQuery = z.infer<typeof searchPostsQuerySchema>;

/** GET /api/posts/by-interest?ids=1,2&q= (legacy searchPostByInterestId). */
export const byInterestQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(20),
  ids: z
    .any()
    .optional()
    .transform((v) =>
      String(v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
});
export type ByInterestQuery = z.infer<typeof byInterestQuerySchema>;

/** GET /api/posts/by-hashtag?tags=a,b (legacy fetchPostsByHashtag) — the
 *  cross-field `tags ?? tag` fallback is resolved in the service. */
export const byHashtagQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(20),
  tags: rawQuery,
  tag: rawQuery,
});
export type ByHashtagQuery = z.infer<typeof byHashtagQuerySchema>;

/** GET /api/posts/hashtags?q= → [{tag, postCount}] (legacy searchHashtag). */
export const hashtagsQuerySchema = z.object({
  q: z.any().optional().transform((v) => String(v ?? "")),
});
export type HashtagsQuery = z.infer<typeof hashtagsQuerySchema>;

// ─── Params (permissive — the legacy idParam() trim check lives in the
//     service so the 400 "Id is required" message stays byte-identical) ──────

export const postIdParamSchema = z.object({ id: z.string() });
export type PostIdParams = z.infer<typeof postIdParamSchema>;

export const commentIdParamSchema = z.object({ commentId: z.string() });
export type CommentIdParams = z.infer<typeof commentIdParamSchema>;

export const userIdParamSchema = z.object({ userId: z.string() });
export type UserIdParams = z.infer<typeof userIdParamSchema>;

// ─── Bodies (JSON or multipart — coercions in the service) ────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}` through String()/
 *  numField()/mediaIdsField() coercions, reproduced in the service. */
export const postBodySchema = z.any();
export type PostBody = Record<string, unknown>;
