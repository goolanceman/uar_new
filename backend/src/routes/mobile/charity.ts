/**
 * Mobile wire-compat routes — charity module.
 *
 * Ports the legacy Laravel controllers 1:1 onto the uarnew backend so the
 * Flutter app works unchanged. Source of truth:
 * uar/php/admin routes/api.php + app/Http/Controllers/{CauseController,
 * DonationController, CharityCardController, DonationPointsController,
 * AchievementsController, DonationGoalsController, CharityEventsController}.php
 * (+ app/Services/CharityCardService.php, app/Models/{Post,Donation,
 * DonationPoint,CharityCard,UserAchievement,EventParticipant,CauseFollower}.php).
 *
 * Legacy middleware per route (mirrored here):
 *   - causes + donations CRUD  → `checkHeader` only (apikey, enforced by the
 *     mount-level mobileGate). Like the PHP, handlers take the acting user
 *     from the `user_id` param — the app's NewApiService sends NO authtoken.
 *   - razorpay/webhook         → NO middleware at all; the Razorpay HMAC
 *     signature is the auth.
 *   - charity/*                → `checkHeader` + AuthorizeUser ($request->user()).
 *     The app calls these two ways (ApiService sends `authtoken`, NewApiService
 *     doesn't — the legacy app 401'd its own achievements/goals calls), so a
 *     SOFT session is used: session.userId when a valid token is present,
 *     falling back to the `user_id` param (both headers are always sent with
 *     user_id). Reported as a deliberate compat decision.
 *
 * Wire contract (checked against the Flutter models — lib/models/*):
 *   cause_model.dart, cause_category_model.dart, donation_model.dart,
 *   charity_card_model.dart, achievement_model.dart, donation_goal_model.dart,
 *   charity_event_model.dart, impact_metrics_model.dart.
 * Envelope { status, message, data? }; business failures HTTP 200 + status:false;
 * only auth failures 401. All ids are String cuids; money is Float; dates ISO.
 *
 * This router also serves the ADMIN DASHBOARD's Community section (no apikey is
 * needed for those requests to be *authorized*, but the posts compat router's
 * mount guard upstream requires the mobile `apikey` header on every request
 * that flows through the compat layer — the admin client sends a constant
 * `apikey: uar-admin-console` plus its normal Authorization JWT, gated here by
 * the session role).
 */
import { Router, urlencoded, type Request, type Response } from "express";
import { createHmac, randomBytes, createHash } from "node:crypto";
import { Prisma, type Achievement, type CharityCard, type CharityEvent, type Donation, type DonationGoal, type DonationPoint, type User } from "@prisma/client";
import { db } from "@/lib/db";
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
  num,
  optStr,
  optNum,
  bool,
  page,
  sendPush,
  feedEvent,
  wrap,
  mobileErrorHandler,
} from "@/lib/mobile/compat";
import type { Session } from "@/lib/session";
import { validateSession } from "@/lib/session";

export const router = Router();

// The cause/goal half of the app (NewApiService) posts application/x-www-
// form-urlencoded bodies (dart http `body: params`), which the global
// express.json() ignores. Parse them so params() sees them; JSON bodies pass
// through untouched (same shim as the reels module).
router.use(urlencoded({ extended: true, limit: "10mb" }));

/** wrap() single-handler form — lets middleware (mobileAuth) run first. */
function h(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) =>
    Promise.resolve(handler(req, res)).catch((e) => mobileErrorHandler(e, res));
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Date-only ISO (legacy $casts date columns serialize as YYYY-MM-DD). */
function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jun 2026" — CharityCardController::getCardStats member_since format. */
function monthYear(d: Date | null | undefined): string | null {
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : null;
}

type UserRow = User;

const POST_INCLUDE = {
  content: { orderBy: { createdAt: "asc" as const } },
  user: true,
  category: true,
} as const;
type PostRow = Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>;

/**
 * SOFT session: populate req.session when a valid authtoken/Authorization is
 * present but never reject (the achievements/goals NewApiService calls carry
 * no token). Guards below decide how to resolve the acting user. Lifts the
 * legacy `authtoken` header exactly like mobileAuth.
 */
