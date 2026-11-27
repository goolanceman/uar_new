/**
 * Community user repository contract — persistence for the moderator-block
 * flow. Everything else in this module (profiles, follow graph, blocks,
 * reports) flows through the shared @/domains/community/users domain helpers.
 */
import type { User } from "@prisma/client";

export interface CommunityUserRepository {
  findUserById(id: string): Promise<User | null>;
  /** Sets isBlock = 1 on the target user (legacy moderator-block update). */
  setUserBlocked(id: string): Promise<User>;
  /** Deletes every community report ABOUT the given user. */
  deleteReportsAbout(userId: string): Promise<number>;
}
