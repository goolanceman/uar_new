/**
 * Chat schemas — request definitions for /api/chat/*.
 *
 * The legacy handlers read the query with pageParams()/Number() coercion and
 * the body with hand-rolled strField() checks interleaved with lib lookups
 * (the conversationId/type checks run before the shared sendChatMessage's own
 * validation), so every field check stays in the service: the query schemas
 * reproduce the coercion expressions verbatim and the body schema is a
 * permissive envelope.
 */
import { z } from "zod";

// ─── GET /api/chat/conversations ─────────────────────────────────────────────

/** Legacy pageParams(req.query): parseInt(String(v)) || default, page floored
 *  at 1, limit clamped to [1, 100] (default 20). */
export const listConversationsQuerySchema = z.object({
  page: z.any().optional().transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
  limit: z.any().optional().transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20))),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

// ─── GET /api/chat/conversations/:id/messages ────────────────────────────────

/** Legacy: limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
 *  before = req.query.before ? String(req.query.before) : null. */
export const listMessagesQuerySchema = z.object({
  limit: z.any().optional().transform((v) => Math.min(100, Math.max(1, Number(v) || 50))),
  before: z.any().optional().transform((v) => (v ? String(v) : null)),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

// ─── Params (cuid conversation ids — Express only matches non-empty) ─────────

export const conversationIdParamSchema = z.object({
  id: z.string().min(1),
});
export type ConversationIdParams = z.infer<typeof conversationIdParamSchema>;

// ─── POST bodies (JSON or multipart) ─────────────────────────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}` through strField()
 *  and validated the conversationId/type fields mid-flow so their exact
 *  400 messages and ordering (before sendChatMessage's own checks) are kept
 *  in the service. Multipart file extraction stays in the controller. */
export const jsonBodySchema = z.any();
export type JsonBody = Record<string, unknown>;
