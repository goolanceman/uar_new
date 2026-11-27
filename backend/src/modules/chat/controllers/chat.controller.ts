/**
 * Chat controller — HTTP layer only. Extracts validated data / session /
 * multipart files, delegates to the service, returns the response. Errors
 * flow to the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { type MulterFile } from "@/lib/multipart";
import type { Session } from "@/lib/session";
import type {
  ConversationIdParams,
  JsonBody,
  ListConversationsQuery,
  ListMessagesQuery,
} from "../schemas/chat.schema";
import type { ChatService } from "../services/chat.service";

/** Grab one uploaded file by its multipart field name (legacy 'media'/'thumbnail'). */
function fileByField(req: Request, field: string): File | null {
  const files = ((req.files ?? []) as unknown as (MulterFile & { fieldname: string })[]) ?? [];
  const f = files.find((x) => x.fieldname === field);
  if (!f) return null;
  return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
}

/** String field from the JSON/multipart body. */
function strField(body: Record<string, unknown> | undefined, key: string): string | null {
  const v = (body ?? {})[key];
  return v === undefined || v === null || v === "" ? null : String(v);
}

export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Store an uploaded file and return its absolute public URL (routes/files.ts). */
  private async storeUpload(req: Request, session: Session, file: File): Promise<string> {
    const { saveUpload } = await import("@/lib/files");
    const asset = await saveUpload(file, { folder: "chat", uploadedBy: { id: session.userId, name: session.name } });
    const host = req.get("host") ?? "localhost";
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
    return `${proto}://${host}/api/files/${asset.id}/file`;
  }

  /** GET /api/chat/conversations — my conversations, newest activity first. */
  listConversations: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListConversationsQuery>(req);
      const payload = await this.chatService.listConversations(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/chat/conversations — create-or-get a 1:1 conversation ({userId}). */
  createConversation: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<JsonBody>(req);
      const conversation = await this.chatService.createConversation(req.session!, {
        userId: strField(body, "userId"),
        userIdSnake: strField(body, "user_id"),
      });
      res.json(conversation);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/chat/conversations/:id/messages — cursor page (?before=<messageId>&limit=). */
  listMessages: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ConversationIdParams>(req);
      const query = validatedQuery<ListMessagesQuery>(req);
      const result = await this.chatService.listMessages(req.session!, id, query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** Shared handler for POST /conversations/:id/messages + POST /messages —
   *  send (JSON or multipart media); 201 with the wire message. */
  sendMessage: RequestHandler = async (req, res, next) => {
    try {
      const session = req.session!;
      const params = validatedParams<ConversationIdParams | undefined>(req);
      const body = validatedBody<JsonBody>(req);
      const message = await this.chatService.sendMessage(session, {
        conversationIdParam: params ? params.id : null,
        conversationId: strField(body, "conversationId"),
        conversationIdSnake: strField(body, "conversation_id"),
        message: strField(body, "message"),
        typeRaw: (body ?? {}).type,
        mediaFile: fileByField(req, "media"),
        thumbnailFile: fileByField(req, "thumbnail"),
        mediaUrl: strField(body, "mediaUrl") ?? strField(body, "media_url"),
        thumbnailUrl: strField(body, "thumbnailUrl") ?? strField(body, "thumbnail_url"),
        replyToMessageId: strField(body, "replyToMessageId") ?? strField(body, "reply_to_message_id"),
        storyId: strField(body, "storyId") ?? strField(body, "story_id"),
        store: (file) => this.storeUpload(req, session, file),
      });
      res.status(201).json(message);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/chat/conversations/:id/read — zero the caller's unread counter. */
  markRead: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ConversationIdParams>(req);
      const result = await this.chatService.markRead(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/chat/conversations/:id/mute — mute for the caller. */
  mute: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ConversationIdParams>(req);
      const result = await this.chatService.mute(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/chat/conversations/:id/mute — unmute (legacy POST .../unmute). */
  unmute: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ConversationIdParams>(req);
      const result = await this.chatService.unmute(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/chat/conversations/:id/clear — hide this user's older messages. */
  clear: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ConversationIdParams>(req);
      const result = await this.chatService.clear(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/chat/conversations/:id — hide/delete for the caller. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ConversationIdParams>(req);
      const result = await this.chatService.remove(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
