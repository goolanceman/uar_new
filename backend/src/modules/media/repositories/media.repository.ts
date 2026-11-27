/**
 * Prisma implementation of the media repository — the ONLY place in the
 * media module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import type { MediaAsset } from "@prisma/client";
import type {
  CreateMediaAssetData,
  MediaRepository,
} from "./media.repository.interface";

export class PrismaMediaRepository implements MediaRepository {
  async countInFlight(ownerId: string, stalePendingBefore: Date): Promise<number> {
    return db.mediaAsset.count({
      where: {
        ownerId,
        status: { in: ["pending_upload", "uploaded", "processing"] },
        OR: [{ status: { not: "pending_upload" } }, { createdAt: { gte: stalePendingBefore } }],
      },
    });
  }

  async create(data: CreateMediaAssetData): Promise<MediaAsset> {
    return db.mediaAsset.create({ data });
  }

  async updateSourceKey(id: string, sourceKey: string): Promise<void> {
    await db.mediaAsset.update({ where: { id }, data: { sourceKey } });
  }

  async findById(id: string): Promise<MediaAsset | null> {
    return db.mediaAsset.findUnique({ where: { id } });
  }

  async findPlaybackRef(id: string): Promise<{ id: string; status: string } | null> {
    return db.mediaAsset.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  }
}
