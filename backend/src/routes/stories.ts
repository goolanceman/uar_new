/**
 * Stories routes — thin endpoint definitions; all logic lives in
 * src/modules/story (routes → controllers → services → repositories).
 * The historical export path (`@/routes/stories`) is preserved: tests and the
 * app entry import `router` from here.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { multipart } from "@/infrastructure/uploads/multipart";
import { createStorySchema, listStoriesQuerySchema, updateStorySchema } from "@/modules/story/schemas/story.schema";
import { storyController } from "@/modules/story";

export const router = Router();

// GET /api/stories — followed users' last-24h stories (legacy fetchStory).
router.get("/", authenticate, validate({ query: listStoriesQuerySchema }), storyController.list);

// POST /api/stories — multipart content + optional thumbnail (legacy createStory).
router.post("/", multipart, authenticate, validate({ body: createStorySchema }), storyController.create);

// POST /api/stories/:id/view — mark viewed (legacy viewStory).
router.post("/:id/view", authenticate, storyController.view);

// GET /api/stories/:id (legacy fetchStoryByID).
router.get("/:id", authenticate, storyController.get);

// DELETE /api/stories/:id — owner OR moderator (deleteStory + deleteStoryByModerator).
router.delete("/:id", authenticate, storyController.remove);

// PATCH /api/stories/:id — edit metadata (type/duration/content/thumbnail).
// The owner may always edit; a moderator may edit anyone's (legacy
// stories/update from the admin portal).
router.patch("/:id", authenticate, validate({ body: updateStorySchema }), storyController.update);
