/**
 * Audio-space service — orchestrates the shared community audio-space lib
 * (create/join/leave, participant roles, mic state, kick, chat messages) and
 * adds the route-level logging + paging the legacy router performed, with
 * the same child logger name and event names.
 */
import { logger } from "@/infrastructure/logging/logger";
import { paged } from "@/domains/community/serializers";
import type {
  AudioMessageWire,
  AudioSpaceListPayload,
  AudioSpaceRepository,
  AudioSpaceWire,
  AudioMessageListPayload,
  JoinResult,
  MicResult,
  OkResult,
  RoleResult,
} from "../repositories/audio-space.repository.interface";

const log = logger.child("audio-spaces");

export class AudioSpaceService {
  constructor(private readonly audioSpaceRepository: AudioSpaceRepository) {}

  /** GET /api/audio-spaces — public spaces + mine, newest first. */
  async list(userId: string, page: number, limit: number, skip: number): Promise<AudioSpaceListPayload> {
    const all = await this.audioSpaceRepository.list(userId);
    return paged(all.slice(skip, skip + limit), page, limit, all.length) as AudioSpaceListPayload;
  }

  /** POST /api/audio-spaces — create with a client-supplied id (the Agora
   *  channel name) + initial participants. */
  async create(userId: string, body: Record<string, unknown>): Promise<AudioSpaceWire> {
    const space = await this.audioSpaceRepository.create(userId, body);
    log.info("audio_space_created", { spaceId: space.id, actor: userId });
    return space;
  }

  /** GET /api/audio-spaces/:id */
  async get(userId: string, id: string): Promise<AudioSpaceWire> {
    return this.audioSpaceRepository.get(userId, id);
  }

  /** PATCH /api/audio-spaces/:id — upsert participants (admin only). */
  async update(userId: string, spaceId: string, users: unknown): Promise<OkResult> {
    const space = await this.audioSpaceRepository.update(userId, spaceId, users);
    log.info("audio_space_updated", { spaceId, actor: userId });
    return space;
  }

  /** DELETE /api/audio-spaces/:id — end the space (admin only). */
  async end(userId: string, spaceId: string): Promise<OkResult> {
    const space = await this.audioSpaceRepository.end(userId, spaceId);
    log.info("audio_space_ended", { spaceId, actor: userId });
    return space;
  }

  /** POST /api/audio-spaces/:id/join */
  async join(userId: string, spaceId: string): Promise<JoinResult> {
    const result = await this.audioSpaceRepository.join(userId, spaceId);
    if (result.joined) {
      log.info("audio_space_joined", { spaceId, actor: userId });
    } else {
      log.debug("audio_space_already_joined", { spaceId, actor: userId });
    }
    return result;
  }

  /** POST /api/audio-spaces/:id/leave */
  async leave(userId: string, spaceId: string): Promise<OkResult> {
    const result = await this.audioSpaceRepository.leave(userId, spaceId);
    log.info("audio_space_left", { spaceId, actor: userId });
    return result;
  }

  /** POST /api/audio-spaces/:id/participants/:userId/role — admin changes a
   *  participant's role ({type: "host"|"listener"|...}). */
  async changeRole(userId: string, spaceId: string, participantId: string, type: unknown): Promise<RoleResult> {
    const result = await this.audioSpaceRepository.changeRole(userId, spaceId, participantId, type);
    log.info("participant_role_changed", {
      spaceId,
      participantId,
      actor: userId,
      role: result.type,
    });
    return result;
  }

  /** POST /api/audio-spaces/:id/participants/:userId/mic — self or admin
   *  ({micStatus: "on"|"muted"}). */
  async toggleMic(userId: string, spaceId: string, participantId: string, micStatus: unknown): Promise<MicResult> {
    const result = await this.audioSpaceRepository.toggleMic(userId, spaceId, participantId, micStatus);
    log.info("participant_mic_toggled", {
      spaceId,
      participantId,
      actor: userId,
      micStatus: result.micStatus,
    });
    return result;
  }

  /** POST /api/audio-spaces/:id/participants/:userId/kick — admin only. */
  async kick(userId: string, spaceId: string, participantId: string): Promise<OkResult> {
    await this.audioSpaceRepository.kick(userId, spaceId, participantId);
    log.info("participant_kicked", { spaceId, participantId, actor: userId });
    return { ok: true };
  }

  /** GET /api/audio-spaces/:id/messages — newest page, oldest first. */
  async messages(userId: string, spaceId: string, limit: number): Promise<AudioMessageListPayload> {
    const items = await this.audioSpaceRepository.messages(userId, spaceId, limit);
    return paged(items, 1, limit, items.length) as AudioMessageListPayload;
  }

  /** POST /api/audio-spaces/:id/messages — client-supplied message id. */
  async sendMessage(userId: string, spaceId: string, body: Record<string, unknown>): Promise<AudioMessageWire> {
    const message = await this.audioSpaceRepository.sendMessage(userId, spaceId, body);
    log.info("audio_space_message_sent", { messageId: message.id, spaceId, actor: userId });
    return message;
  }
}
