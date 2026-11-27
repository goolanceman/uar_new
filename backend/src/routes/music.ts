/**
 * Music routes — /api/music (shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/music
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/music`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listMusicCategoriesQuerySchema,
  listMusicQuerySchema,
  listSavedMusicQuerySchema,
} from "@/modules/music/schemas/music.schema";
import { musicController } from "@/modules/music";

export const router = Router();

// GET /api/music?q=&categoryId=&page=&limit= (legacy fetchMusicWithSearch +
// fetchMusicByCategory). Public browse — no session needed.
router.get("/", validate({ query: listMusicQuerySchema }), musicController.list);

// GET /api/music/categories — music categories with musics counts
// (legacy fetchMusicCategories). Large default limit: the UI fetches them all.
router.get("/categories", validate({ query: listMusicCategoriesQuerySchema }), musicController.categories);

// GET /api/music/saved — the session user's saved musics (legacy fetchSavedMusic).
// The ids are edited via PATCH /api/profile (savedMusicIds). Large default limit:
// the UI shows the full saved list in one call. Legacy gate: `await requireAuth(req)`
// as the handler's first step.
router.get(
  "/saved",
  authenticate,
  validate({ query: listSavedMusicQuerySchema }),
  musicController.saved
);
