/**
 * Mobile compat routes — posts module.
 * Ports the legacy Laravel PostController (+ InterestController::fetchInterests,
 * UserController::fetchPostByUser) 1:1 onto the uarnew backend so the Flutter
 * app works unchanged. Source of truth: uar/php/admin PostController.php.
 *
 * Legacy middleware per route is `checkHeader` (apikey only) — handled by the
 * mount-level mobileGate; handlers below read the acting user from the
 * `user_id`/`my_user_id` params exactly like the PHP did. `uploadFile` is the
 * one endpoint that additionally requires a session (mobileAuth).
 *
 * Wire contract (checked against the Flutter models):
 *   posts_model.dart / single_feed_model.dart / comment_model.dart /
 *   comments_model.dart / search_hashtags_model.dart / post_users_model.dart /
 *   story.dart / upload_file.dart / room_model.dart (suggestedRooms) /
 *   setting_model.dart (Interest) / registration.dart (User).
 */
import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  ok,
  data,
  fail,
  mobileAuth,
  params,
  str,
  num,
  optStr,
  optNum,
  bool,
  csvHas,
  page,
  storeUpload,
  sendPush,
  feedEvent,
  wrap,
  legacyUser,
} from "@/lib/mobile/compat";
import { multipart, readForm, type MulterFile } from "@/lib/multipart";

export const router = Router();

// NOTE: apikey validation is handled exclusively by the mount-level mobileGate
// in routes/mobile/index.ts. Requests WITHOUT the apikey header fall through
// to the admin routers — a router.use guard here would 401 them all (it runs
// for every /api request passing through the compat layer), breaking the
// Razorpay webhook and every admin endpoint mounted after this router.

// ─── Local helpers ────────────────────────────────────────────────────────────

/** Row types resolved from the actual Prisma model signatures. */
type UserRow = NonNullable<Awaited<ReturnType<typeof db.user.findFirst>>>;
type RoomRow = NonNullable<Awaited<ReturnType<typeof db.communityRoom.findFirst>>>;
type LikeRow = Prisma.CommunityLikeGetPayload<{ include: { user: true } }>;
type CommentRow = Prisma.CommunityCommentGetPayload<{
  include: { user: true; likes: true; _count: { select: { likes: true } } };
}>;

const POST_INCLUDE: Prisma.CommunityPostInclude = {
  content: { orderBy: { createdAt: "asc" } },
  user: true,
  category: true,
};
type PostRow = Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>;

const STORY_INCLUDE: Prisma.CommunityStoryInclude = { user: true };

