/**
 * Notification repository contract — notification rows and the user /
 * conversation lookups needed by the push gate. The service layer depends on
 * this interface, never on Prisma directly.
 */
export interface NotificationRow {
  id: string;
  userId: string | null;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  actionUrl: string | null;
  sentVia: string | null;
  createdAt: Date;
  data: string | null;
  platform: string | null;
  deviceToken: string | null;
  readAt: Date | null;
}

/** userId: string → the user's rows merged with global (userId: null) rows;
 *  userId: null → global rows only (signed-out visitors). */
export type NotificationScope = { userId: string } | { userId: null };

export interface NotificationRepository {
  list(scope: NotificationScope, limit: number): Promise<NotificationRow[]>;
  listPaged(
    scope: NotificationScope,
    skip: number,
    take: number
  ): Promise<{ rows: NotificationRow[]; total: number }>;
  findById(id: string): Promise<NotificationRow | null>;
  update(id: string, data: { isRead: boolean }): Promise<NotificationRow>;
  markAllRead(userId: string): Promise<number>;

  findUserById(id: string): Promise<{ id: string } | null>;
  findUserByDeviceToken(token: string): Promise<{ id: string } | null>;
  findModeratorFlag(userId: string): Promise<{ isModerator: number } | null>;
  findConversationById(
    id: string
  ): Promise<{ user1Id: string | null; user2Id: string | null; deletedAt: Date | null } | null>;
}
