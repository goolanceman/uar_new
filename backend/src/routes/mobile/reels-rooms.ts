/**
 * Mobile wire-compat routes — reels + music + rooms module.
 * Ports the legacy Laravel ReelController (reels + music endpoints) and
 * RoomController onto the uarnew backend so the Flutter app works unchanged.
 *
 * Legacy middleware check: every route here carries only `checkHeader`
 * (apikey gate — already enforced by mobileGate upstream); NONE of them
 * require the auth token, so we use a SOFT session (withAuth) that populates
 * req.session when a valid `authtoken` header is present but never rejects —
 * the reel calls in particular (NewApiService) send no authtoken at all.
 *
 * Wire contract (extracted from the Dart models — see reels-rooms module map
 * in ../index.ts): { status, message, data? } envelopes; snake_case keys the
 * Dart fromJson reads. IDs are cuid strings (mobile Room/RoomMember/Invitation
 * models still type some ids as `num` — a known mobile-side fix, reported).
 */
import { Router, urlencoded, type Request, type Response } from "express";
import { Prisma, type CommunityMusic, type CommunityReport, type CommunityRoom, type CommunityRoomUser } from "@prisma/client";
import { db } from "@/lib/db";
import type { Session } from "@/lib/session";
import { validateSession } from "@/lib/session";
import { deleteStored } from "@/lib/files";
import { multipart, type MulterFile } from "@/lib/multipart";
import {
  ok, data, fail, legacyUser, params, str, optStr, optNum, num, csvToInts, page,
  storeUpload, sendPush, feedEvent, wrap, mobileErrorHandler,
} from "@/lib/mobile/compat";

export const router = Router();

// The reel half of the app (NewApiService) posts application/x-www-form-urlencoded
// bodies (dart http `body: params`), which the global express.json() ignores.
// Parse them here so params() sees them; JSON bodies are untouched by this.
router.use(urlencoded({ extended: true, limit: "10mb" }));

// ─── Legacy constants (app/Models/Constants.php) ──────────────────────────────
const UNBLOCKED = 0;
const DELETED_NO = 0;
const PUSH_ON = 1;
const FOR_YOU_REEL = 1; // Constants::forYouReel
const FOLLOWING_REEL = 0; // Constants::followingReel

// SavedNotification types
const TYPE_COMMENT = 2;
const TYPE_ROOM_INVITE = 4;
const TYPE_ACCEPT_INVITE_ROOM = 5;
const TYPE_JOIN_ROOM = 6;
const TYPE_DIRECT_JOIN_ROOM = 7;
const TYPE_ACCEPT_ROOM_REQUEST = 8;
const TYPE_REEL_LIKE = 9;
const TYPE_ADD_REEL_COMMENT = 10;

// CommunityRoomUser.type
const RU_REQUEST = 1;
const RU_MEMBER = 2;
const RU_CO_ADMIN = 3;
const RU_INVITED = 4;
const RU_ADMIN = 5;

// Legacy FCM title (env('APP_NAME') of the chatter app).
const PUSH_TITLE = "Chatter.";

// ─── Row types ────────────────────────────────────────────────────────────────

const reelInclude = {
  user: true,
  music: true,
} satisfies Prisma.CommunityReelInclude;
type ReelRow = Prisma.CommunityReelGetPayload<{ include: typeof reelInclude }>;
type CauseRow = Prisma.CommunityPostGetPayload<{ include: { category: true } }>; // fetched manually (no FK relation on CommunityReel.causeId)

type RoomRow = CommunityRoom;
type RoomUserRow = CommunityRoomUser;
type RoomUserWithUser = Prisma.CommunityRoomUserGetPayload<{ include: { user: true } }>;
type RoomUserWithRoom = Prisma.CommunityRoomUserGetPayload<{ include: { room: true } }>;

// ─── Small helpers ────────────────────────────────────────────────────────────

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Soft auth: populate the session when a valid authtoken is present (never rejects —
 *  these legacy routes only had the apikey check). */
function withAuth(handler: Handler): Handler {
  return async (req, res) => {
    const s = await validateSession(req).catch(() => null);
    if (s) (req as Request & { session?: Session }).session = s;
    return handler(req, res);
  };
}

/** CSV of arbitrary ids (saved_reel_ids holds cuids) → trimmed non-empty strings. */
function csvToStrings(v: unknown): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** User.block_user_ids CSV → id strings. */
function blockedIdsOf(user: { blockUserIds: string | null }): string[] {
  return csvToStrings(user.blockUserIds);
}

/** Room-members cap — legacy Setting::setRoomUsersLimit (kept as the `mobile.app`
 *  setting JSON; 16 = legacy seed default). */
async function roomUsersLimit(): Promise<number> {
  try {
    const row = await db.setting.findUnique({ where: { key: "mobile.app" } });
    const parsed = row ? (JSON.parse(row.value || "{}") as Record<string, unknown>) : {};
    const n = Number(parsed.setRoomUsersLimit);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall through to default
  }
  return 16;
}

/** MySQL FIND_IN_SET(needle, csvColumn) over a Postgres CSV column — returns the
 *  matching row ids (parameterized, so needle quoting is safe). */
async function csvMatchIds(
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

async function randomRooms(where: Prisma.CommunityRoomWhereInput, take: number): Promise<RoomRow[]> {
  const count = await db.communityRoom.count({ where });
  const skip = count > take ? Math.floor(Math.random() * (count - take)) : 0;
  const rows = await db.communityRoom.findMany({ where, skip, take });
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}

/** Legacy GlobalFunction::deleteFile — remove a stored upload by its public URL (best-effort). */
async function deleteFileByUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const m = /\/api\/files\/([A-Za-z0-9]+)\/file/.exec(url);
  if (!m) return;
  try {
    const asset = await db.fileAsset.findUnique({ where: { id: m[1] } });
    if (!asset) return;
    await db.fileAsset.delete({ where: { id: asset.id } });
    await deleteStored(asset.storedName).catch(() => {});
  } catch (e) {
    console.error("[mobile] file delete failed", e);
  }
}

/** One uploaded part (multer any()) as a native File for storeUpload. */
function filePart(req: Request, field: string): File | null {
  type RawMulterFile = MulterFile & { fieldname: string };
  const raw = ((req.files as RawMulterFile[] | undefined) ?? []).find((f) => f.fieldname === field);
  if (!raw) return null;
  return new File([raw.buffer], raw.originalname, { type: raw.mimetype || "application/octet-stream" });
}

// ─── Serializers (mirror the Eloquent JSON the Dart models parse) ─────────────

function musicJson(m: CommunityMusic) {
  return {
    id: m.id,
    category_id: m.categoryId,
    title: m.title,
    sound: m.sound,
    duration: m.duration,
    artist: m.artist,
    image: m.image,
    is_deleted: m.isDeleted,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt ? m.updatedAt.toISOString() : null,
  };
}

function causeJson(p: CauseRow) {
  return {
    id: p.id,
    user_id: p.userId,
    desc: p.desc,
    type: p.type,
    goal_amount: p.goalAmount,
    raised_amount: p.raisedAmount,
    deadline: p.deadline ? p.deadline.toISOString() : null,
    is_verified: p.isVerified ? 1 : 0,
    category_id: p.categoryId,
    comments_count: p.commentsCount,
    likes_count: p.likesCount,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    category: p.category
      ? {
          id: p.category.id,
          name: p.category.name,
          icon: p.category.icon,
          color: p.category.color,
          description: p.category.description,
          is_active: p.category.isActive ? 1 : 0,
          created_at: p.category.createdAt.toISOString(),
          updated_at: p.category.updatedAt.toISOString(),
        }
      : null,
  };
}

