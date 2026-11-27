/**
 * Community admin domain logic — moved out of the mobile compat module
 * (src/routes/mobile/charity.ts /community/admin/*) into the shared lib so
 * the generic /api/community/admin router serves the web dashboard without
 * the apikey/envelope legacy layer.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, requireAuth, type Session } from "@/lib/session";
import { communityAuthor, communityAuthorSelect, communityUser } from "@/lib/community/serializers";
import { feedEvent, sendPush } from "@/lib/community/push";
import { syncPostCommentCounts } from "@/lib/community/counters";
import { getCachedMediaMany, invalidateSettings } from "@/lib/cache";

/**
 * Moderator/admin gate — the session role must be ADMIN/MODERATOR, with the
 * user's role re-read from the DB (isModerator also grants access), per the
 * community contract.
 */
export async function requireElevated(req: Parameters<typeof requireAuth>[0]): Promise<Session> {
  const session = await requireAuth(req);
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { role: true, isModerator: true },
  });
  if (!user) throw new ApiError("Please sign in to continue", 401);
  if (user.role !== "ADMIN" && user.role !== "MODERATOR" && user.isModerator !== 1) {
    throw new ApiError("Moderator access required", 403);
  }
  return session;
}

const POST_INCLUDE = {
  content: { orderBy: { createdAt: "asc" as const } },
  user: true,
  category: true,
} as const;
export type AdminPostRow = Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>;

/** camelCase community-post wire shared by the posts/causes admin lists. */
export function adminPostWire(
  p: AdminPostRow,
  extra?: { commentCount?: number; likeCount?: number; reportCount?: number; causeFollowerCount?: number; donationCount?: number; progressPercentage?: number }
) {
  const goal = p.goalAmount ?? 0;
  const progress = goal > 0 ? Math.min(100, (p.raisedAmount / goal) * 100) : 0;
  return {
    id: p.id,
    userId: p.userId,
    author: communityAuthor(p.user),
    desc: p.desc,
    type: p.type,
    goalAmount: p.goalAmount,
    raisedAmount: p.raisedAmount,
    deadline: p.deadline ? p.deadline.toISOString() : null,
    isVerified: p.isVerified,
    isEmergency: p.isEmergency,
    isRestricted: p.isRestricted,
    contextLabel: p.contextLabel,
    impactLabel: p.impactLabel,
    communityLabel: p.communityLabel,
    commentsCount: p.commentsCount,
    likesCount: p.likesCount,
    categoryId: p.categoryId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    content: p.content.map((c) => ({
      id: c.id,
      postId: c.postId,
      contentType: c.contentType,
      content: c.content,
      thumbnail: c.thumbnail,
      audioWaves: c.audioWaves,
      createdAt: c.createdAt.toISOString(),
    })),
    category: p.category
      ? { id: p.category.id, name: p.category.name, icon: p.category.icon, color: p.category.color }
      : null,
    progressPercentage: extra?.progressPercentage ?? Math.round(progress * 100) / 100,
    commentCount: extra?.commentCount ?? p.commentsCount,
    likeCount: extra?.likeCount ?? p.likesCount,
    reportCount: extra?.reportCount ?? 0,
    causeFollowerCount: extra?.causeFollowerCount ?? 0,
    donationCount: extra?.donationCount ?? 0,
  };
}

