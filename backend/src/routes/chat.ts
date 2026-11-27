/**
 * Chat routes — thin endpoint definitions; all logic lives in
 * src/modules/chat (routes → controllers → services → repositories).
 * The historical export path (`@/routes/chat`) is preserved: tests and the
 * app entry import `router` from here.
 *
 * /api/chat/* (GENERIC: shared by web + mobile).
 *
 * Replaces the mobile-only compat chat endpoints (ChatController.php via
 * src/routes/mobile/chat-audio.ts): same business logic
 * (src/lib/community/chat.ts), but the generic REST contract — Bearer [redacted]
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
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { multipart } from "@/lib/multipart";
import {
  conversationIdParamSchema,
  jsonBodySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
} from "@/modules/chat/schemas/chat.schema";
import { chatController } from "@/modules/chat";

export const router = Router();

// GET /api/chat/conversations — my conversations, newest activity first.
router.get(
  "/conversations",
  authenticate,
  validate({ query: listConversationsQuerySchema }),
  chatController.listConversations
);

// POST /api/chat/conversations — create-or-get a 1:1 conversation ({userId}).
router.post("/conversations", authenticate, validate({ body: jsonBodySchema }), chatController.createConversation);

// GET /api/chat/conversations/:id/messages — cursor page (?before=<messageId>&limit=).
// Fetching marks the conversation read for the caller (legacy auto-read).
router.get(
  "/conversations/:id/messages",
  authenticate,
  validate({ params: conversationIdParamSchema, query: listMessagesQuerySchema }),
  chatController.listMessages
);

// POST /api/chat/conversations/:id/messages — send (JSON or multipart media).
router.post(
  "/conversations/:id/messages",
  multipart,
  authenticate,
  validate({ params: conversationIdParamSchema, body: jsonBodySchema }),
  chatController.sendMessage
);

// POST /api/chat/messages — send with the conversation id in the body
// (legacy wire shape; the app's chat screen uses this one).
router.post(
  "/messages",
  multipart,
  authenticate,
  validate({ body: jsonBodySchema }),
  chatController.sendMessage
);

// POST /api/chat/conversations/:id/read — zero the caller's unread counter.
router.post("/conversations/:id/read", authenticate, validate({ params: conversationIdParamSchema }), chatController.markRead);

// POST /api/chat/conversations/:id/mute — mute for the caller.
router.post("/conversations/:id/mute", authenticate, validate({ params: conversationIdParamSchema }), chatController.mute);

// DELETE /api/chat/conversations/:id/mute — unmute (legacy POST .../unmute).
router.delete("/conversations/:id/mute", authenticate, validate({ params: conversationIdParamSchema }), chatController.unmute);

// POST /api/chat/conversations/:id/clear — hide this user's older messages.
router.post("/conversations/:id/clear", authenticate, validate({ params: conversationIdParamSchema }), chatController.clear);

// DELETE /api/chat/conversations/:id — hide/delete for the caller.
router.delete("/conversations/:id", authenticate, validate({ params: conversationIdParamSchema }), chatController.remove);