async function softAuth(req: Request, _res: Response, next: () => void) {
  const authtoken = req.header("authtoken");
  if (authtoken && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${authtoken}`;
  }
  const s = await validateSession(req);
  if (s) (req as Request & { session?: Session }).session = s;
  next();
}

/**
 * Resolve the acting user id the legacy way: authenticated session first
 * (AuthorizeUser), falling back to the `user_id` param (checkHeader routes).
 */
function actingUserId(req: Request): string | null {
  try {
    return session(req).userId;
  } catch {
    return optStr(params(req).user_id);
  }
}

async function requireUserRow(req: Request): Promise<UserRow | null> {
  const id = actingUserId(req);
  if (!id) return null;
  return db.user.findUnique({ where: { id } });
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

// ─── Serializers (legacy Eloquent shapes — checked against the Dart models) ───

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

/** Legacy Post wire + the computed cause attributes (Cause.dart). */
function serializeCause(
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

/** Mobile cause donations carry the legacy Donation wire (donation_model.dart). */
const LEGACY_STATUS: Record<string, string> = {
  PENDING: "pending",
  COMPLETED: "success",
  FAILED: "failed",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
};

function serializeDonation(d: Donation & { user?: unknown; cause?: unknown }) {
  return {
    id: d.id,
    user_id: d.donorId,
    cause_id: d.causePostId,
    amount: d.amount,
    currency: d.currency,
    // legacy status values ('pending'|'success'|'failed') — donation_model.dart
    status: LEGACY_STATUS[d.paymentStatus] ?? d.paymentStatus.toLowerCase(),
    payment_id: d.transactionId,
    razorpay_order_id: d.gatewayOrderId,
    razorpay_payment_id: d.transactionId,
    razorpay_signature: null as string | null,
    type: "one_time",
    notes: d.message,
    receipt_number: d.receiptNumber,
    created_at: iso(d.createdAt),
    updated_at: iso(d.updatedAt),
    user: d.user ?? null,
    cause: d.cause ?? null,
  };
}

async function causeWireFor(causeId: string | null, withComputed = false): Promise<unknown> {
  if (!causeId) return null;
  const p = await db.communityPost.findUnique({ where: { id: causeId }, include: POST_INCLUDE });
  if (!p) return null;
  if (!withComputed) return serializeCause(p);
  const [followers, donations] = await Promise.all([
    db.causeFollower.count({ where: { causeId: p.id } }),
    db.donation.count({ where: { causePostId: p.id, paymentStatus: "COMPLETED" } }),
  ]);
  return serializeCause(p, { followerCount: followers, donationCount: donations });
}

// ─── CharityCardService port (single source of truth for card stats) ──────────

const LEVEL_THRESHOLDS: Record<string, number> = { bronze: 0, silver: 500, gold: 2500, platinum: 10000 };
const LEVEL_COLORS: Record<string, string> = {
  bronze: "#CD7F32",
  silver: "#C0C0C0",
  gold: "#FFD700",
  platinum: "#E5E4E2",
  diamond: "#B9F2FF",
};
const LEVEL_BENEFITS: Record<string, string[]> = {
  bronze: ["Basic digital charity card", "Donation tracking", "Impact dashboard", "Monthly newsletter"],
  silver: [
    "All Bronze benefits", "10% bonus points on donations", "Priority customer support",
    "Quarterly impact reports", "Event invitations",
  ],
  gold: [
    "All Silver benefits", "20% bonus points on donations", "VIP event access",
    "Personal impact consultant", "Annual recognition award", "Tax benefit assistance",
  ],
  platinum: [
    "All Gold benefits", "30% bonus points on donations", "Executive roundtable access",
    "Naming opportunities", "Strategic partnership meetings", "Custom cause creation",
    "Legacy program enrollment",
  ],
};

function determineMembershipLevel(points: number): string {
  if (points >= 10000) return "platinum";
  if (points >= 2500) return "gold";
  if (points >= 500) return "silver";
  return "bronze";
}

/** Points % to next level (CharityCard::getPointsToNextLevelAttribute). */
function pointsToNextTier(donationPoints: number, level: string): number {
  const levels = Object.keys(LEVEL_THRESHOLDS);
  const idx = levels.indexOf(level);
  if (idx === -1 || idx === levels.length - 1) return 0;
  return Math.max(0, LEVEL_THRESHOLDS[levels[idx + 1]] - donationPoints);
}

/** CharityCard::generateCardNumber — 'CHR-' + 16 uppercase hex. */
function generateCardNumber(): string {
  return `CHR-${randomBytes(8).toString("hex").toUpperCase()}`;
}

/**
 * CharityCardService::syncCardStats — recompute card + User charity columns
 * from COMPLETED mobile donations. 2 points per rupee; impact score gets a
 * consistency multiplier by donation count.
 */
async function syncCardStats(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const stats = await db.donation.aggregate({
    _sum: { amount: true },
    _count: { _all: true },
    where: { donorId: userId, paymentStatus: "COMPLETED" },
  });
  const totalDonated = stats._sum.amount ?? 0;
  const donationCount = stats._count._all;
  const donationPoints = Math.trunc(totalDonated * 2);
  const multiplier = donationCount >= 50 ? 2.0 : donationCount >= 25 ? 1.5 : donationCount >= 10 ? 1.25 : 1.0;
  const impactScore = Math.trunc(donationPoints * multiplier);
  const membershipLevel = determineMembershipLevel(donationPoints);

  const existing = await db.charityCard.findUnique({ where: { userId } });
  if (!existing) {
    await db.charityCard.create({
      data: {
        userId,
        cardNumber: generateCardNumber(),
        memberName: user.name || "Member",
        membershipLevel: membershipLevel,
        totalDonated,
        donationPoints,
        impactScore,
        memberSince: user.createdAt,
        validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      },
    });
  } else {
    await db.charityCard.update({
      where: { userId },
      data: { totalDonated, donationPoints, impactScore, membershipLevel },
    });
  }

  await db.user.update({
    where: { id: userId },
    data: {
      lifetimeDonated: totalDonated,
      totalPoints: donationPoints,
      impactScore,
      currentTier: membershipLevel,
      ...(user.memberSince ? {} : { memberSince: user.createdAt }),
    },
  });
}

/** DonationPoint::awardDonationPoints — ₹1 = 2 points, expire after 1 year. */
async function awardDonationPoints(userId: string, donationId: string, amount: number): Promise<void> {
  const points = Math.trunc(amount * 2);
  await db.donationPoint.create({
    data: {
      userId,
      donationId,
      points,
      type: "earned",
      description: `Earned from donation of ₹${amount.toFixed(2)}`,
      expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });
}

/**
 * Achievements evaluation — mirrors the AchievementsController unlock checks:
 * an achievement unlocks when amount_required (lifetime donated), count_required
 * (success donation count) or points_required (total points) is reached.
 */
async function evaluateAchievements(userId: string): Promise<void> {
  const achievements = await db.achievement.findMany({ where: { isActive: true } });
  if (!achievements.length) return;

  const [donationAgg, existing] = await Promise.all([
    db.donation.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: { donorId: userId, paymentStatus: "COMPLETED" },
    }),
    db.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
  ]);
  const have = new Set(existing.map((e) => e.achievementId));
  const totalDonated = donationAgg._sum.amount ?? 0;
  const donationCount = donationAgg._count._all;
  const user = await db.user.findUnique({ where: { id: userId }, select: { totalPoints: true } });
  const points = user?.totalPoints ?? 0;

  for (const a of achievements) {
    if (have.has(a.id)) continue;
    let progress = 0;
    if (a.amountRequired > 0) progress = Math.trunc(totalDonated);
    else if (a.countRequired > 0) progress = donationCount;
    else if (a.pointsRequired > 0) progress = points;

    const requirement = a.amountRequired || a.countRequired || a.pointsRequired;
    const unlocked = requirement > 0 && progress >= requirement;
    // NOTE: UserAchievement.unlockedAt is NOT NULL in the uarnew schema, so
    // in-progress rows are not persisted — a row exists only once unlocked
    // (progress readers compute live values from the same aggregates).
    if (!unlocked) continue;
    await db.userAchievement.upsert({
      where: { userId_achievementId: { userId, achievementId: a.id } },
      update: { progress },
      create: { userId, achievementId: a.id, progress, unlockedAt: new Date() },
    });
    await sendPush({
      userId,
      title: "Achievement unlocked!",
      body: `Congratulations — you unlocked "${a.name}"!`,
      type: "ACHIEVEMENT",
      data: { achievement_id: String(a.id), type: "achievement" },
    });
    feedEvent("achievement.unlocked", { user_id: userId, achievement_id: a.id, name: a.name });
  }
}

/**
 * Money moved: raised_amount on the cause post + points + card sync +
 * achievements + push + SSE feed. Shared by verifyDonation and the webhook.
 * Idempotent per donation (only a PENDING donation settles).
 */
async function settleDonation(donationId: string, paymentId: string | null): Promise<boolean> {
  const donation = await db.donation.findUnique({ where: { id: donationId } });
  if (!donation || donation.paymentStatus !== "PENDING") return false;

  await db.donation.update({
    where: { id: donation.id },
    data: {
      paymentStatus: "COMPLETED",
      receiptStatus: "ISSUED",
      receiptIssuedAt: new Date(),
      ...(paymentId ? { transactionId: paymentId } : {}),
    },
  });

  if (donation.causePostId) {
    await db.communityPost.update({
      where: { id: donation.causePostId },
      data: { raisedAmount: { increment: donation.amount } },
    }).catch(() => undefined); // cause post may be gone — donation still settles
  }
  if (donation.donorId) {
    await awardDonationPoints(donation.donorId, donation.id, donation.amount);
    await syncCardStats(donation.donorId);
    await evaluateAchievements(donation.donorId);
    await sendPush({
      userId: donation.donorId,
      title: "Donation successful",
      body: `Thank you for your contribution of ₹${donation.amount.toFixed(2)}!`,
      type: "DONATION",
      data: { donation_id: donation.id, amount: donation.amount },
    });
    feedEvent("donation.verified", {
      donation_id: donation.id,
      amount: donation.amount,
      cause_post_id: donation.causePostId,
      user_id: donation.donorId,
    });
  }
  return true;
}

async function nextReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  let n = (await db.donation.count()) + 1;
  let receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
  while (await db.donation.findUnique({ where: { receiptNumber } })) {
    n += 1;
    receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
  }
  return receiptNumber;
}

// ─── Razorpay REST client (the PHP used the razorpay/sdk package) ────────────

const RAZORPAY_API = "https://api.razorpay.com/v1";

function razorpayAuth(): string | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

// ═══════════════════════════════ CAUSES ══════════════════════════════════════
// Legacy middleware: checkHeader only — acting user comes from `user_id`.

/** CauseController::createCause */
wrap(router, "post", "/createCause", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  const description = str(p.description);
  const goalAmount = num(p.goal_amount, -1);
  const categoryId = optNum(p.category_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (!str(p.title).trim()) return fail(res, "The title field is required.");
  if (!description.trim()) return fail(res, "The description field is required.");
  if (goalAmount < 100) return fail(res, "The goal amount must be at least 100.");
  if (!categoryId) return fail(res, "The category id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "Selected user id is invalid.");
  const category = await db.causeCategory.findUnique({ where: { id: categoryId } });
  if (!category) return fail(res, "Selected category id is invalid.");

  // Flutter sends `end_date` (YYYY-MM-DD); the legacy validator read `deadline`.
  const deadlineRaw = optStr(p.deadline) ?? optStr(p.end_date);
  let deadline: Date | null = null;
  if (deadlineRaw) {
    deadline = new Date(deadlineRaw);
    if (Number.isNaN(deadline.getTime())) return fail(res, "The deadline must be a valid date.");
    if (deadline.getTime() < new Date().setHours(0, 0, 0, 0))
      return fail(res, "The deadline must be a date after today.");
  }

  const cause = await db.communityPost.create({
    data: {
      userId,
      desc: description,
      type: "cause",
      goalAmount,
      raisedAmount: 0,
      deadline,
      isVerified: false, // admin needs to verify
      categoryId,
      commentsCount: 0,
      likesCount: 0,
    },
    include: POST_INCLUDE,
  });

  // Media content — the app sends `images` (jsonEncoded parts), the legacy
  // contract said `media`. Accept both.
  const rawMedia = [...csvListSafe(p.media), ...csvListSafe(p.images)];
  for (const url of rawMedia.slice(0, 10)) {
    await db.communityPostContent.create({
      data: { postId: cause.id, contentType: mediaType(url), content: url },
    });
  }
  if (rawMedia.length) {
    const fresh = await db.communityPost.findUnique({ where: { id: cause.id }, include: POST_INCLUDE });
    if (fresh) Object.assign(cause, fresh);
  }

  feedEvent("cause.created", { id: cause.id, user_id: userId, goal_amount: goalAmount });
  return res.status(201).json({
    status: true,
    message: "Cause created successfully! Pending admin verification.",
    data: serializeCause(cause),
  });
});

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

/** CauseController::fetchCauses — active = no deadline or deadline >= today. */
wrap(router, "post", "/fetchCauses", async (req, res) => {
  const p = params(req);
  const userId = optStr(p.user_id);
  const categoryId = optNum(p.category_id);
  const start = Math.max(0, num(p.offset, num(p.start, 0)));
  const limit = Math.min(100, Math.max(1, num(p.limit, 20)));
  const today = new Date();

  const where = {
    type: "cause",
    OR: [{ deadline: null }, { deadline: { gte: today } }],
    ...(categoryId ? { categoryId } : {}),
  };
  const rows = await db.communityPost.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: start,
    take: limit,
    include: POST_INCLUDE,
  });

  const wires = await Promise.all(
    rows.map(async (c) => {
      const [followers, donations, following] = await Promise.all([
        db.causeFollower.count({ where: { causeId: c.id } }),
        db.donation.count({ where: { causePostId: c.id, paymentStatus: "COMPLETED" } }),
        userId
          ? db.causeFollower.findUnique({
              where: { userId_causeId: { userId, causeId: c.id } },
            }).then((f) => !!f)
          : Promise.resolve(false),
      ]);
      return serializeCause(c, {
        isFollowing: following,
        followerCount: followers,
        donationCount: donations,
      });
    })
  );
  return data(res, "Causes fetched successfully", wires);
});

/** CauseController::fetchCauseById */
wrap(router, "post", "/fetchCauseById", async (req, res) => {
  const p = params(req);
  const causeId = str(p.cause_id);
  if (!causeId) return fail(res, "The cause id field is required.");

  const cause = await db.communityPost.findUnique({ where: { id: causeId }, include: POST_INCLUDE });
  if (!cause || cause.type !== "cause") return fail(res, "Cause not found");

  const userId = optStr(p.user_id);
  const [followers, donations, following] = await Promise.all([
    db.causeFollower.count({ where: { causeId: cause.id } }),
    db.donation.count({ where: { causePostId: cause.id, paymentStatus: "COMPLETED" } }),
    userId
      ? db.causeFollower
          .findUnique({ where: { userId_causeId: { userId, causeId: cause.id } } })
          .then((f) => !!f)
      : Promise.resolve(false),
  ]);
  return data(
    res,
    "Cause fetched successfully",
    serializeCause(cause, { isFollowing: following, followerCount: followers, donationCount: donations })
  );
});

/** CauseController::followCause */
wrap(router, "post", "/followCause", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  const causeId = str(p.cause_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (!causeId) return fail(res, "The cause id field is required.");

  const cause = await db.communityPost.findUnique({ where: { id: causeId }, select: { id: true, type: true } });
  if (!cause || cause.type !== "cause") return fail(res, "Selected cause id is invalid.");

  const existing = await db.causeFollower.findUnique({ where: { userId_causeId: { userId, causeId } } });
  if (existing) return fail(res, "Already following this cause");

  await db.causeFollower.create({ data: { userId, causeId } });
  return ok(res, "Cause followed successfully");
});

/** CauseController::unfollowCause */
wrap(router, "post", "/unfollowCause", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  const causeId = str(p.cause_id);
  if (!userId) return fail(res, "The user id field is required.");
  if (!causeId) return fail(res, "The cause id field is required.");

  const existing = await db.causeFollower.findUnique({ where: { userId_causeId: { userId, causeId } } });
  if (!existing) return fail(res, "Not following this cause");

  await db.causeFollower.delete({ where: { id: existing.id } });
  return ok(res, "Cause unfollowed successfully");
});

/** CauseController::fetchMyCauses — follower rows with nested cause. */
wrap(router, "post", "/fetchMyCauses", async (req, res) => {
  const userId = str(params(req).user_id);
  if (!userId) return fail(res, "The user id field is required.");

  const rows = await db.causeFollower.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { cause: { include: POST_INCLUDE } },
  });
  const wires = await Promise.all(
    rows.map(async (f) => ({
      id: f.id,
      user_id: f.userId,
      cause_id: f.causeId,
      created_at: iso(f.createdAt),
      updated_at: iso(f.updatedAt),
      cause: await causeWireFor(f.causeId, true),
    }))
  );
  return data(res, "Followed causes fetched successfully", wires);
});

/** CauseController::fetchCategories */
wrap(router, "post", "/fetchCauseCategories", async (_req, res) => {
  const categories = await db.causeCategory.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
  });
  return data(
    res,
    "Categories fetched successfully",
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      description: c.description,
      is_active: c.isActive,
      created_at: iso(c.createdAt),
      updated_at: iso(c.updatedAt),
    }))
  );
});

// ═══════════════════════════════ DONATIONS ═══════════════════════════════════
// Legacy middleware: checkHeader only — acting user comes from `user_id`.

/** DonationController::createDonationOrder */
wrap(router, "post", "/createDonationOrder", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  const causeId = str(p.cause_id);
  const amount = num(p.amount, -1);
  const notes = optStr(p.notes);
  if (!userId) return fail(res, "The user id field is required.");
  if (!causeId) return fail(res, "The cause id field is required.");
  if (amount < 1 || amount > 99999999.99) return fail(res, "The amount must be between 1 and 99999999.99.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "Selected user id is invalid.");

  const cause = await db.communityPost.findFirst({
    where: { id: causeId, type: "cause", OR: [{ deadline: null }, { deadline: { gte: new Date() } }] },
  });
  if (!cause) return fail(res, "Cause not found or inactive");

  const auth = razorpayAuth();
  if (!auth) return fail(res, "Failed to create donation order: Razorpay keys not configured");

  let orderId: string;
  try {
    const r = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // paise
        currency: "INR",
        receipt: `donation_${Date.now()}_${userId}`,
        notes: { user_id: userId, cause_id: causeId, cause_name: cause.desc ?? "", custom_notes: notes ?? "" },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await r.json()) as { id?: string };
    if (!r.ok || !body.id) return fail(res, "Failed to create donation order: gateway rejected the request");
    orderId = body.id;
  } catch {
    return fail(res, "Failed to create donation order: gateway could not be reached");
  }

  const donation = await db.donation.create({
    data: {
      donorId: userId,
      donorName: user.name,
      donorEmail: user.email,
      donorPhone: user.phone,
      amount,
      currency: "INR",
      type: "ONE_TIME",
      paymentMethod: "RAZORPAY",
      paymentProvider: "RAZORPAY",
      paymentStatus: "PENDING",
      gatewayOrderId: orderId,
      message: notes,
      receiptNumber: await nextReceiptNumber(),
      receiptStatus: "PENDING",
      causePostId: causeId,
    },
  });

  feedEvent("donation.order_created", {
    donation_id: donation.id,
    amount,
    cause_post_id: causeId,
    user_id: userId,
  });

  return data(res, "Donation order created successfully", {
    donation_id: donation.id,
    order_id: orderId,
    amount,
    currency: "INR",
    razorpay_key: process.env.RAZORPAY_KEY_ID ?? "",
  });
});

/** DonationController::verifyDonation */
wrap(router, "post", "/verifyDonation", async (req, res) => {
  const p = params(req);
  const donationId = str(p.donation_id);
  const orderId = str(p.razorpay_order_id);
  const paymentId = str(p.razorpay_payment_id);
  const signature = str(p.razorpay_signature);
  if (!donationId) return fail(res, "The donation id field is required.");
  if (!paymentId) return fail(res, "The razorpay payment id field is required.");
  if (!orderId) return fail(res, "The razorpay order id field is required.");
  if (!signature) return fail(res, "The razorpay signature field is required.");

  const donation = await db.donation.findUnique({ where: { id: donationId } });
  if (!donation) return fail(res, "Donation not found");

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (keySecret) {
    const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    if (expected !== signature) {
      if (donation.paymentStatus === "PENDING") {
        await db.donation.update({ where: { id: donation.id }, data: { paymentStatus: "FAILED" } });
      }
      return fail(res, "Payment verification failed: Invalid signature");
    }
  }

  const settled = await settleDonation(donation.id, paymentId);

  const fresh = await db.donation.findUnique({
    where: { id: donation.id },
    include: { donor: true },
  });
  const cause = await causeWireFor(donation.causePostId, true);
  return data(res, "Donation successful! Thank you for your contribution.", {
    ...serializeDonation({ ...(fresh ?? donation), user: fresh?.donor ? legacyUser(fresh.donor) : null, cause }),
    ...(settled ? {} : { already_settled: true }),
  });
});

/** DonationController::fetchMyDonations */
wrap(router, "post", "/fetchMyDonations", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");
  const { start, limit } = page(req, 20);

  const [rows, agg] = await Promise.all([
    db.donation.findMany({
      where: { donorId: userId, paymentStatus: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: { donor: true },
    }),
    db.donation.aggregate({
      _sum: { amount: true },
      where: { donorId: userId, paymentStatus: "COMPLETED" },
    }),
  ]);

  const donations = await Promise.all(
    rows.map(async (d) =>
      serializeDonation({ ...d, user: d.donor ? legacyUser(d.donor) : null, cause: await causeWireFor(d.causePostId) })
    )
  );
  return data(res, "Donations fetched successfully", {
    donations,
    total_donated: agg._sum.amount ?? 0,
    donation_count: donations.length,
  });
});

/** DonationController::fetchCauseDonations */
wrap(router, "post", "/fetchCauseDonations", async (req, res) => {
  const p = params(req);
  const causeId = str(p.cause_id);
  if (!causeId) return fail(res, "The cause id field is required.");
  const { start, limit } = page(req, 20);

  let sortBy = str(p.sort_by) || "created_at";
  // legacy wire keys → Prisma columns
  if (sortBy === "created_at") sortBy = "createdAt";
  if (!['createdAt', "amount"].includes(sortBy)) sortBy = "createdAt";
  let sortDirection = (str(p.sort_direction) || "desc").toLowerCase();
  if (!["asc", "desc"].includes(sortDirection)) sortDirection = "desc";

  const where = { causePostId: causeId, paymentStatus: "COMPLETED" as const };
  const [rows, total, agg] = await Promise.all([
    db.donation.findMany({
      where,
      orderBy: { [sortBy]: sortDirection },
      skip: start,
      take: limit,
      include: { donor: true },
    }),
    db.donation.count({ where }),
    db.donation.aggregate({ _sum: { amount: true }, where }),
  ]);

  const donations = await Promise.all(
    rows.map(async (d) =>
      serializeDonation({ ...d, user: d.donor ? legacyUser(d.donor) : null, cause: await causeWireFor(causeId) })
    )
  );
  return data(res, "Cause donations fetched successfully", {
    donations,
    total_raised: agg._sum.amount ?? 0,
    donation_count: total, // total count, not page count
  });
});

/**
 * DonationController::handleWebhook — NO auth middleware; the Razorpay HMAC
 * signature over the raw body is the auth (RAZORPAY_WEBHOOK_SECRET, falling
 * back to RAZORPAY_KEY_SECRET).
 *
 * NOTE: the global express.json() parser consumes the stream before routers
 * run, so the HMAC is verified over the re-serialized parsed body — byte
 * identical for Razorpay's compact JSON payloads. When index.ts can take a
 * `verify: (req,_res,buf)=>{req.rawBody=buf}` option this should switch to the
 * true raw bytes.
 */
wrap(router, "post", "/razorpay/webhook", async (req, res) => {
  const signature = req.header("X-Razorpay-Signature") ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return res.status(400).json({ status: "error", message: "Webhook secret not configured" });

  const raw = JSON.stringify(req.body ?? {});
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (expected !== signature) {
    return res.status(400).json({ status: "error", message: "Invalid webhook signature" });
  }

  const payload = (req.body ?? {}) as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
  };
  const event = payload.event ?? "";
  const entity = payload.payload?.payment?.entity;
  const paymentId = entity?.id ?? null;
  const orderId = entity?.order_id;

  if ((event === "payment.authorized" || event === "payment.captured") && orderId) {
    const donation = await db.donation.findFirst({ where: { gatewayOrderId: orderId } });
    if (donation && donation.paymentStatus === "PENDING") {
      await settleDonation(donation.id, paymentId);
    }
  }

  if (event === "payment.failed" && orderId) {
    const donation = await db.donation.findFirst({ where: { gatewayOrderId: orderId } });
    if (donation && donation.paymentStatus === "PENDING") {
      await db.donation.update({ where: { id: donation.id }, data: { paymentStatus: "FAILED" } });
    }
  }

  // legacy shape: a plain string status, not the boolean envelope
  return res.json({ status: "success" });
});

// ══════════════════════════ CHARITY CARD (session) ═══════════════════════════
// Legacy middleware: checkHeader + AuthorizeUser. Soft session + user_id
// fallback (the app always sends user_id alongside).

function serializeCard(card: CharityCard, user?: UserRow | null) {
  return {
    id: card.id,
    user_id: card.userId,
    card_number: card.cardNumber,
    member_name: card.memberName,
    membership_level: card.membershipLevel,
    total_donated: card.totalDonated,
    donation_points: card.donationPoints,
    impact_score: card.impactScore,
    member_since: dateOnly(card.memberSince),
    valid_until: dateOnly(card.validUntil),
    qr_code: card.qrCode,
    is_active: card.isActive,
    created_at: iso(card.createdAt),
    updated_at: iso(card.updatedAt),
    // computed attributes (CharityCard model accessors)
    level_color: LEVEL_COLORS[card.membershipLevel] ?? LEVEL_COLORS.bronze,
    level_benefits: LEVEL_BENEFITS[card.membershipLevel] ?? LEVEL_BENEFITS.bronze,
    points_to_next_tier: pointsToNextTier(card.donationPoints, card.membershipLevel),
    is_expired: card.validUntil ? card.validUntil.getTime() < Date.now() : false,
    qr_code_url: `/api/charity/card/verify?card_number=${card.cardNumber}`,
    ...(user
      ? {
          user: {
            id: user.id,
            username: user.username ?? "",
            full_name: user.name,
            email: user.email,
            profile: user.avatar,
          },
        }
      : {}),
  };
}

/** GET /charity/card/my-card (+ legacy alias GET /charity/card) */
async function myCardHandler(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");

  await syncCardStats(user.id);
  const card = await db.charityCard.findUnique({ where: { userId: user.id } });
  if (!card) return fail(res, "Failed to retrieve charity card");
  return data(res, "Charity card retrieved successfully", serializeCard(card, user));
}
router.get("/charity/card/my-card", softAuth, h(myCardHandler));
router.get("/charity/card", softAuth, h(myCardHandler)); // mobile alias

/** GET /charity/card/tier-info — the legacy static tiers array. */
router.get("/charity/card/tier-info", softAuth, h(async (_req, res) => {
  const tiers = [
    { name: "bronze", min_points: 0, color: "#CD7F32", benefits: LEVEL_BENEFITS.bronze, bonus_points: 0 },
    { name: "silver", min_points: 1000, color: "#C0C0C0", benefits: LEVEL_BENEFITS.silver, bonus_points: 10 },
    { name: "gold", min_points: 5000, color: "#FFD700", benefits: LEVEL_BENEFITS.gold, bonus_points: 20 },
    { name: "platinum", min_points: 20000, color: "#E5E4E2", benefits: LEVEL_BENEFITS.platinum, bonus_points: 30 },
  ];
  return data(res, "Tier information retrieved", tiers);
}));

/** POST /charity/card/verify — QR scanning (no auth in legacy beyond the group). */
router.post("/charity/card/verify", softAuth, h(async (req, res) => {
  const p = params(req);
  const cardNumber = str(p.card_number);
  if (!cardNumber) return fail(res, "The card number field is required.");
  if (cardNumber.length !== 20) return fail(res, "The card number must be 20 characters.");

  const card = await db.charityCard.findUnique({
    where: { cardNumber },
    include: { user: true },
  });
  if (!card) return fail(res, "Invalid card number");

  if (card.validUntil && card.validUntil.getTime() < Date.now()) {
    return res.json({
      status: false,
      message: "Card has expired",
      data: {
        card_number: card.cardNumber,
        validity_until: dateOnly(card.validUntil),
        is_expired: true,
      },
    });
  }

  return data(res, "Card verified successfully", {
    card_number: card.cardNumber,
    membership_level: card.membershipLevel,
    user: {
      id: card.user.id,
      username: card.user.username ?? "",
      full_name: card.user.name,
      profile: card.user.avatar,
    },
    total_donated: card.totalDonated,
    impact_score: card.impactScore,
    validity_until: dateOnly(card.validUntil),
    is_valid: true,
  });
}));

/** POST /charity/card/share */
router.post("/charity/card/share", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");

  const card = await db.charityCard.findUnique({ where: { userId: user.id } });
  if (!card) return fail(res, "Card not found");

  const level = card.membershipLevel.charAt(0).toUpperCase() + card.membershipLevel.slice(1);
  const donated = `₹${card.totalDonated.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  return data(res, "Share data generated", {
    message: "Check out my charity impact!",
    card_number: card.cardNumber,
    membership_level: level,
    total_donated: donated,
    impact_score: card.impactScore,
    share_url: `/api/charity/card/verify?card_number=${card.cardNumber}`,
    social_text: `I've donated ${donated} and achieved ${level} tier status! Join me in making an impact. 🌟`,
  });
}));

