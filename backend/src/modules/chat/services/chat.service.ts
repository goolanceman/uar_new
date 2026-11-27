/**
 * Chat service — orchestration over the shared chat domain module. Depends on
 * the repository contract, throws application errors, never touches HTTP.
 * The conversationId/type field checks keep the exact legacy 400 messages and
 * ordering (before the shared sendChatMessage's own validation), and every
 * log event keeps its legacy name.
 */
import { logger } from "@/infrastructure/logging/logger";
import { paged } from "@/domains/community/serializers";
import { ApiError } from "@/shared/errors";
import type { Session } from "@/infrastructure/auth/session";
import type { ChatRepository, SendMessageOptions } from "../repositories/chat.repository.interface";
import type { ListConversationsQuery, ListMessagesQuery } from "../schemas/chat.schema";

const log = logger.child("chat");

/** Raw request fields for a message send (extracted by the controller — file
 *  reading and the store callback need the HTTP request). */
export interface SendMessageRequest {
  /** Conversation id from the URL param (POST /conversations/:id/messages),
   *  null for POST /messages where it comes from the body. */
  conversationIdParam: string | null;
  conversationId: string | null;
  conversationIdSnake: string | null;
  message: string | null;
  typeRaw: unknown;
  mediaFile: File | null;
  thumbnailFile: File | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  replyToMessageId: string | null;
  storyId: string | null;
  store: (file: File) => Promise<string>;
}

export class ChatService {
  constructor(private readonly chatRepository: ChatRepository) {}

  /** GET /api/chat/conversations — my conversations, newest activity first. */
  async listConversations(session: Session, query: ListConversationsQuery) {
    const skip = (query.page - 1) * query.limit;
    const all = await this.chatRepository.listConversations(session.userId);
    return paged(all.slice(skip, skip + query.limit), query.page, query.limit, all.length);
  }

  /** POST /api/chat/conversations — create-or-get a 1:1 conversation ({userId}). */
  async createConversation(
    session: Session,
    fields: { userId: string | null; userIdSnake: string | null }
  ) {
    const userId = fields.userId ?? fields.userIdSnake;
    const conversation = await this.chatRepository.createOrGetConversation(session.userId, userId ?? "");
    if (conversation.created) {
      log.info("conversation_created", {
        conversationId: conversation.id,
        actor: session.userId,
        otherUserId: userId ?? "",
      });
    } else {
      log.debug("conversation_existing", { conversationId: conversation.id, actor: session.userId });
    }
    return conversation;
  }

  /** GET /api/chat/conversations/:id/messages — cursor page (?before=&limit=).
   *  Fetching marks the conversation read for the caller (legacy auto-read). */
  async listMessages(session: Session, conversationId: string, query: ListMessagesQuery) {
    return this.chatRepository.getMessagesPage(session.userId, conversationId, query.before, query.limit);
  }

  /** Shared message-send flow for POST /messages + POST /conversations/:id/messages. */
  async sendMessage(session: Session, data: SendMessageRequest) {
    const cid = data.conversationIdParam ?? data.conversationId ?? data.conversationIdSnake;
    if (!cid) throw new ApiError("The conversationId field is required", 400);

    const typeRaw = data.typeRaw;
    if (typeRaw === undefined || typeRaw === null || typeRaw === "") {
      throw new ApiError("The type field is required", 400);
    }
    const type = Number(typeRaw);

    const opts: SendMessageOptions = {
      conversationId: cid,
      message: data.message,
      type,
      mediaFile: data.mediaFile,
      thumbnailFile: data.thumbnailFile,
      mediaUrl: data.mediaUrl,
      thumbnailUrl: data.thumbnailUrl,
      replyToMessageId: data.replyToMessageId,
      storyId: data.storyId,
      store: data.store,
    };
    const message = await this.chatRepository.sendChatMessage(session.userId, session.name, opts);
    log.info("message_sent", {
      messageId: message.id,
      conversationId: message.conversationId,
      actor: session.userId,
      type,
    });
    return message;
  }

  /** POST /api/chat/conversations/:id/read — zero the caller's unread counter. */
  async markRead(session: Session, conversationId: string) {
    const result = await this.chatRepository.markRead(session.userId, conversationId);
    log.info("conversation_read", { conversationId, actor: session.userId });
    return result;
  }

  /** POST /api/chat/conversations/:id/mute — mute for the caller. */
  async mute(session: Session, conversationId: string) {
    const result = await this.chatRepository.muteConversation(session.userId, conversationId);
    log.info("conversation_muted", { conversationId, actor: session.userId });
    return result;
  }

  /** DELETE /api/chat/conversations/:id/mute — unmute (legacy POST .../unmute). */
  async unmute(session: Session, conversationId: string) {
    const result = await this.chatRepository.unmuteConversation(session.userId, conversationId);
    log.info("conversation_unmuted", { conversationId, actor: session.userId });
    return result;
  }

  /** POST /api/chat/conversations/:id/clear — hide this user's older messages. */
  async clear(session: Session, conversationId: string) {
    const result = await this.chatRepository.clearConversation(session.userId, conversationId);
    log.info("conversation_cleared", { conversationId, actor: session.userId });
    return result;
  }

  /** DELETE /api/chat/conversations/:id — hide/delete for the caller. */
  async remove(session: Session, conversationId: string) {
    const result = await this.chatRepository.deleteConversation(session.userId, conversationId);
    log.info("conversation_deleted", { conversationId, actor: session.userId });
    return result;
  }
}
