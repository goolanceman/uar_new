/**
 * Community users service — follow / block / report / profile / search logic
 * shared by the generic /api/community/users router (web + mobile).
 *
 * Ported 1:1 from the legacy mobile handlers (src/routes/mobile/auth-users.ts,
 * UserController.php) onto the generic contract: camelCase fields, actors come
 * from the session (never the body), errors are ApiError.
 */
import { db } from "@/lib/db";
import { ApiError } from "@/lib/session";
import { sendPush } from "@/lib/community/push";
import { communityUser, communityUserSelect, csvList, type CommunityUserRow } from "@/lib/community/serializers";
import { invalidateCatalog } from "@/lib/cache";

/** SavedNotification type for "user followed you" (legacy type 1). */
const NOTIFICATION_TYPE_FOLLOW = 1;

/** CSV helper for the User blocklist columns (string user ids). */
function csvStrs(v: string | null | undefined): string[] {
  return csvList(v);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Account deletion (legacy UserController::deleteUser cascade) ────────────

/**
 * Full self-service account deletion cascade — likes, follows (with counter
 * fixes), owned rooms, reels, posts, comments, stories, verifications,
 * reports, saved notifications and the user row itself.
 */
export async function deleteUserCascade(userId: string): Promise<void> {
  // Likes the user made — fix likes_count on the affected posts (legacy).
  const userLikes = await db.communityLike.findMany({ where: { userId, postId: { not: null } } });
  for (const like of userLikes) {
    if (!like.postId) continue;
    const post = await db.communityPost.findUnique({ where: { id: like.postId }, select: { id: true, likesCount: true } });
    if (post)
      await db.communityPost.update({
        where: { id: post.id },
        data: { likesCount: Math.max(0, post.likesCount - 1) },
      });
  }
  await db.communityLike.deleteMany({ where: { userId } });

  // Follow edges — adjust the remote-side counters.
  const followings = await db.userFollow.findMany({ where: { myUserId: userId } });
  for (const f of followings)
    await db.user.updateMany({
      where: { id: f.userId, followersCount: { gt: 0 } },
      data: { followersCount: { decrement: 1 } },
    });
  const followers = await db.userFollow.findMany({ where: { userId } });
  for (const f of followers)
    await db.user.updateMany({
      where: { id: f.myUserId, followingCount: { gt: 0 } },
      data: { followingCount: { decrement: 1 } },
    });
  await db.userFollow.deleteMany({ where: { myUserId: userId } });
  await db.userFollow.deleteMany({ where: { userId } });

  // Rooms the user owns (members cascade with the room).
  const rooms = await db.communityRoom.findMany({ where: { adminId: userId } });
  for (const room of rooms) {
    await db.communityReport.deleteMany({ where: { roomId: room.id } });
    await db.savedNotification.deleteMany({ where: { roomId: room.id } });
    await db.communityRoom.delete({ where: { id: room.id } });
  }
  if (rooms.length) await invalidateCatalog("interests");

  // Reels — comments, likes, reports and their saved notifications.
  const reels = await db.communityReel.findMany({ where: { userId } });
  for (const reel of reels) {
    const reelComments = await db.communityReelComment.findMany({ where: { reelId: reel.id } });
    for (const rc of reelComments)
      await db.savedNotification.deleteMany({ where: { reelCommentId: rc.id } });
    await db.communityReelComment.deleteMany({ where: { reelId: reel.id } });
    await db.communityLike.deleteMany({ where: { reelId: reel.id } });
    await db.communityReport.deleteMany({ where: { reelId: reel.id } });
    await db.savedNotification.deleteMany({ where: { reelId: reel.id } });
    await db.communityReel.delete({ where: { id: reel.id } });
  }

  // Plain cascades / direct children.
  await db.communityPost.deleteMany({ where: { userId } }); // cascades contents/comments/likes
  const commentedPostIds = (
    await db.communityComment.findMany({ where: { userId }, select: { postId: true }, distinct: ["postId"] })
  ).map((c) => c.postId);
  await db.communityComment.deleteMany({ where: { userId } }); // comments on other people's posts
  await db.communityStory.deleteMany({ where: { userId } });
  await db.profileVerification.deleteMany({ where: { userId } });
  await db.communityReport.deleteMany({ where: { userId } }); // reports about this user
  await db.communityRoomUser.deleteMany({ where: { userId } });
  await db.savedNotification.deleteMany({ where: { myUserId: userId } });
  await db.savedNotification.deleteMany({ where: { userId } });
  await db.notification.deleteMany({ where: { userId } });
  await db.volunteer.deleteMany({ where: { userId } }); // portal profile (Restrict FK)

  // Volunteer applications — link by userId; anonymous applications that were
  // never linked to the account only carry the applicant's email, so those
  // are matched by email (never rows owned by another user id). Without this
  // the admin review list keeps showing a deleted user as PENDING.
  const deletingUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  await db.volunteerApplication.deleteMany({
    where: {
      OR: [
        { userId },
        ...(deletingUser ? [{ userId: null, email: deletingUser.email }] : []),
      ],
    },
  });

  await db.user.delete({ where: { id: userId } });
  void commentedPostIds; // post comment counts are fixed by the cascade above
}

// ─── Profile (legacy fetchProfile) ───────────────────────────────────────────

/**
 * Public profile + follow status + block flags. Stories are exposed as ids
 * only until the stories slice lands (they are that slice's resource);
 * interests are embedded as {id, title} rows the client can render.
 */
export async function getUserProfile(myId: string, profileId: string) {
  const [profile, me] = await Promise.all([
    db.user.findUnique({ where: { id: profileId }, select: communityUserSelect }),
    db.user.findUnique({ where: { id: myId }, select: { isBlock: true, blockUserIds: true } }),
  ]);
  if (!profile) throw new ApiError("Profile not found", 404);

  // Legacy: 0 none · 1 he follows me · 2 I follow him · 3 mutual
  // (each leg additionally requires the followed side to be unblocked).
  const [heFollowsMe, iFollowHim] = await Promise.all([
    db.userFollow.findFirst({ where: { myUserId: profileId, userId: myId } }),
    db.userFollow.findFirst({ where: { myUserId: myId, userId: profileId } }),
  ]);
  let followingStatus = 0;
  if (heFollowsMe && me?.isBlock === 0) followingStatus = 1;
  if (iFollowHim && profile.isBlock === 0) followingStatus = 2;
  if (heFollowsMe && iFollowHim && me?.isBlock === 0 && profile.isBlock === 0) followingStatus = 3;

  const [storyIds, interestRows] = await Promise.all([
    db.communityStory.findMany({
      where: { userId: profileId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    }),
    csvStrs(profile.interestIds).length
      ? db.communityInterest.findMany({ where: { id: { in: csvStrs(profile.interestIds).map(Number).filter(Number.isFinite) } } })
      : Promise.resolve([]),
  ]);

  return {
    ...communityUser(profile, { self: myId === profileId }),
    followingStatus,
    isBlockedByMe: csvStrs(me?.blockUserIds).includes(profileId), // I blocked them
    hasBlockedMe: csvStrs(profile.blockUserIds).includes(myId), // they blocked me
    storyIds: storyIds.map((s) => s.id),
    stories: [] as Array<Record<string, unknown>>, // stories are served by the stories slice
    interest: interestRows.map((i) => ({ id: i.id, title: i.title })),
  };
}

// ─── Search (legacy searchProfile / searchUsersForChat) ──────────────────────

/** Directory search — visible profiles matching a keyword. */
export async function searchUsers(meId: string, q: string, skip: number, take: number) {
  const me = await db.user.findUnique({ where: { id: meId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const keyword = q.trim();
  const where = {
    isBlock: 0,
    id: { notIn: [...csvStrs(me.blockUserIds), meId] },
    username: { not: null },
    avatar: { not: null },
    ...(keyword
      ? {
          OR: [
            { username: { contains: keyword, mode: "insensitive" as const } },
            { name: { contains: keyword, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: communityUserSelect }),
    db.user.count({ where }),
  ]);
  return { rows: rows.map((u) => communityUser(u, { self: u.id === meId })), total };
}

/** Contacts picker — excludes me, platform-blocked, my blocked, who blocked me. */
export async function searchChatUsers(meId: string, q: string, skip: number, take: number) {
  const me = await db.user.findUnique({ where: { id: meId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const keyword = q.trim();
  const whoBlockedMe = await db.user.findMany({
    where: { blockUserIds: { contains: meId } },
    select: { id: true },
  });
  const excluded = [...csvStrs(me.blockUserIds), ...whoBlockedMe.map((u) => u.id), meId];
  const where = {
    isBlock: 0,
    id: { notIn: excluded },
    ...(keyword
      ? {
          OR: [
            { username: { contains: keyword, mode: "insensitive" as const } },
            { name: { contains: keyword, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: communityUserSelect }),
    db.user.count({ where }),
  ]);
  return { rows: rows.map((u) => communityUser(u, { self: u.id === meId })), total };
}

/** Random unblocked profile sharing one of my interests (legacy fetchRandomProfile). */
export async function getRandomUser(meId: string) {
  const me = await db.user.findUnique({ where: { id: meId } });
  if (!me) throw new ApiError("User not found", 404);

  const interestIds = csvStrs(me.interestIds);
  if (!interestIds.length) throw new ApiError("Interests not found", 400);

  const blockIds = csvStrs(me.blockUserIds);
  const candidates = await db.user.findMany({
    where: { isBlock: 0, id: { not: meId, notIn: blockIds }, about: { not: null } },
    take: 200,
    select: communityUserSelect,
  });

  let randomUser = null;
  for (const interestId of shuffle(interestIds)) {
    const matches = candidates.filter((c) => csvStrs(c.interestIds).includes(interestId));
    if (matches.length) {
      randomUser = matches[Math.floor(Math.random() * matches.length)];
      break;
    }
  }
  if (!randomUser && candidates.length) randomUser = candidates[Math.floor(Math.random() * candidates.length)];

  return randomUser ? communityUser(randomUser, { self: randomUser.id === meId }) : null;
}

// ─── Follow / unfollow (legacy followUser / unfollowUser) ────────────────────

export async function followUser(myId: string, targetId: string) {
  if (myId === targetId) throw new ApiError("You cannot follow yourself", 400);

  const [fromUser, toUser] = await Promise.all([
    db.user.findUnique({ where: { id: myId } }),
    db.user.findUnique({ where: { id: targetId } }),
  ]);
  if (!toUser) throw new ApiError("User not found", 404);
  if (!fromUser) throw new ApiError("User not found", 404);

  const existing = await db.userFollow.findFirst({ where: { myUserId: myId, userId: targetId } });
  if (existing) throw new ApiError("User is already in your following list", 409);
  if (csvStrs(fromUser.blockUserIds).includes(targetId)) throw new ApiError("You blocked this user", 400);

  const follow = await db.userFollow.create({ data: { myUserId: myId, userId: targetId } });
  await db.user.update({ where: { id: myId }, data: { followingCount: { increment: 1 } } });
  await db.user.update({ where: { id: targetId }, data: { followersCount: { increment: 1 } } });

  if (toUser.isPushNotifications === 1) {
    await sendPush({
      userId: toUser.id,
      title: process.env.APP_NAME || "UAR",
      body: `${fromUser.name} started following you.`,
      data: { type: "follow", userId: myId },
    });
  }
  await db.savedNotification.create({
    data: { myUserId: targetId, userId: myId, type: NOTIFICATION_TYPE_FOLLOW },
  });

  return { id: follow.id, myUserId: follow.myUserId, userId: follow.userId, createdAt: follow.createdAt };
}

export async function unfollowUser(myId: string, targetId: string) {
  if (myId === targetId) throw new ApiError("You do not follow yourself", 400);

  const follow = await db.userFollow.findFirst({ where: { myUserId: myId, userId: targetId } });
  if (!follow) throw new ApiError("You are not following this user", 404);

  await db.user.updateMany({
    where: { id: myId, followingCount: { gt: 0 } },
    data: { followingCount: { decrement: 1 } },
  });
  await db.user.updateMany({
    where: { id: targetId, followersCount: { gt: 0 } },
    data: { followersCount: { decrement: 1 } },
  });
  await db.savedNotification.deleteMany({
    where: { myUserId: targetId, userId: myId, type: NOTIFICATION_TYPE_FOLLOW },
  });
  await db.userFollow.delete({ where: { id: follow.id } });

  return { id: follow.id, myUserId: follow.myUserId, userId: follow.userId };
}

// ─── Follower / following lists (legacy fetchFollowersList / fetchFollowingList) ──

/** People who follow [targetId], newest first, optional keyword filter. */
export async function listFollowers(targetId: string, keyword: string, skip: number, take: number) {
  const user = await db.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!user) throw new ApiError("User not found", 404);

  const kw = keyword.trim();
  const where = {
    userId: targetId,
    follower: {
      isBlock: 0,
      ...(kw
        ? {
            OR: [
              { name: { contains: kw, mode: "insensitive" as const } },
              { username: { contains: kw, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
  };
  const [edges, total] = await Promise.all([
    db.userFollow.findMany({ where, include: { follower: { select: communityUserSelect } }, skip, take, orderBy: { createdAt: "desc" } }),
    db.userFollow.count({ where }),
  ]);
  return { rows: edges.map((e) => communityUser(e.follower)), total };
}

/** People [listOwnerId] follows — excluding anyone the VIEWER blocked (legacy behavior). */
export async function listFollowing(listOwnerId: string, viewerId: string, skip: number, take: number) {
  const [owner, viewer] = await Promise.all([
    db.user.findUnique({ where: { id: listOwnerId }, select: { id: true } }),
    db.user.findUnique({ where: { id: viewerId }, select: { blockUserIds: true } }),
  ]);
  if (!owner) throw new ApiError("User not found", 404);
  if (!viewer) throw new ApiError("User not found", 404);

  const where = {
    myUserId: listOwnerId,
    followed: { isBlock: 0, id: { notIn: csvStrs(viewer.blockUserIds) } },
  };
  const [edges, total] = await Promise.all([
    db.userFollow.findMany({ where, include: { followed: { select: communityUserSelect } }, skip, take, orderBy: { createdAt: "desc" } }),
    db.userFollow.count({ where }),
  ]);
  return { rows: edges.map((e) => communityUser(e.followed)), total };
}

// ─── Block / unblock (legacy UserBlockedByUser / UserUnblockedByUser) ────────

/** Block: unfollow both ways + append to my blocklist CSV. Returns my updated blocklist. */
export async function blockUser(myId: string, targetId: string) {
  if (myId === targetId) throw new ApiError("You cannot block yourself", 400);

  const [fromUser, toUser] = await Promise.all([
    db.user.findUnique({ where: { id: myId } }),
    db.user.findUnique({ where: { id: targetId } }),
  ]);
  if (!fromUser) throw new ApiError("User not found", 404);
  if (!toUser) throw new ApiError("User not found", 404);

  // Remove an existing following edge (me → target).
  const followingEdge = await db.userFollow.findFirst({ where: { myUserId: myId, userId: targetId } });
  if (followingEdge) {
    await db.user.updateMany({
      where: { id: myId, followingCount: { gt: 0 } },
      data: { followingCount: { decrement: 1 } },
    });
    await db.user.updateMany({
      where: { id: targetId, followersCount: { gt: 0 } },
      data: { followersCount: { decrement: 1 } },
    });
    await db.userFollow.delete({ where: { id: followingEdge.id } });
  }

  // Remove an existing follower edge (target → me).
  const followerEdge = await db.userFollow.findFirst({ where: { myUserId: targetId, userId: myId } });
  if (followerEdge) {
    await db.user.updateMany({
      where: { id: myId, followersCount: { gt: 0 } },
      data: { followersCount: { decrement: 1 } },
    });
    await db.user.updateMany({
      where: { id: targetId, followingCount: { gt: 0 } },
      data: { followingCount: { decrement: 1 } },
    });
    await db.userFollow.delete({ where: { id: followerEdge.id } });
  }

  if (csvStrs(fromUser.blockUserIds).includes(targetId)) throw new ApiError("User already blocked", 409);

  const updated = await db.user.update({
    where: { id: myId },
    data: { blockUserIds: csvStrs(fromUser.blockUserIds).concat(targetId).join(",") },
  });
  await db.savedNotification.deleteMany({ where: { myUserId: myId, type: NOTIFICATION_TYPE_FOLLOW } });

  return csvStrs(updated.blockUserIds);
}

/** Unblock: remove the id from my blocklist CSV. Returns my updated blocklist. */
export async function unblockUser(myId: string, targetId: string) {
  const me = await db.user.findUnique({ where: { id: myId } });
  if (!me) throw new ApiError("User not found", 404);

  const updated = await db.user.update({
    where: { id: myId },
    data: { blockUserIds: csvStrs(me.blockUserIds).filter((id) => id !== targetId).join(",") },
  });
  return csvStrs(updated.blockUserIds);
}

/** Users I blocked (legacy fetchBlockedUserList). */
export async function listBlocked(meId: string, skip: number, take: number) {
  const me = await db.user.findUnique({ where: { id: meId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const ids = csvStrs(me.blockUserIds);
  const where = { id: { in: ids } };
  const [rows, total] = await Promise.all([
    ids.length
      ? db.user.findMany({ where, skip, take, select: communityUserSelect })
      : Promise.resolve([] as CommunityUserRow[]),
    ids.length ? db.user.count({ where }) : Promise.resolve(0),
  ]);
  return { rows: rows.map((u) => communityUser(u, { self: u.id === meId })), total };
}

// ─── Report (legacy reportUser — CommunityReport type 2) ─────────────────────

export async function reportUser(_reporterId: string, targetId: string, reason: string, desc: string) {
  if (!reason.trim()) throw new ApiError("The reason field is required", 400);
  if (!desc.trim()) throw new ApiError("The description field is required", 400);

  const user = await db.user.findUnique({ where: { id: targetId } });
  if (!user) throw new ApiError("User not found", 404);
  if (user.isBlock === 1) throw new ApiError("User is already blocked", 400);

  const report = await db.communityReport.create({
    data: { type: 2, userId: user.id, reason: reason.trim(), desc: desc.trim() },
  });
  return {
    id: report.id,
    type: report.type,
    userId: report.userId,
    reason: report.reason,
    desc: report.desc,
    createdAt: report.createdAt,
  };
}