/** GET /community/admin/users — members + charity profile + activity counts. */
export async function adminUsers(q: string, tier: string | null, skip: number, limit: number) {
  const search = q
    ? {
        OR: [
          { name: { contains: q } },
          { email: { contains: q } },
          { username: { contains: q } },
          { city: { contains: q } },
        ],
      }
    : {};
  const where = { ...(tier ? { currentTier: tier } : {}), ...search };

  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
    db.user.count({ where }),
  ]);

  // per-user activity aggregates for the visible page
  const items = [];
  for (const u of rows) {
    const [postCount, causeCount, donationAgg] = await Promise.all([
      db.communityPost.count({ where: { userId: u.id } }),
      db.communityPost.count({ where: { userId: u.id, type: "cause" } }),
      db.donation.aggregate({
        _count: { _all: true },
        _sum: { amount: true },
        where: { donorId: u.id, paymentStatus: "COMPLETED" },
      }),
    ]);
    items.push({
      ...communityUser(u, { self: true }),
      lifetimeDonated: u.lifetimeDonated,
      impactScore: u.impactScore,
      memberSince: u.memberSince ? u.memberSince.toISOString().slice(0, 10) : null,
      postCount,
      causeCount,
      donationCount: donationAgg._count._all,
      donationTotal: donationAgg._sum.amount ?? 0,
    });
  }
  return { items, total };
}

/** GET /community/admin/posts — moderation list with per-post report counts. */
export async function adminPosts(q: string, type: string | null, skip: number, limit: number) {
  if (type && !["normal", "cause"].includes(type)) throw new ApiError("Invalid post type", 400);
  const where = {
    ...(type ? { type } : {}),
    ...(q ? { desc: { contains: q } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.communityPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        ...POST_INCLUDE,
        _count: { select: { comments: true, likes: true, reports: true, causeFollowers: true, donations: true } },
      },
    }),
    db.communityPost.count({ where }),
  ]);
  const items = rows.map((r) =>
    adminPostWire(r, {
      commentCount: r._count.comments,
      likeCount: r._count.likes,
      reportCount: r._count.reports,
      causeFollowerCount: r._count.causeFollowers,
      donationCount: r._count.donations,
    })
  );
  return { items, total };
}

/** POST /community/admin/posts/moderate — verify/restrict/delete. */
export async function moderatePost(session: Session, postId: string, action: string) {
  if (!postId) throw new ApiError("The post id field is required.", 400);
  if (!["verify", "unverify", "restrict", "unrestrict", "delete"].includes(action)) {
    throw new ApiError("Invalid moderation action", 400);
  }

  const post = await db.communityPost.findUnique({ where: { id: postId } });
  if (!post) throw new ApiError("Post not found", 404);

  if (action === "delete") {
    await db.communityPost.delete({ where: { id: postId } });
    feedEvent("post.moderated", { id: postId, action, by: session.userId });
    return { ok: true };
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
  feedEvent("post.moderated", { id: postId, action, by: session.userId });
  return { id: updated.id, isVerified: updated.isVerified, isRestricted: updated.isRestricted };
}

/** GET /community/admin/reports — the moderation queue. */
export async function adminReports(type: number | null, skip: number, limit: number) {
  const where = { ...(type !== null ? { type } : {}) };
  const [rows, total] = await Promise.all([
    db.communityReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        reporter: { select: { ...communityAuthorSelect, email: true } },
        post: { include: { user: { select: communityAuthorSelect } } },
        comment: { include: { user: { select: communityAuthorSelect } } },
        room: { select: { id: true, title: true } },
        reel: { select: { id: true, description: true, thumbnail: true } },
      },
    }),
    db.communityReport.count({ where }),
  ]);
  const items = rows.map((r) => ({
    id: r.id,
    type: r.type,
    reason: r.reason,
    desc: r.desc,
    createdAt: r.createdAt.toISOString(),
    reporter: r.reporter ? { ...communityAuthor(r.reporter), email: r.reporter.email } : null,
    post: r.post
      ? {
          id: r.post.id,
          desc: r.post.desc,
          type: r.post.type,
          author: communityAuthor(r.post.user),
          isRestricted: r.post.isRestricted,
        }
      : null,
    comment: r.comment
      ? { id: r.comment.id, desc: r.comment.desc, author: communityAuthor(r.comment.user) }
      : null,
    room: r.room,
    reel: r.reel ? { id: r.reel.id, description: r.reel.description, thumbnail: r.reel.thumbnail } : null,
  }));
  return { items, total };
}

