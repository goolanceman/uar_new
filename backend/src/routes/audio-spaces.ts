/**
 * Audio space routes — /api/audio-spaces/* (GENERIC: shared by web + mobile).
 *
 * Replaces the mobile-only compat endpoints (AudioSpaceController.php via
 * src/routes/mobile/chat-audio.ts): same business logic
 * (src/lib/community/audio-spaces.ts), but the generic REST contract —
 * Bearer JWT auth (requireAuth), raw JSON (no envelope), camelCase fields,
 * paged() lists, ApiError → {error}.
 *
 * Endpoints (legacy equivalent in brackets):
 *   GET    /                              [GET /audio-spaces]
 *   GET    /:id                           [GET /audio-spaces/:id]
 *   POST   /                              [POST /audio-spaces]
 *   PATCH  /:id                           [PUT /audio-spaces/:id]
 *   DELETE /:id                           [DELETE /audio-spaces/:id]
 *   POST   /:id/join                      [POST /audio-spaces/:id/join]
 *   POST   /:id/leave                     [POST /audio-spaces/:id/leave]
 *   POST   /:id/participants/:userId/role  [POST /audio-spaces/:id/participants/:userId/type]
 *   POST   /:id/participants/:userId/mic   [POST /audio-spaces/:id/participants/:userId/mic]
 *   POST   /:id/participants/:userId/kick  [POST /audio-spaces/:id/participants/:userId/kick]
 *   GET    /:id/messages                   [GET /audio-spaces/:id/messages]
 *   POST   /:id/messages                   [POST /audio-spaces/:id/messages]
 */
import { Router } from "express";
import { requireAuth, json, handleError } from "@/lib/session";
import { logger } from "@/lib/logger";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  listAudioSpaces,
  getAudioSpace,
  createAudioSpace,
  updateAudioSpace,
  deleteAudioSpace,
  joinAudioSpace,
  leaveAudioSpace,
  changeParticipantRole,
  toggleParticipantMic,
  kickParticipant,
  getAudioSpaceMessages,
  sendAudioSpaceMessage,
} from "@/lib/community/audio-spaces";

export const router = Router();

const log = logger.child("audio-spaces");

// GET /api/audio-spaces — public spaces + mine, newest first.
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const all = await listAudioSpaces(session.userId);
    return json(res, paged(all.slice(skip, skip + limit), page, limit, all.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/audio-spaces — create with a client-supplied id (the Agora
// channel name) + initial participants.
router.post("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const space = await createAudioSpace(session.userId, (req.body ?? {}) as Record<string, unknown>);
    log.info("audio_space_created", { spaceId: space.id, actor: session.userId });
    return json(res, space, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/audio-spaces/:id
router.get("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await getAudioSpace(session.userId, String(req.params.id)));
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/audio-spaces/:id — upsert participants (admin only).
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const spaceId = String(req.params.id);
    const users = (req.body ?? {}).users;
    const space = await updateAudioSpace(session.userId, spaceId, { users });
    log.info("audio_space_updated", { spaceId, actor: session.userId });
    return json(res, space);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/audio-spaces/:id — end the space (admin only).
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const spaceId = String(req.params.id);
    const space = await deleteAudioSpace(session.userId, spaceId);
    log.info("audio_space_ended", { spaceId, actor: session.userId });
    return json(res, space);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/audio-spaces/:id/join
router.post("/:id/join", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const spaceId = String(req.params.id);
    const result = await joinAudioSpace(session.userId, spaceId);
    if (result.joined) {
      log.info("audio_space_joined", { spaceId, actor: session.userId });
    } else {
      log.debug("audio_space_already_joined", { spaceId, actor: session.userId });
    }
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/audio-spaces/:id/leave
router.post("/:id/leave", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const spaceId = String(req.params.id);
    const result = await leaveAudioSpace(session.userId, spaceId);
    log.info("audio_space_left", { spaceId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/audio-spaces/:id/participants/:userId/role — admin changes a
// participant's role ({type: "host"|"listener"|...}).
router.post("/:id/participants/:userId/role", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const type = b.type ?? (b as Record<string, unknown>).role;
    const spaceId = String(req.params.id);
    const participantId = String(req.params.userId);
    const result = await changeParticipantRole(session.userId, spaceId, participantId, type);
    log.info("participant_role_changed", {
      spaceId,
      participantId,
      actor: session.userId,
      role: result.type,
    });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/audio-spaces/:id/participants/:userId/mic — self or admin
// ({micStatus: "on"|"muted"}).
router.post("/:id/participants/:userId/mic", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const micStatus = b.micStatus ?? (b as Record<string, unknown>).mic_status;
    const spaceId = String(req.params.id);
    const participantId = String(req.params.userId);
    const result = await toggleParticipantMic(session.userId, spaceId, participantId, micStatus);
    log.info("participant_mic_toggled", {
      spaceId,
      participantId,
      actor: session.userId,
      micStatus: result.micStatus,
    });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/audio-spaces/:id/participants/:userId/kick — admin only.
router.post("/:id/participants/:userId/kick", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const spaceId = String(req.params.id);
    const participantId = String(req.params.userId);
    await kickParticipant(session.userId, spaceId, participantId);
    log.info("participant_kicked", { spaceId, participantId, actor: session.userId });
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/audio-spaces/:id/messages — newest page, oldest first.
router.get("/:id/messages", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    const items = await getAudioSpaceMessages(session.userId, String(req.params.id), limit);
    return json(res, paged(items, 1, limit, items.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/audio-spaces/:id/messages — client-supplied message id.
router.post("/:id/messages", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const spaceId = String(req.params.id);
    const message = await sendAudioSpaceMessage(session.userId, spaceId, (req.body ?? {}) as Record<string, unknown>);
    log.info("audio_space_message_sent", { messageId: message.id, spaceId, actor: session.userId });
    return json(res, message, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