/** Plain reel row (attributes only — legacy returns ->fresh() / the model row). */
function reelJson(r: ReelRow) {
  return {
    id: r.id,
    user_id: r.userId,
    cause_id: r.causeId,
    interest_ids: r.interestIds,
    music_id: r.musicId,
    description: r.description,
    content: r.content,
    thumbnail: r.thumbnail,
    hashtags: r.hashtags,
    comments_count: r.commentsCount,
    likes_count: r.likesCount,
    views_count: r.viewsCount,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

/** Legacy Reel::processReels — recomputed counters + is_like + followingStatus + music
 *  (+ the cause post with its category, fetched manually since CommunityReel.causeId
 *  has no Prisma relation). */
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

  return reels.map((reel) => {
    const cause = reel.causeId ? causeById.get(reel.causeId) : undefined;
    return {
      ...reelJson(reel),
      is_like: likedSet.has(reel.id) ? 1 : 0,
      comments_count: commentCounts.get(reel.id) ?? 0,
      likes_count: likeCounts.get(reel.id) ?? 0,
      music: reel.music ? musicJson(reel.music) : null,
      user: reel.user
        ? { ...legacyUser(reel.user), followingStatus: followedSet.has(reel.user.id) ? 2 : 0 }
        : null,
      cause: cause ? causeJson(cause) : null,
    };
  });
}

/** Fetch one reel (or many by ids) with the standard includes. */
async function findReel(id: string): Promise<ReelRow | null> {
  return db.communityReel.findUnique({ where: { id }, include: reelInclude });
}

function commentJson(c: { id: string; userId: string; reelId: string; description: string; createdAt: Date; updatedAt: Date }, user: unknown) {
  return {
    id: c.id,
    user_id: c.userId,
    reel_id: c.reelId,
    description: c.description,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    user,
  };
}

function roomJson(r: RoomRow) {
  return {
    id: r.id,
    admin_id: r.adminId,
    conversation_id: r.conversationId,
    photo: r.photo,
    title: r.title,
    desc: r.desc,
    interest_ids: r.interestIds,
    is_private: r.isPrivate,
    is_join_request_enable: r.isJoinRequestEnable,
    total_member: r.totalMember,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function roomUserJson(
  ru: RoomUserRow,
  extra: { user?: unknown; room?: unknown; invited_user?: unknown } = {}
) {
  return {
    id: ru.id,
    room_id: ru.roomId,
    user_id: ru.userId,
    invited_by: ru.invitedBy,
    type: ru.type,
    is_mute: ru.isMute,
    created_at: ru.createdAt.toISOString(),
    updated_at: ru.updatedAt.toISOString(),
    ...extra,
  };
}

function reportJson(r: CommunityReport) {
  return {
    id: r.id,
    type: r.type,
    room_id: r.roomId,
    user_id: r.userId,
    post_id: r.postId,
    reel_id: r.reelId,
    comment_id: r.commentId,
    reason: r.reason,
    desc: r.desc,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function interestJson(i: { id: number; title: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: i.id,
    title: i.title,
    created_at: i.createdAt.toISOString(),
    updated_at: i.updatedAt.toISOString(),
  };
}

/** Room-user membership count the limit checks run against. */
function memberCountWhere(roomId: string, includeAdmins: boolean) {
  return {
    roomId,
    type: includeAdmins ? { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN] } : { in: [RU_MEMBER, RU_CO_ADMIN] },
  };
}

/** Add a room member as a group-conversation participant (idempotent, per PHP). */
async function addConversationParticipant(conversationId: string | null, userId: string, role: number) {
  if (!conversationId) return;
  const existing = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (existing) return;
  await db.conversationParticipant.create({
    data: { conversationId, userId, role, isActive: true, joinedAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// REELS (ReelController)
// ─────────────────────────────────────────────────────────────────────────────

// POST /uploadReel — multipart (content + thumbnail files).
async function uploadReel(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  const content = filePart(req, "content");
  const thumbnail = filePart(req, "thumbnail");
  if (!content) return fail(res, "The content field is required.");
  if (!thumbnail) return fail(res, "The thumbnail field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User Not Found");

  const contentUrl = await storeUpload(req, content, "mobile/reels");
  const thumbnailUrl = await storeUpload(req, thumbnail, "mobile/reels");

  const reel = await db.communityReel.create({
    data: {
      userId,
      causeId: optStr(p.cause_id),
      description: optStr(p.description),
      interestIds: optStr(p.interest_ids),
      hashtags: optStr(p.hashtags),
      content: contentUrl,
      thumbnail: thumbnailUrl,
      musicId: optNum(p.music_id),
    },
  });

  feedEvent("mobile.reel.created", { reelId: reel.id, userId });
  const fresh = await findReel(reel.id);
  if (!fresh) return fail(res, "Reel Not Found.");
  return data(res, "Reel Added Successfully.", reelJson(fresh));
}

// POST /likeDislikeReel
async function likeDislikeReel(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  const reelId = str(p.reel_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (!reelId) return fail(res, "The reel id field is required.");

  const user = await db.user.findFirst({ where: { id: userId, isBlock: UNBLOCKED } });
  if (!user) return fail(res, "User Not Found.");

  const reel = await findReel(reelId);
  if (!reel) return fail(res, "Reel Not Found.");

  const likeRecord = await db.communityLike.findFirst({ where: { userId, reelId } });

  if (likeRecord) {
    const newCount = Math.max(0, reel.likesCount - 1); // legacy max(0, count-1)
    await db.communityReel.update({ where: { id: reel.id }, data: { likesCount: newCount } });
    await db.savedNotification.deleteMany({
      where: { userId, reelId, type: TYPE_REEL_LIKE },
    });
    await db.communityLike.delete({ where: { id: likeRecord.id } });

    return data(res, "Reel Dislike Successfully.", {
      ...reelJson(reel),
      likes_count: newCount,
      user: reel.user ? legacyUser(reel.user) : null,
    });
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

  feedEvent("mobile.reel.liked", { reelId: reel.id, userId });
  return data(res, "Reel Liked.", {
    ...reelJson(reel),
    likes_count: newCount,
    user: reel.user ? legacyUser(reel.user) : null,
  });
}

// POST /increaseReelViewCount
async function increaseReelViewCount(req: Request, res: Response) {
  const reelId = str(params(req).reel_id);
  if (!reelId) return fail(res, "The reel id field is required.");

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) return fail(res, "Reel Not Found.");

  const updated = await db.communityReel.update({
    where: { id: reel.id },
    data: { viewsCount: { increment: 1 } },
  });

  return data(res, "Reel view count increased successfully.", {
    reel_id: updated.id,
    views_count: updated.viewsCount,
  });
}

// POST /addReelComment
async function addReelComment(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  const reelId = str(p.reel_id);
  const description = str(p.description);
  if (!userId) return fail(res, "The user id field is required.");
  if (!reelId) return fail(res, "The reel id field is required.");
  if (!description) return fail(res, "The description field is required.");
  if (description.length > 500) return fail(res, "The description may not be greater than 500 characters.");

  const user = await db.user.findFirst({ where: { id: userId, isBlock: UNBLOCKED } });
  if (!user) return fail(res, "User Not Found or Blocked.");

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) return fail(res, "Reel Not Found.");

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

  return data(res, "Reel Comment Added Successfully.", commentJson(comment, legacyUser(user)));
}

// POST /fetchReelComments
async function fetchReelComments(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  const reelId = str(p.reel_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (!reelId) return fail(res, "The reel id field is required.");
  const { skip, limit } = page(req);

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User Not Found.");

  const blockUserIds = blockedIdsOf(user);

  const comments = await db.communityReelComment.findMany({
    where: {
      reelId,
      ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  // legacy with(['user' => where is_block 0]) keeps the comment but user is null
  // when its author is (admin-)blocked
  return data(
    res,
    "Reel Comment Fetch Successfully.",
    comments.map((c) => commentJson(c, c.user && c.user.isBlock === UNBLOCKED ? legacyUser(c.user) : null))
  );
}

// POST /deleteReelComment
async function deleteReelComment(req: Request, res: Response) {
  const p = params(req);
  const myUserId = str(p.my_user_id);
  const commentId = str(p.comment_id);
  if (!myUserId) return fail(res, "The my user id field is required.");
  if (!commentId) return fail(res, "The comment id field is required.");

  const comment = await db.communityReelComment.findFirst({ where: { id: commentId, userId: myUserId } });
  if (!comment) {
    return fail(res, "Reel Comment not found or you do not have permission to delete this comment.");
  }

  const reel = await db.communityReel.findUnique({ where: { id: comment.reelId } });
  if (reel) {
    await db.communityReel.update({
      where: { id: reel.id },
      data: { commentsCount: Math.max(0, reel.commentsCount - 1) },
    });
  }

  await db.savedNotification.deleteMany({
    where: { myUserId, reelCommentId: commentId, type: TYPE_ADD_REEL_COMMENT },
  });
  await db.communityReelComment.delete({ where: { id: comment.id } });

  return data(res, "Reel Comment Delete Successfully.", commentJson(comment, null));
}

// POST /deleteReel
async function deleteReel(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  const reelId = str(p.reel_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (!reelId) return fail(res, "The reel id field is required.");

  const reel = await db.communityReel.findFirst({ where: { id: reelId, userId }, include: reelInclude });
  if (!reel) return fail(res, "Reel Not Found.");

  const commentTypes = [TYPE_REEL_LIKE, TYPE_COMMENT, TYPE_ADD_REEL_COMMENT];

  const comments = await db.communityReelComment.findMany({ where: { reelId } });
  for (const c of comments) {
    await db.savedNotification.deleteMany({ where: { reelCommentId: c.id, type: { in: commentTypes } } });
    await db.communityReelComment.delete({ where: { id: c.id } });
  }

  await db.communityLike.deleteMany({ where: { reelId } });
  await deleteFileByUrl(reel.content);
  await deleteFileByUrl(reel.thumbnail);
  await db.savedNotification.deleteMany({ where: { reelId, type: { in: commentTypes } } });
  await db.communityReel.delete({ where: { id: reel.id } });

  feedEvent("mobile.reel.deleted", { reelId, userId });
  return data(res, "Reel Deleted Successfully.", reelJson(reel));
}

// POST /fetchReelsByUserId
async function fetchReelsByUserId(req: Request, res: Response) {
  const p = params(req);
  const myUserId = str(p.my_user_id);
  const userId = str(p.user_id);
  if (!myUserId) return fail(res, "The my user id field is required.");
  if (!userId) return fail(res, "The user id field is required.");
  const { skip, limit } = page(req);

  const user = await db.user.findUnique({ where: { id: userId } });
  const myUser = await db.user.findUnique({ where: { id: myUserId } });
  if (!user || !myUser) return fail(res, "User Not Found.");

  const blockUserIds = blockedIdsOf(user);
  const blockMyUserIds = blockedIdsOf(myUser);

  if (blockUserIds.includes(myUserId) || blockMyUserIds.includes(userId)) {
    return fail(res, "User Blocked.");
  }

  const where: Prisma.CommunityReelWhereInput = {
    userId,
    user: { isBlock: UNBLOCKED },
  };
  // legacy whereNotIn('user_id', blockUserIds) — a self-blocked author yields no rows
  if (blockUserIds.length) {
    if (blockUserIds.includes(userId)) return data(res, "Fetch Reels Successfully On Profile.", []);
    where.userId = { equals: userId, notIn: blockUserIds };
  }

  const reels = await db.communityReel.findMany({
    where,
    include: reelInclude,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  return data(res, "Fetch Reels Successfully On Profile.", await processReels(reels, myUserId));
}

// POST /fetchReelsOnExplore
async function fetchReelsOnExplore(req: Request, res: Response) {
  const p = params(req);
  const myUserId = str(p.my_user_id);
  const type = optNum(p.type);
  if (!myUserId) return fail(res, "The my user id field is required.");
  if (type === null) return fail(res, 'Invalid "type" provided.');
  const { skip, limit } = page(req);

  const user = await db.user.findUnique({ where: { id: myUserId } });
  if (!user) return fail(res, "User Not Found.");

  const blockUserIds = blockedIdsOf(user);
  const baseWhere: Prisma.CommunityReelWhereInput = {
    ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    user: { isBlock: UNBLOCKED },
  };

  let reelIds: string[];
  if (type === FOR_YOU_REEL) {
    reelIds = await randomReelIds(baseWhere, limit);
  } else if (type === FOLLOWING_REEL) {
    const followingUserIds = (
      await db.userFollow.findMany({ where: { myUserId }, select: { userId: true } })
    ).map((f) => f.userId);
    const rows = await db.communityReel.findMany({
      where: { ...baseWhere, userId: { in: followingUserIds } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: { id: true },
    });
    reelIds = rows.map((r) => r.id);
  } else {
    return fail(res, 'Invalid "type" provided.');
  }

  const rows = await db.communityReel.findMany({
    where: { id: { in: reelIds } },
    include: reelInclude,
  });
  // restore the fetched order (inRandomOrder / id-desc)
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = reelIds.map((id) => byId.get(id)).filter((r): r is ReelRow => Boolean(r));
  const reels = await processReels(ordered, myUserId);

  if (reels.length === 0) return fail(res, "Reels Not Found.");

  return data(res, "Fetch Reels Successfully On Explore.", reels);
}

// POST /searchReelsByInterestId
async function searchReelsByInterestId(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  const interestId = str(p.interest_id);
  const keyword = optStr(p.keyword);
  if (!userId) return fail(res, "The user id field is required.");
  const { skip, limit } = page(req);

  if (interestId) {
    const interestIdNum = Number(interestId);
    const interest = Number.isFinite(interestIdNum)
      ? await db.communityInterest.findUnique({ where: { id: interestIdNum } })
      : null;
    if (!interest) return fail(res, "Interest Not Found.");
  }

  const user = await db.user.findFirst({ where: { id: userId, isBlock: UNBLOCKED } });
  if (!user) return fail(res, "User Not Found.");

  const blockUserIds = blockedIdsOf(user);

  const where: Prisma.CommunityReelWhereInput = {
    user: { isBlock: UNBLOCKED },
    ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
  };
  if (interestId) {
    where.id = { in: await csvMatchIds("app_reels", "interest_ids", interestId) };
  }
  if (keyword) {
    where.description = { contains: keyword };
  }

  const reels = await db.communityReel.findMany({
    where,
    include: reelInclude,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  return data(res, "Search Reels By Interest.", await processReels(reels, userId));
}

// POST /fetchReelsByHashtag
async function fetchReelsByHashtag(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  const tag = str(p.tag);
  if (!userId) return fail(res, "The user id field is required.");
  if (!tag) return fail(res, "The tag field is required.");
  const { skip, limit } = page(req);

  const user = await db.user.findFirst({ where: { id: userId, isBlock: UNBLOCKED } });
  if (!user) return fail(res, "User not found.");

  const blockUserIds = blockedIdsOf(user);

  const matching = await csvMatchIds("app_reels", "hashtags", tag);
  const reels = await db.communityReel.findMany({
    where: {
      id: { in: matching },
      user: { isBlock: UNBLOCKED },
      ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    },
    include: reelInclude,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  return data(res, "Fetched reels by hashtag successfully.", await processReels(reels, userId));
}

// POST /reportReel
async function reportReel(req: Request, res: Response) {
  const p = params(req);
  const reelId = str(p.reel_id);
  const reason = str(p.reason);
  const desc = str(p.desc);
  if (!reelId) return fail(res, "The reel id field is required.");
  if (!reason) return fail(res, "The reason field is required.");
  if (!desc) return fail(res, "The desc field is required.");

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) return fail(res, "Reel Not Found");

  const report = await db.communityReport.create({
    data: { type: 3, reelId: reel.id, reason, desc }, // type 3 = reel
  });

  return data(res, "Report Added Successfully.", reportJson(report));
}

// POST /fetchSavedReels — saved reel ids live on the user row (saved_reel_ids CSV),
// written by editProfile; this only reads them (legacy parity).
async function fetchSavedReels(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  const { skip, limit } = page(req);

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User Not Found.");

  const savedReelIds = csvToStrings(user.savedReelIds);
  const blockUserIds = blockedIdsOf(user);

  const reels = await db.communityReel.findMany({
    where: {
      id: { in: savedReelIds },
      user: { isBlock: UNBLOCKED },
      ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    },
    include: reelInclude,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  return data(res, "Fetch Saved Reels Successfully.", await processReels(reels, userId));
}

// POST /fetchReelById
async function fetchReelById(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  const reelId = str(p.reel_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (!reelId) return fail(res, "The reel id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User Not Found.");

  const blockUserIds = blockedIdsOf(user);

  const reel = await db.communityReel.findFirst({
    where: {
      id: reelId,
      user: { isBlock: UNBLOCKED },
      ...(blockUserIds.length ? { userId: { notIn: blockUserIds } } : {}),
    },
    include: reelInclude,
  });
  if (!reel) return data(res, "Fetch Reel By Id Successfully.", null);

  const [processed] = await processReels([reel], userId);
  return data(res, "Fetch Reel By Id Successfully.", processed ?? null);
}

// POST /fetchReelsByMusic
async function fetchReelsByMusic(req: Request, res: Response) {
  const p = params(req);
  const musicId = optNum(p.music_id);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (musicId === null) return fail(res, "The music id field is required.");
  const { skip, limit } = page(req);

  const music = await db.communityMusic.findUnique({ where: { id: musicId } });
  if (!music) return fail(res, "The selected music id is invalid.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "The selected user id is invalid.");

  const reels = await db.communityReel.findMany({
    where: { musicId },
    include: reelInclude,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  return data(res, "Fetch Reels By Music Successfully.", await processReels(reels, str(p.my_user_id)));
}

// ─────────────────────────────────────────────────────────────────────────────
// MUSIC (ReelController music endpoints)
// ─────────────────────────────────────────────────────────────────────────────

// POST /fetchMusicWithSearch
async function fetchMusicWithSearch(req: Request, res: Response) {
  const p = params(req);
  const start = optNum(p.start);
  const limit = optNum(p.limit);
  if (start === null) return fail(res, "The start field is required.");
  if (limit === null) return fail(res, "The limit field is required.");
  const keyword = optStr(p.keyword);

  const musics = await db.communityMusic.findMany({
    where: {
      isDeleted: DELETED_NO,
      ...(keyword
        ? { OR: [{ title: { contains: keyword } }, { artist: { contains: keyword } }] }
        : {}),
    },
    orderBy: { id: "desc" },
    skip: Math.max(0, start),
    take: Math.max(1, limit),
  });

  return data(res, "Fetched music successfully.", musics.map(musicJson));
}

// POST /fetchMusicCategories
async function fetchMusicCategories(req: Request, res: Response) {
  const categories = await db.musicCategory.findMany({
    where: { isDeleted: DELETED_NO },
    orderBy: { id: "desc" },
    include: { _count: { select: { musics: true } } },
  });

  return data(
    res,
    "Fetch Musics Categories Successfully.",
    categories.map((c) => ({ ...musicCategoryJson(c), musics_count: c._count.musics }))
  );
}

type MusicCategoryRow = Prisma.MusicCategoryGetPayload<{ include: { _count: { select: { musics: true } } } }>;
function musicCategoryJson(c: MusicCategoryRow) {
  return {
    id: c.id,
    title: c.title,
    is_deleted: c.isDeleted,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

// POST /fetchSavedMusic — saved music ids live on the user row (saved_music_ids CSV).
async function fetchSavedMusic(req: Request, res: Response) {
  const userId = str(params(req).user_id);
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "The selected user id is invalid.");

  const savedMusicIds = csvToInts(user.savedMusicIds);
  const musics = savedMusicIds.length
    ? await db.communityMusic.findMany({ where: { id: { in: savedMusicIds } } })
    : [];

  return data(res, "Fetch User Saved Musics Successfully.", musics.map(musicJson));
}

// POST /fetchMusicByCategory
async function fetchMusicByCategory(req: Request, res: Response) {
  const p = params(req);
  const start = optNum(p.start);
  const limit = optNum(p.limit);
  const categoryId = str(p.category_id);
  if (start === null) return fail(res, "The start field is required.");
  if (limit === null) return fail(res, "The limit field is required.");
  if (!categoryId) return fail(res, "The category id field is required.");

  const categoryIdNum = Number(categoryId);
  const musics = Number.isFinite(categoryIdNum)
    ? await db.communityMusic.findMany({
        where: { isDeleted: DELETED_NO, categoryId: categoryIdNum },
        orderBy: { id: "desc" },
        skip: Math.max(0, start),
        take: Math.max(1, limit),
      })
    : [];

  return data(res, "Fetch Musics By Categories Successfully.", musics.map(musicJson));
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOMS (RoomController)
// ─────────────────────────────────────────────────────────────────────────────

// POST /createRoom — multipart (optional photo); also creates the linked group
// Conversation + admin participant + admin RoomUser (per RoomController).
async function createRoom(req: Request, res: Response) {
  const p = params(req);
  const title = str(p.title);
  const desc = str(p.desc);
  const interestIds = str(p.interest_ids);
  const isPrivate = str(p.is_private);
  const isJoinRequestEnable = str(p.is_join_request_enable);
  if (!title) return fail(res, "The title field is required.");
  if (!desc) return fail(res, "The desc field is required.");
  if (!interestIds) return fail(res, "The interest ids field is required.");
  if (isPrivate === "") return fail(res, "The is private field is required.");
  if (isJoinRequestEnable === "") return fail(res, "The is join request enable field is required.");

  const adminId = str(p.admin_id);
  const admin = adminId ? await db.user.findUnique({ where: { id: adminId } }) : null;
  if (!admin) return fail(res, "User Not Found");

  const photo = filePart(req, "photo");
  const photoUrl = photo ? await storeUpload(req, photo, "mobile/rooms") : null;

  // Group conversation linked to the room (legacy 2026_06_24 migrations behavior).
  const conversation = await db.conversation.create({
    data: { type: 2, groupName: title, adminId: admin.id, groupPhoto: photoUrl },
  });

  const room = await db.communityRoom.create({
    data: {
      adminId: admin.id,
      conversationId: conversation.id,
      photo: photoUrl,
      title,
      desc,
      interestIds,
      isPrivate: Number(isPrivate) || 0,
      isJoinRequestEnable: Number(isJoinRequestEnable) || 0,
      totalMember: 1,
    },
  });

  await db.communityRoomUser.create({
    data: { roomId: room.id, userId: admin.id, type: RU_ADMIN },
  });

  await db.conversationParticipant.create({
    data: { conversationId: conversation.id, userId: admin.id, role: 2, isActive: true, joinedAt: new Date() },
  });

  feedEvent("mobile.room.created", { roomId: room.id, adminId: admin.id });
  return data(res, "Room Created Successfully", {
    ...roomJson(room),
    conversation: {
      id: conversation.id,
      type: conversation.type,
      group_name: conversation.groupName,
      group_photo: conversation.groupPhoto,
      admin_id: conversation.adminId,
      created_at: conversation.createdAt.toISOString(),
      updated_at: conversation.updatedAt.toISOString(),
    },
  });
}

// POST /editRoom — multipart (optional photo); updates only present fields.
async function editRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  if (!roomId) return fail(res, "The room id field is required.");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (room) {
    const update: Prisma.CommunityRoomUpdateInput = {};

    const photo = filePart(req, "photo");
    if (photo) {
      await deleteFileByUrl(room.photo);
      update.photo = await storeUpload(req, photo, "mobile/rooms");
    }
    if (p.title !== undefined) update.title = str(p.title);
    if (p.desc !== undefined) update.desc = str(p.desc);
    if (p.interest_ids !== undefined) update.interestIds = str(p.interest_ids);
    if (p.is_private !== undefined) update.isPrivate = Number(p.is_private) || 0;
    if (p.is_join_request_enable !== undefined)
      update.isJoinRequestEnable = Number(p.is_join_request_enable) || 0;

    await db.communityRoom.update({ where: { id: room.id }, data: update });
  }

  const fresh = room ? await db.communityRoom.findUnique({ where: { id: room.id } }) : null;
  return ok(res, "Room edit successfully", { data: fresh ? roomJson(fresh) : null });
}

// POST /inviteUserToRoom — creates RoomUser type 4 (invited) + SavedNotification type 4.
async function inviteUserToRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId }, include: { admin: true } });
  if (!room) return fail(res, "Room Not Found");

  if (room.adminId === userId) {
    return fail(res, "Lol, You are the Admin of the room");
  }

  const existing = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (existing) return fail(res, "User record already exists");

  const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, true) });
  const limit = await roomUsersLimit();
  if (memberCount >= limit) return fail(res, "Room users limit reached");

  const roomUser = await db.communityRoomUser.create({
    data: { roomId: room.id, userId: user.id, invitedBy: room.adminId, type: RU_INVITED },
  });

  if (room.adminId !== user.id && user.isPushNotifications === PUSH_ON) {
    await sendPush({
      userId: user.id,
      title: PUSH_TITLE,
      body: `${room.admin.name} has invited to room : ${room.title}`,
      type: "ROOM_INVITE",
      data: { room_id: room.id, type: TYPE_ROOM_INVITE },
    });
  }

  await db.savedNotification.create({
    data: { myUserId: user.id, userId: room.adminId, roomId: room.id, type: TYPE_ROOM_INVITE },
  });

  return data(res, "Request Send", roomUserJson(roomUser, { room: roomJson(room) }));
}

// POST /joinOrRequestRoom — join request (type 1) or direct join (type 2) per room config.
async function joinOrRequestRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId }, include: { admin: true } });
  if (!room) return fail(res, "Room Not Found");

  const existing = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (existing) return fail(res, "Already in room users list");

  const limit = await roomUsersLimit();

  if (room.isJoinRequestEnable === 1) {
    const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, false) });
    if (memberCount >= limit) return fail(res, "Room users limit reached");

    const roomUser = await db.communityRoomUser.create({
      data: { roomId: room.id, userId: user.id, type: RU_REQUEST },
    });

    if (user.id !== room.adminId && room.admin.isPushNotifications === PUSH_ON && room.admin.deviceToken) {
      await sendPush({
        userId: room.adminId,
        title: PUSH_TITLE,
        body: `${user.name} has requested to join your room : ${room.title}`,
        type: "ROOM_JOIN",
        data: { room_id: room.id, type: TYPE_JOIN_ROOM },
      });
    }

    await db.savedNotification.create({
      data: { myUserId: room.adminId, userId: user.id, roomId: room.id, type: TYPE_JOIN_ROOM },
    });

    return data(res, "Request Send", roomUserJson(roomUser, { room: roomJson(room) }));
  }

  const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, true) });
  if (memberCount >= limit) return fail(res, "Room users limit reached");

  const roomUser = await db.communityRoomUser.create({
    data: { roomId: room.id, userId: user.id, type: RU_MEMBER },
  });

  await db.communityRoom.update({ where: { id: room.id }, data: { totalMember: { increment: 1 } } });
  await addConversationParticipant(room.conversationId, user.id, 1);

  if (user.id !== room.adminId && room.admin.isPushNotifications === PUSH_ON && room.admin.deviceToken) {
    await sendPush({
      userId: room.adminId,
      title: PUSH_TITLE,
      body: `${user.name} has joined your room : ${room.title}`,
      type: "ROOM_JOIN",
      data: { room_id: room.id, type: TYPE_DIRECT_JOIN_ROOM },
    });
  }

  await db.savedNotification.create({
    data: { myUserId: room.adminId, userId: user.id, roomId: room.id, type: TYPE_DIRECT_JOIN_ROOM },
  });

  feedEvent("mobile.room.joined", { roomId: room.id, userId: user.id });
  return data(res, "Great, You are in the room", roomUserJson(roomUser, { room: roomJson(room) }));
}

// POST /getInvitationList — RoomUser type 4 rows with room + invited_user.
async function getInvitationList(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  const { skip, limit } = page(req);

  const rows = await db.communityRoomUser.findMany({
    where: { userId, type: RU_INVITED },
    include: { room: true },
    orderBy: { createdAt: "asc" }, // legacy natural (insertion) order
    skip,
    take: limit,
  });

  const inviterIds = [...new Set(rows.map((r) => r.invitedBy).filter((v): v is string => Boolean(v)))];
  const inviters = await db.user.findMany({ where: { id: { in: inviterIds } } });
  const inviterById = new Map(inviters.map((u) => [u.id, u]));

  return data(
    res,
    "Get All Room Requests (Invitation)",
    rows.map((r) =>
      roomUserJson(r, {
        room: roomJson(r.room),
        invited_user: r.invitedBy && inviterById.has(r.invitedBy) ? legacyUser(inviterById.get(r.invitedBy)!) : null,
      })
    )
  );
}

// POST /acceptInvitation — invited (4) / requested (1) row becomes member (2).
async function acceptInvitation(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  const anyRoomUser = await db.communityRoomUser.findFirst({ where: { userId } });
  if (!user || !anyRoomUser) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room Not Found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (!row) return fail(res, "Record Not found");

  if (row.type === RU_MEMBER) return fail(res, "Invitation Already Accepted");

  if (row.type !== RU_REQUEST && row.type !== RU_INVITED) {
    // legacy falls off the end (empty body) for co-admin/admin rows; keep valid JSON
    return fail(res, "Record not found");
  }

  const inviter = row.invitedBy ? await db.user.findUnique({ where: { id: row.invitedBy } }) : null;

  await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_MEMBER } });
  await db.communityRoom.update({ where: { id: room.id }, data: { totalMember: { increment: 1 } } });
  await addConversationParticipant(room.conversationId, user.id, 1);

  // legacy condition ($user->id != $invitedByUser->invited_by) is always true (User has
  // no invited_by attribute → compared against null); guarded for a missing inviter row
  if (inviter && inviter.isPushNotifications === PUSH_ON) {
    await sendPush({
      userId: inviter.id,
      title: PUSH_TITLE,
      body: `${user.name} has accepted your invitation of room : ${room.title}`,
      type: "ROOM_INVITE",
      data: { room_id: room.id, type: TYPE_ACCEPT_INVITE_ROOM },
    });
  }

  await db.savedNotification.create({
    data: { myUserId: room.adminId, userId: user.id, roomId: room.id, type: TYPE_ACCEPT_INVITE_ROOM },
  });

  const fresh = await db.communityRoomUser.findUnique({ where: { id: row.id } });
  return data(res, "Accept Invitation", roomUserJson(fresh ?? row, { room: roomJson(room) }));
}

// POST /acceptRoomRequest — admin accepts a join request (1 → 2).
async function acceptRoomRequest(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId }, include: { admin: true } });
  if (!room) return fail(res, "Room Not Found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (!row) return fail(res, "Record Not found");

  if (row.type === RU_MEMBER) return fail(res, "Invitation Already Accepted");

  const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, true) });
  const limit = await roomUsersLimit();
  if (memberCount >= limit) return fail(res, "Room users limit reached");

  await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_MEMBER } });
  await db.communityRoom.update({ where: { id: room.id }, data: { totalMember: { increment: 1 } } });
  await addConversationParticipant(room.conversationId, user.id, 1);

  // push goes TO the requesting user (their request was accepted)
  if (room.adminId !== user.id && user.isPushNotifications === PUSH_ON) {
    await sendPush({
      userId: user.id,
      title: PUSH_TITLE,
      body: `${room.admin.name} has accepted your join request of room : ${room.title}`,
      type: "ROOM_JOIN",
      data: { room_id: room.id, type: TYPE_ACCEPT_ROOM_REQUEST },
    });
  }

  const oldNotification = await db.savedNotification.findFirst({
    where: { roomId, userId, type: TYPE_JOIN_ROOM },
  });
  if (oldNotification) await db.savedNotification.delete({ where: { id: oldNotification.id } });

  await db.savedNotification.create({
    data: { myUserId: user.id, userId: room.adminId, roomId: room.id, type: TYPE_ACCEPT_ROOM_REQUEST },
  });

  const fresh = await db.communityRoomUser.findUnique({ where: { id: row.id } });
  return data(res, "Accept Room request", roomUserJson(fresh ?? row, { room: roomJson(room) }));
}