/** The "mobile.app" Setting KV (app name, setRoomUsersLimit, fetch_post_type…). */
async function appSettings(): Promise<Record<string, unknown>> {
  const row = await db.setting.findUnique({ where: { key: "mobile.app" } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** CSV string → string[] (cuid-safe variant of csvToInts for User-id columns). */
function csvList(v: unknown): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Collect uploaded parts by field name (tolerates Laravel-style `name[]`). */
function formFiles(req: Request, base: string): File[] {
  const all = (req.files ?? []) as Array<MulterFile & { fieldname?: string }>;
  return all
    .filter((f) => f.fieldname === base || f.fieldname === `${base}[]`)
    .map((f) => new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" }));
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ─── Serializers (legacy Eloquent JSON, snake_case) ──────────────────────────

function serializeCategory(c: NonNullable<PostRow["category"]>) {
  return {
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    description: c.description,
    is_active: c.isActive,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

function serializeContent(c: PostRow["content"][number]) {
  return {
    id: c.id,
    post_id: c.postId,
    content_type: c.contentType,
    content: c.content,
    thumbnail: c.thumbnail,
    audio_waves: c.audioWaves,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

function serializePost(
  p: PostRow,
  extra?: {
    isLike?: number;
    reactionType?: string | null;
    counts?: Record<string, number>;
    progressPercentage?: number;
    likesCount?: number;
  }
) {
  const counts = extra?.counts ?? {};
  const support = counts.support ?? 0;
  const prayers = counts.prayers ?? 0;
  const appreciate = counts.appreciate ?? 0;
  const inspired = counts.inspired ?? 0;
  const help = counts.help ?? 0;

  const wire: Record<string, unknown> = {
    id: p.id,
    user_id: p.userId,
    desc: p.desc,
    tags: p.tags,
    link_preview_json: p.linkPreviewJson,
    interest_ids: p.interestIds,
    type: p.type,
    goal_amount: p.goalAmount,
    raised_amount: p.raisedAmount,
    deadline: iso(p.deadline),
    is_verified: p.isVerified,
    category_id: p.categoryId,
    is_emergency: p.isEmergency,
    context_label: p.contextLabel,
    impact_label: p.impactLabel,
    community_label: p.communityLabel,
    comments_count: p.commentsCount,
    likes_count: extra?.likesCount ?? p.likesCount,
    is_restricted: p.isRestricted,
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
    content: p.content.map(serializeContent),
    user: p.user ? legacyUser(p.user) : null,
    category: p.category ? serializeCategory(p.category) : null,
    is_like: extra?.isLike ?? 0,
    reaction_type: extra?.reactionType ?? null,
    support_count: support,
    prayers_count: prayers,
    appreciate_count: appreciate,
    inspired_count: inspired,
    help_count: help,
    total_reactions: support + prayers + appreciate + inspired + help,
  };
  if (extra?.progressPercentage !== undefined) wire.progress_percentage = extra.progressPercentage;
  return wire;
}

function serializeLike(l: LikeRow, withPost?: Record<string, unknown>) {
  const wire: Record<string, unknown> = {
    id: l.id,
    user_id: l.userId,
    post_id: l.postId,
    reel_id: l.reelId,
    reaction_type: l.reactionType,
    created_at: iso(l.createdAt),
    updated_at: iso(l.updatedAt),
    user: l.user ? legacyUser(l.user) : null,
  };
  if (withPost) wire.post = withPost;
  return wire;
}

function commentWire(
  c: Pick<CommentRow, "id" | "userId" | "postId" | "desc" | "createdAt" | "updatedAt">,
  user?: UserRow | null
) {
  return {
    id: c.id,
    user_id: c.userId,
    post_id: c.postId,
    desc: c.desc,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
    user: user && user.isBlock === 0 ? legacyUser(user) : null,
  };
}

function likeCommentWire(l: { id: string; userId: string; commentId: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: l.id,
    user_id: l.userId,
    comment_id: l.commentId,
    created_at: iso(l.createdAt),
    updated_at: iso(l.updatedAt),
  };
}

type StoryLike = {
  id: string;
  userId: string;
  type: number;
  duration: number;
  content: string;
  thumbnail: string | null;
  viewByUserIds: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: UserRow | null;
};

function storyWire(s: StoryLike, withUser?: boolean) {
  const wire: Record<string, unknown> = {
    id: s.id,
    user_id: s.userId,
    type: s.type,
    duration: s.duration,
    content: s.content,
    thumbnail: s.thumbnail,
    view_by_user_ids: s.viewByUserIds,
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
  };
  if (withUser && s.user) wire.user = legacyUser(s.user);
  return wire;
}

function reportWire(r: {
  id: string;
  type: number | null;
  roomId: string | null;
  userId: string | null;
  postId: string | null;
  reelId: string | null;
  commentId: string | null;
  reason: string;
  desc: string;
  createdAt: Date;
  updatedAt: Date;
}) {
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
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
}

function interestWire(i: { id: number; title: string; createdAt: Date; updatedAt: Date }, totalRoomOfInterest: number) {
  return {
    id: i.id,
    title: i.title,
    created_at: iso(i.createdAt),
    updated_at: iso(i.updatedAt),
    totalRoomOfInterest,
  };
}

function roomWire(r: RoomRow, userRoomStatus: number) {
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
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
    userRoomStatus,
  };
}

// ─── Domain helpers (ports of Post::processPosts / getSuggestedRooms) ─────────

/** Post::processPosts — is_like/reaction_type + per-reaction counts. */
async function processPosts(posts: PostRow[], myUserId: string) {
  const ids = posts.map((p) => p.id);
  const [mine, grouped] = await Promise.all([
    db.communityLike.findMany({ where: { postId: { in: ids }, userId: myUserId } }),
    db.communityLike.groupBy({
      by: ["postId", "reactionType"],
      where: { postId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const mineByPost = new Map(mine.map((l) => [l.postId, l]));
  const countsByPost = new Map<string, Record<string, number>>();
  for (const g of grouped) {
    if (!g.postId) continue;
    const per = countsByPost.get(g.postId) ?? {};
    per[g.reactionType] = g._count._all;
    countsByPost.set(g.postId, per);
  }

  return posts.map((p) => {
    const like = mineByPost.get(p.id);
    return serializePost(p, {
      isLike: like ? 1 : 0,
      reactionType: like ? like.reactionType : null,
      counts: countsByPost.get(p.id) ?? {},
    });
  });
}

/** PostController::getSuggestedRooms — up to 2 public rooms I'm not in, preferring my interests. */
async function getSuggestedRooms(me: UserRow): Promise<ReturnType<typeof roomWire>[]> {
  const settings = await appSettings();
  const roomUsersLimit = num(settings.setRoomUsersLimit, 16);

  const [myRoomIds, blockedAdminIds] = await Promise.all([
    db.communityRoomUser
      .findMany({ where: { userId: me.id }, select: { roomId: true } })
      .then((rows) => rows.map((r) => r.roomId)),
    db.user
      .findMany({ where: { isBlock: 1 }, select: { id: true } })
      .then((rows) => rows.map((u) => u.id)),
  ]);
  const pool = await db.communityRoom.findMany({
    where: {
      isPrivate: 0,
      adminId: { not: me.id, notIn: blockedAdminIds },
      id: { notIn: myRoomIds },
    },
  });

  const candidates = shuffle(pool);
  const picked: RoomRow[] = [];
  const push = (room: RoomRow) => {
    if (picked.length < 2 && !picked.some((r) => r.id === room.id)) picked.push(room);
  };

  const myInterestIds = shuffle(csvList(me.interestIds));
  if (myInterestIds.length === 0) {
    candidates.slice(0, 2).forEach(push);
  } else {
    for (const interestId of myInterestIds) {
      if (picked.length >= 2) break;
      for (const room of candidates) {
        if (picked.length >= 2) break;
        if (!csvHas(room.interestIds, interestId)) continue;
        if (room.totalMember >= roomUsersLimit) continue;
        push(room);
      }
    }
    // Fewer than 2 found → top up with random public rooms.
    for (const room of candidates) {
      if (picked.length >= 2) break;
      push(room);
    }
  }

  const statuses = await db.communityRoomUser.findMany({
    where: { userId: me.id, roomId: { in: picked.map((r) => r.id) } },
  });
  return picked.map((r) => roomWire(r, statuses.find((s) => s.roomId === r.id)?.type ?? 0));
}

/** Random page of feed post ids — Postgres port of Eloquent inRandomOrder(). */
async function randomPostIds(where: Prisma.CommunityPostWhereInput, limit: number): Promise<string[]> {
  const blockedIds = Array.isArray(where.userId && (where.userId as { notIn?: string[] }).notIn)
    ? ((where.userId as { notIn: string[] }).notIn as string[])
    : [];
  const blockedSql = blockedIds.length > 0 ? Prisma.sql` AND p.user_id NOT IN (${Prisma.join(blockedIds)})` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT p.id FROM "app_posts" p INNER JOIN "users" u ON u."id" = p."user_id"
               WHERE u."isBlock" = 0 AND p."is_restricted" = 0${blockedSql}
               ORDER BY random() LIMIT ${limit}`
  );
  return rows.map((r) => r.id);
}

/** wrap() equivalent for routes that need the `multipart` middleware first. */
function wrapOne(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) =>
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error("[mobile] route error:", e);
      return fail(res, "Something went wrong");
    });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** addPost — PostController::addPost (SightEngine moderation disabled in settings). */
router.post("/addPost", multipart, wrapOne(async (req, res) => {
  const p = params(req);
  if (!str(p.user_id)) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "User Not Found");

  const contentFiles = formFiles(req, "content");
  const thumbnails = formFiles(req, "thumbnail");
  if (contentFiles.length > 0 && !str(p.content_type)) {
    return fail(res, "The content type field is required when content is not null.");
  }

  const post = await db.communityPost.create({
    data: {
      userId: user.id,
      desc: optStr(p.desc),
      tags: optStr(p.tags),
      linkPreviewJson: optStr(p.link_preview_json),
      interestIds: optStr(p.interest_ids),
      isEmergency: bool(p.is_emergency),
      contextLabel: optStr(p.context_label),
      impactLabel: optStr(p.impact_label),
      communityLabel: optStr(p.community_label),
    },
  });

  const contentType = Math.trunc(num(p.content_type, 0)); // 0 image | 1 video | 2 audio
  const audioWaves = optStr(p.audio_waves);
  for (let i = 0; i < contentFiles.length; i++) {
    const content = await storeUpload(req, contentFiles[i], "mobile");
    const thumbnail = thumbnails[i] ? await storeUpload(req, thumbnails[i], "mobile") : null;
    await db.communityPostContent.create({
      data: { postId: post.id, contentType, content, thumbnail, audioWaves },
    });
  }

  const full = await db.communityPost.findUnique({ where: { id: post.id }, include: POST_INCLUDE });
  feedEvent("post.created", { id: post.id, user_id: post.userId });
  return data(res, "Post Uploaded", full ? serializePost(full) : null);
}));

/** fetchPosts — PostController::fetchPosts — the app's main feed. */
wrap(router, "post", "/fetchPosts", async (req, res) => {
  const p = params(req);
  if (!str(p.my_user_id)) return fail(res, "The my user id field is required.");

  const me = await db.user.findFirst({ where: { id: str(p.my_user_id), isBlock: 0 } });
  if (!me) return fail(res, "User not found");

  const blockedIds = csvList(me.blockUserIds);
  const where: Prisma.CommunityPostWhereInput = {
    user: { isBlock: 0 },
    userId: { notIn: blockedIds },
    isRestricted: 0,
  };

  // fetch_post_type: 0 = random (Constants::RandomPosts), else latest.
  // The app echoes its cached setting; fall back to the server's Setting KV.
  const settings = await appSettings();
  const fetchType = optNum(p.fetch_post_type) ?? num(settings.fetch_post_type, 0);

  let posts: PostRow[];
  if (fetchType === 0) {
    const ids = await randomPostIds(where, page(req).limit);
    posts = ids.length
      ? await db.communityPost.findMany({ where: { id: { in: ids } }, include: POST_INCLUDE })
      : [];
    posts.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  } else {
    const { start, limit } = page(req);
    posts = await db.communityPost.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: { createdAt: "desc" },
      ...(start > 0 ? { skip: start } : {}),
      take: limit,
    });
  }

  const wires = await processPosts(posts, me.id);

  // Cause posts get progress_percentage (Post::getProgressPercentage).
  for (const [i, post] of posts.entries()) {
    if (post.type === "cause") {
      const progress =
        !post.goalAmount || post.goalAmount <= 0
          ? 0
          : Math.min(100, (post.raisedAmount / post.goalAmount) * 100);
      (wires[i] as Record<string, unknown>).progress_percentage = progress;
    }
  }

  const suggestedRooms = bool(p.should_send_suggested_room) ? await getSuggestedRooms(me) : [];
  return ok(res, "Fetch posts successfully", { data: wires, suggestedRooms });
});

/** fetchPostByPostId — PostController::fetchPostByPostId (single feed). */
wrap(router, "post", "/fetchPostByPostId", async (req, res) => {
  const p = params(req);
  if (!str(p.my_user_id) || !str(p.post_id)) return fail(res, "Validation failed");

  const me = await db.user.findFirst({ where: { id: str(p.my_user_id), isBlock: 0 } });
  if (!me) return fail(res, "User not found");

  const post = await db.communityPost.findFirst({
    where: {
      id: str(p.post_id),
      user: { isBlock: 0 },
      userId: { notIn: csvList(me.blockUserIds) },
    },
    include: POST_INCLUDE,
  });
  if (!post) return fail(res, "Posts not Available");

  const isLike = await db.communityLike.findFirst({
    where: { userId: me.id, postId: post.id },
  });
  return data(res, "Fetch posts", serializePost(post, { isLike: isLike ? 1 : 0 }));
});

/** fetchPostByUser — UserController::fetchPostByUser (post-domain, lives here). */
wrap(router, "post", "/fetchPostByUser", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.my_user_id)) return fail(res, "Validation failed");

  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "User not found");

  const start = num(p.start);
  const limit = optNum(p.limit) ?? undefined;
  const posts = await db.communityPost.findMany({
    where: { userId: user.id },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
    ...(start > 0 ? { skip: start } : {}),
    take: limit,
  });

  // Recount comments/likes excluding blocked users (PHP loops per post).
  const blockUserIds = (await db.user.findMany({ where: { isBlock: 1 }, select: { id: true } })).map((u) => u.id);
  const [commentCounts, likeCounts, mine] = await Promise.all([
    db.communityComment.groupBy({
      by: ["postId"],
      where: { postId: { in: posts.map((x) => x.id) }, userId: { notIn: blockUserIds } },
      _count: { _all: true },
    }),
    db.communityLike.groupBy({
      by: ["postId"],
      where: { postId: { in: posts.map((x) => x.id) }, userId: { notIn: blockUserIds } },
      _count: { _all: true },
    }),
    db.communityLike.findMany({ where: { userId: str(p.my_user_id), postId: { in: posts.map((x) => x.id) } } }),
  ]);
  const commentByPost = new Map(commentCounts.map((c) => [c.postId, c._count._all]));
  const likeByPost = new Map(likeCounts.map((c) => [c.postId, c._count._all]));
  const likedPostIds = new Set(mine.map((l) => l.postId));

  const wires = posts.map((post) => {
    const wire = serializePost(post, { isLike: likedPostIds.has(post.id) ? 1 : 0 }) as Record<string, unknown>;
    wire.comments_count = commentByPost.get(post.id) ?? 0;
    wire.likes_count = likeByPost.get(post.id) ?? 0;
    return wire;
  });

  return data(res, "Fetch post successfully", wires);
});

/** addComment — PostController::addComment. */
wrap(router, "post", "/addComment", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.post_id) || !str(p.desc)) return fail(res, "Validation failed");

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User Not Found");

  const post = await db.communityPost.findUnique({
    where: { id: str(p.post_id) },
    include: POST_INCLUDE,
  });
  if (!post) return fail(res, "Post Not Found");

  const comment = await db.communityComment.create({
    data: { userId: user.id, postId: post.id, desc: str(p.desc) },
  });
  await db.communityPost.update({ where: { id: post.id }, data: { commentsCount: { increment: 1 } } });

  const toUser = post.user;
  if (toUser.id !== user.id && toUser.isPushNotifications === 1) {
    await sendPush({
      userId: toUser.id,
      title: process.env.APP_NAME || "Charitable Trust",
      body: `${user.name} has commented: ${str(p.desc)}`,
      data: { post_id: post.id, type: 2 },
    });
  }

  if (user.id !== post.userId) {
    await db.savedNotification.create({
      data: { myUserId: post.userId, userId: user.id, postId: post.id, commentId: comment.id, type: 2 },
    });
  }

  feedEvent("comment.created", { id: comment.id, post_id: post.id, user_id: user.id });
  return data(res, "Comment Placed", {
    ...commentWire(comment, user),
    post: serializePost(post),
  });
});

/** fetchComments — PostController::fetchComments. */
wrap(router, "post", "/fetchComments", async (req, res) => {
  const p = params(req);
  if (!str(p.post_id) || !str(p.my_user_id)) return fail(res, "Validation failed");

  const start = num(p.start);
  const limit = optNum(p.limit) ?? undefined;
  const comments = await db.communityComment.findMany({
    where: { postId: str(p.post_id) },
    include: {
      user: true,
      likes: { where: { userId: str(p.my_user_id) } },
      _count: { select: { likes: true } },
    },
    orderBy: { createdAt: "desc" },
    ...(start > 0 ? { skip: start } : {}),
    take: limit,
  });

  const wires = (comments as CommentRow[]).map((c) => ({
    ...commentWire(c, c.user),
    is_like: c.likes.length > 0 ? 1 : 0,
    comment_like_count: c._count.likes,
    likes: c.likes.map(likeCommentWire),
  }));

  return data(res, "Fetch Comments", wires);
});

/** deleteComment — PostController::deleteComment. */
wrap(router, "post", "/deleteComment", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.comment_id)) return fail(res, "Validation failed");

  const comment = await db.communityComment.findFirst({
    where: { id: str(p.comment_id), userId: str(p.user_id) },
  });
  if (!comment) return fail(res, "Comment not found");

  const post = await db.communityPost.findUnique({ where: { id: comment.postId } });
  if (post) {
    await db.communityPost.update({
      where: { id: post.id },
      data: { commentsCount: Math.max(0, post.commentsCount - 1) },
    });
  }

  await db.savedNotification.deleteMany({
    where: { userId: str(p.user_id), commentId: comment.id, type: 2 },
  });
  await db.communityComment.delete({ where: { id: comment.id } });

  return data(res, "Delete comment successfully", commentWire(comment));
});

/** likePost — PostController::likePost (reaction types: support/prayers/appreciate/inspired/help). */
wrap(router, "post", "/likePost", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.post_id)) return fail(res, "Validation failed");

  const reactionType = optStr(p.reaction_type) ?? "support";
  const validReactions = ["support", "prayers", "appreciate", "inspired", "help"];
  if (optStr(p.reaction_type) !== null && !validReactions.includes(reactionType)) {
    return fail(res, "The selected reaction type is invalid.");
  }

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User Not Found");

  const post = await db.communityPost.findUnique({
    where: { id: str(p.post_id) },
    include: POST_INCLUDE,
  });
  if (!post) return fail(res, "Post Not Found");

  const existing = await db.communityLike.findFirst({
    where: { userId: user.id, postId: post.id },
  });
  if (existing) {
    if (existing.reactionType !== reactionType) {
      const updated = await db.communityLike.update({
        where: { id: existing.id },
        data: { reactionType },
        include: { user: true },
      });
      return data(res, "Reaction Updated", serializeLike(updated));
    }
    return fail(res, "Already Liked");
  }

  const like = await db.communityLike.create({
    data: { userId: user.id, postId: post.id, reactionType },
  });
  await db.communityPost.update({
    where: { id: post.id },
    data: { likesCount: { increment: 1 } },
  });

  const postUser = post.user;
  if (postUser.id !== user.id && postUser.isPushNotifications === 1) {
    await sendPush({
      userId: postUser.id,
      title: process.env.APP_NAME || "Charitable Trust",
      body: `${user.name} has liked your post.`,
      data: { post_id: post.id, type: 3 },
    });
  }

  if (user.id !== post.userId) {
    await db.savedNotification.create({
      data: { myUserId: post.userId, userId: user.id, postId: post.id, type: 3 },
    });
  }

  feedEvent("post.liked", { id: like.id, post_id: post.id, user_id: user.id });
  const fullLike = await db.communityLike.findUnique({ where: { id: like.id }, include: { user: true } });
  return data(
    res,
    "Post Liked",
    serializeLike(fullLike ?? { ...like, user: user as LikeRow["user"] }, {
      ...serializePost(post),
      likes_count: post.likesCount + 1,
    })
  );
});

/** dislikePost — PostController::dislikePost. */
wrap(router, "post", "/dislikePost", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.post_id)) return fail(res, "Validation failed");

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User not found");

  const likedPost = await db.communityLike.findFirst({
    where: { userId: str(p.user_id), postId: str(p.post_id) },
  });
  if (!likedPost) return fail(res, "Post Already Dislike");

  const post = await db.communityPost.findUnique({ where: { id: str(p.post_id) } });
  if (post) {
    await db.communityPost.update({
      where: { id: post.id },
      data: { likesCount: Math.max(0, post.likesCount - 1) },
    });
  }

  await db.savedNotification.deleteMany({
    where: { postId: str(p.post_id), userId: str(p.user_id), type: 3 },
  });
  await db.communityLike.delete({ where: { id: likedPost.id } });

  return data(res, "Post Dislike", serializeLike({ ...likedPost, user: user as LikeRow["user"] }));
});

/** likeDislikeComment — PostController::likeDislikeComment (toggle). */
wrap(router, "post", "/likeDislikeComment", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.comment_id)) return fail(res, "Validation failed");

  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "User not found");

  const comment = await db.communityComment.findUnique({ where: { id: str(p.comment_id) } });
  if (!comment) return fail(res, "Comment not found");

  const existing = await db.likeComment.findUnique({
    where: { commentId_userId: { commentId: comment.id, userId: user.id } },
  });
  if (existing) {
    await db.likeComment.delete({ where: { id: existing.id } });
    return data(res, "Dislike Comment Successfully.", likeCommentWire(existing));
  }

  const likeComment = await db.likeComment.create({
    data: { userId: user.id, commentId: comment.id },
  });
  return data(res, "Like Comment Successfully", likeCommentWire(likeComment));
});

/** reportPost — PostController::reportPost (CommunityReport type 1 = post). */
wrap(router, "post", "/reportPost", async (req, res) => {
  const p = params(req);
  if (!str(p.post_id) || !str(p.reason) || !str(p.desc)) return fail(res, "Validation failed");

  const post = await db.communityPost.findUnique({ where: { id: str(p.post_id) } });
  if (!post) return fail(res, "Post Not Found");

  const report = await db.communityReport.create({
    data: { type: 1, postId: post.id, reason: str(p.reason), desc: str(p.desc) },
  });
  return data(res, "Report Added Successfully", reportWire(report));
});

/** deleteMyPost — PostController::deleteMyPost. */
wrap(router, "post", "/deleteMyPost", async (req, res) => {
  const p = params(req);
  const post = await db.communityPost.findFirst({
    where: { id: str(p.post_id), userId: str(p.user_id) },
    include: POST_INCLUDE,
  });
  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "User not found");
  if (!post) return fail(res, "Post Not Found");

  const wire = serializePost(post);

  await db.communityReport.deleteMany({ where: { postId: post.id, type: 1 } });
  await db.savedNotification.deleteMany({ where: { postId: post.id } });
  // Comments (→ their LikeComments), contents and likes cascade with the post.
  await db.communityPost.delete({ where: { id: post.id } });

  return data(res, "Post Delete Successfully", wire);
});

/** fetchUsersWhoLikedPost — PostController::fetchUsersWhoLikedPost. */
wrap(router, "post", "/fetchUsersWhoLikedPost", async (req, res) => {
  const p = params(req);
  if (!str(p.post_id) || !str(p.user_id)) return fail(res, "Validation failed");

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User Not Found");

  const likes = await db.communityLike.findMany({
    where: { postId: str(p.post_id) },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  return data(res, "Fetch Liked By User", likes.map((l) => serializeLike(l)));
});

/** searchPost — PostController::searchPost. */
wrap(router, "post", "/searchPost", async (req, res) => {
  const p = params(req);
  if (optNum(p.start) === null || optNum(p.limit) === null || !str(p.user_id)) {
    return fail(res, "Validation failed");
  }

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User Not Found");

  const posts = await db.communityPost.findMany({
    where: {
      desc: { contains: str(p.keyword), mode: "insensitive" },
      user: { isBlock: 0 },
      userId: { notIn: csvList(user.blockUserIds) },
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
    skip: num(p.start),
    take: num(p.limit, 20),
  });

  const mine = await db.communityLike.findMany({
    where: { userId: user.id, postId: { in: posts.map((x) => x.id) } },
  });
  const likedIds = new Set(mine.map((l) => l.postId));

  return data(
    res,
    "Search Post Successfully",
    posts.map((post) => serializePost(post, { isLike: likedIds.has(post.id) ? 1 : 0 }))
  );
});

/** searchPostByInterestId — PostController::searchPostByInterestId (find_in_set on interest_ids). */
wrap(router, "post", "/searchPostByInterestId", async (req, res) => {
  const p = params(req);
  if (!str(p.interest_id) || !str(p.user_id) || optNum(p.start) === null || optNum(p.limit) === null) {
    return fail(res, "Validation failed");
  }

  const interest = await db.communityInterest.findUnique({ where: { id: num(p.interest_id) } });
  if (!interest) return fail(res, "Interest Not Found.");

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User Not Found");

  const posts = await db.communityPost.findMany({
    where: {
      desc: { contains: str(p.keyword), mode: "insensitive" },
      user: { isBlock: 0 },
      userId: { notIn: csvList(user.blockUserIds) },
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  const start = num(p.start);
  const limit = num(p.limit, 20);
  return data(
    res,
    "Search Posts By Interest.",
    posts
      .filter((post) => csvHas(post.interestIds, str(p.interest_id)))
      .slice(start, start + limit)
      .map((post) => serializePost(post))
  );
});

/** fetchPostsByHashtag — PostController::fetchPostsByHashtag (find_in_set on tags). */
wrap(router, "post", "/fetchPostsByHashtag", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.tag) || optNum(p.start) === null || optNum(p.limit) === null) {
    return fail(res, "Validation failed");
  }

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User not found");

  const posts = await db.communityPost.findMany({
    where: {
      user: { isBlock: 0 },
      userId: { notIn: csvList(user.blockUserIds) },
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  const start = num(p.start);
  const limit = num(p.limit, 20);
  return data(
    res,
    "Fetch posts by hashtag successfully",
    posts
      .filter((post) => csvHas(post.tags, str(p.tag)))
      .slice(start, start + limit)
      .map((post) => serializePost(post))
  );
});

/** searchHashtag — PostController::searchHashtag → [{tag, post_count}]. */
wrap(router, "post", "/searchHashtag", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id)) return fail(res, "Validation failed");

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User Not Found");

  const posts = await db.communityPost.findMany({
    where: {
      desc: { contains: str(p.keyword), mode: "insensitive" },
      user: { isBlock: 0 },
      userId: { notIn: csvList(user.blockUserIds) },
    },
    orderBy: { createdAt: "desc" },
  });

  const tagCounts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of csvList(post.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return data(
    res,
    "Search Hashtag Successfully",
    [...tagCounts.entries()].map(([tag, count]) => ({ tag, post_count: count }))
  );
});

// ─── Stories ──────────────────────────────────────────────────────────────────

/** createStory — PostController::createStory (multipart: content, optional thumbnail). */
router.post("/createStory", multipart, wrapOne(async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.type)) return fail(res, "Validation failed");

  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "The selected user id is invalid.");

  const contentFile = formFiles(req, "content")[0];
  const thumbnailFile = formFiles(req, "thumbnail")[0];
  const content = contentFile
    ? await storeUpload(req, contentFile, "mobile")
    : optStr(p.content);
  if (!content) return fail(res, "The content field is required.");

  const story = await db.communityStory.create({
    data: {
      userId: user.id,
      type: Math.trunc(num(p.type, 0)), // 0 image | 1 video
      duration: num(p.duration, 0),
      content,
      thumbnail: thumbnailFile ? await storeUpload(req, thumbnailFile, "mobile") : null,
    },
    include: STORY_INCLUDE,
  });

  return data(res, "Story Added Successfully", storyWire(story));
}));

/** fetchStory — PostController::fetchStory → followed users (last-24h stories). */
wrap(router, "post", "/fetchStory", async (req, res) => {
  const p = params(req);
  if (!str(p.my_user_id)) return fail(res, "The my user id field is required.");

  const me = await db.user.findUnique({ where: { id: str(p.my_user_id) } });
  if (!me) return fail(res, "The selected my user id is invalid.");

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000); // now()->subDay()
  const follows = await db.userFollow.findMany({
    where: { myUserId: me.id, followed: { isBlock: 0 } },
    include: {
      followed: {
        include: { stories: { where: { createdAt: { gte: dayAgo } }, orderBy: { createdAt: "asc" } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const users = follows
    .map((f) => f.followed)
    .filter((u) => u.stories.length > 0)
    .map((u) => ({ ...legacyUser(u), stories: u.stories.map((s) => storyWire(s)) }));

  return data(res, "Story fetched successfully.", users);
});

/** fetchStoryByID — PostController::fetchStoryByID. */
wrap(router, "post", "/fetchStoryByID", async (req, res) => {
  const p = params(req);
  if (!str(p.story_id)) return fail(res, "Validation failed");

  const story = await db.communityStory.findUnique({
    where: { id: str(p.story_id) },
    include: STORY_INCLUDE,
  });
  if (!story) return fail(res, "Story not found");

  return data(res, "Fetch Story By ID successfully", storyWire(story, true));
});

/** viewStory — PostController::viewStory (appends viewer id to the CSV). */
wrap(router, "post", "/viewStory", async (req, res) => {
  const p = params(req);
  if (!str(p.user_id) || !str(p.story_id)) return fail(res, "Validation failed");

  const user = await db.user.findFirst({ where: { id: str(p.user_id), isBlock: 0 } });
  if (!user) return fail(res, "User not found");

  const story = await db.communityStory.findUnique({ where: { id: str(p.story_id) } });
  if (!story) return fail(res, "Story not found");

  if (csvHas(story.viewByUserIds, user.id)) {
    return data(res, "Story Viewed", storyWire(story));
  }

  const updated = await db.communityStory.update({
    where: { id: story.id },
    data: { viewByUserIds: `${story.viewByUserIds ?? ""}${user.id},` },
  });
  return data(res, "Story Viewed", storyWire(updated));
});

/** deleteStory — PostController::deleteStory. */
wrap(router, "post", "/deleteStory", async (req, res) => {
  const p = params(req);
  if (!str(p.my_user_id) || !str(p.story_id)) return fail(res, "Validation failed");

  const story = await db.communityStory.findFirst({
    where: { id: str(p.story_id), userId: str(p.my_user_id) },
  });
  if (!story) return fail(res, "Story not found");

  await db.communityStory.delete({ where: { id: story.id } });
  return ok(res, "Story delete successfully");
});

/** uploadFile — PostController::uploadFile → data = public URL (Dart reads it as a string). */
router.post("/uploadFile", multipart, mobileAuth, wrapOne(async (req, res) => {
  const file = formFiles(req, "uploadFile")[0] ?? readForm(req).files[0];
  if (!file) return fail(res, "The upload file field is required.");

  const url = await storeUpload(req, file, "mobile");
  return data(res, "Uploaded file path", url);
}));

/** fetchInterests — InterestController::fetchInterests (+ totalRoomOfInterest). */
wrap(router, "post", "/fetchInterests", async (req, res) => {
  const interests = await db.communityInterest.findMany({ orderBy: { id: "asc" } });
  const wires = [];
  for (const interest of interests) {
    // Legacy does Room::where('interest_ids', id) — an exact CSV match.
    const totalRoomOfInterest = await db.communityRoom.count({
      where: { interestIds: String(interest.id) },
    });
    wires.push(interestWire(interest, totalRoomOfInterest));
  }
  return data(res, "Fetch Interest", wires);
});
