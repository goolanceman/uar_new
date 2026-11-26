/**
 * Community posts service — posts / comments / reactions logic shared by the
 * generic /api/posts router (web + mobile).
 *
 * Ported from the legacy mobile handlers (src/routes/mobile/posts.ts —
 * PostController.php) plus the post/comment Moderator handlers of
 * src/routes/mobile/auth-users.ts onto the generic contract: camelCase fields,
 * the actor always comes from the session (never the body), errors are ApiError.
 */
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/session";
import { saveUpload } from "@/lib/files";
import { csvList, communityAuthor, type CommunityAuthorRow } from "@/lib/community/serializers";
import { sendPush, feedEvent } from "@/lib/community/push";
import { syncPostCommentCounts } from "@/lib/community/counters";
import type { MulterFile } from "@/lib/multipart";

/** SavedNotification types (legacy wire): 2 = comment, 3 = post like. */
const NOTIFICATION_TYPE_COMMENT = 2;
const NOTIFICATION_TYPE_POST_LIKE = 3;

const VALID_REACTIONS = ["support", "prayers", "appreciate", "inspired", "help"];

type UserRow = NonNullable<Awaited<ReturnType<typeof db.user.findFirst>>>;
type LikeRow = Prisma.CommunityLikeGetPayload<{ include: { user: true } }>;
type CommentRow = Prisma.CommunityCommentGetPayload<{
  include: { user: true; likes: true; _count: { select: { likes: true } } };
}>;

const POST_INCLUDE = {
  content: { orderBy: { createdAt: "asc" } },
  user: true,
  category: true,
  _count: { select: { comments: { where: { user: { isBlock: 0 } } } } },
} satisfies Prisma.CommunityPostInclude;
type PostRow = Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>;

// ─── Actor helpers ────────────────────────────────────────────────────────────

/**
 * Moderator = platform role ADMIN/MODERATOR OR the DB `user.isModerator === 1`
 * flag — always re-read from the DB, never trusted from the token alone.
 */
export async function isActorModerator(userId: string, role: string | undefined): Promise<boolean> {
  if (role === "ADMIN" || role === "MODERATOR") return true;
  const user = await db.user.findUnique({ where: { id: userId }, select: { isModerator: true } });
  return user?.isModerator === 1;
}

/** Load the acting user (must exist and not be blocked). */
export async function actorOr404(userId: string): Promise<UserRow> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("User not found", 404);
  if (user.isBlock === 1) throw new ApiError("User not found", 404);
  return user;
}

/** Own post or moderator — shared gate for DELETE /api/posts/:id. */
async function postOr403(postId: string, meId: string, moderator: boolean): Promise<PostRow> {
  const post = await db.communityPost.findUnique({ where: { id: postId }, include: POST_INCLUDE });
  if (!post) throw new ApiError("Post not found", 404);
  if (post.userId !== meId && !moderator) throw new ApiError("You do not have permission for this action", 403);
  return post;
}

// ─── Uploads ──────────────────────────────────────────────────────────────────

/** Store a community media upload and return its absolute public URL. */
export async function saveCommunityUpload(
  req: Request,
  file: File,
  uploadedBy: { id: string; name: string }
): Promise<string> {
  const asset = await saveUpload(file, { folder: "community", uploadedBy });
  const host = req.get("host") ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
  return `${proto}://${host}/api/files/${asset.id}/file`;
}