// POST /rejectInvitation — deletes the RoomUser row.
async function rejectInvitation(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  const anyRoomUser = await db.communityRoomUser.findFirst({ where: { userId } });
  if (!user || !anyRoomUser) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room Not Found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (row) {
    await db.communityRoomUser.delete({ where: { id: row.id } });
    return data(res, "Reject Invitation", roomUserJson(row));
  }
  return fail(res, "Record not found");
}

// POST /rejectRoomRequest — deletes the RoomUser row + the join-request notification.
async function rejectRoomRequest(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  const anyRoomUser = await db.communityRoomUser.findFirst({ where: { userId } });
  if (!user || !anyRoomUser) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room Not Found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (row) {
    await db.communityRoomUser.delete({ where: { id: row.id } });

    const oldNotification = await db.savedNotification.findFirst({
      where: { roomId, userId, type: TYPE_JOIN_ROOM },
    });
    if (oldNotification) await db.savedNotification.delete({ where: { id: oldNotification.id } });

    return data(res, "Reject Room Request", roomUserJson(row));
  }
  return fail(res, "Record does not exist");
}

// POST /fetchRoomRequestList — RoomUser type 1 rows with user.
async function fetchRoomRequestList(req: Request, res: Response) {
  const roomId = str(params(req).room_id);
  if (!roomId) return fail(res, "The room id field is required.");

  const rows = await db.communityRoomUser.findMany({
    where: { roomId, type: RU_REQUEST },
    include: { user: true },
  });

  return data(
    res,
    "Fetch Room Request List",
    rows.map((r) => roomUserJson(r, { user: r.user ? legacyUser(r.user) : null }))
  );
}