/** POST /community/admin/reports/resolve — delete reported content / dismiss. */
export async function resolveReport(session: Session, reportId: string, action: string) {
  if (!reportId) throw new ApiError("The report id field is required.", 400);
  if (!["delete_post", "delete_comment", "dismiss"].includes(action)) {
    throw new ApiError("Invalid resolve action", 400);
  }

  const report = await db.communityReport.findUnique({ where: { id: reportId } });
  if (!report) throw new ApiError("Report not found", 404);

  if (action === "delete_post" && report.postId) {
    await db.communityPost.delete({ where: { id: report.postId } }).catch(() => undefined);
    await db.communityReport.deleteMany({ where: { postId: report.postId } });
    feedEvent("post.moderated", { id: report.postId, action, by: session.userId });
    return { ok: true };
  }
  if (action === "delete_comment" && report.commentId) {
    const deleted = await db.communityComment.delete({ where: { id: report.commentId } }).catch(() => null);
    if (deleted) await syncPostCommentCounts({ postIds: [deleted.postId] });
    await db.communityReport.deleteMany({ where: { commentId: report.commentId } });
    return { ok: true };
  }
  await db.communityReport.delete({ where: { id: reportId } });
  return { ok: true };
}

/** GET /community/admin/causes — CommunityPost(type=cause) fundraising list. */
export async function adminCauses(q: string, skip: number, limit: number) {
  const where = {
    type: "cause" as const,
    ...(q ? { desc: { contains: q } } : {}),
  };
  const [rows, total, agg] = await Promise.all([
    db.communityPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        ...POST_INCLUDE,
        _count: { select: { causeFollowers: true, donations: true } },
      },
    }),
    db.communityPost.count({ where }),
    db.donation.aggregate({
      _sum: { amount: true },
      where: { causePostId: { not: null }, paymentStatus: "COMPLETED" },
    }),
  ]);
  const items = rows.map((r) =>
    adminPostWire(r, {
      causeFollowerCount: r._count.causeFollowers,
      donationCount: r._count.donations,
    })
  );
  return { items, total, totalRaisedAll: agg._sum.amount ?? 0 };
}

/** GET /community/admin/donations — cause donations with the cause wire. */
export async function adminDonations(causePostId: string | null, skip: number, limit: number) {
  const where = {
    causePostId: { not: null },
    ...(causePostId ? { causePostId } : {}),
  };
  const [rows, total, agg] = await Promise.all([
    db.donation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { donor: true },
    }),
    db.donation.count({ where }),
    db.donation.aggregate({ _sum: { amount: true }, where: { ...where, paymentStatus: "COMPLETED" } }),
  ]);
  const items = [];
  for (const d of rows) {
    const causePost = d.causePostId
      ? await db.communityPost.findUnique({
          where: { id: d.causePostId },
          include: POST_INCLUDE,
        })
      : null;
    items.push({
      id: d.id,
      donorId: d.donorId,
      amount: d.amount,
      currency: d.currency,
      paymentStatus: d.paymentStatus,
      receiptNumber: d.receiptNumber,
      message: d.message,
      createdAt: d.createdAt.toISOString(),
      donor: communityAuthor(d.donor),
      cause: causePost ? adminPostWire(causePost) : null,
    });
  }
  return { items, total, totalRaised: agg._sum.amount ?? 0 };
}

const MEDIA_STATUSES = ["pending_upload", "uploaded", "processing", "ready", "failed"];

/** GET /api/community/admin/reels — every reel with its transcode state.
 *  Status comes from Redis where the worker cached it; only the misses hit
 *  app_media_assets, and those are cached for the next page. */