/** Collect uploaded parts by field name (tolerates `content[]` / `content[0]`). */
export function collectFiles(req: Request, base: string): File[] {
  const all = ((req as Request & { files?: unknown }).files ?? []) as Array<MulterFile & { fieldname?: string }>;
  return all
    .filter(
      (f) =>
        f.fieldname === base ||
        f.fieldname === `${base}[]` ||
        (f.fieldname ?? "").startsWith(`${base}[`)
    )
    .map((f) => new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" }));
}

// ─── Serializers (camelCase) ──────────────────────────────────────────────────

function serializeCategory(c: NonNullable<PostRow["category"]>) {
  return {
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    description: c.description,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function serializeContent(c: PostRow["content"][number]) {
  return {
    id: c.id,
    postId: c.postId,
    contentType: c.contentType,
    content: c.content,
    thumbnail: c.thumbnail,
    audioWaves: c.audioWaves,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

type PostExtra = {
  isLike?: number;
  reactionType?: string | null;
  counts?: Record<string, number>;
  progressPercentage?: number;
  likesCount?: number;
};

function serializePost(p: PostRow, extra: PostExtra = {}) {
  const counts = extra.counts ?? {};
  const support = counts.support ?? 0;
  const prayers = counts.prayers ?? 0;
  const appreciate = counts.appreciate ?? 0;
  const inspired = counts.inspired ?? 0;
  const help = counts.help ?? 0;

  return {
    id: p.id,
    userId: p.userId,
    desc: p.desc,
    tags: p.tags,
    linkPreviewJson: p.linkPreviewJson,
    interestIds: p.interestIds,
    type: p.type,
    goalAmount: p.goalAmount,
    raisedAmount: p.raisedAmount,
    deadline: p.deadline,
    isVerified: p.isVerified,
    categoryId: p.categoryId,
    isEmergency: p.isEmergency,
    contextLabel: p.contextLabel,
    impactLabel: p.impactLabel,
    communityLabel: p.communityLabel,
    commentsCount: p._count?.comments ?? p.commentsCount,
    likesCount: extra.likesCount ?? p.likesCount,
    isRestricted: p.isRestricted,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    content: p.content.map(serializeContent),
    user: communityAuthor(p.user),
    category: p.category ? serializeCategory(p.category) : null,
    isLike: extra.isLike ?? 0,
    reactionType: extra.reactionType ?? null,
    supportCount: support,
    prayersCount: prayers,
    appreciateCount: appreciate,
    inspiredCount: inspired,
    helpCount: help,
    totalReactions: support + prayers + appreciate + inspired + help,
    ...(extra.progressPercentage !== undefined ? { progressPercentage: extra.progressPercentage } : {}),
  };
}

function serializeLike(l: LikeRow) {
  return {
    id: l.id,
    userId: l.userId,
    postId: l.postId,
    reelId: l.reelId,
    reactionType: l.reactionType,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    user: communityAuthor(l.user),
  };
}

function serializeComment(
  c: Pick<CommentRow, "id" | "userId" | "postId" | "desc" | "createdAt" | "updatedAt">,
  user?: UserRow | null
) {
  return {
    id: c.id,
    userId: c.userId,
    postId: c.postId,
    desc: c.desc,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    user: user && user.isBlock === 0 ? communityAuthor(user as CommunityAuthorRow) : null,
  };
}

function serializeLikeComment(l: { id: string; userId: string; commentId: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: l.id,
    userId: l.userId,
    commentId: l.commentId,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

// ─── Shared query helpers ─────────────────────────────────────────────────────

/** CSV column contains this id? (interest_ids / tags columns) */
function csvHas(csv: string | null | undefined, id: string): boolean {
  if (!csv) return false;
  return csv.split(",").map((s) => s.trim()).includes(id);
}

/** Post::processPosts — isLike / reactionType + per-reaction counts for a page. */
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

/** Cause posts get progressPercentage (Post::getProgressPercentage). */
function withCauseProgress(posts: PostRow[], wires: ReturnType<typeof serializePost>[]) {
  for (const [i, post] of posts.entries()) {
    if (post.type === "cause") {
      wires[i].progressPercentage =
        !post.goalAmount || post.goalAmount <= 0
          ? 0
          : Math.min(100, (post.raisedAmount / post.goalAmount) * 100);
    }
  }
  return wires;
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

// ─── Feed ─────────────────────────────────────────────────────────────────────

/** GET /api/posts — the main feed (?type=latest|random). */
export async function listFeed(meId: string, opts: { type?: string; skip: number; take: number }) {
  const me = await db.user.findUnique({ where: { id: meId } });
  if (!me) throw new ApiError("User not found", 404);

  const where: Prisma.CommunityPostWhereInput = {
    user: { isBlock: 0 },
    userId: { notIn: csvList(me.blockUserIds) },
    isRestricted: 0,
  };

  let posts: PostRow[];
  let total: number | undefined;
  if (opts.type === "random") {
    const ids = await randomPostIds(where, opts.take);
    posts = ids.length
      ? await db.communityPost.findMany({ where: { id: { in: ids } }, include: POST_INCLUDE })
      : [];
    posts.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  } else {
    const [rows, count] = await Promise.all([
      db.communityPost.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: opts.skip,
        take: opts.take,
      }),
      db.communityPost.count({ where }),
    ]);
    posts = rows;
    total = count;
  }

  const wires = await processPosts(posts, me.id);
  return { items: withCauseProgress(posts, wires), total };
}

/** GET /api/posts/saved — the session user's savedPostIds (the ids are edited
 *  via PATCH /api/profile, mirroring savedReelIds). */
export async function listSavedPosts(meId: string, skip: number, take: number) {
  const me = await db.user.findUnique({ where: { id: meId }, select: { id: true, savedPostIds: true, blockUserIds: true } });
  if (!me) throw new ApiError("User not found", 404);

  const csv = (me.savedPostIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const blockedIds = (me.blockUserIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const where: Prisma.CommunityPostWhereInput = {
    id: { in: csv },
    user: { isBlock: 0 },
    isRestricted: 0,
    ...(blockedIds.length ? { userId: { notIn: blockedIds } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityPost.findMany({ where, include: POST_INCLUDE, orderBy: { createdAt: "desc" }, skip, take }),
    db.communityPost.count({ where }),
  ]);
  const wires = await processPosts(rows, me.id);
  return { items: withCauseProgress(rows, wires), total };
}

/** GET /api/posts/:id — single feed post. */
export async function getPost(meId: string, postId: string) {
  const me = await db.user.findUnique({ where: { id: meId } });
  if (!me) throw new ApiError("User not found", 404);

  const post = await db.communityPost.findFirst({
    where: { id: postId, user: { isBlock: 0 }, userId: { notIn: csvList(me.blockUserIds) } },
    include: POST_INCLUDE,
  });
  if (!post) throw new ApiError("Post not found", 404);

  const [wire] = await processPosts([post], me.id);
  return wire;
}

/** GET /api/posts/user/:userId — a user's own posts, counts exclude blocked users. */
export async function listUserPosts(meId: string, userId: string, skip: number, take: number) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("User not found", 404);

  const [posts, total] = await Promise.all([
    db.communityPost.findMany({
      where: { userId: user.id },
      include: POST_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.communityPost.count({ where: { userId: user.id } }),
  ]);

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
    db.communityLike.findMany({ where: { userId: meId, postId: { in: posts.map((x) => x.id) } } }),
  ]);
  const commentByPost = new Map(commentCounts.map((c) => [c.postId, c._count._all]));
  const likeByPost = new Map(likeCounts.map((c) => [c.postId, c._count._all]));
  const likedPostIds = new Set(mine.map((l) => l.postId));

  const wires = posts.map((post) => {
    const wire = serializePost(post, { isLike: likedPostIds.has(post.id) ? 1 : 0 });
    wire.commentsCount = commentByPost.get(post.id) ?? 0;
    wire.likesCount = likeByPost.get(post.id) ?? 0;
    return wire;
  });

  return { items: wires, total };
}

// ─── Create / delete ──────────────────────────────────────────────────────────

export type CreatePostInput = {
  desc?: string | null;
  tags?: string | null;
  linkPreviewJson?: string | null;
  interestIds?: string | null;
  isEmergency?: boolean;
  contextLabel?: string | null;
  impactLabel?: string | null;
  communityLabel?: string | null;
  contentType?: number;
  audioWaves?: string | null;
};

/** POST /api/posts — multipart media + text (legacy addPost). */
export async function createPost(
  req: Request,
  me: { id: string; name: string },
  input: CreatePostInput
) {
  const contentFiles = collectFiles(req, "content");
  const thumbnails = collectFiles(req, "thumbnail");
  if (contentFiles.length > 0 && input.contentType === undefined) {
    throw new ApiError("The content type field is required when content is not null", 400);
  }

  const post = await db.communityPost.create({
    data: {
      userId: me.id,
      desc: input.desc ?? null,
      tags: input.tags ?? null,
      linkPreviewJson: input.linkPreviewJson ?? null,
      interestIds: input.interestIds ?? null,
      isEmergency: input.isEmergency ?? false,
      contextLabel: input.contextLabel ?? null,
      impactLabel: input.impactLabel ?? null,
      communityLabel: input.communityLabel ?? null,
    },
  });

  const contentType = Math.trunc(input.contentType ?? 0); // 0 image | 1 video | 2 audio
  for (let i = 0; i < contentFiles.length; i++) {
    const content = await saveCommunityUpload(req, contentFiles[i], me);
    const thumbnail = thumbnails[i] ? await saveCommunityUpload(req, thumbnails[i], me) : null;
    await db.communityPostContent.create({
      data: { postId: post.id, contentType, content, thumbnail, audioWaves: input.audioWaves ?? null },
    });
  }

  const full = await db.communityPost.findUnique({ where: { id: post.id }, include: POST_INCLUDE });
  feedEvent("post.created", { id: post.id, user_id: post.userId });
  return full ? (await processPosts([full], me.id))[0] : null;
}

/** DELETE /api/posts/:id — owner OR moderator (deleteMyPost + deletePostByModerator). */
export async function deletePost(meId: string, role: string | undefined, postId: string) {
  const moderator = await isActorModerator(meId, role);
  const post = await postOr403(postId, meId, moderator);
  const wire = serializePost(post);

  await db.communityReport.deleteMany({ where: { postId: post.id, type: 1 } });
  await db.savedNotification.deleteMany({ where: { postId: post.id } });
  // Comments (→ their LikeComments), contents and likes cascade with the post.
  await db.communityPost.delete({ where: { id: post.id } });

  return wire;
}

// ─── Search / filters ─────────────────────────────────────────────────────────

/** GET /api/posts/search?q= (legacy searchPost). */
export async function searchPosts(meId: string, keyword: string, skip: number, take: number) {
  const me = await actorOr404(meId);
  const posts = await db.communityPost.findMany({
    where: {
      desc: { contains: keyword, mode: "insensitive" },
      user: { isBlock: 0 },
      userId: { notIn: csvList(me.blockUserIds) },
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });

  const mine = await db.communityLike.findMany({
    where: { userId: me.id, postId: { in: posts.map((x) => x.id) } },
  });
  const likedIds = new Set(mine.map((l) => l.postId));

  return {
    items: posts.map((post) => serializePost(post, { isLike: likedIds.has(post.id) ? 1 : 0 })),
    total: undefined as number | undefined,
  };
}

/** GET /api/posts/by-interest?ids= (legacy searchPostByInterestId — CSV match). */
export async function listPostsByInterest(meId: string, interestIds: string[], skip: number, take: number) {
  const me = await actorOr404(meId);
  const interest = interestIds[0];
  if (!interest) throw new ApiError("Interest id is required", 400);
  const exists = await db.communityInterest.findUnique({ where: { id: Math.trunc(Number(interest)) } });
  if (!exists) throw new ApiError("Interest not found", 404);

  const posts = await db.communityPost.findMany({
    where: {
      user: { isBlock: 0 },
      userId: { notIn: csvList(me.blockUserIds) },
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  const items = posts
    .filter((post) => interestIds.some((id) => csvHas(post.interestIds, id)))
    .slice(skip, skip + take);
  return { items: items.map((post) => serializePost(post)), total: undefined as number | undefined };
}

/** GET /api/posts/by-hashtag?tags= (legacy fetchPostsByHashtag — CSV match). */
export async function listPostsByHashtag(meId: string, tags: string[], skip: number, take: number) {
  const me = await actorOr404(meId);
  if (tags.length === 0) throw new ApiError("Hashtag is required", 400);

  const posts = await db.communityPost.findMany({
    where: {
      user: { isBlock: 0 },
      userId: { notIn: csvList(me.blockUserIds) },
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  const items = posts
    .filter((post) => tags.some((tag) => csvHas(post.tags, tag)))
    .slice(skip, skip + take);
  return { items: items.map((post) => serializePost(post)), total: undefined as number | undefined };
}

/** GET /api/posts/hashtags?q= → [{tag, postCount}] (legacy searchHashtag). */
export async function searchHashtags(meId: string, keyword: string) {
  const me = await actorOr404(meId);
  const posts = await db.communityPost.findMany({
    where: {
      desc: { contains: keyword, mode: "insensitive" },
      user: { isBlock: 0 },
      userId: { notIn: csvList(me.blockUserIds) },
    },
    orderBy: { createdAt: "desc" },
  });

  const tagCounts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of csvList(post.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  return [...tagCounts.entries()].map(([tag, postCount]) => ({ tag, postCount }));
}

// ─── Report ───────────────────────────────────────────────────────────────────

/** POST /api/posts/:id/report { reason, desc } (legacy reportPost — type 1 = post). */
export async function reportPost(meId: string, postId: string, reason: string, desc: string) {
  if (!reason || !desc) throw new ApiError("reason and desc are required", 400);
  const post = await db.communityPost.findUnique({ where: { id: postId } });
  if (!post) throw new ApiError("Post not found", 404);

  // Legacy leaves userId null on post reports (the reported entity is the post).
  const report = await db.communityReport.create({
    data: { type: 1, postId: post.id, reason, desc },
  });
  return report;
}

// ─── Reactions (likes) ────────────────────────────────────────────────────────

/** POST /api/posts/:id/like { reaction } (legacy likePost). */
export async function likePost(meId: string, postId: string, reaction?: string | null) {
  const reactionType = reaction ?? "support";
  if (reaction !== undefined && reaction !== null && !VALID_REACTIONS.includes(reactionType)) {
    throw new ApiError("The selected reaction type is invalid", 400);
  }

  const user = await actorOr404(meId);
  const post = await db.communityPost.findUnique({ where: { id: postId }, include: POST_INCLUDE });
  if (!post) throw new ApiError("Post not found", 404);

  const existing = await db.communityLike.findFirst({ where: { userId: user.id, postId: post.id } });
  if (existing) {
    if (existing.reactionType !== reactionType) {
      const updated = await db.communityLike.update({
        where: { id: existing.id },
        data: { reactionType },
        include: { user: true },
      });
      return { like: serializeLike(updated), post: null, message: "Reaction Updated" };
    }
    throw new ApiError("Already Liked", 409);
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
      data: { myUserId: post.userId, userId: user.id, postId: post.id, type: NOTIFICATION_TYPE_POST_LIKE },
    });
  }

  feedEvent("post.liked", { id: like.id, post_id: post.id, user_id: user.id });
  const fullLike = await db.communityLike.findUnique({ where: { id: like.id }, include: { user: true } });
  return {
    like: serializeLike(fullLike ?? { ...like, user: user as LikeRow["user"] }),
    post: { ...serializePost(post), likesCount: post.likesCount + 1 },
    message: "Post Liked",
  };
}

/** DELETE /api/posts/:id/like (legacy dislikePost). */
export async function unlikePost(meId: string, postId: string) {
  const user = await actorOr404(meId);
  const likedPost = await db.communityLike.findFirst({ where: { userId: meId, postId } });
  if (!likedPost) throw new ApiError("Post Already Dislike", 404);

  const post = await db.communityPost.findUnique({ where: { id: postId } });
  if (post) {
    await db.communityPost.update({
      where: { id: post.id },
      data: { likesCount: Math.max(0, post.likesCount - 1) },
    });
  }

  await db.savedNotification.deleteMany({
    where: { postId, userId: meId, type: NOTIFICATION_TYPE_POST_LIKE },
  });
  await db.communityLike.delete({ where: { id: likedPost.id } });

  return serializeLike({ ...likedPost, user: user as LikeRow["user"] });
}

/** GET /api/posts/:id/likes — users who liked the post (legacy fetchUsersWhoLikedPost). */
export async function listPostLikers(meId: string, postId: string, skip: number, take: number) {
  await actorOr404(meId);
  const [likes, total] = await Promise.all([
    db.communityLike.findMany({
      where: { postId },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.communityLike.count({ where: { postId } }),
  ]);
  return { items: likes.map(serializeLike), total };
}

// ─── Comments ─────────────────────────────────────────────────────────────────

/** GET /api/posts/:id/comments (legacy fetchComments). */
export async function listComments(meId: string, postId: string, skip: number, take: number) {
  const comments = await db.communityComment.findMany({
    where: { postId, user: { isBlock: 0 } },
    include: {
      user: true,
      likes: { where: { userId: meId } },
      _count: { select: { likes: true } },
    },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });

  return {
    items: (comments as CommentRow[]).map((c) => ({
      ...serializeComment(c, c.user),
      isLike: c.likes.length > 0 ? 1 : 0,
      commentLikeCount: c._count.likes,
      likes: c.likes.map(serializeLikeComment),
    })),
    total: undefined as number | undefined,
  };
}

/** POST /api/posts/:id/comments { desc } (legacy addComment). */
export async function addComment(meId: string, postId: string, desc: string) {
  if (!desc) throw new ApiError("desc is required", 400);
  const user = await actorOr404(meId);

  const post = await db.communityPost.findUnique({ where: { id: postId }, include: POST_INCLUDE });
  if (!post) throw new ApiError("Post not found", 404);

  const comment = await db.communityComment.create({
    data: { userId: user.id, postId: post.id, desc },
  });
  await syncPostCommentCounts({ postIds: [post.id] });

  const toUser = post.user;
  if (toUser.id !== user.id && toUser.isPushNotifications === 1) {
    await sendPush({
      userId: toUser.id,
      title: process.env.APP_NAME || "Charitable Trust",
      body: `${user.name} has commented: ${desc}`,
      data: { post_id: post.id, type: 2 },
    });
  }

  if (user.id !== post.userId) {
    await db.savedNotification.create({
      data: { myUserId: post.userId, userId: user.id, postId: post.id, commentId: comment.id, type: NOTIFICATION_TYPE_COMMENT },
    });
  }

  feedEvent("comment.created", { id: comment.id, post_id: post.id, user_id: user.id });
  return serializeComment(comment, user);
}

/** DELETE /api/posts/comments/:commentId — owner OR moderator. */
export async function deleteComment(meId: string, role: string | undefined, commentId: string) {
  const moderator = await isActorModerator(meId, role);
  const comment = await db.communityComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new ApiError("Comment not found", 404);
  if (comment.userId !== meId && !moderator) {
    throw new ApiError("You do not have permission for this action", 403);
  }

  await db.savedNotification.deleteMany({ where: { commentId: comment.id, type: NOTIFICATION_TYPE_COMMENT } });
  await db.communityComment.delete({ where: { id: comment.id } });
  await syncPostCommentCounts({ postIds: [comment.postId] });

  return serializeComment(comment);
}

/** POST /api/posts/comments/:commentId/like — toggle (legacy likeDislikeComment). */
export async function toggleCommentLike(meId: string, commentId: string) {
  const user = await actorOr404(meId);
  const comment = await db.communityComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new ApiError("Comment not found", 404);

  const existing = await db.likeComment.findUnique({
    where: { commentId_userId: { commentId: comment.id, userId: user.id } },
  });
  if (existing) {
    await db.likeComment.delete({ where: { id: existing.id } });
    return { liked: false, like: serializeLikeComment(existing) };
  }

  const likeComment = await db.likeComment.create({
    data: { userId: user.id, commentId: comment.id },
  });
  return { liked: true, like: serializeLikeComment(likeComment) };
}
