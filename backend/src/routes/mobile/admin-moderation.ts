/**
 * Mobile community ADMIN routes — admin-moderation module (PHP admin panel parity).
 * Mounted under /api via routes/mobile/index.ts. Auth: mobileAuth (JWT — the
 * admin dashboard sends Authorization: Bearer; mobile admin users send
 * authtoken) + an ADMIN/MODERATOR role gate, mirroring the legacy checkLogin.
 *
 * Ports the STORIES + REELS moderation half of the legacy PHP admin panel:
 *   - PostController::allStoriesList / userStoryList / deleteStoryFromAdmin
 *     (uar/php/admin/app/Http/Controllers/PostController.php)
 *   - ReelController::reelList / userReelList / deleteReelByAdmin /
 *     fetchCommentsInReelModal / deleteReelCommentFromAdmin / reelReportList /
 *     deleteReelReport / deleteReelFromReport (ReelController.php)
 *   - PostController::fetchPostComment / deleteCommentFromAdmin — post-comment
 *     review, which the existing /community/admin/posts moderation lacks.
 *
 * Complements (does not duplicate) the /community/admin/{users,posts,reports,
 * causes} endpoints in charity.ts: those cover posts/causes/user moderation;
 * this module covers stories, reels, their comments and their reports.
 *
 * Wire contract: same { status, message, data? } envelope; pagination via the
 * shared start/limit params; user objects in the legacy shape (legacyUser);
 * PHP cascades mirrored — comment counters on post/reel, likes + reports +
 * saved-notification cleanup, best-effort stored-file removal.
 */
import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { deleteStored } from "@/lib/files";
import type { Session } from "@/lib/session";
import {
  ok,
  data,
  fail,
  unauthorized,
  mobileAuth,
  session,
  legacyUser,
  params,
  str,
  optStr,
  num,
  page,
  feedEvent,
  mobileErrorHandler,
  optNum,
} from "@/lib/mobile/compat";

export const router = Router();

/** wrap() single-handler form — lets middleware (mobileAuth) run first. */
function h(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) =>
    Promise.resolve(handler(req, res)).catch((e) => mobileErrorHandler(e, res));
}

// ─── Shared helpers (same local copies as charity.ts / reels-rooms.ts) ────────

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Session with an elevated role (admin dashboard endpoints). */
function requireElevated(req: Request, res: Response): Session | null {
  try {
    const s = session(req);
    if (s.role !== "ADMIN" && s.role !== "MODERATOR") {
      unauthorized(res, "Moderator access required");
      return null;
    }
    return s;
  } catch {
    unauthorized(res, "Invalid or expired token");
    return null;
  }
}

// SavedNotification types (legacy Constants.php)
const TYPE_COMMENT = 2; // post comment notification
const TYPE_REEL_LIKE = 9;
const TYPE_ADD_REEL_COMMENT = 10;

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

// ─── Serializers (mirror the Eloquent JSON the legacy admin panel showed) ─────

type StoryRow = {
  id: string;
  userId: string;
  type: number;
  duration: number;
  content: string;
  thumbnail: string | null;
  viewByUserIds: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: Parameters<typeof legacyUser>[0] | null;
};

