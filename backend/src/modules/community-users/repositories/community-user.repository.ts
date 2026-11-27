/**
 * Prisma implementation of the community user repository — the ONLY place in
 * the community-users module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { User } from "@prisma/client";
import type { CommunityUserRepository } from "./community-user.repository.interface";

export class PrismaCommunityUserRepository implements CommunityUserRepository {
  async findUserById(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  }

  async setUserBlocked(id: string): Promise<User> {
    return mapPrismaError(() => db.user.update({ where: { id }, data: { isBlock: 1 } }));
  }

  async deleteReportsAbout(userId: string): Promise<number> {
    const result = await db.communityReport.deleteMany({ where: { userId } });
    return result.count;
  }
}
