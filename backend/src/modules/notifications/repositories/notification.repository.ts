/**
 * Prisma implementation of the notification repository — the ONLY place in
 * the notifications module that touches Prisma models directly. (Reads plus
 * isRead updates: no unique/FK violation risk, so no mapPrismaError wrap.)
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import type {
  NotificationRepository,
  NotificationRow,
  NotificationScope,
} from "./notification.repository.interface";

export class PrismaNotificationRepository implements NotificationRepository {
  private whereFor(scope: NotificationScope): Prisma.NotificationWhereInput {
    return scope.userId
      ? { OR: [{ userId: scope.userId }, { userId: null }] }
      : { userId: null };
  }

  async list(scope: NotificationScope, limit: number): Promise<NotificationRow[]> {
    const rows = await db.notification.findMany({
      where: this.whereFor(scope),
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows as NotificationRow[];
  }

  async listPaged(
    scope: NotificationScope,
    skip: number,
    take: number
  ): Promise<{ rows: NotificationRow[]; total: number }> {
    const where = this.whereFor(scope);
    const [rows, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      db.notification.count({ where }),
    ]);
    return { rows: rows as NotificationRow[], total };
  }

  async findById(id: string): Promise<NotificationRow | null> {
    return db.notification.findUnique({ where: { id } }) as Promise<NotificationRow | null>;
  }

  async update(id: string, data: { isRead: boolean }): Promise<NotificationRow> {
    return db.notification.update({ where: { id }, data }) as Promise<NotificationRow>;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }

  async findUserById(id: string): Promise<{ id: string } | null> {
    return db.user.findUnique({ where: { id }, select: { id: true } });
  }

  async findUserByDeviceToken(token: string): Promise<{ id: string } | null> {
    return db.user.findFirst({
      where: { OR: [{ fcmToken: token }, { apnsToken: token }, { deviceToken: token }] },
      select: { id: true },
    });
  }

  async findModeratorFlag(userId: string): Promise<{ isModerator: number } | null> {
    return db.user.findUnique({ where: { id: userId }, select: { isModerator: true } });
  }

  async findConversationById(
    id: string
  ): Promise<{ user1Id: string | null; user2Id: string | null; deletedAt: Date | null } | null> {
    return db.conversation.findUnique({
      where: { id },
      select: { user1Id: true, user2Id: true, deletedAt: true },
    });
  }
}