/** Same wire shape as posts.ts storyWire (+ optional legacy user). */
function storyWire(s: StoryRow, withUser?: boolean) {
  const wire: Record<string, unknown> = {
    id: s.id,
    user_id: s.userId,
    type: s.type, // 0 image | 1 video
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

/** Legacy Comment model JSON (+ comment_like_count like PHP withCount). */
function postCommentWire(
  c: { id: string; userId: string; postId: string; desc: string; createdAt: Date; updatedAt: Date; user?: unknown },
  commentLikeCount?: number
) {
  return {
    id: c.id,
    user_id: c.userId,
    post_id: c.postId,
    desc: c.desc,
    comment_like_count: commentLikeCount ?? 0,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
    user: c.user && (c.user as { isBlock: number }).isBlock === 0 ? legacyUser(c.user as Parameters<typeof legacyUser>[0]) : null,
  };
}

/** Legacy ReelComment model JSON (mirrors reels-rooms.ts commentJson). */
function reelCommentWire(
  c: { id: string; userId: string; reelId: string; description: string; createdAt: Date; updatedAt: Date; user?: unknown }
) {
  return {
    id: c.id,
    user_id: c.userId,
    reel_id: c.reelId,
    description: c.description,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
    user: c.user && (c.user as { isBlock: number }).isBlock === 0 ? legacyUser(c.user as Parameters<typeof legacyUser>[0]) : null,
  };
}

/** Legacy Reel model JSON + legacy user (admin reelList row). */
function reelAdminWire(r: {
  id: string;
  userId: string;
  causeId: string | null;
  interestIds: string | null;
  musicId: number | null;
  description: string | null;
  content: string | null;
  thumbnail: string | null;
  hashtags: string | null;
  commentsCount: number;
  likesCount: number;
  viewsCount: number;
  createdAt: Date;
  updatedAt: Date;
  user?: unknown;
}) {
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
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
    user: r.user ? legacyUser(r.user as Parameters<typeof legacyUser>[0]) : null,
  };
}

/** Full admin reel row include (user for the legacy shape). */
const REEL_INCLUDE = { user: true } as const;

// ─── Stories (PostController::allStoriesList / userStoryList / deleteStoryFromAdmin) ─

router.get("/mobile-admin/stories", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit, skip } = page(req, 50);
  const q = str(p.q).trim();
  const userId = optStr(p.user_id);
  // Legacy lists only showed stories from the last 24h (stories expire daily);
  // the admin surface defaults to ALL stories, `fresh=1` restores the window.
  const fresh = optStr(p.fresh) === "1";
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const where = {
    ...(userId ? { userId } : {}),
    ...(fresh ? { createdAt: { gte: dayAgo, lte: new Date() } } : {}),
    ...(q ? { user: { name: { contains: q } } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityStory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { user: true },
    }),
    db.communityStory.count({ where }),
  ]);

  return data(res, "Stories retrieved", {
    stories: rows.map((s) => storyWire(s, true)),
    total_count: total,
  });
}));

/** userStoryList — stories of one user (same wire shape as the list above). */
router.get("/mobile-admin/stories/user", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "The selected user id is invalid.");
  const { start, limit, skip } = page(req, 50);

  const where = { userId };
  const [rows, total] = await Promise.all([
    db.communityStory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { user: true },
    }),
    db.communityStory.count({ where }),
  ]);

  return data(res, "Stories retrieved", {
    stories: rows.map((s) => storyWire(s, true)),
    total_count: total,
  });
}));

/** deleteStoryFromAdmin — body/query story_id; removes the stored file + row. */
async function deleteStoryHandler(req: Request, res: Response) {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const storyId = str(p.story_id);
  if (!storyId) return fail(res, "The story id field is required.");

  const story = await db.communityStory.findUnique({ where: { id: storyId } });
  if (!story) return fail(res, "Story not found");

  await deleteFileByUrl(story.content);
  await db.communityStory.delete({ where: { id: story.id } });
  feedEvent("story.moderated", { storyId: story.id, action: "delete", by: s.userId });
  return ok(res, "Story delete successfully");
}
router.delete("/mobile-admin/stories", mobileAuth, h(deleteStoryHandler));
// POST alias — the dashboard's mfetch helper only speaks GET/POST.
router.post("/mobile-admin/stories/delete", mobileAuth, h(deleteStoryHandler));

// ─── Reels (ReelController::reelList / userReelList / deleteReelByAdmin) ──────

router.get("/mobile-admin/reels", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit, skip } = page(req, 30);
  const q = str(p.q).trim();
  const userId = optStr(p.user_id);

  const where = {
    ...(userId ? { userId } : {}),
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: 'insensitive' as const } },
            { hashtags: { contains: q, mode: 'insensitive' as const } },
            { user: { name: { contains: q } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityReel.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: REEL_INCLUDE,
    }),
    db.communityReel.count({ where }),
  ]);

  return data(res, "Reels retrieved", {
    reels: rows.map((r) => reelAdminWire(r)),
    total_count: total,
  });
}));

/** userReelList — reels of one user. */
router.get("/mobile-admin/reels/user", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "The selected user id is invalid.");
  const { start, limit, skip } = page(req, 30);

  const where = { userId };
  const [rows, total] = await Promise.all([
    db.communityReel.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: REEL_INCLUDE,
    }),
    db.communityReel.count({ where }),
  ]);

  return data(res, "Reels retrieved", {
    reels: rows.map((r) => reelAdminWire(r)),
    total_count: total,
  });
}));

