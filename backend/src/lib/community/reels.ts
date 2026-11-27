/**
 * Community reels service — reel + reel-comment logic shared by the generic
 * /api/reels router (web + mobile).
 *
 * Ported 1:1 from the legacy mobile handlers (src/routes/mobile/reels-rooms.ts
 * reel half + the Moderator reel deletions in auth-users.ts) onto the generic
 * contract: camelCase fields, the actor ALWAYS comes from the session, errors
 * are ApiError. Moderation is allowed for the reel owner OR a moderator
 * (session role ADMIN/MODERATOR or the DB `user.isModerator === 1` flag,
 * re-read from the DB on every call).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/session";
import { communityAuthor } from "@/lib/community/serializers";
import { deleteStored } from "@/lib/files";
import { mediaWire } from "@/lib/media/media-asset";
import { storage } from "@/lib/storage";
import { invalidateMedia } from "@/lib/cache";
import { sendPush, feedEvent } from "@/lib/community/push";

// ─── Legacy constants (app/Models/Constants.php + SavedNotification types) ────
const UNBLOCKED = 0;
const PUSH_ON = 1;
const FOR_YOU_REEL = 1; // Constants::forYouReel
const FOLLOWING_REEL = 0; // Constants::followingReel

const TYPE_COMMENT = 2;
const TYPE_REEL_LIKE = 9;
const TYPE_ADD_REEL_COMMENT = 10;

/** Legacy FCM title (env('APP_NAME') of the chatter app). */
const PUSH_TITLE = process.env.APP_NAME || "Chatter.";

// ─── Row types ────────────────────────────────────────────────────────────────

export const reelInclude = {
  user: true,
  music: true,
  media: true,
} satisfies Prisma.CommunityReelInclude;
export type ReelRow = Prisma.CommunityReelGetPayload<{ include: typeof reelInclude }>;

/** Public-list visibility: legacy reels (no media) or a fully transcoded one. */
const MEDIA_READY_OR_NONE = { OR: [{ mediaId: null }, { media: { status: "ready" } }] } satisfies Prisma.CommunityReelWhereInput;
type CauseRow = Prisma.CommunityPostGetPayload<{ include: { category: true } }>; // fetched manually (no FK relation on CommunityReel.causeId)

// ─── Moved helpers (were local to the legacy reels-rooms compat router) ──────

/** MySQL FIND_IN_SET(needle, csvColumn) over a Postgres CSV column — returns the
 *  matching row ids (parameterized, so needle quoting is safe). The rooms
 *  compat router imports this too (room interest_ids matching). */
export async function csvMatchIds(
  table: "app_reels" | "app_rooms",
  column: "interest_ids" | "hashtags",
  needle: string
): Promise<string[]> {
  const rows =
    column === "interest_ids"
      ? table === "app_reels"
        ? await db.$queryRaw<{ id: string }[]>`SELECT id FROM app_reels WHERE (',' || COALESCE(interest_ids, '') || ',') LIKE ('%,' || ${needle} || ',%')`
        : await db.$queryRaw<{ id: string }[]>`SELECT id FROM app_rooms WHERE (',' || COALESCE(interest_ids, '') || ',') LIKE ('%,' || ${needle} || ',%')`
      : await db.$queryRaw<{ id: string }[]>`SELECT id FROM app_reels WHERE (',' || COALESCE(hashtags, '') || ',') LIKE ('%,' || ${needle} || ',%')`;
  return rows.map((r) => r.id);
}

/** Legacy GlobalFunction::deleteFile — remove a stored upload by its public URL (best-effort). */
export async function deleteFileByUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const m = /\/api\/files\/([A-Za-z0-9]+)\/file/.exec(url);
  if (!m) return;
  try {
    const asset = await db.fileAsset.findUnique({ where: { id: m[1] } });
    if (!asset) return;
    await db.fileAsset.delete({ where: { id: asset.id } });
    await deleteStored(asset.storedName).catch(() => {});
  } catch (e) {
    console.error("[community] file delete failed", e);
  }
}