// POST /fetchRoomUsersList — RoomUser type 2|3|5 rows with user (paginated).
async function fetchRoomUsersList(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  if (!roomId) return fail(res, "The room id field is required.");
  const { skip, limit } = page(req);

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room not found");

  const rows: RoomUserWithUser[] = await db.communityRoomUser.findMany({
    where: { roomId, type: { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN] } },
    include: { user: true },
    orderBy: { createdAt: "asc" },
    skip,
    take: limit,
  });

  return data(
    res,
    "Fetch Room User List",
    rows.map((r) => roomUserJson(r, { user: r.user ? legacyUser(r.user) : null }))
  );
}

// POST /removeUserFromRoom
async function removeUserFromRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room Not Found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (row) {
    await db.communityRoom.update({
      where: { id: room.id },
      data: { totalMember: Math.max(0, room.totalMember - 1) },
    });
    await db.communityRoomUser.delete({ where: { id: row.id } });
    return data(res, "Remove user from Room", roomUserJson(row));
  }
  return fail(res, "User Not Found");
}

// POST /makeRoomAdmin — member becomes co-admin (type 3).
async function makeRoomAdmin(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User not found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (!row) return fail(res, "Room user not found");

  const updated = await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_CO_ADMIN } });
  return data(res, "Co admin created succesfully", roomUserJson(updated));
}