export async function adminReels(q: string, status: string | null, skip: number, limit: number) {
  if (status && !MEDIA_STATUSES.includes(status)) throw new ApiError("Invalid transcode status", 400);

  const where: Prisma.CommunityReelWhereInput = {
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: "insensitive" } },
            { user: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(status ? { media: { status } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.communityReel.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: communityAuthorSelect },
        media: { select: { id: true, status: true, attempts: true, error: true, durationMs: true, readyAt: true } },
        _count: { select: { likes: true, comments: true, reports: true } },
      },
    }),
    db.communityReel.count({ where }),
  ]);

  // Prefer the cached status — it's what the worker last wrote, and it
  // saves a join's worth of staleness when a video just changed state.
  const cached = await getCachedMediaMany(rows.flatMap((r) => (r.media ? [r.media.id] : [])));

  const items = rows.map((r) => ({
    id: r.id,
    description: r.description,
    thumbnail: r.thumbnail,
    hashtags: r.hashtags,
    viewsCount: r.viewsCount,
    likesCount: r._count.likes,
    commentsCount: r._count.comments,
    reportsCount: r._count.reports,
    createdAt: r.createdAt.toISOString(),
    author: communityAuthor(r.user),
    transcode: r.media
      ? {
          mediaId: r.media.id,
          status: cached.get(r.media.id)?.status ?? r.media.status,
          attempts: r.media.attempts,
          error: r.media.error,
          durationMs: r.media.durationMs,
          readyAt: r.media.readyAt ? r.media.readyAt.toISOString() : null,
        }
      : null,
  }));
  return { items, total };
}

// ═════════════════════ Admin config + verification + announcements ═══════════
// Ported from the mobile-only admin compat module onto the generic surface
// (legacy AdminController / SettingsController / RestrictionController /
// ProfileVerificationController).

// ─── Document types — Setting KV "mobile.documentTypes" (JSON array of
// title strings; the array index IS the id, matching the mobile fetchSetting
// nesting). Direct KV writes drop the settings cache via invalidateSettings.
const DOCS_KV_KEY = "mobile.documentTypes";
const DOCS_KV_DESC = "Profile verification document types for the mobile app";

async function readDocKv(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: DOCS_KV_KEY } });
  try {
    const parsed = JSON.parse(row?.value ?? "[]");
    if (Array.isArray(parsed)) return parsed.map((t) => String(t));
  } catch {
    // missing/corrupt KV row → empty list
  }
  return [];
}

async function writeDocKv(titles: string[]): Promise<void> {
  await db.setting.upsert({
    where: { key: DOCS_KV_KEY },
    update: { value: JSON.stringify(titles) },
    create: { key: DOCS_KV_KEY, value: JSON.stringify(titles), description: DOCS_KV_DESC },
  });
  await invalidateSettings();
}

export function listDocumentTypes() {
  return readDocKv().then((titles) => ({
    items: titles.map((title, id) => ({ id, title })),
    total: titles.length,
  }));
}

export async function addDocumentType(title: string) {
  const titles = await readDocKv();
  if (titles.includes(title)) throw new ApiError(`Document type "${title}" already exists`, 409);
  titles.push(title);
  await writeDocKv(titles);
  feedEvent("app.document_types.updated", { action: "add", title });
  return { id: titles.length - 1, title };
}

export async function updateDocumentType(id: number, title: string) {
  const titles = await readDocKv();
  if (id < 0 || id >= titles.length) throw new ApiError("Document type not found", 404);
  if (titles.includes(title)) throw new ApiError(`Document type "${title}" already exists`, 409);
  titles[id] = title;
  await writeDocKv(titles);
  feedEvent("app.document_types.updated", { action: "update", id, title });
  return { id, title };
}

export async function deleteDocumentType(id: number) {
  const titles = await readDocKv();
  if (id < 0 || id >= titles.length) throw new ApiError("Document type not found", 404);
  const [removed] = titles.splice(id, 1);
  await writeDocKv(titles);
  feedEvent("app.document_types.updated", { action: "delete", id });
  return { id, title: removed };
}

// ─── Report reasons (ReportReason rows) ──────────────────────────────────

async function titleTaken(
  model: "communityInterest" | "reportReason" | "usernameRestriction",
  title: string,
  excludeId?: number
): Promise<boolean> {
  const where = { title, ...(excludeId !== undefined ? { id: { not: excludeId } } : {}) };
  const row = await (db[model] as typeof db.communityInterest).findFirst({ where, select: { id: true } });
  return !!row;
}