/** CSV of arbitrary ids (saved_reel_ids holds cuids) → trimmed non-empty strings. */
function csvToStrings(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** User.block_user_ids CSV → id strings. */
function blockedIdsOf(user: { blockUserIds: string | null }): string[] {
  return csvToStrings(user.blockUserIds);
}

/** Uniformly-random slice of the rows matching `where` (legacy inRandomOrder + take). */
async function randomReelIds(where: Prisma.CommunityReelWhereInput, take: number): Promise<string[]> {
  const count = await db.communityReel.count({ where });
  const skip = count > take ? Math.floor(Math.random() * (count - take)) : 0;
  const rows = await db.communityReel.findMany({ where, skip, take, select: { id: true } });
  // shuffle (inRandomOrder ignores skip/take in MySQL; emulate by shuffling the slice)
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.map((r) => r.id);
}

/** Moderator check — session role ADMIN/MODERATOR or the DB flag (re-read). */
async function isModerator(userId: string, sessionRole: string | undefined): Promise<boolean> {
  if (sessionRole === "ADMIN" || sessionRole === "MODERATOR") return true;
  const user = await db.user.findUnique({ where: { id: userId }, select: { isModerator: true } });
  return user?.isModerator === 1;
}

// ─── Serializers (camelCase — the generic web + mobile contract) ─────────────

export function musicJson(m: {
  id: number;
  categoryId: number | null;
  title: string | null;
  sound: string | null;
  duration: string | null;
  artist: string | null;
  image: string | null;
  isDeleted: number;
  createdAt: Date;
  updatedAt: Date | null;
}) {
  return {
    id: m.id,
    categoryId: m.categoryId,
    title: m.title,
    sound: m.sound,
    duration: m.duration,
    artist: m.artist,
    image: m.image,
    isDeleted: m.isDeleted,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt ? m.updatedAt.toISOString() : null,
  };
}

function causeJson(p: CauseRow) {
  return {
    id: p.id,
    userId: p.userId,
    desc: p.desc,
    type: p.type,
    goalAmount: p.goalAmount,
    raisedAmount: p.raisedAmount,
    deadline: p.deadline ? p.deadline.toISOString() : null,
    isVerified: p.isVerified ? 1 : 0,
    categoryId: p.categoryId,
    commentsCount: p.commentsCount,
    likesCount: p.likesCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    category: p.category
      ? {
          id: p.category.id,
          name: p.category.name,
          icon: p.category.icon,
          color: p.category.color,
          description: p.category.description,
          isActive: p.category.isActive ? 1 : 0,
          createdAt: p.category.createdAt.toISOString(),
          updatedAt: p.category.updatedAt.toISOString(),
        }
      : null,
  };
}

/** Plain reel row (camelCase attributes + media playback hydration — status
 *  "ready" for legacy reels without media; content/thumbnail swap to the
 *  transcoded MP4/poster when available). */
export async function reelJson(r: ReelRow) {
  const media = await mediaWire(r.media);
  return {
    id: r.id,
    userId: r.userId,
    causeId: r.causeId,
    interestIds: r.interestIds,
    musicId: r.musicId,
    description: r.description,
    content: r.media?.status === "ready" && media.mp4Url ? media.mp4Url : r.content,
    thumbnail: r.thumbnail ?? media.posterUrl,
    hashtags: r.hashtags,
    status: media.status,
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    aspectRatio: media.aspectRatio,
    hlsUrl: media.hlsUrl,
    mp4Url: media.mp4Url,
    posterUrl: media.posterUrl,
    commentsCount: r.commentsCount,
    likesCount: r.likesCount,
    viewsCount: r.viewsCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Legacy Reel::processReels — recomputed counters + isLike + followingStatus + music
 *  (+ the cause post with its category, fetched manually since CommunityReel.causeId
 *  has no Prisma relation). The author is embedded via communityAuthor. */
async function processReels(reels: ReelRow[], myUserId: string): Promise<unknown[]> {
  if (reels.length === 0) return [];
  const reelIds = reels.map((r) => r.id);
  const userIds = [...new Set(reels.map((r) => r.userId))];
  const causeIds = [...new Set(reels.map((r) => r.causeId).filter((v): v is string => Boolean(v)))];

  const [myLikes, commentGroups, likeGroups, myFollows, causes] = await Promise.all([
    db.communityLike.findMany({ where: { reelId: { in: reelIds }, userId: myUserId }, select: { reelId: true } }),
    db.communityReelComment.groupBy({ by: ["reelId"], where: { reelId: { in: reelIds } }, _count: { _all: true } }),
    db.communityLike.groupBy({ by: ["reelId"], where: { reelId: { in: reelIds } }, _count: { _all: true } }),
    db.userFollow.findMany({ where: { myUserId, userId: { in: userIds } }, select: { userId: true } }),
    causeIds.length
      ? db.communityPost.findMany({ where: { id: { in: causeIds } }, include: { category: true } })
      : Promise.resolve([] as CauseRow[]),
  ]);

  const likedSet = new Set(myLikes.map((l) => l.reelId));
  const commentCounts = new Map(commentGroups.map((g) => [g.reelId, g._count._all]));
  const likeCounts = new Map(likeGroups.map((g) => [g.reelId, g._count._all]));
  const followedSet = new Set(myFollows.map((f) => f.userId));
  const causeById = new Map(causes.map((c) => [c.id, c]));

  return Promise.all(reels.map(async (reel) => {
    const cause = reel.causeId ? causeById.get(reel.causeId) : undefined;
    return {
      ...(await reelJson(reel)),
      isLike: likedSet.has(reel.id) ? 1 : 0,
      commentsCount: commentCounts.get(reel.id) ?? 0,
      likesCount: likeCounts.get(reel.id) ?? 0,
      music: reel.music ? musicJson(reel.music) : null,
      user: reel.user
        ? { ...communityAuthor(reel.user), followingStatus: followedSet.has(reel.user.id) ? 2 : 0 }
        : null,
      cause: cause ? causeJson(cause) : null,
    };
  }));
}

/** Fetch one reel (or many by ids) with the standard includes. */
async function findReel(id: string): Promise<ReelRow | null> {
  return db.communityReel.findUnique({ where: { id }, include: reelInclude });
}

function commentJson(c: {
  id: string;
  userId: string;
  reelId: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}, user: unknown) {
  return {
    id: c.id,
    userId: c.userId,
    reelId: c.reelId,
    description: c.description,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    user,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateReelInput {
  description?: string | null;
  hashtags?: string | null;
  interestIds?: string | null;
  musicId?: number | null;
  causeId?: string | null;
  /** Legacy multipart path — both uploaded-file URLs. */
  contentUrl?: string | null;
  thumbnailUrl?: string | null;
  /** Direct-upload path — a MediaAsset id instead of a content file. */
  mediaId?: string | null;
}

/** POST /api/reels — create a reel from multipart uploads (legacy uploadReel)
 *  or from a presigned-upload mediaId (content/thumbnail left null — the
 *  transcoder fills the playback URLs once the asset is ready). */
export async function createReel(userId: string, input: CreateReelInput) {
  const reel = await db.communityReel.create({
    data: {
      userId,
      causeId: input.causeId ?? null,
      description: input.description ?? null,
      interestIds: input.interestIds ?? null,
      hashtags: input.hashtags ?? null,
      content: input.contentUrl ?? null,
      thumbnail: input.thumbnailUrl ?? null,
      mediaId: input.mediaId ?? null,
      musicId: input.musicId ?? null,
    },
  });

  feedEvent("community.reel.created", { reelId: reel.id, userId });
  const fresh = await findReel(reel.id);
  if (!fresh) throw new ApiError("Reel not found", 404);
  return serializeReel(fresh, userId);
}

/** Serialize one reel for the actor (processReels for a single row). */
export async function serializeReel(reel: ReelRow, myUserId: string) {
  const [processed] = await processReels([reel], myUserId);
  return processed ?? null;
}

/** GET /api/reels/:id (legacy fetchReelById — 404 instead of a null data row). */
export async function getReel(myUserId: string, reelId: string) {
  const me = await db.user.findUnique({ where: { id: myUserId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const blockUserIds = blockedIdsOf(me);
  const reel = await db.communityReel.findFirst({
    where: {
      id: reelId,
      user: { isBlock: UNBLOCKED },
      ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    },
    include: reelInclude,
  });
  if (!reel) throw new ApiError("Reel not found", 404);
  // Still-processing direct uploads stay visible to the owner only.
  if (reel.media && reel.media.status !== "ready" && reel.userId !== myUserId) {
    throw new ApiError("Reel not found", 404);
  }
  return serializeReel(reel, myUserId);
}

/** DELETE /api/reels/:id — the owner OR a moderator (legacy deleteReel +
 *  Moderator/deleteReelByModerator). Cleans up comments, their saved
 *  notifications, likes, reports and the uploaded content/thumbnail files. */
export async function deleteReel(actorId: string, actorRole: string | undefined, reelId: string) {
  const reel = await findReel(reelId);
  if (!reel) throw new ApiError("Reel not found", 404);

  const moderator = await isModerator(actorId, actorRole);
  if (reel.userId !== actorId && !moderator) throw new ApiError("You do not have permission to delete this reel", 403);

  const commentTypes = [TYPE_REEL_LIKE, TYPE_COMMENT, TYPE_ADD_REEL_COMMENT];

  const comments = await db.communityReelComment.findMany({ where: { reelId } });
  for (const c of comments) {
    await db.savedNotification.deleteMany({ where: { reelCommentId: c.id, type: { in: commentTypes } } });
    await db.communityReelComment.delete({ where: { id: c.id } });
  }

  await db.communityLike.deleteMany({ where: { reelId } });
  await db.communityReport.deleteMany({ where: { reelId } }); // moderator path (legacy deleteReelByModerator)
  await deleteFileByUrl(reel.content); // owner path file cleanup (legacy deleteReel)
  await deleteFileByUrl(reel.thumbnail);
  // Direct-upload cleanup: the media store prefix + the MediaAsset row.
  if (reel.mediaId) {
    await storage.deletePrefix(`media/${reel.mediaId}/`).catch(() => {});
    await db.mediaAsset.delete({ where: { id: reel.mediaId } }).catch(() => {});
    await invalidateMedia(reel.mediaId);
  }
  await db.savedNotification.deleteMany({ where: { reelId, type: { in: commentTypes } } });
  await db.communityReel.delete({ where: { id: reel.id } });
  feedEvent("community.reel.deleted", { reelId, userId: actorId });
  return await reelJson(reel);
}

export interface UpdateReelInput {
  description?: string | null;
  hashtags?: string | null;
  interestIds?: string | null;
  thumbnail?: string | null;
  content?: string | null;
  musicId?: number | null;
}

/** PATCH /api/reels/:id — edit metadata. The owner may always edit; a
 *  moderator may edit anyone's (legacy reels/update by the admin portal). */
export async function updateReel(actorId: string, actorRole: string | undefined, reelId: string, input: UpdateReelInput) {
  const reel = await findReel(reelId);
  if (!reel) throw new ApiError("Reel not found", 404);

  const moderator = await isModerator(actorId, actorRole);
  if (reel.userId !== actorId && !moderator) throw new ApiError("You do not have permission to edit this reel", 403);

  const patch: Record<string, unknown> = {};
  if (input.description !== undefined) patch.description = input.description;
  if (input.hashtags !== undefined) patch.hashtags = input.hashtags;
  if (input.interestIds !== undefined) patch.interestIds = input.interestIds;
  if (input.thumbnail !== undefined) patch.thumbnail = input.thumbnail;
  if (input.content !== undefined) patch.content = input.content;
  if (input.musicId !== undefined) patch.musicId = input.musicId;
  if (Object.keys(patch).length === 0) throw new ApiError("Nothing to update", 400);

  await db.communityReel.update({ where: { id: reel.id }, data: patch });
  if (moderator && reel.userId !== actorId) {
    feedEvent("community.reel.moderated", { reelId, changes: Object.keys(patch).join(","), by: actorId });
  }
  const fresh = await findReel(reel.id);
  if (!fresh) throw new ApiError("Reel not found", 404);
  return serializeReel(fresh, actorId);
}

// ─── Listing ──────────────────────────────────────────────────────────────────

/** GET /api/reels?feed=foryou|following (legacy fetchReelsOnExplore — foryou is a
 *  random slice, following is newest-first paging). */
export async function listExploreReels(
  myUserId: string,
  feed: "foryou" | "following",
  page: number,
  limit: number,
  skip: number
) {
  const me = await db.user.findUnique({ where: { id: myUserId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const blockUserIds = blockedIdsOf(me);
  const baseWhere: Prisma.CommunityReelWhereInput = {
    ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    user: { isBlock: UNBLOCKED },
    ...MEDIA_READY_OR_NONE,
  };

  let reelIds: string[];
  let total: number;
  if (feed === "foryou") {
    // legacy inRandomOrder take(limit) — a fresh random slice per request
    reelIds = await randomReelIds(baseWhere, limit);
    total = await db.communityReel.count({ where: baseWhere });
  } else {
    const followingUserIds = (
      await db.userFollow.findMany({ where: { myUserId }, select: { userId: true } })
    ).map((f) => f.userId);
    const where = { ...baseWhere, userId: { in: followingUserIds } };
    total = await db.communityReel.count({ where });
    const rows = await db.communityReel.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: { id: true },
    });
    reelIds = rows.map((r) => r.id);
  }

  const rows = await db.communityReel.findMany({
    where: { id: { in: reelIds } },
    include: reelInclude,
  });
  // restore the fetched order (inRandomOrder / id-desc)
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = reelIds.map((id) => byId.get(id)).filter((r): r is ReelRow => Boolean(r));

  return { rows: await processReels(ordered, myUserId), total };
}

/** GET /api/reels/user/:userId (legacy fetchReelsByUserId — two-way block aware). */
export async function listReelsByUser(myUserId: string, targetUserId: string, skip: number, take: number) {
  const [user, myUser] = await Promise.all([
    db.user.findUnique({ where: { id: targetUserId }, select: { blockUserIds: true } }),
    db.user.findUnique({ where: { id: myUserId }, select: { blockUserIds: true } }),
  ]);
  if (!user || !myUser) throw new ApiError("User not found", 404);

  const blockUserIds = blockedIdsOf(user);
  const blockMyUserIds = blockedIdsOf(myUser);
  if (blockUserIds.includes(myUserId) || blockMyUserIds.includes(targetUserId)) {
    throw new ApiError("User blocked", 403);
  }

  const where: Prisma.CommunityReelWhereInput = {
    userId: targetUserId,
    user: { isBlock: UNBLOCKED },
    // the owner always sees their own processing uploads
    ...(myUserId === targetUserId ? {} : MEDIA_READY_OR_NONE),
  };
  // legacy whereNotIn('user_id', blockUserIds) — a self-blocked author yields no rows
  if (blockUserIds.length) {
    if (blockUserIds.includes(targetUserId)) return { rows: [], total: 0 };
    where.userId = { equals: targetUserId, notIn: blockUserIds };
  }

  const [reels, total] = await Promise.all([
    db.communityReel.findMany({ where, include: reelInclude, orderBy: { createdAt: "desc" }, skip, take }),
    db.communityReel.count({ where }),
  ]);
  return { rows: await processReels(reels, myUserId), total };
}

/** GET /api/reels/by-interest?ids=1,2&q= (legacy searchReelsByInterestId —
 *  reels whose interest_ids CSV contains ANY of the ids, optional keyword). */
export async function searchReelsByInterest(
  myUserId: string,
  interestIds: string[],
  keyword: string,
  skip: number,
  take: number
) {
  const me = await db.user.findUnique({ where: { id: myUserId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  for (const interestId of interestIds) {
    const n = Number(interestId);
    const interest = Number.isFinite(n) ? await db.communityInterest.findUnique({ where: { id: n } }) : null;
    if (!interest) throw new ApiError("Interest not found", 404);
  }

  const blockUserIds = blockedIdsOf(me);
  const where: Prisma.CommunityReelWhereInput = {
    user: { isBlock: UNBLOCKED },
    ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    ...MEDIA_READY_OR_NONE,
  };
  if (interestIds.length) {
    const matches = await Promise.all(interestIds.map((id) => csvMatchIds("app_reels", "interest_ids", id)));
    where.id = { in: [...new Set(matches.flat())] };
  }
  const kw = keyword.trim();
  if (kw) {
    where.description = { contains: kw };
  }

  const [reels, total] = await Promise.all([
    db.communityReel.findMany({ where, include: reelInclude, orderBy: { createdAt: "desc" }, skip, take }),
    db.communityReel.count({ where }),
  ]);
  return { rows: await processReels(reels, myUserId), total };
}

/** GET /api/reels/by-hashtag?tags=a,b (legacy fetchReelsByHashtag — any of the tags). */
export async function listReelsByHashtag(myUserId: string, tags: string[], skip: number, take: number) {
  const me = await db.user.findUnique({ where: { id: myUserId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const blockUserIds = blockedIdsOf(me);
  const matching = await Promise.all(tags.map((tag) => csvMatchIds("app_reels", "hashtags", tag)));
  const where: Prisma.CommunityReelWhereInput = {
    id: { in: [...new Set(matching.flat())] },
    user: { isBlock: UNBLOCKED },
    ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    ...MEDIA_READY_OR_NONE,
  };
  const [reels, total] = await Promise.all([
    db.communityReel.findMany({ where, include: reelInclude, orderBy: { createdAt: "desc" }, skip, take }),
    db.communityReel.count({ where }),
  ]);
  return { rows: await processReels(reels, myUserId), total };
}

/** GET /api/reels/by-music/:musicId (legacy fetchReelsByMusic). */
export async function listReelsByMusic(myUserId: string, musicId: number, skip: number, take: number) {
  const music = await db.communityMusic.findUnique({ where: { id: musicId } });
  if (!music) throw new ApiError("Music not found", 404);

  const [reels, total] = await Promise.all([
    db.communityReel.findMany({ where: { musicId, ...MEDIA_READY_OR_NONE }, include: reelInclude, orderBy: { createdAt: "desc" }, skip, take }),
    db.communityReel.count({ where: { musicId, ...MEDIA_READY_OR_NONE } }),
  ]);
  return { rows: await processReels(reels, myUserId), total };
}

/** GET /api/reels/saved — the session user's savedReelIds (legacy fetchSavedReels;
 *  the ids are edited via PATCH /api/profile). */
export async function listSavedReels(myUserId: string, skip: number, take: number) {
  const user = await db.user.findUnique({ where: { id: myUserId }, select: { savedReelIds: true, blockUserIds: true } });
  if (!user) throw new ApiError("User not found", 404);

  const savedReelIds = csvToStrings(user.savedReelIds);
  const blockUserIds = blockedIdsOf(user);

  const where: Prisma.CommunityReelWhereInput = {
    id: { in: savedReelIds },
    user: { isBlock: UNBLOCKED },
    ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    ...MEDIA_READY_OR_NONE,
  };
  const [reels, total] = await Promise.all([
    db.communityReel.findMany({ where, include: reelInclude, orderBy: { createdAt: "desc" }, skip, take }),
    db.communityReel.count({ where }),
  ]);
  return { rows: await processReels(reels, myUserId), total };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/** POST /api/reels/:id/like — toggle (legacy likeDislikeReel). Returns the
 *  updated reel with isLike + the recomputed likes count. */
export async function toggleReelLike(userId: string, reelId: string) {
  const user = await db.user.findFirst({ where: { id: userId, isBlock: UNBLOCKED } });
  if (!user) throw new ApiError("User not found", 404);

  const reel = await findReel(reelId);
  if (!reel) throw new ApiError("Reel not found", 404);

  const likeRecord = await db.communityLike.findFirst({ where: { userId, reelId } });

  if (likeRecord) {
    const newCount = Math.max(0, reel.likesCount - 1); // legacy max(0, count-1)
    await db.communityReel.update({ where: { id: reel.id }, data: { likesCount: newCount } });
    await db.savedNotification.deleteMany({
      where: { userId, reelId, type: TYPE_REEL_LIKE },
    });
    await db.communityLike.delete({ where: { id: likeRecord.id } });

    return {
      ...(await reelJson(reel)),
      isLike: 0,
      likesCount: newCount,
      user: reel.user ? communityAuthor(reel.user) : null,
    };
  }

  await db.communityLike.create({ data: { userId, reelId } });
  const newCount = reel.likesCount + 1;
  await db.communityReel.update({ where: { id: reel.id }, data: { likesCount: newCount } });

  if (reel.user && reel.user.id !== user.id && reel.user.isPushNotifications === PUSH_ON) {
    await sendPush({
      userId: reel.user.id,
      title: PUSH_TITLE,
      body: `${user.name} has liked your Reel.`,
      type: "REEL_LIKE",
      data: { reel_id: reel.id, type: TYPE_REEL_LIKE },
    });
  }
  if (reel.user && user.id !== reel.user.id) {
    await db.savedNotification.create({
      data: {
        myUserId: reel.user.id, // legacy quirk: my_user_id = reel owner, user_id = actor
        userId: user.id,
        reelId: reel.id,
        type: TYPE_REEL_LIKE,
      },
    });
  }

  feedEvent("community.reel.liked", { reelId: reel.id, userId });
  return {
    ...(await reelJson(reel)),
    isLike: 1,
    likesCount: newCount,
    user: reel.user ? communityAuthor(reel.user) : null,
  };
}

/** POST /api/reels/:id/view (legacy increaseReelViewCount). */
export async function addReelView(reelId: string) {
  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) throw new ApiError("Reel not found", 404);

  const updated = await db.communityReel.update({
    where: { id: reel.id },
    data: { viewsCount: { increment: 1 } },
  });
  return { reelId: updated.id, viewsCount: updated.viewsCount };
}

/** POST /api/reels/:id/report (legacy reportReel — CommunityReport type 3,
 *  the reporter now recorded from the session). */
export async function reportReel(reporterId: string, reelId: string, reason: string, desc: string) {
  if (!reason.trim()) throw new ApiError("The reason field is required", 400);
  if (!desc.trim()) throw new ApiError("The description field is required", 400);

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) throw new ApiError("Reel not found", 404);

  const report = await db.communityReport.create({
    data: { type: 3, reelId: reel.id, userId: reporterId, reason: reason.trim(), desc: desc.trim() },
  });
  return {
    id: report.id,
    type: report.type,
    reelId: report.reelId,
    userId: report.userId,
    reason: report.reason,
    desc: report.desc,
    createdAt: report.createdAt,
  };
}

// ─── Comments ─────────────────────────────────────────────────────────────────

/** GET /api/reels/:id/comments (legacy fetchReelComments — authors I blocked are
 *  filtered out; (admin-)blocked authors keep their comment but a null user). */
export async function listReelComments(myUserId: string, reelId: string, skip: number, take: number) {
  const me = await db.user.findUnique({ where: { id: myUserId }, select: { blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const blockUserIds = blockedIdsOf(me);
  const where: Prisma.CommunityReelCommentWhereInput = {
    reelId,
    ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
  };
  const [comments, total] = await Promise.all([
    db.communityReelComment.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.communityReelComment.count({ where }),
  ]);

  // legacy with(['user' => where is_block 0]) keeps the comment but user is null
  // when its author is (admin-)blocked
  return {
    rows: comments.map((c) => commentJson(c, c.user && c.user.isBlock === UNBLOCKED ? communityAuthor(c.user) : null)),
    total,
  };
}

/** POST /api/reels/:id/comments (legacy addReelComment — 500-char cap, owner
 *  push + saved notification when the commenter is not the owner). */
export async function addReelComment(userId: string, reelId: string, description: string) {
  if (!description.trim()) throw new ApiError("The description field is required", 400);
  if (description.length > 500) throw new ApiError("The description may not be greater than 500 characters", 400);

  const user = await db.user.findFirst({ where: { id: userId, isBlock: UNBLOCKED } });
  if (!user) throw new ApiError("User not found", 404);

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) throw new ApiError("Reel not found", 404);

  const comment = await db.communityReelComment.create({
    data: { userId: user.id, reelId: reel.id, description },
  });
  await db.communityReel.update({ where: { id: reel.id }, data: { commentsCount: { increment: 1 } } });

  if (reel.userId !== user.id) {
    const owner = await db.user.findUnique({ where: { id: reel.userId } });
    if (owner && owner.isPushNotifications === PUSH_ON) {
      await sendPush({
        userId: owner.id,
        title: PUSH_TITLE,
        body: `${user.name} has commented on your Reel: ${description}`,
        type: "REEL_COMMENT",
        data: { reel_id: reel.id, type: TYPE_ADD_REEL_COMMENT },
      });
    }
    // legacy quirk kept: my_user_id = commenter, user_id = reel owner
    await db.savedNotification.create({
      data: { myUserId: user.id, userId: reel.userId, reelCommentId: comment.id, type: TYPE_ADD_REEL_COMMENT },
    });
  }

  return commentJson(comment, communityAuthor(user));
}

/** DELETE /api/reels/comments/:commentId — the comment author, the reel owner
 *  OR a moderator (legacy deleteReelComment + deleteReelCommentByModerator). */
export async function deleteReelComment(actorId: string, actorRole: string | undefined, commentId: string) {
  const comment = await db.communityReelComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new ApiError("Reel comment not found", 404);

  const reel = await db.communityReel.findUnique({
    where: { id: comment.reelId },
    select: { id: true, userId: true, commentsCount: true },
  });
  const moderator = await isModerator(actorId, actorRole);
  const allowed = comment.userId === actorId || (reel?.userId ?? null) === actorId || moderator;
  if (!allowed) throw new ApiError("You do not have permission to delete this comment", 403);

  if (reel) {
    await db.communityReel.update({
      where: { id: reel.id },
      data: { commentsCount: Math.max(0, reel.commentsCount - 1) },
    });
  }

  await db.savedNotification.deleteMany({
    where: { reelCommentId: commentId, type: TYPE_ADD_REEL_COMMENT },
  });
  await db.communityReelComment.delete({ where: { id: comment.id } });

  return commentJson(comment, null);
}
