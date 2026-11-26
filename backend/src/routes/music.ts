/**
 * Music routes — /api/music (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile music endpoints (ReelController music
 * half via src/routes/mobile/reels-rooms.ts): browse/search, categories and the
 * session user's saved music.
 */
import { Router } from "express";
import { requireAuth, json, handleError } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { listMusic, listMusicCategories, listSavedMusic } from "@/lib/community/music";

export const router = Router();

// GET /api/music?q=&categoryId=&page=&limit= (legacy fetchMusicWithSearch +
// fetchMusicByCategory). Public browse — no session needed.
router.get("/", async (req, res) => {
  try {
    const categoryIdRaw = String(req.query.categoryId ?? "").trim();
    const categoryId = categoryIdRaw === "" ? null : Number(categoryIdRaw);
    if (categoryId !== null && !Number.isFinite(categoryId)) {
      return json(res, paged([], 1, 20, 0)); // a non-numeric category matches nothing (legacy parity)
    }
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listMusic(String(req.query.q ?? ""), categoryId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/music/categories — music categories with musics counts
// (legacy fetchMusicCategories). Large default limit: the UI fetches them all.
router.get("/categories", async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query, 200, 500);
    const { rows, total } = await listMusicCategories(skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/music/saved — the session user's saved musics (legacy fetchSavedMusic).
// The ids are edited via PATCH /api/profile (savedMusicIds). Large default limit:
// the UI shows the full saved list in one call.
router.get("/saved", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query, 200, 500);
    const { rows, total } = await listSavedMusic(session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});