// POST /fetchRoomAdmins — RoomUser type 3|5 rows with user.
async function fetchRoomAdmins(req: Request, res: Response) {
  const roomId = str(params(req).room_id);
  if (!roomId) return fail(res, "The room id field is required.");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room not found");

  const rows: RoomUserWithUser[] = await db.communityRoomUser.findMany({
    where: { roomId, type: { in: [RU_CO_ADMIN, RU_ADMIN] } },
    include: { user: true },
    orderBy: { createdAt: "asc" }, // legacy natural (insertion) order
  });

  return data(
    res,
    "Fetch room admins",
    rows.map((r) => roomUserJson(r, { user: r.user ? legacyUser(r.user) : null }))
  );
}

// POST /removeAdminFromRoom — co-admin (3) back to member (2).
async function removeAdminFromRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room not found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId, type: RU_CO_ADMIN } });
  if (!row) return fail(res, "Already User not co-admin");

  const updated = await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_MEMBER } });
  return data(res, "Remove admin from room", roomUserJson(updated));
}

// POST /reportRoom — CommunityReport type 0; requester must have a room_users row (legacy).
async function reportRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  const reason = str(p.reason);
  const desc = str(p.desc);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");
  if (!reason) return fail(res, "The reason field is required.");
  if (!desc) return fail(res, "The desc field is required.");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  const anyRoomUser = await db.communityRoomUser.findFirst({ where: { userId } });

  if (!anyRoomUser) return fail(res, "User Not Found");
  if (!room) return fail(res, "Room Not Found");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) return fail(res, "User Not Found");

  const report = await db.communityReport.create({
    data: { type: 0, roomId: room.id, userId: user.id, reason, desc },
  });

  return data(res, "Report Added Successfully", reportJson(report));
}

