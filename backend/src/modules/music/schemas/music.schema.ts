/**
 * Music schemas — GET /api/music input.
 *
 * These mirror the legacy route expressions verbatim so no input the legacy
 * accepted is rejected (or coerced differently):
 *  - q / categoryId: `String(req.query.x ?? "")` — String() coercion of the
 *    raw qs value (arrays join with ",", objects become "[object Object]" —
 *    legacy parity); categoryId is additionally .trim()ed in the route.
 *  - page / limit: the pageParams() expressions —
 *    Math.max(1, parseInt(String(v ?? def)) || def), capped at maxLimit.
 */
import { z } from "zod";

/** String(req.query.x ?? fallback) over the raw qs value. */
const rawString = (fallback = "") => z.preprocess((v) => String(v ?? fallback), z.string());

/** pageParams(): page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1). */
const page = z.preprocess((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1), z.number());

/** pageParams(): limit = Math.min(maxLimit, Math.max(1, parseInt(String(q.limit ?? defLimit), 10) || defLimit)). */
const limit = (defLimit: number, maxLimit: number) =>
  z.preprocess(
    (v) => Math.min(maxLimit, Math.max(1, parseInt(String(v ?? String(defLimit)), 10) || defLimit)),
    z.number()
  );

// GET /api/music?q=&categoryId=&page=&limit= — pageParams(req.query) defaults.
export const listMusicQuerySchema = z.object({
  q: rawString(),
  categoryId: rawString().transform((v) => v.trim()),
  page,
  limit: limit(20, 100),
});
export type ListMusicQuery = z.infer<typeof listMusicQuerySchema>;

// GET /api/music/categories — pageParams(req.query, 200, 500).
export const listMusicCategoriesQuerySchema = z.object({ page, limit: limit(200, 500) });
export type ListMusicCategoriesQuery = z.infer<typeof listMusicCategoriesQuerySchema>;

// GET /api/music/saved — pageParams(req.query, 200, 500).
export const listSavedMusicQuerySchema = listMusicCategoriesQuerySchema;
export type ListSavedMusicQuery = z.infer<typeof listSavedMusicQuerySchema>;
