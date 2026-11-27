/**
 * Realtime repository contract — persistence checks used by channel
 * authorization and Agora token minting. The service depends on this
 * interface, never on Prisma directly.
 */
export interface RealtimeRoomRow {
  id: string;
  adminId: string;
}

export interface RealtimeSpaceRef {
  id: string;
}

export interface RealtimeRepository {
  /** Community room row (admin check) — legacy findUnique in /auth. */
  findRoom(roomId: string): Promise<RealtimeRoomRow | null>;
  /** Any membership row for the room — legacy findFirst in /auth. */
  findRoomMember(roomId: string, userId: string): Promise<{ id: string } | null>;
  /** Audio space by exact channel id — legacy findUnique in /agora-token. */
  findSpaceById(id: string): Promise<RealtimeSpaceRef | null>;
  /** Participant row of an audio space — legacy findFirst in /agora-token. */
  findSpaceParticipant(spaceId: string, userId: string): Promise<{ id: string } | null>;
}