// POST /leaveThisRoom
async function leaveThisRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room Not Found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
  if (row) {
    await db.communityRoom.update({
      where: { id: room.id },
      data: { totalMember: Math.max(0, room.totalMember - 1) },
    });
    await db.communityRoomUser.delete({ where: { id: row.id } });

    const oldNotification = await db.savedNotification.findFirst({
      where: { roomId, userId, type: TYPE_ACCEPT_ROOM_REQUEST },
    });
    if (oldNotification) await db.savedNotification.delete({ where: { id: oldNotification.id } });

    return data(res, "Leave This Room", roomUserJson(row));
  }
  return fail(res, "Room user data not found");
}

// POST /fetchRoomDetail — room + userRoomStatus + is_mute + interests + admin
// (+ roomUsers when should_show_member=1). Auto-creates the linked conversation
// when missing (legacy behavior).
async function fetchRoomDetail(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  const shouldShowMember = num(p.should_show_member);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  let room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room not found");

  // Auto-create conversation if it doesn't exist (+ backfill participants)
  if (!room.conversationId) {
    const conversation = await db.conversation.create({
      data: { type: 2, groupName: room.title, adminId: room.adminId, groupPhoto: room.photo },
    });
    room = await db.communityRoom.update({
      where: { id: room.id },
      data: { conversationId: conversation.id },
    });

    const members = await db.communityRoomUser.findMany({
      where: { roomId: room.id, type: { in: [RU_MEMBER, RU_ADMIN] } },
    });
    for (const member of members) {
      await addConversationParticipant(conversation.id, member.userId, member.type === RU_ADMIN ? 2 : 1);
    }
  }

  const userRoomStatus = await db.communityRoomUser.findFirst({ where: { userId, roomId } });
  if (!userRoomStatus) {
    // legacy: no room_users row for this user → "User not found"
    return fail(res, "User not found");
  }

  const interests = await db.communityInterest.findMany({
    where: { id: { in: csvToInts(room.interestIds) } },
  });

  const result: Record<string, unknown> = {
    ...roomJson(room),
    userRoomStatus: userRoomStatus.type,
    is_mute: userRoomStatus.isMute,
    interests: interests.map(interestJson),
  };

  const admin = await db.user.findUnique({ where: { id: room.adminId } });
  result.admin = admin ? legacyUser(admin) : null;

  if (shouldShowMember === 1) {
    const members: RoomUserWithUser[] = await db.communityRoomUser.findMany({
      where: { roomId: room.id, type: { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN, -1] } },
      include: { user: true },
    });
    result.roomUsers = members
      .map((m) => (m.user ? legacyUser(m.user) : null))
      .filter((u) => u !== null);
  }

  return data(res, "Room Details", result);
}