/**
 * GET /charity/card/stats — card statistics. Also serves GET /charity/impact
 * (the Flutter ImpactMetrics model reads these keys plus optional extras).
 */
async function cardStatsHandler(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");

  const card = await db.charityCard.findUnique({ where: { userId: user.id } });
  if (!card) return fail(res, "Card not found");

  const [donationCount, activePoints, achievementsCount, causesAgg, eventsAttended, lastDonation] =
    await Promise.all([
      db.donation.count({ where: { donorId: user.id, paymentStatus: "COMPLETED" } }),
      db.donationPoint.aggregate({
        _sum: { points: true },
        where: { userId: user.id, isExpired: false, type: "earned", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      }),
      db.userAchievement.count({ where: { userId: user.id } }),
      db.donation.groupBy({ by: ["causePostId"], where: { donorId: user.id, paymentStatus: "COMPLETED", causePostId: { not: null } } }),
      db.eventParticipant.count({ where: { userId: user.id, status: "attended" } }),
      db.donation.findFirst({
        where: { donorId: user.id, paymentStatus: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  return data(res, "Card statistics retrieved", {
    total_donated: card.totalDonated,
    donation_points: card.donationPoints,
    impact_score: card.impactScore,
    membership_level: card.membershipLevel,
    level_color: LEVEL_COLORS[card.membershipLevel] ?? LEVEL_COLORS.bronze,
    points_to_next_tier: pointsToNextTier(card.donationPoints, card.membershipLevel),
    member_since: monthYear(card.memberSince),
    valid_until: card.validUntil ? monthYear(card.validUntil) : "Lifetime",
    donation_count: donationCount,
    active_points: activePoints._sum.points ?? 0,
    achievements_count: achievementsCount,
    // impact-metrics extras (impact_metrics_model.dart — defaulted 0 in legacy)
    causes_supported: causesAgg.length,
    average_donation: donationCount > 0 ? card.totalDonated / donationCount : 0,
    events_attended: eventsAttended,
    last_donation_date: iso(lastDonation?.createdAt),
  });
}
router.get("/charity/card/stats", softAuth, h(cardStatsHandler));
router.get("/charity/impact", softAuth, h(cardStatsHandler));

// ══════════════════════════ DONATION POINTS (session) ════════════════════════

const pointInclude = { donation: { include: { causePost: { include: POST_INCLUDE } } } } as const;
type PointRow = Prisma.DonationPointGetPayload<{ include: typeof pointInclude }>;

type DonationWithIncludes = Donation & { causePost?: PostRow | null };

function serializePoint(t: PointRow) {
  const donation = t.donation as (DonationWithIncludes & { causePost?: PostRow | null }) | null;
  return {
    id: t.id,
    user_id: t.userId,
    donation_id: t.donationId,
    points: t.points,
    type: t.type,
    description: t.description,
    expires_at: dateOnly(t.expiresAt),
    is_expired: t.isExpired,
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
    donation: donation
      ? {
          id: donation.id,
          amount: donation.amount,
          cause_id: donation.causePostId,
          cause: donation.causePost ? serializeCause(donation.causePost) : null,
        }
      : null,
  };
}

/** Total active points — is_expired false AND (expiresAt null OR > now). */
function activeWhere(userId: string) {
  return {
    userId,
    isExpired: false,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

router.get("/charity/points/balance", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");

  const [active, lifetime, expired, expiring] = await Promise.all([
    db.donationPoint.aggregate({ _sum: { points: true }, where: activeWhere(user.id) }),
    db.donationPoint.aggregate({ _sum: { points: true }, where: { userId: user.id } }),
    db.donationPoint.aggregate({ _sum: { points: true }, where: { userId: user.id, isExpired: true } }),
    db.donationPoint.aggregate({
      _sum: { points: true },
      where: { ...activeWhere(user.id), expiresAt: { lte: new Date(Date.now() + 30 * 864e5), not: null } },
    }),
  ]);
  return data(res, "Points balance retrieved", {
    active_points: active._sum.points ?? 0,
    lifetime_points: lifetime._sum.points ?? 0,
    expired_points: expired._sum.points ?? 0,
    expiring_soon: expiring._sum.points ?? 0,
  });
}));

router.get("/charity/points/history", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const p = params(req);
  const { start, limit } = page(req, 20);
  const type = optStr(p.type);
  if (type && !["earned", "bonus", "redeemed", "expired", "adjustment"].includes(type)) {
    return fail(res, "The selected type is invalid.");
  }

  const [rows, total] = await Promise.all([
    db.donationPoint.findMany({
      where: { userId: user.id, ...(type ? { type } : {}) },
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: pointInclude,
    }),
    db.donationPoint.count({ where: { userId: user.id } }),
  ]);
  return data(res, "History retrieved", {
    transactions: rows.map(serializePoint),
    total_count: total,
  });
}));

router.get("/charity/points/expiring", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const days = Math.min(365, Math.max(1, num(params(req).days, 30)));

  const rows = await db.donationPoint.findMany({
    where: { ...activeWhere(user.id), expiresAt: { lte: new Date(Date.now() + days * 864e5), not: null } },
    orderBy: { expiresAt: "asc" },
    include: pointInclude,
  });
  return data(res, "Expiring points retrieved", {
    expiring_points: rows.map(serializePoint),
    total_expiring: rows.reduce((s, r) => s + (r.points > 0 ? r.points : 0), 0),
    days,
  });
}));

router.post("/charity/points/redeem", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const p = params(req);
  const points = Math.trunc(num(p.points, 0));
  const redemptionType = str(p.redemption_type);
  if (points < 1) return fail(res, "The points must be at least 1.");
  if (!["donation", "reward", "discount"].includes(redemptionType)) {
    return fail(res, "The selected redemption type is invalid.");
  }

  const active = await db.donationPoint.aggregate({ _sum: { points: true }, where: activeWhere(user.id) });
  const activePoints = active._sum.points ?? 0;
  if (activePoints < points) return fail(res, "Insufficient points balance");

  const redemption = await db.donationPoint.create({
    data: {
      userId: user.id,
      donationId: null,
      points: -points,
      type: "redeemed",
      description: optStr(p.description) ?? `Points redeemed for ${redemptionType}`,
      expiresAt: null,
    },
  });
  await db.charityCard.update({
    where: { userId: user.id },
    data: { donationPoints: { decrement: points } },
  }).catch(() => undefined); // card may not exist yet
  await db.user.update({
    where: { id: user.id },
    data: { totalPoints: { decrement: points } },
  });

  return data(res, "Points redeemed successfully", {
    redemption: serializePoint({ ...redemption, donation: null }),
    remaining_points: activePoints - points,
  });
}));