/**
 * The PHP admin cascade (ReelController::deleteReelByAdmin /
 * deleteReelFromReport): per-comment notification cleanup, comments, likes,
 * reports, stored files, reel-level notifications, then the reel itself.
 */
async function cascadeDeleteReel(reelId: string): Promise<void> {
  const notificationTypes = [TYPE_COMMENT, TYPE_REEL_LIKE, TYPE_ADD_REEL_COMMENT];

  const comments = await db.communityReelComment.findMany({ where: { reelId } });
  for (const c of comments) {
    await db.savedNotification.deleteMany({ where: { reelCommentId: c.id, type: { in: notificationTypes } } });
    await db.communityReelComment.delete({ where: { id: c.id } }).catch(() => undefined);
  }

  await db.communityLike.deleteMany({ where: { reelId } });
  await db.communityReport.deleteMany({ where: { reelId } }); // Report::where('reel_id', ...)->delete()

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (reel) {
    await deleteFileByUrl(reel.content);
    await deleteFileByUrl(reel.thumbnail);
  }
  await db.savedNotification.deleteMany({ where: { reelId, type: { in: notificationTypes } } });
  await db.communityReel.delete({ where: { id: reelId } }).catch(() => undefined);
}

/** deleteReelByAdmin — body/query reel_id; full cascade. */
router.post("/mobile-admin/reels/delete", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const reelId = str(p.reel_id);
  if (!reelId) return fail(res, "The reel id field is required.");

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) return fail(res, "Reel Not Found.");

  await cascadeDeleteReel(reel.id);
  feedEvent("reel.moderated", { reelId: reel.id, action: "delete", by: s.userId });
  return data(res, "Reel Deleted Successfully.", reelAdminWire({ ...reel, user: undefined }));
}));

// ─── Reel comments (ReelController::fetchCommentsInReelModal / deleteReelCommentFromAdmin) ─

router.get("/mobile-admin/reels/comments", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const reelId = str(p.reel_id);
  if (!reelId) return fail(res, "The reel id field is required.");
  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) return fail(res, "The selected reel id is invalid.");
  const { start, limit } = page(req, 50);

  const [rows, total] = await Promise.all([
    db.communityReelComment.findMany({
      where: { reelId },
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: { user: true },
    }),
    db.communityReelComment.count({ where: { reelId } }),
  ]);

  return data(res, "Fetch Comments.", {
    comments: rows.map((c) => reelCommentWire(c)),
    has_more: total > start + limit, // legacy hasMoreComments
    total_count: total,
  });
}));

/**
 * deleteReelCommentFromAdmin — body/query comment_id (+ optional user_id; when
 * present the comment must belong to that user, exactly like the PHP check).
 * Decrements the reel's comments_count (floor 0) and cleans notifications.
 */
router.post("/mobile-admin/reels/comments/delete", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const commentId = str(p.comment_id);
  if (!commentId) return fail(res, "The comment id field is required.");
  const userId = optStr(p.user_id);

  const comment = await db.communityReelComment.findFirst({
    where: { id: commentId, ...(userId ? { userId } : {}) },
  });
  if (!comment) return fail(res, "Comment not found");

  const reel = await db.communityReel.findUnique({ where: { id: comment.reelId } });
  if (reel) {
    await db.communityReel.update({
      where: { id: reel.id },
      data: { commentsCount: Math.max(0, reel.commentsCount - 1) },
    });
  }

  await db.savedNotification.deleteMany({
    where: { reelCommentId: comment.id, type: { in: [TYPE_COMMENT, TYPE_ADD_REEL_COMMENT] } },
  });
  await db.communityReelComment.delete({ where: { id: comment.id } });
  feedEvent("comment.moderated", { commentId: comment.id, kind: "reel", reelId: comment.reelId, by: s.userId });

  return data(res, "Delete comment successfully", reelCommentWire(comment));
}));

// ─── Reel reports (ReelController::reelReportList / deleteReelReport / deleteReelFromReport) ─