// POST /deleteRoom — room admin (RoomUser type 5) deletes the room and its dependents.
async function deleteRoom(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const adminRow = await db.communityRoomUser.findFirst({ where: { roomId, userId, type: RU_ADMIN } });
  if (!adminRow) return fail(res, "User not found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room not found");

  await deleteFileByUrl(room.photo);
  await db.communityRoomUser.deleteMany({ where: { roomId } });
  await db.savedNotification.deleteMany({ where: { roomId } });
  await db.communityReport.deleteMany({ where: { roomId, type: 0 } });
  await db.communityRoom.delete({ where: { id: room.id } });

  return data(res, "Room deleted successfully", roomJson(room));
}

// POST /fetchMyOwnRooms
async function fetchMyOwnRooms(req: Request, res: Response) {
  const myUserId = str(params(req).my_user_id);
  if (!myUserId) return fail(res, "The my user id field is required.");

  const user = await db.user.findUnique({ where: { id: myUserId } });
  if (!user) return fail(res, "User not found");

  const rooms = await db.communityRoom.findMany({
    where: { adminId: user.id },
    orderBy: { createdAt: "asc" }, // legacy natural (insertion) order
  });

  return data(res, "Room you own", rooms.map(roomJson));
}

// POST /fetchRoomsByInterest — public, non-full rooms matching a CSV interest.
async function fetchRoomsByInterest(req: Request, res: Response) {
  const p = params(req);
  const interestId = str(p.interest_id);
  const userId = str(p.user_id);
  if (!interestId) return fail(res, "The interest id field is required.");
  if (!userId) return fail(res, "The user id field is required.");
  const { skip, limit } = page(req);

  const settingLimit = await roomUsersLimit();

  const matching = await csvMatchIds("app_rooms", "interest_ids", interestId);
  const rooms = await db.communityRoom.findMany({
    where: {
      id: { in: matching },
      admin: { isBlock: UNBLOCKED },
      isPrivate: 0,
      totalMember: { not: settingLimit },
    },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const withStatus = await Promise.all(
    rooms.map(async (room) => {
      const ru = await db.communityRoomUser.findFirst({ where: { userId, roomId: room.id } });
      return { ...roomJson(room), userRoomStatus: ru ? ru.type : 0 };
    })
  );

  return data(res, "Room Result", withStatus);
}

// POST /fetchSuggestedRooms — mirrors RoomController::fetchSuggestedRooms exactly,
// including returning the last fetched `$rooms` batch (the legacy controller
// accumulates `$data` but returns `$rooms`).
async function fetchSuggestedRooms(req: Request, res: Response) {
  const myUserId = str(params(req).my_user_id);
  if (!myUserId) return fail(res, "The my user id field is required.");

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: myUserId } });
  if (!user) return fail(res, "User not found");

  const myRoomIds = (
    await db.communityRoomUser.findMany({ where: { userId: myUserId }, select: { roomId: true } })
  ).map((r) => r.roomId);
  const blockedUserIds = (
    await db.user.findMany({ where: { isBlock: 1 }, select: { id: true } })
  ).map((u) => u.id);

  const baseWhere: Prisma.CommunityRoomWhereInput = {
    adminId: { not: myUserId },
    isPrivate: 0,
    ...(myRoomIds.length ? { id: { notIn: myRoomIds } } : {}),
    ...(blockedUserIds.length ? { adminId: { notIn: blockedUserIds } } : {}),
  };

  if (!user.interestIds) {
    // legacy: interest_ids null OR '' (loose == null) → random pick
    const rooms = await randomRooms(baseWhere, 2);
    return data(res, "Suggested random room", rooms.map(roomJson));
  }

  const settingLimit = await roomUsersLimit();
  const interestIds = csvToInts(user.interestIds);
  // legacy shuffle($interest_ids)
  for (let i = interestIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [interestIds[i], interestIds[j]] = [interestIds[j], interestIds[i]];
  }

  const picked = new Set<string>();
  let rooms: RoomRow[] = [];

  for (const interestId of interestIds) {
    const matching = await csvMatchIds("app_rooms", "interest_ids", String(interestId));
    rooms = await randomRooms({ ...baseWhere, id: { in: matching } }, 2);
    for (const room of rooms) {
      if (room.totalMember < settingLimit && !picked.has(room.id) && picked.size !== 2) {
        picked.add(room.id);
      }
    }
  }

  if (rooms.length <= 1) {
    rooms = await randomRooms(baseWhere, 2);
    for (const room of rooms) {
      if (room.totalMember < settingLimit && !picked.has(room.id) && picked.size !== 2) {
        picked.add(room.id);
      }
    }
  }

  // legacy quirk: returns the last `$rooms` batch, not the accumulated `$data`
  return data(res, "Suggested Room", rooms.map(roomJson));
}

// POST /searchUserForInvitation — invitable users for a room (not already in it).
async function searchUserForInvitation(req: Request, res: Response) {
  const p = params(req);
  const myUserId = str(p.my_user_id);
  const roomId = str(p.room_id);
  if (!myUserId) return fail(res, "The my user id field is required.");
  if (!roomId) return fail(res, "The room id field is required.");
  const { skip, limit } = page(req);
  const keyword = str(p.keyword);

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: myUserId } });
  if (!user) return fail(res, "User Not Found");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room not found");

  const blockUserIds = blockedIdsOf(user);

  const alreadyInRoom = (
    await db.communityRoomUser.findMany({ where: { roomId }, select: { userId: true } })
  ).map((r) => r.userId);

  const users = await db.user.findMany({
    where: {
      isBlock: UNBLOCKED,
      isInvitedToRoom: 1,
      // legacy: notIn(ids already in the room) AND notIn(my blocked users)
      ...(alreadyInRoom.length || blockUserIds.length
        ? { id: { notIn: [...alreadyInRoom, ...blockUserIds] } }
        : {}),
      OR: [{ username: { contains: keyword } }, { name: { contains: keyword } }],
    },
    orderBy: { createdAt: "asc" }, // legacy natural (insertion) order
    skip,
    take: limit,
  });

  return data(res, "User result", users.map(legacyUser));
}

