/**
 * Denormalized community counters — moved out of the mobile compat layer so
 * the generic routers reuse the same implementation.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Recompute app_posts.comments_count from the live comment rows (comments by
 * non-blocked users — what the comments feed returns). Scope to the given
 * posts, the posts a user has commented on, or every post when neither is
 * given.
 */
export async function syncPostCommentCounts(scope: { postIds?: string[]; commenterId?: string } = {}) {
  let filter = Prisma.empty;
  if (scope.postIds) {
    if (scope.postIds.length === 0) return;
    filter = Prisma.sql`WHERE p."id" IN (${Prisma.join(scope.postIds)})`;
  } else if (scope.commenterId) {
    filter = Prisma.sql`WHERE p."id" IN (SELECT "post_id" FROM "app_comments" WHERE "user_id" = ${scope.commenterId})`;
  }
  await db.$executeRaw`
    UPDATE "app_posts" p SET "comments_count" = (
      SELECT count(*)::int FROM "app_comments" c
      INNER JOIN "users" u ON u."id" = c."user_id"
      WHERE c."post_id" = p."id" AND u."isBlock" = 0
    ) ${filter}`;
}