/** reelReportList — CommunityReport type 3 (reel), optionally scoped to one reel. */
router.get("/mobile-admin/reels/reports", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit, skip } = page(req, 30);
  const reelId = optStr(p.reel_id);
  const q = str(p.q).trim();

  const where = {
    type: 3,
    ...(reelId ? { reelId } : {}),
    ...(q
      ? {
          OR: [
            { desc: { contains: q, mode: 'insensitive' as const } },
            { reason: { contains: q } },
            { reel: { description: { contains: q, mode: 'insensitive' as const } } },
            { reporter: { name: { contains: q } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        reporter: { select: { id: true, name: true, username: true, avatar: true, email: true } },
        reel: { include: REEL_INCLUDE },
      },
    }),
    db.communityReport.count({ where }),
  ]);

  return data(res, "Reports retrieved", {
    reports: rows.map((r) => ({
      id: r.id,
      type: r.type,
      reason: r.reason,
      desc: r.desc,
      reel_id: r.reelId,
      created_at: iso(r.createdAt),
      reporter: r.reporter,
      reel: r.reel ? reelAdminWire(r.reel) : null,
    })),
    total_count: total,
  });
}));

/**
 * deleteReelReport — body/query report_id. Legacy behaviour: reject the report
 * by deleting EVERY report filed against that reel (the reel itself stays).
 */
router.post("/mobile-admin/reels/reports/delete", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const reportId = str(p.report_id);
  if (!reportId) return fail(res, "The report id field is required.");

  const report = await db.communityReport.findUnique({ where: { id: reportId } });
  if (!report) return fail(res, "Report Not Found");

  const deleted = await db.communityReport.deleteMany({
    where: { ...(report.reelId ? { reelId: report.reelId } : { id: report.id }) },
  });
  feedEvent("reel.report.resolved", { reportId: report.id, reelId: report.reelId, deleted: deleted.count, by: s.userId });
  return ok(res, "Report Reject Successfully.");
}));

/**
 * deleteReelFromReport — body/query reel_id; removes the REPORTED reel itself
 * (same cascade as deleteReelByAdmin, including its reports).
 */
router.post("/mobile-admin/reels/reports/delete-reel", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const reelId = str(p.reel_id);
  if (!reelId) return fail(res, "The reel id field is required.");

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) return fail(res, "Reel Not Found");

  await cascadeDeleteReel(reel.id);
  feedEvent("reel.moderated", { reelId: reel.id, action: "delete_from_report", by: s.userId });
  return data(res, "Reel Deleted Successfully.", reelAdminWire({ ...reel, user: undefined }));
}));

// ─── Post comments (PostController::fetchPostComment / deleteCommentFromAdmin) ─

/** fetchPostComment — paginated comments of a post, with per-comment like counts. */
router.get("/mobile-admin/posts/comments", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const postId = str(p.post_id);
  if (!postId) return fail(res, "The post id field is required.");
  const post = await db.communityPost.findUnique({ where: { id: postId } });
  if (!post) return fail(res, "The selected post id is invalid.");
  const { start, limit } = page(req, 50);

  const [rows, total] = await Promise.all([
    db.communityComment.findMany({
      where: { postId },
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: { user: true, _count: { select: { likes: true } } },
    }),
    db.communityComment.count({ where: { postId } }),
  ]);

  return data(res, "Fetch Comments", {
    comments: rows.map((c) => postCommentWire(c, c._count.likes)),
    has_more: total > start + limit, // legacy hasMoreComments
    total_count: total,
  });
}));

/**
 * deleteCommentFromAdmin — body/query comment_id (+ optional user_id; when
 * present the comment must belong to that user, exactly like the PHP check).
 * Decrements the post's comments_count (floor 0) and cleans notifications.
 */
router.post("/mobile-admin/posts/comments/delete", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const commentId = str(p.comment_id);
  if (!commentId) return fail(res, "The comment id field is required.");
  const userId = optStr(p.user_id);

  const comment = await db.communityComment.findFirst({
    where: { id: commentId, ...(userId ? { userId } : {}) },
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
    where: { commentId: comment.id, type: TYPE_COMMENT },
  });
  await db.communityComment.delete({ where: { id: comment.id } });
  feedEvent("comment.moderated", { commentId: comment.id, kind: "post", postId: comment.postId, by: s.userId });

  return data(res, "Delete comment successfully", postCommentWire(comment));
}));

// (const export above is the module surface — ../index.ts imports `router`).

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

