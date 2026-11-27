/**
 * Reel schemas — request definitions for /api/reels.
 *
 * Nothing to validate here:
 * - Pagination keeps the legacy lib helper pageParams() (parseInt-based) in
 *   the controller — a Zod coercion would differ (e.g. "2.5" → 2 vs default).
 * - Param checks (:id, :musicId, :userId, :commentId, tags CSV, feed enum)
 *   carry exact wire messages and run mid-flow — the service performs the
 *   identical checks.
 * - POST / (multipart or direct-upload) and PATCH /:id normalize their raw
 *   bodies field-by-field in the service (aliases desc/interest_ids/
 *   music_id, clamps, "send either a content file or a mediaId").
 */
export {};