router.get("/charity/points/summary", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [active, lifetime, monthEarned, expiring, recent] = await Promise.all([
    db.donationPoint.aggregate({ _sum: { points: true }, where: activeWhere(user.id) }),
    db.donationPoint.aggregate({ _sum: { points: true }, where: { userId: user.id } }),
    db.donationPoint.aggregate({
      _sum: { points: true },
      where: { userId: user.id, type: "earned", createdAt: { gte: monthStart } },
    }),
    db.donationPoint.aggregate({
      _sum: { points: true },
      where: { ...activeWhere(user.id), expiresAt: { lte: new Date(Date.now() + 30 * 864e5), not: null } },
    }),
    db.donationPoint.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: pointInclude,
    }),
  ]);
  return data(res, "Points summary retrieved", {
    active_points: active._sum.points ?? 0,
    lifetime_points: lifetime._sum.points ?? 0,
    earned_this_month: monthEarned._sum.points ?? 0,
    expiring_in_30_days: expiring._sum.points ?? 0,
    recent_transactions: recent.map(serializePoint),
  });
}));

// ═══════════════════════════ ACHIEVEMENTS ════════════════════════════════════
// The Flutter AchievementService calls via NewApiService (NO authtoken), so
// these resolve the user from the session when present, else `user_id`.