// POST /fetchRandomRooms
async function fetchRandomRooms(req: Request, res: Response) {
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  const limit = Math.max(1, num(p.limit, 20));

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) return fail(res, "User not found");

  const blockedUserIds = (await db.user.findMany({ where: { isBlock: 1 }, select: { id: true } })).map(
    (u) => u.id
  );

  const rooms = await randomRooms(
    {
      ...(blockedUserIds.length ? { adminId: { notIn: blockedUserIds } } : {}),
      isPrivate: 0,
    },
    limit
  );

  const withStatus = await Promise.all(
    rooms.map(async (room) => {
      const ru = await db.communityRoomUser.findFirst({ where: { userId, roomId: room.id } });
      return { ...roomJson(room), userRoomStatus: ru ? ru.type : 0 };
    })
  );

  return data(res, "Random Room List", withStatus);
}

// POST /muteUnmuteRoomNotification
async function muteUnmuteRoomNotification(req: Request, res: Response) {
  const p = params(req);
  const roomId = str(p.room_id);
  const userId = str(p.user_id);
  if (!roomId) return fail(res, "The room id field is required.");
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  const room = await db.communityRoom.findUnique({ where: { id: roomId } });

  if (user || room) {
    const row = await db.communityRoomUser.findFirst({ where: { roomId, userId } });
    if (!row) return fail(res, "Something went wrong");

    const updated = await db.communityRoomUser.update({
      where: { id: row.id },
      data: { isMute: num(p.is_mute) ? 1 : 0 },
    });
    return data(res, "Mute Unmute Successfully", roomUserJson(updated));
  }
  return fail(res, "Something went wrong");
}

// POST /fetchRoomsList — my room_users rows (2|3|5) with the room attached.
async function fetchRoomsList(req: Request, res: Response) {
  const userId = str(params(req).user_id);
  if (!userId) return fail(res, "The user id field is required.");

  const rows: RoomUserWithRoom[] = await db.communityRoomUser.findMany({
    where: { userId, type: { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN] } },
    include: { room: true },
    orderBy: { createdAt: "asc" }, // legacy natural (insertion) order
  });

  return data(
    res,
    "Fetching rooms list Successfully",
    rows.map((r) => roomUserJson(r, { room: roomJson(r.room) }))
  );
}

// POST /fetchRoomsIAmIn — all room_users rows for the user.
// Legacy quirk kept: responds status:false with the data (the app only reads data).
async function fetchRoomsIAmIn(req: Request, res: Response) {
  const userId = str(params(req).user_id);
  if (!userId) return fail(res, "User Not Found");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User Not Found");

  const rows = await db.communityRoomUser.findMany({ where: { userId } });

  return res.json({ status: false, message: "Users In Room List", data: rows.map((r) => roomUserJson(r)) });
}

// ─── Route table (all POST — the legacy api.php only registers POST) ─────────

// Multipart routes: registered directly so multer receives express's real `next`
// (wrap() calls handlers as h(req, res), which leaves multer's next undefined).
const wrapped = (h: Handler) => (req: Request, res: Response) =>
  Promise.resolve(h(req, res)).catch((e) => mobileErrorHandler(e, res));

router.post("/uploadReel", multipart, wrapped(withAuth(uploadReel)));
router.post("/createRoom", multipart, wrapped(withAuth(createRoom)));
router.post("/editRoom", multipart, wrapped(withAuth(editRoom)));

wrap(router, "post", "/likeDislikeReel", withAuth(likeDislikeReel));
wrap(router, "post", "/increaseReelViewCount", withAuth(increaseReelViewCount));
wrap(router, "post", "/addReelComment", withAuth(addReelComment));
wrap(router, "post", "/fetchReelComments", withAuth(fetchReelComments));
wrap(router, "post", "/deleteReelComment", withAuth(deleteReelComment));
wrap(router, "post", "/deleteReel", withAuth(deleteReel));
wrap(router, "post", "/fetchReelsByUserId", withAuth(fetchReelsByUserId));
wrap(router, "post", "/fetchReelsOnExplore", withAuth(fetchReelsOnExplore));
wrap(router, "post", "/searchReelsByInterestId", withAuth(searchReelsByInterestId));
wrap(router, "post", "/fetchReelsByHashtag", withAuth(fetchReelsByHashtag));
wrap(router, "post", "/reportReel", withAuth(reportReel));
wrap(router, "post", "/fetchSavedReels", withAuth(fetchSavedReels));
wrap(router, "post", "/fetchReelById", withAuth(fetchReelById));
wrap(router, "post", "/fetchReelsByMusic", withAuth(fetchReelsByMusic));

wrap(router, "post", "/fetchMusicWithSearch", withAuth(fetchMusicWithSearch));
wrap(router, "post", "/fetchMusicCategories", withAuth(fetchMusicCategories));
wrap(router, "post", "/fetchSavedMusic", withAuth(fetchSavedMusic));
wrap(router, "post", "/fetchMusicByCategory", withAuth(fetchMusicByCategory));

wrap(router, "post", "/inviteUserToRoom", withAuth(inviteUserToRoom));
wrap(router, "post", "/joinOrRequestRoom", withAuth(joinOrRequestRoom));
wrap(router, "post", "/getInvitationList", withAuth(getInvitationList));
wrap(router, "post", "/acceptInvitation", withAuth(acceptInvitation));
wrap(router, "post", "/acceptRoomRequest", withAuth(acceptRoomRequest));
wrap(router, "post", "/rejectInvitation", withAuth(rejectInvitation));
wrap(router, "post", "/fetchRoomRequestList", withAuth(fetchRoomRequestList));
wrap(router, "post", "/rejectRoomRequest", withAuth(rejectRoomRequest));
wrap(router, "post", "/removeUserFromRoom", withAuth(removeUserFromRoom));
wrap(router, "post", "/makeRoomAdmin", withAuth(makeRoomAdmin));
wrap(router, "post", "/fetchRoomUsersList", withAuth(fetchRoomUsersList));
wrap(router, "post", "/reportRoom", withAuth(reportRoom));
wrap(router, "post", "/leaveThisRoom", withAuth(leaveThisRoom));
wrap(router, "post", "/fetchRoomDetail", withAuth(fetchRoomDetail));
wrap(router, "post", "/deleteRoom", withAuth(deleteRoom));
wrap(router, "post", "/fetchMyOwnRooms", withAuth(fetchMyOwnRooms));
wrap(router, "post", "/fetchSuggestedRooms", withAuth(fetchSuggestedRooms));
wrap(router, "post", "/fetchRoomsByInterest", withAuth(fetchRoomsByInterest));
wrap(router, "post", "/searchUserForInvitation", withAuth(searchUserForInvitation));
wrap(router, "post", "/fetchRandomRooms", withAuth(fetchRandomRooms));
wrap(router, "post", "/fetchRoomAdmins", withAuth(fetchRoomAdmins));
wrap(router, "post", "/removeAdminFromRoom", withAuth(removeAdminFromRoom));
wrap(router, "post", "/fetchRoomsList", withAuth(fetchRoomsList));
wrap(router, "post", "/muteUnmuteRoomNotification", withAuth(muteUnmuteRoomNotification));
wrap(router, "post", "/fetchRoomsIAmIn", withAuth(fetchRoomsIAmIn));
