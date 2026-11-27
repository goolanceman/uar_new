/**
 * Audio space routes — /api/audio-spaces/* (GENERIC: shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/audio-spaces
 * (routes → controllers → services → repositories, over the shared domain
 * lib src/lib/community/audio-spaces.ts). The historical export path
 * (`@/routes/audio-spaces`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Contract: Bearer/cookie auth (requireAuth), raw JSON (no envelope),
 * camelCase fields, paged() lists, ApiError → {error}.
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
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  audioSpaceIdParamSchema,
  createAudioSpaceBodySchema,
  listAudioSpaceMessagesQuerySchema,
  listAudioSpacesQuerySchema,
  participantMicBodySchema,
  participantParamsSchema,
  participantRoleBodySchema,
  sendAudioSpaceMessageBodySchema,
  updateAudioSpaceBodySchema,
} from "@/modules/audio-spaces/schemas/audio-space.schema";
import { audioSpaceController } from "@/modules/audio-spaces";

export const router = Router();

// GET /api/audio-spaces — public spaces + mine, newest first.
// (Legacy gate: `await requireAuth(req)` as the handler's first step.)
router.get(
  "/",
  authenticate,
  validate({ query: listAudioSpacesQuerySchema }),
  audioSpaceController.list
);

// POST /api/audio-spaces — create with a client-supplied id (the Agora
// channel name) + initial participants.
router.post(
  "/",
  authenticate,
  validate({ body: createAudioSpaceBodySchema }),
  audioSpaceController.create
);

// GET /api/audio-spaces/:id
router.get(
  "/:id",
  authenticate,
  validate({ params: audioSpaceIdParamSchema }),
  audioSpaceController.get
);

// PATCH /api/audio-spaces/:id — upsert participants (admin only).
router.patch(
  "/:id",
  authenticate,
  validate({ params: audioSpaceIdParamSchema, body: updateAudioSpaceBodySchema }),
  audioSpaceController.update
);

// DELETE /api/audio-spaces/:id — end the space (admin only).
router.delete(
  "/:id",
  authenticate,
  validate({ params: audioSpaceIdParamSchema }),
  audioSpaceController.remove
);

// POST /api/audio-spaces/:id/join
router.post(
  "/:id/join",
  authenticate,
  validate({ params: audioSpaceIdParamSchema }),
  audioSpaceController.join
);

// POST /api/audio-spaces/:id/leave
router.post(
  "/:id/leave",
  authenticate,
  validate({ params: audioSpaceIdParamSchema }),
  audioSpaceController.leave
);

// POST /api/audio-spaces/:id/participants/:userId/role — admin changes a
// participant's role ({type: "host"|"listener"|...}).
router.post(
  "/:id/participants/:userId/role",
  authenticate,
  validate({ params: participantParamsSchema, body: participantRoleBodySchema }),
  audioSpaceController.changeRole
);

// POST /api/audio-spaces/:id/participants/:userId/mic — self or admin
// ({micStatus: "on"|"muted"}).
router.post(
  "/:id/participants/:userId/mic",
  authenticate,
  validate({ params: participantParamsSchema, body: participantMicBodySchema }),
  audioSpaceController.toggleMic
);

// POST /api/audio-spaces/:id/participants/:userId/kick — admin only.
router.post(
  "/:id/participants/:userId/kick",
  authenticate,
  validate({ params: participantParamsSchema }),
  audioSpaceController.kick
);

// GET /api/audio-spaces/:id/messages — newest page, oldest first.
router.get(
  "/:id/messages",
  authenticate,
  validate({ params: audioSpaceIdParamSchema, query: listAudioSpaceMessagesQuerySchema }),
  audioSpaceController.messages
);

// POST /api/audio-spaces/:id/messages — client-supplied message id.
router.post(
  "/:id/messages",
  authenticate,
  validate({ params: audioSpaceIdParamSchema, body: sendAudioSpaceMessageBodySchema }),
  audioSpaceController.sendMessage
);
