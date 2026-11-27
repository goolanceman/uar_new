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
import { logger } from "@/lib/logger";
import { paged, pageParams } from "@/lib/community/serializers";
import { listInterests, addInterest, updateInterest, deleteInterest } from "@/lib/community/interests";
import { requireElevated } from "@/lib/community/admin";

export const router = Router();

const log = logger.child("interests");

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
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    const row = await addInterest(title);
    log.info("interest_created", { interestId: row.id, title, actor: session.userId });
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/interests/:id {title} — admin.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const title = String((req.body ?? {}).title ?? "").trim();
    if (!title) throw new ApiError("The title field is required.", 400);
    const interestId = Number((req.params as Record<string, string>).id);
    const updated = await updateInterest(interestId, title);
    log.info("interest_updated", { interestId: updated.id, title, actor: session.userId });
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/interests/:id — admin; strips the id from users.interestIds and
// the communityPost/communityReel/communityRoom CSVs (dangling-reference fix
// the legacy deleteInterest lacked).
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireElevated(req);
    const interestId = Number((req.params as Record<string, string>).id);
    const row = await deleteInterest(interestId);
    log.info("interest_deleted", { interestId: row.id, actor: session.userId });
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});
