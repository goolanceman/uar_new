/**
 * Realtime schemas — Zod definitions for /api/realtime requests.
 * Validation messages match the legacy route errors exactly so existing
 * clients see identical responses.
 */
import { z } from "zod";

// ─── POST /agora-token ───────────────────────────────────────────────────────

/** {channelName} — legacy coerced String(body.channelName ?? "").trim() and
 *  400'd when empty; empty strings/missing fields reject with the same
 *  message (numbers/objects coerce silently, as before). */
export const agoraTokenSchema = z.object({
  channelName: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "The channel name field is required")
  ),
});
export type AgoraTokenBody = z.infer<typeof agoraTokenSchema>;

// POST /auth performs no schema validation: the legacy handler answered
// missing {socket_id, channel_name} with a 401 authorization response (not a
// 400 validation error), so the field checks stay inline in the controller.