function achievementWire(a: Achievement) {
  const requirement = a.pointsRequired || a.amountRequired || a.countRequired;
  const requirementType =
    a.amountRequired > 0 ? "donation_amount" : a.countRequired > 0 ? "count" : a.pointsRequired > 0 ? "points" : "donation_amount";
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    icon: a.iconUrl ?? "🏆",
    icon_url: a.iconUrl,
    category: a.category,
    tier: a.tier,
    tier_color: LEVEL_COLORS[a.tier] ?? LEVEL_COLORS.bronze,
    reward_points: a.rewardPoints,
    requirement,
    requirement_type: requirementType,
    points_required: a.pointsRequired,
    amount_required: a.amountRequired,
    count_required: a.countRequired,
    is_active: a.isActive,
    created_at: iso(a.createdAt),
    updated_at: iso(a.updatedAt),
  };
}

router.get("/charity/achievements/all", softAuth, h(async (req, res) => {
  const p = params(req);
  const category = optStr(p.category);
  const tier = optStr(p.tier);
  if (category && !["donation", "engagement", "impact", "milestone", "special"].includes(category)) {
    return fail(res, "The selected category is invalid.");
  }
  if (tier && !["bronze", "silver", "gold", "platinum", "diamond"].includes(tier)) {
    return fail(res, "The selected tier is invalid.");
  }

  const rows = await db.achievement.findMany({
    where: { isActive: true, ...(category ? { category } : {}), ...(tier ? { tier } : {}) },
    orderBy: [{ tier: "asc" }, { pointsRequired: "asc" }],
  });
  // NOTE: the Dart AchievementListModel parses `data` as a plain array (the
  // legacy {achievements, total_count} wrapper broke the app) — return array.
  return data(res, "Achievements retrieved", rows.map(achievementWire));
}));

/** Enriched per-user achievement rows (AchievementsController::getMyAchievements). */
async function myAchievementsHandler(req: Request, res: Response) {
  const p = params(req);
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const status = str(p.status) || "all";

  const [rows, userRows] = await Promise.all([
    db.achievement.findMany({ where: { isActive: true }, orderBy: [{ tier: "asc" }, { pointsRequired: "asc" }] }),
    db.userAchievement.findMany({ where: { userId: user.id } }),
  ]);
  const byId = new Map(userRows.map((u) => [u.achievementId, u]));

  let list = rows.map((a) => {
    const ua = byId.get(a.id);
    const isUnlocked = !!ua?.unlockedAt;
    return {
      ...achievementWire(a),
      is_unlocked: isUnlocked,
      is_claimed: ua?.isClaimed ?? false,
      progress: ua?.progress ?? 0,
      unlocked_at: iso(ua?.unlockedAt ?? null),
      claimed_at: iso(ua?.claimedAt ?? null),
    };
  });

  if (status === "unlocked") list = list.filter((a) => a.is_unlocked);
  else if (status === "claimed") list = list.filter((a) => a.is_claimed);
  else if (status === "unclaimed") list = list.filter((a) => a.is_unlocked && !a.is_claimed);
  else if (status === "in_progress") list = list.filter((a) => !a.is_unlocked);

  return data(res, "User achievements retrieved", {
    achievements: list,
    total_unlocked: list.filter((a) => a.is_unlocked).length,
    total_claimed: list.filter((a) => a.is_claimed).length,
  });
}
router.get("/charity/achievements/my-achievements", softAuth, h(myAchievementsHandler));
// The Flutter AchievementService calls `charity/achievements/user` — alias.
router.get("/charity/achievements/user", softAuth, h(myAchievementsHandler));