function serializeCategory(c: PostRow["category"]) {
  if (!c) return null;
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

type PostRow = Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>;

function serializeFeedPost(
  p: PostRow,
  extra?: {
    isFollowing?: boolean;
    followerCount?: number;
    progressPercentage?: number;
    donationCount?: number;
  }
) {
  const goal = p.goalAmount ?? 0;
  const progress = goal > 0 ? Math.min(100, (p.raisedAmount / goal) * 100) : 0;
  return {
    id: p.id,
    user_id: p.userId,
    desc: p.desc,
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
    likes_count: p.likesCount,
    is_restricted: p.isRestricted,
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
    content: p.content.map(serializeContent),
    user: p.user ? legacyUser(p.user) : null,
    category: serializeCategory(p.category),
    is_following: (extra?.isFollowing ?? false) ? 1 : 0,
    follower_count: extra?.followerCount ?? 0,
    progress_percentage: extra?.progressPercentage ?? progress,
    donation_count: extra?.donationCount ?? 0,
  };
}


// ─── Feed (posts) moderation + reports center ───────────────────────────────
// Moved from charity.ts — feed posts are mobile-only social content managed
// by the Mobile → Feed page; reports are the moderation queue for that content.

const POST_INCLUDE = {
  content: { orderBy: { createdAt: "asc" as const } },
  user: true,
  category: true,
} as const;

router.get("/mobile-admin/feed", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 30);
  const q = str(p.q).trim();
  const type = optStr(p.type);
  if (type && !["normal", "cause"].includes(type)) return fail(res, "The selected type is invalid.");

  const where = {
    ...(type ? { type } : {}),
    ...(q ? { desc: { contains: q, mode: 'insensitive' as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: {
        ...POST_INCLUDE,
        _count: { select: { comments: true, likes: true, reports: true, causeFollowers: true, donations: true } },
      },
    }),
    db.communityPost.count({ where }),
  ]);

  return data(res, "Posts retrieved", {
    posts: rows.map((r) => ({
      ...serializeFeedPost(r),
      comment_count: r._count.comments,
      like_count: r._count.likes,
      report_count: r._count.reports,
      follower_count: r._count.causeFollowers,
      donation_count: r._count.donations,
    })),
    total_count: total,
  });
}));

router.post("/mobile-admin/feed/moderate", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const postId = str(p.post_id);
  const action = str(p.action);
  if (!postId) return fail(res, "The post id field is required.");
  if (!["verify", "unverify", "restrict", "unrestrict", "delete"].includes(action)) {
    return fail(res, "The selected action is invalid.");
  }

  const post = await db.communityPost.findUnique({ where: { id: postId } });
  if (!post) return fail(res, "Post not found");

  if (action === "delete") {
    await db.communityPost.delete({ where: { id: postId } });
    feedEvent("post.moderated", { id: postId, action, by: s.userId });
    return ok(res, "Post deleted");
  }
  const updated = await db.communityPost.update({
    where: { id: postId },
    data: {
      ...(action === "verify" ? { isVerified: true } : {}),
      ...(action === "unverify" ? { isVerified: false } : {}),
      ...(action === "restrict" ? { isRestricted: 1 } : {}),
      ...(action === "unrestrict" ? { isRestricted: 0 } : {}),
    },
  });
  feedEvent("post.moderated", { id: postId, action, by: s.userId });
  return data(res, "Post updated", { id: updated.id, is_verified: updated.isVerified, is_restricted: updated.isRestricted });
}));

router.get("/mobile-admin/reports", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 30);
  const type = optNum(p.type); // 0 room | 1 post | 2 user | 3 reel

  const where = { ...(type !== null ? { type } : {}) };
  const [rows, total] = await Promise.all([
    db.communityReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: {
        reporter: { select: { id: true, name: true, username: true, avatar: true, email: true } },
        post: { include: { user: { select: { id: true, name: true, username: true, avatar: true } } } },
        comment: { include: { user: { select: { id: true, name: true, username: true, avatar: true } } } },
        room: { select: { id: true, title: true } },
        reel: { select: { id: true, description: true, thumbnail: true } },
      },
    }),
    db.communityReport.count({ where }),
  ]);
  return data(res, "Reports retrieved", {
    reports: rows.map((r) => ({
      id: r.id,
      type: r.type,
      reason: r.reason,
      desc: r.desc,
      created_at: iso(r.createdAt),
      reporter: r.reporter,
      post: r.post
        ? { id: r.post.id, desc: r.post.desc, type: r.post.type, user: r.post.user, is_restricted: r.post.isRestricted }
        : null,
      comment: r.comment ? { id: r.comment.id, desc: r.comment.desc, user: r.comment.user } : null,
      room: r.room,
      reel: r.reel ? { id: r.reel.id, description: r.reel.description, thumbnail: r.reel.thumbnail } : null,
    })),
    total_count: total,
  });
}));

