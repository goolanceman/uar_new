/**
 * Audio-space schemas — /api/audio-spaces input.
 *
 * Most validation lives in the shared domain lib
 * (src/lib/community/audio-spaces.ts), which throws the exact legacy
 * ApiErrors (client-supplied ids, participant types, mic statuses). Those
 * bodies are passed through untouched (z.any()) so no new rejections are
 * invented. Only the pagination / messages-limit query params are parsed
 * here, mirroring the legacy expressions verbatim.
 */
import { z } from "zod";

/** pageParams(req.query) written out verbatim: page =
 *  Math.max(1, parseInt(String(v ?? "1"), 10) || 1); limit =
 *  Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20)) —
 *  exact legacy pagination parity (default 20, max 100). */
export const listAudioSpacesQuerySchema = z.object({
  page: z.preprocess((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1), z.number()),
  limit: z.preprocess((v) => Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20)), z.number()),
});
export type ListAudioSpacesQuery = z.infer<typeof listAudioSpacesQuerySchema>;

/** GET /:id/messages limit over the RAW qs value:
 *  Math.min(1000, Math.max(1, Number(req.query.limit) || 100)) — a Number()
 *  of an array/object/NaN falls back to 100, exactly like legacy. */
export const listAudioSpaceMessagesQuerySchema = z.object({
  limit: z.preprocess((v) => Math.min(1000, Math.max(1, Number(v) || 100)), z.number()),
});
export type ListAudioSpaceMessagesQuery = z.infer<typeof listAudioSpaceMessagesQuerySchema>;

// ─── Path params ────────────────────────────────────────────────────────────
// :id / :userId stay raw strings — the shared lib validates existence (404s)
// exactly where the legacy handler did.

export const audioSpaceIdParamSchema = z.object({ id: z.string() });
export type AudioSpaceIdParams = z.infer<typeof audioSpaceIdParamSchema>;

export const participantParamsSchema = z.object({ id: z.string(), userId: z.string() });
export type ParticipantParams = z.infer<typeof participantParamsSchema>;

// ─── Bodies (passed untouched into the shared lib — it owns every check) ────

export const createAudioSpaceBodySchema = z.any();
export type CreateAudioSpaceBody = Record<string, unknown>;

export const updateAudioSpaceBodySchema = z.any();
export type UpdateAudioSpaceBody = Record<string, unknown>;

export const participantRoleBodySchema = z.any();
export type ParticipantRoleBody = Record<string, unknown>;

export const participantMicBodySchema = z.any();
export type ParticipantMicBody = Record<string, unknown>;

export const sendAudioSpaceMessageBodySchema = z.any();
export type SendAudioSpaceMessageBody = Record<string, unknown>;