router.post("/charity/achievements/claim", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const achievementId = Math.trunc(num(params(req).achievement_id, 0));
  if (!achievementId) return fail(res, "The achievement id field is required.");

  const ua = await db.userAchievement.findUnique({
    where: { userId_achievementId: { userId: user.id, achievementId } },
    include: { achievement: true },
  });
  if (!ua) return fail(res, "Achievement not found");
  if (!ua.unlockedAt) return fail(res, "Achievement not unlocked yet");
  if (ua.isClaimed) return fail(res, "Achievement already claimed");

  const claimed = await db.userAchievement.update({
    where: { id: ua.id },
    data: { isClaimed: true, claimedAt: new Date() },
    include: { achievement: true },
  });

  // UserAchievement::claim — award the bonus points row + mirror to card/user.
  if (ua.achievement.rewardPoints > 0) {
    await db.donationPoint.create({
      data: {
        userId: user.id,
        donationId: null,
        points: ua.achievement.rewardPoints,
        type: "bonus",
        description: `Bonus points for achievement: ${ua.achievement.name}`,
      },
    });
    await db.charityCard.update({
      where: { userId: user.id },
      data: { donationPoints: { increment: ua.achievement.rewardPoints } },
    }).catch(() => undefined);
    await db.user.update({
      where: { id: user.id },
      data: { totalPoints: { increment: ua.achievement.rewardPoints } },
    });
  }

  return data(res, "Achievement claimed successfully", {
    achievement: {
      ...achievementWire(claimed.achievement),
      is_unlocked: true,
      is_claimed: claimed.isClaimed,
      progress: claimed.progress,
      unlocked_at: iso(claimed.unlockedAt),
      claimed_at: iso(claimed.claimedAt),
    },
    reward_points: ua.achievement.rewardPoints,
  });
}));

async function progressHandler(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const achievementId = Math.trunc(num(params(req).achievement_id, 0));
  if (!achievementId) return fail(res, "The achievement id field is required.");

  const achievement = await db.achievement.findUnique({ where: { id: achievementId } });
  if (!achievement) return fail(res, "Achievement not found");

  const ua = await db.userAchievement.findUnique({
    where: { userId_achievementId: { userId: user.id, achievementId } },
  });
  const progress = ua?.progress ?? 0;
  const requirement = achievement.pointsRequired || achievement.amountRequired || achievement.countRequired;
  const percentage = requirement > 0 ? Math.min(100, (progress / requirement) * 100) : 0;

  return data(res, "Progress retrieved", {
    achievement: achievementWire(achievement),
    progress,
    requirement,
    percentage: Math.round(percentage * 100) / 100,
    is_unlocked: !!ua?.unlockedAt,
    is_claimed: ua?.isClaimed ?? false,
  });
}
router.get("/charity/achievements/progress", softAuth, h(progressHandler));
// Flutter alias: `${achievementsUser}/progress`
router.get("/charity/achievements/user/progress", softAuth, h(progressHandler));

router.get("/charity/achievements/summary", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");

  const [total, unlocked, claimed, recent] = await Promise.all([
    db.achievement.count({ where: { isActive: true } }),
    db.userAchievement.count({ where: { userId: user.id } }),
    db.userAchievement.count({ where: { userId: user.id, isClaimed: true } }),
    db.userAchievement.findMany({
      where: { userId: user.id },
      orderBy: { unlockedAt: "desc" },
      take: 5,
      include: { achievement: true },
    }),
  ]);
  return data(res, "Achievements summary retrieved", {
    total_achievements: total,
    unlocked_count: unlocked,
    claimed_count: claimed,
    unclaimed_count: unlocked - claimed,
    completion_percentage: total > 0 ? Math.round((unlocked / total) * 10000) / 100 : 0,
    recent_achievements: recent.map((ua) => ({
      ...achievementWire(ua.achievement),
      is_unlocked: true,
      is_claimed: ua.isClaimed,
      progress: ua.progress,
      unlocked_at: iso(ua.unlockedAt),
      claimed_at: iso(ua.claimedAt),
    })),
  });
}));

// ═══════════════════════════ DONATION GOALS ══════════════════════════════════
// The Flutter DonationGoalService also calls via NewApiService (NO authtoken).

function goalWire(g: DonationGoal) {
  const progress = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
  return {
    id: g.id,
    user_id: g.userId,
    title: g.title,
    description: g.description,
    target_amount: g.targetAmount,
    current_amount: g.currentAmount,
    // legacy column was end_date; the Dart model reads `deadline` — send both
    deadline: dateOnly(g.endDate),
    end_date: dateOnly(g.endDate),
    start_date: dateOnly(g.startDate),
    frequency: g.frequency,
    status: g.status,
    is_public: g.isPublic,
    completed_at: iso(g.completedAt),
    created_at: iso(g.createdAt),
    updated_at: iso(g.updatedAt),
    progress_percentage: Math.round(progress * 100) / 100,
    remaining_amount: Math.max(0, g.targetAmount - g.currentAmount),
    is_achieved: g.currentAmount >= g.targetAmount,
  };
}

router.get("/charity/goals/my-goals", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const status = (str(params(req).status) || "all").toLowerCase();

  let where: Record<string, unknown> = { userId: user.id };
  if (status === "active") where = { ...where, status: "active" };
  else if (status === "completed") where = { ...where, status: "completed" };
  else if (status === "expired") where = { ...where, status: "active", endDate: { lt: new Date() } };

  const goals = await db.donationGoal.findMany({ where, orderBy: { createdAt: "desc" } });
  // NOTE: the Dart DonationGoalListModel parses `data` as a plain array (the
  // legacy {goals, total_count} wrapper broke the app) — return array.
  return data(res, "Goals retrieved", goals.map(goalWire));
}));

/**
 * The Flutter DonationGoalService POSTs its LIST call to `charity/goals` (the
 * legacy route table had no POST there) and its CREATE call to the same URL —
 * dispatch on presence of the create fields.
 */
router.post("/charity/goals", softAuth, h(async (req, res) => {
  const p = params(req);
  if (str(p.title).trim() && optStr(p.target_amount)) return goalCreate(req, res);
  return myGoalsPost(req, res);
}));

async function myGoalsPost(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const status = (str(params(req).status) || "all").toLowerCase();

  let where: Record<string, unknown> = { userId: user.id };
  if (status === "active") where = { ...where, status: "active" };
  else if (status === "completed") where = { ...where, status: "completed" };
  else if (status === "expired") where = { ...where, status: "active", endDate: { lt: new Date() } };

  const goals = await db.donationGoal.findMany({ where, orderBy: { createdAt: "desc" } });
  // plain array — DonationGoalListModel contract (see my-goals note)
  return data(res, "Goals retrieved", goals.map(goalWire));
}

async function goalCreate(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const p = params(req);
  const title = str(p.title).trim();
  const targetAmount = num(p.target_amount, -1);
  if (!title) return fail(res, "The title field is required.");
  if (targetAmount < 1 || targetAmount > 99999999.99) return fail(res, "The target amount must be between 1 and 99999999.99.");

  // the app sends `deadline`; the legacy validator read `end_date`
  const endRaw = optStr(p.end_date) ?? optStr(p.deadline);
  if (!endRaw) return fail(res, "The end date field is required.");
  const endDate = new Date(endRaw);
  if (Number.isNaN(endDate.getTime())) return fail(res, "The end date must be a valid date.");

  const startDateRaw = optStr(p.start_date);
  const startDate = startDateRaw && !Number.isNaN(new Date(startDateRaw).getTime()) ? new Date(startDateRaw) : new Date();
  const frequency = str(p.frequency) || "one_time";
  if (!["one_time", "monthly", "yearly"].includes(frequency)) return fail(res, "The selected frequency is invalid.");

  const goal = await db.donationGoal.create({
    data: {
      userId: user.id,
      title,
      description: optStr(p.description),
      targetAmount,
      currentAmount: 0,
      startDate,
      endDate,
      frequency,
      status: "active",
      isPublic: bool(p.is_public),
    },
  });
  return data(res, "Goal created successfully", goalWire(goal));
}

router.post("/charity/goals/create", softAuth, h(goalCreate));

async function goalUpdate(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const p = params(req);
  const goalId = str(p.goal_id) || str((req.params as Record<string, string>).id);
  if (!goalId) return fail(res, "The goal id field is required.");

  const goal = await db.donationGoal.findFirst({ where: { id: goalId, userId: user.id } });
  if (!goal) return fail(res, "Goal not found or access denied");
  if (goal.status === "completed") return fail(res, "Cannot update completed goal");

  const dataToUpdate: Record<string, unknown> = {};
  if (optStr(p.title)) dataToUpdate.title = str(p.title).trim();
  if (p.description !== undefined) dataToUpdate.description = optStr(p.description);
  if (optStr(p.target_amount) !== null) {
    const t = num(p.target_amount, -1);
    if (t < 1) return fail(res, "The target amount must be at least 1.");
    dataToUpdate.targetAmount = t;
  }
  if (optStr(p.end_date) ?? optStr(p.deadline)) {
    const d = new Date(str(optStr(p.end_date) ?? optStr(p.deadline)));
    if (Number.isNaN(d.getTime())) return fail(res, "The end date must be a valid date.");
    dataToUpdate.endDate = d;
  }
  if (p.is_public !== undefined) dataToUpdate.isPublic = bool(p.is_public);
  if (optStr(p.status) && ["active", "completed", "cancelled", "expired"].includes(str(p.status))) {
    dataToUpdate.status = str(p.status);
  }

  const updated = await db.donationGoal.update({ where: { id: goal.id }, data: dataToUpdate });
  return data(res, "Goal updated successfully", goalWire(updated));
}
router.post("/charity/goals/update", softAuth, h(goalUpdate));

