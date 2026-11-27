/**
 * Lib-backed audio-space repository — thin delegation to the shared
 * community audio-space helpers (src/lib/community/audio-spaces.ts), which
 * own the Prisma access and domain rules for this module. Named Lib* because
 * the Prisma calls stay in the shared lib (read-only for this module), like
 * the wave-1 LibMusicRepository.
 */
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
import type {
  AudioMessageWire,
  AudioSpaceRepository,
  AudioSpaceWire,
  JoinResult,
  MicResult,
  OkResult,
  RoleResult,
} from "./audio-space.repository.interface";

export class LibAudioSpaceRepository implements AudioSpaceRepository {
  list(userId: string): Promise<AudioSpaceWire[]> {
    return listAudioSpaces(userId);
  }

  get(userId: string, id: string): Promise<AudioSpaceWire> {
    return getAudioSpace(userId, id);
  }

  /** The lib's declared return types the `users` array as
   *  Record<string, unknown>[] (it pushes full wire rows) — widened here to
   *  the wire contract. */
  async create(userId: string, body: Record<string, unknown>): Promise<AudioSpaceWire> {
    return (await createAudioSpace(userId, body)) as unknown as AudioSpaceWire;
  }

  update(userId: string, spaceId: string, users: unknown): Promise<OkResult> {
    return updateAudioSpace(userId, spaceId, { users });
  }

  end(userId: string, spaceId: string): Promise<OkResult> {
    return deleteAudioSpace(userId, spaceId);
  }

  join(userId: string, spaceId: string): Promise<JoinResult> {
    return joinAudioSpace(userId, spaceId);
  }

  leave(userId: string, spaceId: string): Promise<OkResult> {
    return leaveAudioSpace(userId, spaceId);
  }

  changeRole(userId: string, spaceId: string, participantId: string, type: unknown): Promise<RoleResult> {
    return changeParticipantRole(userId, spaceId, participantId, type);
  }

  toggleMic(userId: string, spaceId: string, participantId: string, micStatus: unknown): Promise<MicResult> {
    return toggleParticipantMic(userId, spaceId, participantId, micStatus);
  }

  kick(userId: string, spaceId: string, participantId: string): Promise<OkResult> {
    return kickParticipant(userId, spaceId, participantId);
  }

  messages(userId: string, spaceId: string, limit: number): Promise<AudioMessageWire[]> {
    return getAudioSpaceMessages(userId, spaceId, limit);
  }

  sendMessage(userId: string, spaceId: string, body: Record<string, unknown>): Promise<AudioMessageWire> {
    return sendAudioSpaceMessage(userId, spaceId, body);
  }
}
