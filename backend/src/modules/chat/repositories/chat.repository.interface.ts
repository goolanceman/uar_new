/**
 * Chat repository contract — persistence gateway for conversations/messages.
 * ALL Prisma access and realtime event publishing for chat lives in the
 * shared domain module @/lib/community/chat (read-only shared code, imported
 * by the implementation); this contract exposes exactly the operations the
 * chat endpoints use so the service stays decoupled from HTTP.
 */
import type {
  clearConversation,
  createOrGetConversation,
  deleteConversation,
  getMessagesPage,
  listConversations,
  markRead,
  muteConversation,
  sendChatMessage,
  unmuteConversation,
} from "@/lib/community/chat";

/** Options for sending a message — identical to the shared sendChatMessage
 *  opts. The store callback is injected by the controller: persisting an
 *  upload needs the HTTP request to build the public asset URL. */
export interface SendMessageOptions {
  conversationId: string;
  message: string | null;
  type: number;
  mediaFile: File | null;
  thumbnailFile: File | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  replyToMessageId: string | null;
  storyId: string | null;
  store: (file: File) => Promise<string>;
}

export interface ChatRepository {
  listConversations(me: string): Promise<Awaited<ReturnType<typeof listConversations>>>;
  createOrGetConversation(
    me: string,
    otherUserId: string
  ): Promise<Awaited<ReturnType<typeof createOrGetConversation>>>;
  getMessagesPage(
    me: string,
    conversationId: string,
    beforeId: string | null,
    limit: number
  ): Promise<Awaited<ReturnType<typeof getMessagesPage>>>;
  sendChatMessage(
    me: string,
    senderName: string,
    opts: SendMessageOptions
  ): Promise<Awaited<ReturnType<typeof sendChatMessage>>>;
  markRead(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof markRead>>>;
  muteConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof muteConversation>>>;
  unmuteConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof unmuteConversation>>>;
  clearConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof clearConversation>>>;
  deleteConversation(me: string, conversationId: string): Promise<Awaited<ReturnType<typeof deleteConversation>>>;
}