router.post("/charity/goals/delete", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const goalId = str(params(req).goal_id);
  if (!goalId) return fail(res, "The goal id field is required.");

  const goal = await db.donationGoal.findFirst({ where: { id: goalId, userId: user.id } });
  if (!goal) return fail(res, "Goal not found or access denied");

  await db.donationGoal.delete({ where: { id: goal.id } });
  return ok(res, "Goal deleted successfully");
}));

router.post("/charity/goals/complete", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const goalId = str(params(req).goal_id);
  if (!goalId) return fail(res, "The goal id field is required.");

  const goal = await db.donationGoal.findFirst({ where: { id: goalId, userId: user.id } });
  if (!goal) return fail(res, "Goal not found or access denied");
  if (goal.status === "completed") return fail(res, "Goal already completed");

  const updated = await db.donationGoal.update({
    where: { id: goal.id },
    data: { status: "completed", completedAt: new Date() },
  });
  return data(res, "Goal marked as completed", goalWire(updated));
}));

router.get("/charity/goals/summary", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");

  const goals = await db.donationGoal.findMany({ where: { userId: user.id } });
  const active = goals.filter((g) => g.status === "active");
  const in7d = new Date(Date.now() + 7 * 864e5);
  return data(res, "Goals summary retrieved", {
    total_goals: goals.length,
    active_goals: active.length,
    completed_goals: goals.filter((g) => g.status === "completed").length,
    goals_near_completion: active.filter((g) => {
      const pct = g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0;
      return pct >= 75;
    }).length,
    upcoming_deadlines: active.filter((g) => g.endDate.getTime() <= in7d.getTime()).length,
  });
}));

// :id aliases LAST — the specific goal paths above must win route matching.
// The app POSTs updates to charity/goals/{id}. A bare detail-style call (only
// user_id) is treated as a no-op update so it can never destroy the goal.
router.post("/charity/goals/:id", softAuth, h(goalUpdate));
router.get("/charity/goals/:id", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const goal = await db.donationGoal.findFirst({
    where: { id: str((req.params as Record<string, string>).id), userId: user.id },
  });
  if (!goal) return fail(res, "Goal not found or access denied");
  return data(res, "Goal retrieved successfully", goalWire(goal));
}));

// ═══════════════════════════ CHARITY EVENTS ══════════════════════════════════
// Legacy middleware: checkHeader + AuthorizeUser. The event service (ApiService)
// sends authtoken; user_id fallback keeps NewApiService-style callers alive.

function eventWire(
  e: CharityEvent,
  opts?: { isRegistered?: boolean; registrationStatus?: string | null; qrCode?: string | null; registeredAt?: Date | null }
) {
  const now = new Date();
  const max = e.maxParticipants;
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    type: e.type,
    location: e.location,
    // Dart reads start_datetime (falls back to event_date) — send both
    start_datetime: iso(e.startDatetime),
    event_date: iso(e.startDatetime),
    end_datetime: iso(e.endDatetime),
    max_participants: max ?? 0,
    current_participants: e.currentParticipants,
    status: e.status,
    requires_registration: e.requiresRegistration,
    requires_qr_checkin: e.requiresQrCheckin,
    points_reward: e.pointsReward,
    image_url: e.imageUrl,
    created_at: iso(e.createdAt),
    updated_at: iso(e.updatedAt),
    is_full: max !== null && max > 0 ? e.currentParticipants >= max : false,
    has_started: e.startDatetime.getTime() <= now.getTime(),
    has_ended: e.endDatetime.getTime() <= now.getTime(),
    available_spots: max === null ? null : Math.max(0, max - e.currentParticipants),
    is_registered: opts?.isRegistered ?? false,
    registration_status: opts?.registrationStatus ?? null,
    qr_code: opts?.qrCode ?? null,
    registered_at: iso(opts?.registeredAt ?? null),
  };
}

async function eventListHandler(req: Request, res: Response) {
  const p = params(req);
  const type = optStr(p.type);
  const status = optStr(p.status)?.toLowerCase();
  if (type && !["fundraiser", "volunteer", "workshop", "awareness", "community"].includes(type)) {
    return fail(res, "The selected type is invalid.");
  }
  if (status && !["upcoming", "ongoing", "completed", "cancelled"].includes(status)) {
    return fail(res, "The selected status is invalid.");
  }

  const now = new Date();
  let where: Record<string, unknown> = {
    ...(type ? { type } : {}),
  };
  if (status === "upcoming") where = { ...where, status: "upcoming", startDatetime: { gt: now } };
  else if (status === "ongoing") where = { ...where, status: "ongoing" };
  else if (status) where = { ...where, status };

  // Flutter getMyRegisteredEvents sends registered_only=true
  const userId = actingUserId(req);
  if (bool(p.registered_only) && userId) {
    const mine = await db.eventParticipant.findMany({
      where: { userId },
      include: { event: true },
      orderBy: { registeredAt: "desc" },
    });
    const events = mine.map((m) => eventWire(m.event, {
      isRegistered: true,
      registrationStatus: m.status,
      qrCode: m.qrCode,
      registeredAt: m.registeredAt,
    }));
    return data(res, "Events retrieved", { events, total_count: events.length });
  }

  const rows = await db.charityEvent.findMany({ where, orderBy: { startDatetime: "asc" } });
  const registrations = userId
    ? await db.eventParticipant.findMany({ where: { userId, eventId: { in: rows.map((r) => r.id) } } })
    : [];
  const byEvent = new Map(registrations.map((r) => [r.eventId, r]));

  const events = rows.map((e) => {
    const reg = byEvent.get(e.id);
    return eventWire(e, {
      isRegistered: !!reg,
      registrationStatus: reg?.status ?? null,
      qrCode: reg?.qrCode ?? null,
      registeredAt: reg?.registeredAt ?? null,
    });
  });
  return data(res, "Events retrieved", { events, total_count: events.length });
}
router.get("/charity/events/all", softAuth, h(eventListHandler));
router.get("/charity/events", softAuth, h(eventListHandler)); // mobile alias

router.get("/charity/events/details", softAuth, h(async (req, res) => {
  const eventId = str(params(req).event_id);
  if (!eventId) return fail(res, "The event id field is required.");
  return eventDetails(req, res, eventId);
}));
// Flutter alias: GET charity/events/{id} — registered at the END of the
// events section (below) so the specific GET paths always win route matching.

async function eventDetails(req: Request, res: Response, eventId: string) {
  const event = await db.charityEvent.findUnique({
    where: { id: eventId },
    include: { participants: { include: { user: true } } },
  });
  if (!event) return fail(res, "Event not found");

  const userId = actingUserId(req);
  const mine = userId ? event.participants.find((pt) => pt.userId === userId) : undefined;

  return data(res, "Event details retrieved", {
    ...eventWire(event, {
      isRegistered: !!mine,
      registrationStatus: mine?.status ?? null,
      qrCode: mine?.qrCode ?? null,
      registeredAt: mine?.registeredAt ?? null,
    }),
    event_participants: event.participants.map((pt) => ({
      id: pt.id,
      event_id: pt.eventId,
      user_id: pt.userId,
      status: pt.status,
      registered_at: iso(pt.registeredAt),
      checked_in_at: iso(pt.checkedInAt),
      qr_code: pt.qrCode,
      user: {
        id: pt.user.id,
        username: pt.user.username ?? "",
        full_name: pt.user.name,
        profile: pt.user.avatar,
      },
    })),
  });
}

async function eventRegister(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const p = params(req);
  const eventId = str(p.event_id) || str((req.params as Record<string, string>).id);
  if (!eventId) return fail(res, "The event id field is required.");

  const event = await db.charityEvent.findUnique({ where: { id: eventId } });
  if (!event) return fail(res, "Event not found");
  if (event.maxParticipants !== null && event.currentParticipants >= event.maxParticipants) {
    return fail(res, "Event is full");
  }

  const existing = await db.eventParticipant.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: user.id } },
  });
  if (existing) return fail(res, "Already registered for this event");

  const qrCode = createHash("md5").update(`${event.id}-${user.id}-${Date.now()}`).digest("hex");
  const participant = await db.eventParticipant.create({
    data: {
      eventId: event.id,
      userId: user.id,
      status: "registered",
      registeredAt: new Date(),
      qrCode,
      notes: optStr(p.notes),
    },
  });
  await db.charityEvent.update({
    where: { id: event.id },
    data: { currentParticipants: { increment: 1 } },
  });

  feedEvent("event.registered", { event_id: event.id, user_id: user.id });
  return data(res, "Successfully registered for event", {
    participant: {
      id: participant.id,
      event_id: participant.eventId,
      user_id: participant.userId,
      status: participant.status,
      registered_at: iso(participant.registeredAt),
      checked_in_at: iso(participant.checkedInAt),
      qr_code: participant.qrCode,
      notes: participant.notes,
    },
    qr_code: participant.qrCode,
  });
}
router.post("/charity/events/register", softAuth, h(eventRegister));
router.post("/charity/events/:id/register", softAuth, h(eventRegister)); // Flutter alias