export async function listReportReasons(skip: number, take: number) {
  const [rows, total] = await Promise.all([
    db.reportReason.findMany({ orderBy: { id: "desc" }, skip, take }),
    db.reportReason.count(),
  ]);
  return { items: rows, total };
}

export async function addReportReason(title: string) {
  if (await titleTaken("reportReason", title)) throw new ApiError(`Report reason "${title}" already exists`, 409);
  return db.reportReason.create({ data: { title } });
}

export async function updateReportReason(id: number, title: string) {
  const row = await db.reportReason.findUnique({ where: { id } });
  if (!row) throw new ApiError("Report reason not found", 404);
  if (await titleTaken("reportReason", title, id)) throw new ApiError(`Report reason "${title}" already exists`, 409);
  return db.reportReason.update({ where: { id }, data: { title } });
}

export async function deleteReportReason(id: number) {
  const row = await db.reportReason.findUnique({ where: { id } });
  if (!row) throw new ApiError("Report reason not found", 404);
  await db.reportReason.delete({ where: { id } });
  return row;
}

// ─── Username restrictions (UsernameRestriction rows; add accepts a
// comma-separated batch like the legacy addUsernameRestrictions) ─────────

export async function listUsernameRestrictions(skip: number, take: number) {
  const [rows, total] = await Promise.all([
    db.usernameRestriction.findMany({ orderBy: { id: "desc" }, skip, take }),
    db.usernameRestriction.count(),
  ]);
  return { items: rows, total };
}

