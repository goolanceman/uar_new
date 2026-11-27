/**
 * Assistant schemas — request definitions for /api/assistant/chat.
 *
 * The legacy route performs NO schema validation on the chat body: `message`
 * is consumed with the exact expression `(body.message ?? "").trim()` (a
 * non-string value crashes into a 500 exactly like the legacy route), and
 * every other field (`history`, the client-supplied `role`/`userName`) is
 * either leniently filtered or deliberately ignored — the role MUST come from
 * the verified session, never from the body. Encoding any of this in Zod
 * would invent rejections or reword the error contract, so only the wire
 * types are declared here.
 */

/** One turn of client-supplied conversation history. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Raw chat request body — consumed defensively by the controller/service. */
export interface ChatRequestBody {
  message?: unknown;
  history?: ChatMessage[];
  role?: unknown;
  userName?: unknown;
}