router.post("/mobile-admin/reports/resolve", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const reportId = str(p.report_id);
  const action = str(p.action); // delete_post | delete_comment | dismiss
  if (!reportId) return fail(res, "The report id field is required.");
  if (!["delete_post", "delete_comment", "dismiss"].includes(action)) {
    return fail(res, "The selected action is invalid.");
  }

  const report = await db.communityReport.findUnique({ where: { id: reportId } });
  if (!report) return fail(res, "Report not found");

  if (action === "delete_post" && report.postId) {
    await db.communityPost.delete({ where: { id: report.postId } }).catch(() => undefined);
    await db.communityReport.deleteMany({ where: { postId: report.postId } });
    feedEvent("post.moderated", { id: report.postId, action, by: s.userId });
    return ok(res, "Reported post deleted");
  }
  if (action === "delete_comment" && report.commentId) {
    await db.communityComment.delete({ where: { id: report.commentId } }).catch(() => undefined);
    await db.communityReport.deleteMany({ where: { commentId: report.commentId } });
    return ok(res, "Reported comment deleted");
  }
  await db.communityReport.delete({ where: { id: reportId } });
  return ok(res, "Report dismissed");
}));


// ─── Feed / Stories / Reels create + metadata update (full CRUD) ────────────
// Admin-authored content uses the admin's own unified user identity.

function csvListSafe(v: unknown): string[] {
  const decode = (s: string): string => {
    try {
      const parsed = JSON.parse(s); // NewApiService jsonEncodes list items
      return typeof parsed === "string" ? parsed : s;
    } catch {
      return s;
    }
  };
  if (Array.isArray(v)) return v.map((x) => decode(str(x))).filter(Boolean);
  // NewApiService sends list items as `images[0]` — qs (extended urlencoded)
  // already expands those into arrays; the object form is a just-in-case fallback.
  if (v && typeof v === "object") {
    return Object.values(v as Record<string, unknown>).map((x) => decode(str(x))).filter(Boolean);
  }
  return str(v).split(",").map((s) => decode(s.trim())).filter(Boolean);
}

function mediaType(url: string): number {
  return /\.(mp4|mov|avi|wmv)$/i.test(url) ? 2 : 1; // 1 image | 2 video
}

// POST /api/mobile-admin/feed — create a post (text + optional media URLs)
router.post("/mobile-admin/feed", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const desc = optStr(b.desc) ?? optStr(b.description);
  if (!desc) return fail(res, "The description field is required.");

  const post = await db.communityPost.create({
    data: { userId: session(req).userId, desc, type: "normal", interestIds: optStr(b.interest_ids), tags: optStr(b.tags) },
    include: POST_INCLUDE,
  });
  for (const url of [...csvListSafe(b.media), ...csvListSafe(b.images)].slice(0, 10)) {
    await db.communityPostContent.create({
      data: { postId: post.id, contentType: mediaType(url), content: url },
    });
  }
  feedEvent("feed.created", { id: post.id, by: session(req).name });
  return data(res, "Post created successfully", serializeFeedPost(post));
}));

// POST /api/mobile-admin/feed/update — edit desc/tags/interests/restriction
router.post("/mobile-admin/feed/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const id = str(b.post_id);
  const post = await db.communityPost.findUnique({ where: { id } });
  if (!post) return fail(res, "Post not found");
  const patch: any = {};
  const desc = optStr(b.desc) ?? optStr(b.description);
  if (desc !== null) patch.desc = desc;
  const tags = optStr(b.tags);
  if (tags !== null) patch.tags = tags;
  const interests = optStr(b.interest_ids);
  if (interests !== null) patch.interestIds = interests;
  if (b.is_restricted !== undefined) patch.isRestricted = num(b.is_restricted) ? 1 : 0;
  if (Object.keys(patch).length === 0) return fail(res, "Nothing to update");
  const updated = await db.communityPost.update({ where: { id }, data: patch, include: POST_INCLUDE });
  feedEvent("feed.moderated", { id, changes: Object.keys(patch).join(","), by: session(req).name });
  return data(res, "Post updated successfully", serializeFeedPost(updated));
}));

