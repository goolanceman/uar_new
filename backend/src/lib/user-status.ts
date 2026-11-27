import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ApiError, logActivity } from "@/lib/session";

const log = logger.child("user-status");

/**
 * User account status — single owner of all User.status writes.
 *
 * States (prisma/schema.prisma User.status):
 *   ACTIVE | PENDING | SUSPENDED   (PENDING = volunteer awaiting approval)
 *
 * Transitions are at ADMIN discretion (the admin console exposes all three in
 * its status dropdown), so the machine enforces membership rather than an
 * order — but every write goes through `setUserStatus` so it is validated and
 * audit-logged in exactly one place.
 *
 * Callers:
 *  - PATCH /api/volunteer-applications/:id  (approval flips PENDING → ACTIVE)
 *  - PATCH /api/users/:id                   (admin edit)
 *  - PATCH /api/volunteers/:id              (volunteer status mirrored to the account)
 */
export const USER_STATUSES = ["ACTIVE", "PENDING", "SUSPENDED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export async function setUserStatus(
  userId: string,
  to: UserStatus | string,
  opts: { actorName?: string | null; actorId?: string; reason?: string; isActive?: boolean } = {}
): Promise<{ id: string; status: string; changed: boolean }> {
  const target = String(to).trim().toUpperCase() as UserStatus;
  if (!USER_STATUSES.includes(target))
    throw new ApiError(`Invalid user status: ${target}`, 400);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, status: true },
  });
  if (!user) {
    log.warn("user_status_not_found", { userId, to: target });
    throw new ApiError("User not found", 404);
  }

  if (user.status === target) {
    // Same status — still honour an explicit isActive correction if provided.
    log.debug("user_status_unchanged", { userId, status: target });
    if (opts.isActive !== undefined)
      await db.user.update({ where: { id: userId }, data: { isActive: opts.isActive } });
    return { id: userId, status: target, changed: false };
  }

  const data: { status: string; isActive?: boolean } = { status: target };
  if (opts.isActive !== undefined) data.isActive = opts.isActive;
  await db.user.update({ where: { id: userId }, data });
  log.info("user_status_changed", {
    userId,
    from: user.status,
    to: target,
    actor: opts.actorId ?? userId,
  });

  await logActivity(
    opts.actorName ?? "system",
    "USER_STATUS",
    "User",
    `${user.name}: ${user.status} → ${target}${opts.reason ? ` — ${opts.reason}` : ""}`,
    opts.actorId ?? userId
  );
  return { id: userId, status: target, changed: true };
}
