/**
 * Prisma implementation of the realtime repository — the ONLY place in the
 * realtime module that touches Prisma models directly. All lookups here are
 * read-only existence checks (no unique/FK violation risk).
 */
import { db } from "@/infrastructure/database/prisma";
import type { RealtimeRepository } from "./realtime.repository.interface";

export class PrismaRealtimeRepository implements RealtimeRepository {
  async findRoom(roomId: string): Promise<{ id: string; adminId: string } | null> {
    return db.communityRoom.findUnique({
      where: { id: roomId },
      select: { id: true, adminId: true },
    });
  }

  async findRoomMember(roomId: string, userId: string): Promise<{ id: string } | null> {
    return db.communityRoomUser.findFirst({
      where: { roomId, userId },
      select: { id: true },
    });
  }

  async findSpaceById(id: string): Promise<{ id: string } | null> {
    return db.audioSpace.findUnique({
      where: { id },
      select: { id: true },
    });
  }

  async findSpaceParticipant(spaceId: string, userId: string): Promise<{ id: string } | null> {
    return db.audioSpaceParticipant.findFirst({
      where: { audioSpaceId: spaceId, userId },
      select: { id: true },
    });
  }
}