// POST /api/mobile-admin/stories/create — create a story
router.post("/mobile-admin/stories/create", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const content = optStr(b.content);
  if (!content) return fail(res, "The content field is required.");
  const story = await db.communityStory.create({
    data: {
      userId: session(req).userId,
      type: num(b.type) === 1 ? 1 : 0,
      duration: num(b.duration, 5),
      content,
      thumbnail: optStr(b.thumbnail),
      viewByUserIds: "",
    },
  });
  feedEvent("story.created", { id: story.id, by: session(req).name });
  return data(res, "Story created successfully", {
    id: story.id, user_id: story.userId, type: story.type, duration: story.duration,
    content: story.content, thumbnail: story.thumbnail, created_at: story.createdAt.toISOString(),
  });
}));

// POST /api/mobile-admin/stories/update — edit metadata (type/duration/content/thumbnail)
router.post("/mobile-admin/stories/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const id = str(b.story_id);
  const story = await db.communityStory.findUnique({ where: { id } });
  if (!story) return fail(res, "Story not found");
  const patch: any = {};
  const content = optStr(b.content);
  if (content !== null) patch.content = content;
  const thumbnail = optStr(b.thumbnail);
  if (thumbnail !== null) patch.thumbnail = thumbnail;
  if (b.duration !== undefined) patch.duration = num(b.duration, story.duration);
  if (b.type !== undefined) patch.type = num(b.type) === 1 ? 1 : 0;
  if (Object.keys(patch).length === 0) return fail(res, "Nothing to update");
  await db.communityStory.update({ where: { id }, data: patch });
  feedEvent("story.moderated", { id, changes: Object.keys(patch).join(","), by: session(req).name });
  return ok(res, "Story updated successfully");
}));

// POST /api/mobile-admin/reels/create — create a reel
router.post("/mobile-admin/reels/create", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const content = optStr(b.content) ?? optStr(b.media);
  if (!content) return fail(res, "The content field is required.");
  const musicId = optNum(b.music_id);
  const reel = await db.communityReel.create({
    data: {
      userId: session(req).userId,
      description: optStr(b.description) ?? optStr(b.desc),
      content,
      thumbnail: optStr(b.thumbnail),
      hashtags: optStr(b.hashtags),
      musicId: musicId,
      interestIds: optStr(b.interest_ids),
    },
  });
  feedEvent("reel.created", { id: reel.id, by: session(req).name });
  return data(res, "Reel created successfully", {
    id: reel.id, user_id: reel.userId, description: reel.description, content: reel.content,
    thumbnail: reel.thumbnail, hashtags: reel.hashtags, created_at: reel.createdAt.toISOString(),
  });
}));

// POST /api/mobile-admin/reels/update — edit metadata
router.post("/mobile-admin/reels/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const id = str(b.reel_id);
  const reel = await db.communityReel.findUnique({ where: { id } });
  if (!reel) return fail(res, "Reel not found");
  const patch: any = {};
  const description = optStr(b.description) ?? optStr(b.desc);
  if (description !== null) patch.description = description;
  const hashtags = optStr(b.hashtags);
  if (hashtags !== null) patch.hashtags = hashtags;
  const thumbnail = optStr(b.thumbnail);
  if (thumbnail !== null) patch.thumbnail = thumbnail;
  const content = optStr(b.content) ?? optStr(b.media);
  if (content !== null) patch.content = content;
  const musicId = optNum(b.music_id);
  if (b.music_id !== undefined) patch.musicId = musicId;
  if (Object.keys(patch).length === 0) return fail(res, "Nothing to update");
  await db.communityReel.update({ where: { id }, data: patch });
  feedEvent("reel.moderated", { id, changes: Object.keys(patch).join(","), by: session(req).name });
  return ok(res, "Reel updated successfully");
}));