export async function addUsernameRestrictions(title: string) {
  const parts = Array.from(
    new Set(
      title
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  if (parts.length === 0) throw new ApiError("The title field is required.", 400);
  const created = [];
  for (const part of parts) {
    if (await titleTaken("usernameRestriction", part)) continue; // batch add skips dups
    created.push(await db.usernameRestriction.create({ data: { title: part } }));
  }
  return created;
}

export async function updateUsernameRestriction(id: number, title: string) {
  const row = await db.usernameRestriction.findUnique({ where: { id } });
  if (!row) throw new ApiError("Username restriction not found", 404);
  if (await titleTaken("usernameRestriction", title, id)) throw new ApiError(`Username restriction "${title}" already exists`, 409);
  return db.usernameRestriction.update({ where: { id }, data: { title } });
}

export async function deleteUsernameRestriction(id: number) {
  const row = await db.usernameRestriction.findUnique({ where: { id } });
  if (!row) throw new ApiError("Username restriction not found", 404);
  await db.usernameRestriction.delete({ where: { id } });
  return row;
}

// ─── Profile verifications (ProfileVerification rows; the user's isVerified
// 0 not | 1 pending | 2 verified is the status the legacy grid showed;
// approved/rejected requests are removed, the roster lives on the user) ─────

export async function listVerifications(opts: { q?: string; status?: string; skip: number; take: number }) {
  const where: Record<string, unknown> = {};
  if (opts.q) {
    where.OR = [
      { fullName: { contains: opts.q } },
      { documentType: { contains: opts.q } },
      { user: { is: { OR: [{ name: { contains: opts.q } }, { username: { contains: opts.q } }, { email: { contains: opts.q } }] } } },
    ];
  }
  if (opts.status === "pending") where.user = { is: { isVerified: 1 } };
  if (opts.status === "verified") where.user = { is: { isVerified: 2 } };
  if (opts.status === "not_verified") where.user = { is: { isVerified: 0 } };

  const [rows, total] = await Promise.all([
    db.profileVerification.findMany({
      where,
      include: { user: { select: { id: true, name: true, username: true, email: true, avatar: true, isVerified: true } } },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),
    db.profileVerification.count({ where }),
  ]);
  return {
    items: rows.map((v) => ({
      id: v.id,
      userId: v.userId,
      selfie: v.selfie,
      document: v.document,
      documentType: v.documentType,
      fullName: v.fullName,
      status: v.user.isVerified,
      createdAt: v.createdAt.toISOString(),
      user: v.user,
    })),
    total,
  };
}

export async function listVerifiedMembers(opts: { q?: string; skip: number; take: number }) {
  const where: Record<string, unknown> = { isVerified: { gte: 2 } };
  if (opts.q) {
    where.OR = [
      { name: { contains: opts.q } },
      { username: { contains: opts.q } },
      { email: { contains: opts.q } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: opts.skip,
      take: opts.take,
      select: {
        id: true, email: true, name: true, username: true, avatar: true,
        isVerified: true, currentTier: true, totalPoints: true, memberSince: true, createdAt: true,
      },
    }),
    db.user.count({ where }),
  ]);
  return { items: rows, total };
}

export async function resolveVerification(session: Session, userId: string, approve: boolean) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("Profile not found", 404);
  const verification = await db.profileVerification.findFirst({ where: { userId } });
  if (!verification) throw new ApiError("Record not found", 404);

  await db.user.update({ where: { id: userId }, data: { isVerified: approve ? 2 : 0 } });
  await db.profileVerification.delete({ where: { id: verification.id } });

  feedEvent(approve ? "verification.approved" : "verification.rejected", {
    userId, name: user.name, by: session.userId,
  });
  return { userId, isVerified: approve ? 2 : 0 };
}

// ─── Platform announcements (AdminNotification rows + push fan-out) ───────

/** Push to every user with push notifications enabled, batched. Returns the
 *  number of users reached (per-user FCM failures never abort the loop). */
async function fanOutPush(title: string, description: string): Promise<number> {
  const users = await db.user.findMany({ where: { isPushNotifications: 1 }, select: { id: true } });
  const BATCH = 50;
  let sent = 0;
  for (let i = 0; i < users.length; i += BATCH) {
    const results = await Promise.allSettled(
      users.slice(i, i + BATCH).map((u) => sendPush({ userId: u.id, title, body: description, type: "ADMIN" }))
    );
    sent += results.filter((r) => r.status === "fulfilled").length;
  }
  return sent;
}

export async function listAdminNotifications(opts: { q?: string; skip: number; take: number }) {
  const where = opts.q
    ? { OR: [{ title: { contains: opts.q, mode: "insensitive" as const } }, { description: { contains: opts.q, mode: "insensitive" as const } }] }
    : {};
  const [rows, total] = await Promise.all([
    db.adminNotification.findMany({ where, orderBy: { id: "desc" }, skip: opts.skip, take: opts.take }),
    db.adminNotification.count({ where }),
  ]);
  return { items: rows, total };
}

export async function sendAdminNotification(session: Session, title: string, description: string) {
  const row = await db.adminNotification.create({ data: { title, description } });
  const recipients = await fanOutPush(title, description);
  feedEvent("notification.sent", { id: row.id, title, recipients, by: session.userId });
  return { id: row.id, title, description, recipients };
}

export async function updateAdminNotification(id: number, title: string, description: string) {
  const row = await db.adminNotification.findUnique({ where: { id } });
  if (!row) throw new ApiError("Notification not found", 404);
  return db.adminNotification.update({ where: { id }, data: { title, description } });
}

export async function repeatAdminNotification(session: Session, id: number, title?: string, description?: string) {
  const row = await db.adminNotification.findUnique({ where: { id } });
  if (!row) throw new ApiError("Notification not found", 404);
  const t = title?.trim() || row.title;
  const d = description?.trim() || row.description;
  const recipients = await fanOutPush(t, d);
  feedEvent("notification.repeated", { id: row.id, title: t, recipients, by: session.userId });
  return { id: row.id, recipients };
}

export async function deleteAdminNotification(id: number) {
  const row = await db.adminNotification.findUnique({ where: { id } });
  if (!row) throw new ApiError("Notification not found", 404);
  await db.adminNotification.delete({ where: { id } });
  return row;
}
