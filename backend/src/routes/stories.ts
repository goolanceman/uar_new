/**
 * Stories routes — /api/stories (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile story endpoints
 * (src/routes/mobile/posts.ts story routes + Moderator/deleteStoryByModerator).
 * The actor is ALWAYS the session user — ids never come from the body.
 */
import { Router, type Request } from "express";
import { requireAuth, ApiError, json, handleError, body } from "@/lib/session";
import { logger } from "@/lib/logger";
import { paged, pageParams } from "@/lib/community/serializers";
import { multipart, type MulterFile } from "@/lib/multipart";
import { createStory, deleteStory, getStory, listStories, updateStory, viewStory } from "@/lib/community/stories";

export const router = Router();

const log = logger.child("stories");

/** :id path param — reject missing ids early. */
function idParam(req: Request): string {
  const id = String((req.params as Record<string, string>).id ?? "").trim();
  if (!id) throw new ApiError("Story id is required", 400);
  return id;
}

/** The first uploaded part matching [base] (base, base[], base[0]). */
function fieldFile(req: Request, base: string): File | null {
  const all = ((req as Request & { files?: unknown }).files ?? []) as Array<MulterFile & { fieldname?: string }>;
  const f = all.find(
    (x) => x.fieldname === base || x.fieldname === `${base}[]` || (x.fieldname ?? "").startsWith(`${base}[`)
  );
  return f ? new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" }) : null;
}

// GET /api/stories — followed users' last-24h stories (legacy fetchStory).
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query, 50);
    const { items, total } = await listStories(session.userId, skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/stories — multipart content + optional thumbnail (legacy createStory).
router.post("/", multipart, async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = body<Record<string, unknown>>(req);
    const story = await createStory(
      req,
      { id: session.userId, name: session.name },
      {
        type: Number(b.type ?? 0) || 0,
        duration: Number(b.duration ?? 0) || 0,
        content: b.content != null && b.content !== "" ? String(b.content) : null,
      },
      { content: fieldFile(req, "content"), thumbnail: fieldFile(req, "thumbnail") }
    );
    log.info("story_created", {
      storyId: story.id,
      actor: session.userId,
      type: Number(b.type ?? 0) || 0,
      hasThumbnail: fieldFile(req, "thumbnail") != null,
    });
    return json(res, story, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/stories/:id/view — mark viewed (legacy viewStory).
router.post("/:id/view", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const story = await viewStory(session.userId, idParam(req));
    log.info("story_viewed", { storyId: story.id, actor: session.userId });
    return json(res, story);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/stories/:id (legacy fetchStoryByID).
router.get("/:id", async (req, res) => {
  try {
    await requireAuth(req);
    const story = await getStory(idParam(req));
    return json(res, story);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/stories/:id — owner OR moderator (deleteStory + deleteStoryByModerator).
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const story = await deleteStory(session.userId, session.role, idParam(req));
    log.info("story_deleted", { storyId: story.id, actor: session.userId });
    return json(res, { ok: true, story });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/stories/:id — edit metadata (type/duration/content/thumbnail).
// The owner may always edit; a moderator may edit anyone's (legacy
// stories/update from the admin portal).
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const storyId = idParam(req);
    const patch = {
      type: b.type !== undefined ? Number(b.type) : undefined,
      duration: b.duration !== undefined ? Number(b.duration) : undefined,
      content: b.content !== undefined ? String(b.content) : undefined,
      thumbnail: b.thumbnail !== undefined ? String(b.thumbnail) : undefined,
    };
    const story = await updateStory(session.userId, session.role, storyId, patch);
    log.info("story_updated", {
      storyId,
      actor: session.userId,
      fields: Object.entries(patch).filter(([, v]) => v !== undefined).map(([k]) => k),
    });
    return json(res, { ok: true, story });
  } catch (e) {
    return handleError(e, res);
  }
});