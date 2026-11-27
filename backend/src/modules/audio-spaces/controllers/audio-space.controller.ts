/**
 * Audio-space controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  AudioSpaceIdParams,
  CreateAudioSpaceBody,
  ListAudioSpaceMessagesQuery,
  ListAudioSpacesQuery,
  ParticipantMicBody,
  ParticipantParams,
  ParticipantRoleBody,
  SendAudioSpaceMessageBody,
  UpdateAudioSpaceBody,
} from "../schemas/audio-space.schema";
import type { AudioSpaceService } from "../services/audio-space.service";

export class AudioSpaceController {
  constructor(private readonly audioSpaceService: AudioSpaceService) {}

  /** GET /api/audio-spaces — public spaces + mine, newest first. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = validatedQuery<ListAudioSpacesQuery>(req);
      const payload = await this.audioSpaceService.list(req.session!.userId, page, limit, (page - 1) * limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/audio-spaces — create with a client-supplied id (the Agora
   *  channel name) + initial participants. */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<CreateAudioSpaceBody>(req) ?? {};
      const space = await this.audioSpaceService.create(req.session!.userId, body);
      res.status(201).json(space);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/audio-spaces/:id */
  get: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<AudioSpaceIdParams>(req);
      const space = await this.audioSpaceService.get(req.session!.userId, id);
      res.json(space);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/audio-spaces/:id — upsert participants (admin only). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<AudioSpaceIdParams>(req);
      const body = validatedBody<UpdateAudioSpaceBody>(req) ?? {};
      const space = await this.audioSpaceService.update(req.session!.userId, id, body.users);
      res.json(space);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/audio-spaces/:id — end the space (admin only). */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<AudioSpaceIdParams>(req);
      const space = await this.audioSpaceService.end(req.session!.userId, id);
      res.json(space);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/audio-spaces/:id/join */
  join: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<AudioSpaceIdParams>(req);
      const result = await this.audioSpaceService.join(req.session!.userId, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/audio-spaces/:id/leave */
  leave: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<AudioSpaceIdParams>(req);
      const result = await this.audioSpaceService.leave(req.session!.userId, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/audio-spaces/:id/participants/:userId/role — admin changes a
   *  participant's role ({type: "host"|"listener"|...} — the legacy
   *  snake_case `role` key is still honored as fallback). */
  changeRole: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, userId: participantId } = validatedParams<ParticipantParams>(req);
      const b = validatedBody<ParticipantRoleBody>(req) ?? {};
      const type = b.type ?? b.role;
      const result = await this.audioSpaceService.changeRole(req.session!.userId, id, participantId, type);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/audio-spaces/:id/participants/:userId/mic — self or admin
   *  ({micStatus: "on"|"muted"} — the legacy snake_case `mic_status` key is
   *  still honored as fallback). */
  toggleMic: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, userId: participantId } = validatedParams<ParticipantParams>(req);
      const b = validatedBody<ParticipantMicBody>(req) ?? {};
      const micStatus = b.micStatus ?? b.mic_status;
      const result = await this.audioSpaceService.toggleMic(req.session!.userId, id, participantId, micStatus);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/audio-spaces/:id/participants/:userId/kick — admin only. */
  kick: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, userId: participantId } = validatedParams<ParticipantParams>(req);
      const result = await this.audioSpaceService.kick(req.session!.userId, id, participantId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/audio-spaces/:id/messages — newest page, oldest first. */
  messages: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<AudioSpaceIdParams>(req);
      const { limit } = validatedQuery<ListAudioSpaceMessagesQuery>(req);
      const payload = await this.audioSpaceService.messages(req.session!.userId, id, limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/audio-spaces/:id/messages — client-supplied message id. */
  sendMessage: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<AudioSpaceIdParams>(req);
      const body = validatedBody<SendAudioSpaceMessageBody>(req) ?? {};
      const message = await this.audioSpaceService.sendMessage(req.session!.userId, id, body);
      res.status(201).json(message);
    } catch (error) {
      next(error);
    }
  };
}
