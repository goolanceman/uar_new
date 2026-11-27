/**
 * Interests routes — /api/interests (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile fetchInterests endpoint
 * (InterestController::fetchInterests via src/routes/mobile/posts.ts) with the
 * per-interest room count, plus the admin CRUD (add/update/deleteInterest —
 * delete also strips the id from every interestIds CSV column).
 */
import { Router } from "express";
import { ApiError, json, handleError } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { listInterests, addInterest, updateInterest, deleteInterest } from "@/lib/community/interests";
import { requireElevated } from "@/lib/community/admin";

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

// POST /api/interests {title} — admin.
router.post("/", async (req, res) => {
  try {
    await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    return json(res, await addInterest(title), 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/interests/:id {title} — admin.
router.patch("/:id", async (req, res) => {
  try {
    await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    return json(res, await updateInterest(Number((req.params as Record<string, string>).id), title));
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/interests/:id — admin; strips the id from users.interestIds and
// the communityPost/communityReel/communityRoom CSVs (dangling-reference fix
// the legacy deleteInterest lacked).
router.delete("/:id", async (req, res) => {
  try {
    await requireElevated(req);
    return json(res, await deleteInterest(Number((req.params as Record<string, string>).id)));
  } catch (e) {
    return handleError(e, res);
  }
});
