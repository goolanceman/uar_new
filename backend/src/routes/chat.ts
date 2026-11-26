/**
 * Chat routes — /api/chat/* (GENERIC: shared by web + mobile).
 *
 * Replaces the mobile-only compat chat endpoints (ChatController.php via
 * src/routes/mobile/chat-audio.ts): same business logic
 * (src/lib/community/chat.ts), but the generic REST contract — Bearer JWT
 * auth (requireAuth), raw JSON (no envelope), camelCase fields, paged()
 * conversation lists, {items, nextCursor} cursor pages for messages,
 * ApiError → {error}.
 *
 * Endpoints (legacy equivalent in brackets):
 *   GET    /conversations                     [GET /chat/conversations]
 *   POST   /conversations                     [POST /chat/conversations]
 *   GET    /conversations/:id/messages        [GET /chat/conversations/:id/messages]
 *   POST   /conversations/:id/messages        [POST /chat/messages (multipart)]
 *   POST   /messages                          [POST /chat/messages (multipart, id in body)]
 *   POST   /conversations/:id/read            [POST /chat/conversations/:id/read]
 *   POST   /conversations/:id/mute            [POST /chat/conversations/:id/mute]
 *   DELETE /conversations/:id/mute            [POST /chat/conversations/:id/unmute]
 *   POST   /conversations/:id/clear           [POST /chat/conversations/:id/clear]
 *   DELETE /conversations/:id                 [DELETE /chat/conversations/:id]
 *
 * NOTE: the legacy compat router still serves /api/chat/* for requests WITH
 * the mobile apikey header (gated in src/index.ts); this router serves the
 * same paths WITHOUT it — same paths are fine.
 */
import { Router, type Request, type Response } from "express";
import { ApiError, requireAuth, json, handleError, type Session } from "@/lib/session";
import { multipart, type MulterFile } from "@/lib/multipart";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  createOrGetConversation,
  listConversations,
  getMessagesPage,
  sendChatMessage,
  markRead,
  muteConversation,
  unmuteConversation,
  clearConversation,
  deleteConversation,
} from "@/lib/community/chat";

export const router = Router();

/** Grab one uploaded file by its multipart field name (legacy 'media'/'thumbnail'). */
function fileByField(req: Request, field: string): File | null {
  const files = ((req.files ?? []) as unknown as (MulterFile & { fieldname: string })[]) ?? [];
  const f = files.find((x) => x.fieldname === field);
  if (!f) return null;
  return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
}

/** Store an uploaded file and return its absolute public URL (routes/files.ts). */
async function storeUpload(req: Request, session: Session, file: File): Promise<string> {
  const { saveUpload } = await import("@/lib/files");
  const asset = await saveUpload(file, { folder: "chat", uploadedBy: { id: session.userId, name: session.name } });
  const host = req.get("host") ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
  return `${proto}://${host}/api/files/${asset.id}/file`;
}

/** String field from the JSON/multipart body. */
function strField(req: Request, key: string): string | null {
  const v = (req.body ?? {})[key];
  return v === undefined || v === null || v === "" ? null : String(v);
}

// GET /api/chat/conversations — my conversations, newest activity first.
router.get("/conversations", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const all = await listConversations(session.userId);
    return json(res, paged(all.slice(skip, skip + limit), page, limit, all.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/chat/conversations — create-or-get a 1:1 conversation ({userId}).
router.post("/conversations", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const userId = strField(req, "userId") ?? strField(req, "user_id");
    const conversation = await createOrGetConversation(session.userId, userId ?? "");
    return json(res, conversation);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/chat/conversations/:id/messages — cursor page (?before=<messageId>&limit=).
// Fetching marks the conversation read for the caller (legacy auto-read).
router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const before = req.query.before ? String(req.query.before) : null;
    const result = await getMessagesPage(session.userId, String(req.params.id), before, limit);
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

/** Shared message-send handler for POST /messages + POST /conversations/:id/messages. */
async function sendMessageRoute(req: Request, res: Response, conversationId: string | null) {
  const session = await requireAuth(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const cid = conversationId ?? strField(req, "conversationId") ?? strField(req, "conversation_id");
  if (!cid) throw new ApiError("The conversationId field is required", 400);

  const typeRaw = b.type;
  if (typeRaw === undefined || typeRaw === null || typeRaw === "") {
    throw new ApiError("The type field is required", 400);
  }
  const type = Number(typeRaw);

  const message = await sendChatMessage(session.userId, session.name, {
    conversationId: cid,
    message: strField(req, "message"),
    type,
    mediaFile: fileByField(req, "media"),
    thumbnailFile: fileByField(req, "thumbnail"),
    mediaUrl: strField(req, "mediaUrl") ?? strField(req, "media_url"),
    thumbnailUrl: strField(req, "thumbnailUrl") ?? strField(req, "thumbnail_url"),
    replyToMessageId: strField(req, "replyToMessageId") ?? strField(req, "reply_to_message_id"),
    storyId: strField(req, "storyId") ?? strField(req, "story_id"),
    store: (file) => storeUpload(req, session, file),
  });
  return json(res, message, 201);
}

// POST /api/chat/conversations/:id/messages — send (JSON or multipart media).
router.post("/conversations/:id/messages", multipart, async (req, res) => {
  try {
    return await sendMessageRoute(req, res, String(req.params.id));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/chat/messages — send with the conversation id in the body
// (legacy wire shape; the app's chat screen uses this one).
router.post("/messages", multipart, async (req, res) => {
  try {
    return await sendMessageRoute(req, res, null);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/chat/conversations/:id/read — zero the caller's unread counter.
router.post("/conversations/:id/read", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await markRead(session.userId, String(req.params.id)));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/chat/conversations/:id/mute — mute for the caller.
router.post("/conversations/:id/mute", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await muteConversation(session.userId, String(req.params.id)));
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/chat/conversations/:id/mute — unmute (legacy POST .../unmute).
router.delete("/conversations/:id/mute", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await unmuteConversation(session.userId, String(req.params.id)));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/chat/conversations/:id/clear — hide this user's older messages.
router.post("/conversations/:id/clear", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await clearConversation(session.userId, String(req.params.id)));
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/chat/conversations/:id — hide/delete for the caller.
router.delete("/conversations/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await deleteConversation(session.userId, String(req.params.id)));
  } catch (e) {
    return handleError(e, res);
  }
});