async function eventCheckIn(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const eventId = str(params(req).event_id) || str((req.params as Record<string, string>).id);
  if (!eventId) return fail(res, "The event id field is required.");

  const participant = await db.eventParticipant.findUnique({
    where: { eventId_userId: { eventId, userId: user.id } },
    include: { event: true },
  });
  if (!participant) return fail(res, "Not registered for this event");

  if (participant.event.requiresQrCheckin && optStr(params(req).qr_code)) {
    if (participant.qrCode !== str(params(req).qr_code)) return fail(res, "Invalid QR code");
  }
  if (participant.status === "attended") return fail(res, "Already checked in");

  const updated = await db.eventParticipant.update({
    where: { id: participant.id },
    data: { status: "attended", checkedInAt: new Date() },
  });

  // EventParticipant::checkIn — award the event's points once
  let pointsEarned = 0;
  if (!participant.pointsAwarded && participant.event.pointsReward > 0) {
    pointsEarned = participant.event.pointsReward;
    await db.donationPoint.create({
      data: {
        userId: user.id,
        donationId: null,
        points: pointsEarned,
        type: "earned",
        description: `Attended event: ${participant.event.title}`,
      },
    });
    await db.eventParticipant.update({ where: { id: participant.id }, data: { pointsAwarded: true } });
    await db.charityCard.update({
      where: { userId: user.id },
      data: { donationPoints: { increment: pointsEarned } },
    }).catch(() => undefined);
    await db.user.update({
      where: { id: user.id },
      data: { totalPoints: { increment: pointsEarned } },
    });
  }

  feedEvent("event.checked_in", { event_id: eventId, user_id: user.id });
  return data(res, "Successfully checked in", {
    participant: {
      id: updated.id,
      event_id: updated.eventId,
      user_id: updated.userId,
      status: updated.status,
      registered_at: iso(updated.registeredAt),
      checked_in_at: iso(updated.checkedInAt),
      qr_code: updated.qrCode,
    },
    points_earned: pointsEarned,
  });
}
router.post("/charity/events/check-in", softAuth, h(eventCheckIn));
router.post("/charity/events/:id/check-in", softAuth, h(eventCheckIn)); // Flutter alias

router.get("/charity/events/my-events", softAuth, h(async (req, res) => {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const status = (str(params(req).status) || "all").toLowerCase();

  const where = { userId: user.id, ...(status !== "all" ? { status } : {}) };
  const rows = await db.eventParticipant.findMany({
    where,
    orderBy: { registeredAt: "desc" },
    include: { event: true },
  });
  // Flattened event wire + registration fields so the app's event list model
  // can parse both the event and the participation state.
  const events = rows.map((r) => ({
    ...eventWire(r.event),
    registration_status: r.status,
    qr_code: r.qrCode,
    registered_at: iso(r.registeredAt),
    checked_in_at: iso(r.checkedInAt),
    is_registered: r.status !== "cancelled",
  }));
  return data(res, "User events retrieved", { events, total_count: events.length });
}));

async function eventCancel(req: Request, res: Response) {
  const user = await requireUserRow(req);
  if (!user) return unauthorized(res, "Invalid or expired token");
  const eventId = str(params(req).event_id) || str((req.params as Record<string, string>).id);
  if (!eventId) return fail(res, "The event id field is required.");

  const participant = await db.eventParticipant.findUnique({
    where: { eventId_userId: { eventId, userId: user.id } },
    include: { event: true },
  });
  if (!participant) return fail(res, "Not registered for this event");
  if (participant.status === "attended") return fail(res, "Cannot cancel after attending");
  if (participant.event.startDatetime.getTime() <= Date.now()) {
    return fail(res, "Cannot cancel after event has started");
  }

  await db.eventParticipant.update({ where: { id: participant.id }, data: { status: "cancelled" } });
  await db.charityEvent.update({
    where: { id: participant.event.id },
    data: { currentParticipants: { decrement: 1 } },
  });
  return ok(res, "Registration cancelled successfully");
}
router.post("/charity/events/cancel", softAuth, h(eventCancel));
router.post("/charity/events/:id/cancel", softAuth, h(eventCancel)); // Flutter alias

// ══════════════════════════ ADMIN: COMMUNITY SECTION ═════════════════════════
// Serves the admin dashboard's Community view (see community-view.tsx). The
// admin client reaches the compat layer by sending the mobile `apikey` header
// (see the file header) plus its normal Authorization JWT; these endpoints are
// role-gated on the session. Mobile requests with a moderator session could
// also reach them — same trust level as the legacy /admin/volunteer routes.

const ADMIN_SELECT_USER = {
  id: true,
  email: true,
  name: true,
  username: true,
  avatar: true,
  about: true,
  phone: true,
  city: true,
  role: true,
  status: true,
  isActive: true,
  isBlock: true,
  isVerified: true,
  userType: true,
  volunteerStatus: true,
  totalPoints: true,
  lifetimeDonated: true,
  impactScore: true,
  currentTier: true,
  memberSince: true,
  followingCount: true,
  followersCount: true,
  createdAt: true,
} as const;

router.get("/community/admin/users", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 50);
  const q = str(p.q).trim();
  const tier = optStr(p.tier);

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where: {
        ...(tier ? { currentTier: tier } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { email: { contains: q } },
                { username: { contains: q } },
                { city: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      select: ADMIN_SELECT_USER,
    }),
    db.user.count({
      where: {
        ...(tier ? { currentTier: tier } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { email: { contains: q } },
                { username: { contains: q } },
                { city: { contains: q } },
              ],
            }
          : {}),
      },
    }),
  ]);

  // per-user activity aggregates for the visible page
  const users = [];
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
    users.push({
      ...u,
      member_since: dateOnly(u.memberSince),
      created_at: iso(u.createdAt),
      post_count: postCount,
      cause_count: causeCount,
      donation_count: donationAgg._count._all,
      donation_total: donationAgg._sum.amount ?? 0,
    });
  }
  return data(res, "Users retrieved", { users, total_count: total });
}));

router.get("/community/admin/posts", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 30);
  const q = str(p.q).trim();
  const type = optStr(p.type);
  if (type && !["normal", "cause"].includes(type)) return fail(res, "The selected type is invalid.");

  const where = {
    ...(type ? { type } : {}),
    ...(q ? { desc: { contains: q } } : {}),
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
      ...serializeCause(r),
      comment_count: r._count.comments,
      like_count: r._count.likes,
      report_count: r._count.reports,
      follower_count: r._count.causeFollowers,
      donation_count: r._count.donations,
    })),
    total_count: total,
  });
}));

router.post("/community/admin/posts/moderate", mobileAuth, h(async (req, res) => {
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

router.get("/community/admin/reports", mobileAuth, h(async (req, res) => {
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

router.post("/community/admin/reports/resolve", mobileAuth, h(async (req, res) => {
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

router.get("/community/admin/causes", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 30);
  const q = str(p.q).trim();

  const where = {
    type: "cause" as const,
    ...(q ? { desc: { contains: q } } : {}),
  };
  const [rows, total, agg] = await Promise.all([
    db.communityPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: start,
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
  return data(res, "Causes retrieved", {
    causes: rows.map((r) => {
      const goal = r.goalAmount ?? 0;
      return {
        ...serializeCause(r),
        follower_count: r._count.causeFollowers,
        donation_count: r._count.donations,
        progress_percentage: goal > 0 ? Math.round(Math.min(100, (r.raisedAmount / goal) * 100) * 100) / 100 : 0,
      };
    }),
    total_count: total,
    total_raised_all: agg._sum.amount ?? 0,
  });
}));

router.get("/community/admin/donations", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 30);
  const causePostId = optStr(p.cause_post_id);

  const where = {
    causePostId: { not: null },
    ...(causePostId ? { causePostId } : {}),
  };
  const [rows, total, agg] = await Promise.all([
    db.donation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: { donor: true },
    }),
    db.donation.count({ where }),
    db.donation.aggregate({ _sum: { amount: true }, where: { ...where, paymentStatus: "COMPLETED" } }),
  ]);
  const donations = await Promise.all(
    rows.map(async (d) => ({
      ...serializeDonation({ ...d, user: d.donor ? legacyUser(d.donor) : null, cause: await causeWireFor(d.causePostId, true) }),
    }))
  );
  return data(res, "Mobile donations retrieved", {
    donations,
    total_count: total,
    total_raised: agg._sum.amount ?? 0,
  });
}));

// Flutter alias: GET charity/events/{id} — LAST so /details, /my-events, /all
// and /events (list) always win route matching.
router.get("/charity/events/:id", softAuth, h(async (req, res) => {
  return eventDetails(req, res, str((req.params as Record<string, string>).id));
}));

// (const export above is the module surface — ../index.ts imports `router`).
