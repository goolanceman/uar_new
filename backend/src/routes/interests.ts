/**
 * Interests routes — /api/interests (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile fetchInterests endpoint
 * (InterestController::fetchInterests via src/routes/mobile/posts.ts) with the
 * per-interest room count.
 */
import { Router } from "express";
import { json, handleError } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { listInterests } from "@/lib/community/interests";

export const router = Router();

// GET /api/interests?page=&limit= — interests + totalRoomOfInterest.
router.get("/", async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query, 100);
    const { items, total } = await listInterests(skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});
