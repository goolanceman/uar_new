/**
 * Community chat repository implementation — delegates every operation to the
 * shared domain module @/domains/community/chat, which owns ALL chat Prisma
 * access, cache invalidation and realtime event publishing. The conversation
 * and message wire shapes are therefore produced by exactly the legacy code
 * path (byte-identical responses and events).
 */
import {
  clearConversation as clearConversationFn,
  createOrGetConversation as createOrGetConversationFn,
  deleteConversation as deleteConversationFn,
  getMessagesPage as getMessagesPageFn,
  listConversations as listConversationsFn,
  markRead as markReadFn,
  muteConversation as muteConversationFn,
  sendChatMessage as sendChatMessageFn,
  unmuteConversation as unmuteConversationFn,
} from "@/domains/community/chat";
import type { ChatRepository, SendMessageOptions } from "./chat.repository.interface";

export class CommunityChatRepository implements ChatRepository {
  listConversations(me: string): Promise<Awaited<ReturnType<typeof listConversationsFn>>> {
    return listConversationsFn(me);
  }

  createOrGetConversation(
    me: string,
    otherUserId: string
  ): Promise<Awaited<ReturnType<typeof createOrGetConversationFn>>> {
    return createOrGetConversationFn(me, otherUserId);
  }

  getMessagesPage(
    me: string,
    conversationId: string,
    beforeId: string | null,
    limit: number
  ): Promise<Awaited<ReturnType<typeof getMessagesPageFn>>> {
    return getMessagesPageFn(me, conversationId, beforeId, limit);
  }

  sendChatMessage(
    me: string,
    senderName: string,
    opts: SendMessageOptions
  ): Promise<Awaited<ReturnType<typeof sendChatMessageFn>>> {
    return sendChatMessageFn(me, senderName, opts);
  }

  markRead(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof markReadFn>>> {
    return markReadFn(me, conversationId);
  }

  muteConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof muteConversationFn>>> {
    return muteConversationFn(me, conversationId);
  }

  unmuteConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof unmuteConversationFn>>> {
    return unmuteConversationFn(me, conversationId);
  }

  clearConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof clearConversationFn>>> {
    return clearConversationFn(me, conversationId);
  }

  deleteConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof deleteConversationFn>>> {
    return deleteConversationFn(me, conversationId);
  }
}
