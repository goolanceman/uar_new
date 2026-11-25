/**
 * Mobile compat routes — auth-users module.
 *
 * Ports the legacy Laravel controllers (see ../index.ts module map):
 *   - AuthController          → /auth/*
 *   - UserController          → addUser, editProfile, follow/unfollow, profile
 *                               fetch/search, blocking, moderation endpoints
 *   - ProfileVerificationController → /profileVerification
 *   - NotificationController  → /notifications/*
 *   - AdminController         → /fetchPlatformNotification
 *   - VolunteerApplicationController → /user/select-type, /volunteer/*,
 *                               /admin/volunteer/*
 *
 * Wire contract: every response is { status: boolean, message: string, data? };
 * business failures are HTTP 200 with status:false — only auth failures 401
 * (see lib/mobile/compat.ts). IDs are the User row cuids sent as strings.
 */
import { Router, type Request, type Response } from "express";
import { randomInt, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  ok,
  data,
  fail,
  mobileAuth,
  session,
  requireModerator,
  legacyUser,
  params,
  str,
  num,
  optStr,
  optNum,
  bool,
  csvToInts,
  csvHas,
  page,
  sendPush,
  storeUpload,
  wrap,
  mobileErrorHandler,
} from "@/lib/mobile/compat";
import { issueToken, hashPassword, verifyPassword } from "@/lib/session";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { validEmail } from "@/lib/validators";
import { loadSettings, emailShell, sendEmail } from "@/lib/notify";
import { multipart } from "@/lib/multipart";

export const router = Router();

/** wrap() single-handler form — lets middleware (mobileAuth) run first. */
function h(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) =>
    Promise.resolve(handler(req, res)).catch((e) => mobileErrorHandler(e, res));
}

/** 7-day session window — matches legacy Sanctum token expiry (AuthController). */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 15 * 60 * 1000; // password-reset / verification codes

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Legacy CSV columns holding STRING ids (block_user_ids) — keep as strings. */
function csvStrs(v: unknown): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Laravel-style "The X field is required." for the first missing key. */
function firstMissing(p: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = p[k];
    if (v === undefined || v === null || str(v).trim() === "") {
      const label = k.replace(/_/g, " ");
      return `The ${label} field is required.`;
    }
  }
  return null;
}

/** Unique username generated from an email — AuthController::generateUsername. */
async function generateUsername(email: string): Promise<string> {
  const base = str(email.split("@")[0]).toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  let username = base;
  let counter = 1;
  while (await db.user.findFirst({ where: { username }, select: { id: true } })) {
    username = `${base}${counter}`;
    counter++;
  }
  return username;
}

// ─── serialization helpers (legacy Eloquent shapes) ──────────────────────────

function legacyFollowRow(f: {
  id: string;
  myUserId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}, user?: unknown) {
  return {
    id: f.id,
    my_user_id: f.myUserId,
    user_id: f.userId,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
    ...(user !== undefined ? { user } : {}),
  };
}

function legacyStoryRow(s: {
  id: string;
  userId: string;
  type: number;
  duration: number;
  content: string;
  thumbnail: string | null;
  viewByUserIds: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    user_id: s.userId,
    type: s.type,
    duration: s.duration,
    content: s.content,
    thumbnail: s.thumbnail,
    view_by_user_ids: s.viewByUserIds,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

function legacyInterestRow(i: { id: number; title: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: i.id,
    title: i.title,
    created_at: i.createdAt.toISOString(),
    updated_at: i.updatedAt.toISOString(),
  };
}

function legacyRoomRow(r: {
  id: string;
  adminId: string;
  conversationId: string | null;
  photo: string | null;
  title: string;
  desc: string;
  interestIds: string;
  isPrivate: number;
  isJoinRequestEnable: number;
  totalMember: number;
  createdAt: Date;
  updatedAt: Date;
}) {
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

function legacyReelRow(r: {
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
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function legacyCommentRow(c: {
  id: string;
  userId: string;
  postId: string;
  desc: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    user_id: c.userId,
    post_id: c.postId,
    desc: c.desc,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

function legacyReelCommentRow(c: {
  id: string;
  userId: string;
  reelId: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    user_id: c.userId,
    reel_id: c.reelId,
    description: c.description,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

type PostWithRelations = Awaited<ReturnType<typeof db.communityPost.findFirstOrThrow>> & {
  content: Array<{
    id: string;
    postId: string;
    contentType: number;
    content: string;
    thumbnail: string | null;
    audioWaves: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  user: Parameters<typeof legacyUser>[0];
};

function legacyPostRow(
  p: PostWithRelations,
  opts?: { isLike?: number; commentsCount?: number; likesCount?: number; reactionType?: string | null }
) {
  return {
    id: p.id,
    user_id: p.userId,
    desc: p.desc,
    type: p.type,
    goal_amount: p.goalAmount,
    raised_amount: p.raisedAmount,
    deadline: iso(p.deadline),
    is_verified: p.isVerified ? 1 : 0,
    category_id: p.categoryId,
    is_emergency: p.isEmergency ? 1 : 0,
    context_label: p.contextLabel,
    impact_label: p.impactLabel,
    community_label: p.communityLabel,
    tags: p.tags,
    comments_count: opts?.commentsCount ?? p.commentsCount,
    likes_count: opts?.likesCount ?? p.likesCount,
    link_preview_json: p.linkPreviewJson,
    interest_ids: p.interestIds,
    is_restricted: p.isRestricted,
    is_like: opts?.isLike ?? 0,
    reaction_type: opts?.reactionType ?? null,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    content: p.content.map((c) => ({
      id: c.id,
      post_id: c.postId,
      content_type: c.contentType,
      content: c.content,
      thumbnail: c.thumbnail,
      audio_waves: c.audioWaves,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    })),
    user: legacyUser(p.user),
  };
}

/** VolunteerApplication wire shape — JSON array columns are decoded for the
 *  Dart model (List<String>.from(json['skills']) etc.), status is lowercase. */
const APP_STATUS_WIRE: Record<string, string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};
const APP_STATUS_DB: Record<string, "PENDING" | "APPROVED" | "REJECTED"> = {
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
};

function jsonArr(v: unknown): string[] | null {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.map((x) => str(x));
  const s = str(v).trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map((x: unknown) => str(x));
  } catch {
    /* plain string value */
  }
  return [s];
}

type VolunteerAppRow = Awaited<ReturnType<typeof db.volunteerApplication.findFirstOrThrow>>;

function legacyVolunteerApp(a: VolunteerAppRow) {
  return {
    id: a.id,
    user_id: a.userId,
    skills: jsonArr(a.skills),
    custom_skills: jsonArr(a.customSkills),
    availability: jsonArr(a.availability),
    service_areas: jsonArr(a.serviceAreas),
    is_flexible: a.isFlexible,
    city: a.city,
    state: a.state,
    country: a.country,
    postal_code: a.postalCode,
    latitude: a.latitude,
    longitude: a.longitude,
    willing_to_travel: a.willingToTravel,
    max_travel_distance: a.maxTravelDistance,
    remote_volunteering: a.remoteVolunteering,
    motivation: a.motivation,
    prior_experience: a.priorExperience,
    emergency_contact: a.emergencyContact,
    emergency_phone: a.emergencyPhone,
    address_line1: a.addressLine1,
    address_line2: a.addressLine2,
    status: APP_STATUS_WIRE[a.status] ?? a.status.toLowerCase(),
    review_note: a.reviewNote,
    reviewed_by: a.reviewedBy,
    reviewed_at: iso(a.reviewedAt),
    rejection_reason: a.rejectionReason,
    admin_notes: a.adminNotes,
    submitted_at: iso(a.createdAt),
    created_at: iso(a.createdAt),
    updated_at: null, // legacy updated_at column — not present on the new model
  };
}

// ─── multipart file helpers (legacy saveFileAndGivePath) ─────────────────────

interface MulterFileLike {
  fieldname?: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

function findFieldFile(req: Request, fieldname: string): File | null {
  const files = ((req as Request & { files?: unknown }).files ?? []) as MulterFileLike[];
  const f = files.find((x) => x.fieldname === fieldname);
  if (!f) return null;
  return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
}

async function saveFieldFile(req: Request, fieldname: string, folder: string): Promise<string | null> {
  const file = findFieldFile(req, fieldname);
  if (!file) return null;
  return storeUpload(req, file, folder);
}

// ─── OTP email (mirrors routes/auth.ts — shared PasswordReset rows) ──────────

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

async function issueOtpEmail(email: string, userName: string, purpose: "reset" | "verify"): Promise<void> {
  const otp = generateOtp();
  // Supersede any previous pending codes for this email.
  await db.passwordReset.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
  await db.passwordReset.create({
    data: {
      email,
      otpHash: hashPassword(otp), // scrypt — plaintext OTP never stored
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  const map = await loadSettings();
  const org = {
    name: map["org.name"] || "United Angel Reach",
    footer: map["receipts.footer"] || undefined,
  };
  const subject = purpose === "reset" ? `Your password reset code — ${org.name}` : `Your verification code — ${org.name}`;
  const bodyHtml = `
    <p style="margin:0 0 8px;">Hello ${userName},</p>
    <p style="margin:0 0 12px;">Use the verification code below — it expires in <strong>15 minutes</strong>.</p>
    <p style="margin:16px 0;text-align:center;">
      <span style="display:inline-block;font-size:28px;letter-spacing:8px;font-weight:700;color:#064e3b;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 24px;">${otp}</span>
    </p>
    <p style="margin:0;">— The ${org.name} Team</p>`;
  const out = await sendEmail(map, { to: email, subject, html: emailShell(subject, bodyHtml, org) });
  if (out.skipped) {
    // No transport configured — documented DEV behavior: logged server-side,
    // never returned in the API response.
    console.log(`[mobile] ${purpose === "reset" ? "password reset" : "verification"} OTP for ${email}: ${otp} (email transport not configured)`);
  } else if (!out.ok) {
    console.error(`[mobile] ${purpose} OTP email failed:`, out.message);
  }
}

// ─── account deletion cascade (legacy UserController::deleteUser) ────────────

async function deleteUserCascade(userId: string): Promise<void> {
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
  await db.communityComment.deleteMany({ where: { userId } }); // comments on other people's posts
  await db.communityStory.deleteMany({ where: { userId } });
  await db.profileVerification.deleteMany({ where: { userId } });
  await db.communityReport.deleteMany({ where: { userId } }); // reports about this user
  await db.communityRoomUser.deleteMany({ where: { userId } });
  await db.savedNotification.deleteMany({ where: { myUserId: userId } });
  await db.savedNotification.deleteMany({ where: { userId } });
  await db.notification.deleteMany({ where: { userId } });
  await db.volunteer.deleteMany({ where: { userId } }); // portal profile (Restrict FK)

  await db.user.delete({ where: { id: userId } });
}

// ─── moderator gate (legacy param-based is_moderator check) ──────────────────

async function moderatorOrFail(req: Request, res: Response) {
  const p = params(req);
  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) {
    fail(res, "User not found");
    return null;
  }
  if (user.isModerator !== 1) {
    fail(res, "User is not a Moderator");
    return null;
  }
  return user;
}

// ─── saved-notification feed (UserController::fetchUserNotification) ─────────

async function savedNotificationFeed(myUserId: string, start: number, limit: number) {
  const rows = await db.savedNotification.findMany({
    where: { myUserId },
    orderBy: { createdAt: "desc" },
    skip: start,
    take: limit,
  });

  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const postIds = [...new Set(rows.map((r) => r.postId).filter((v): v is string => !!v))];
  const roomIds = [...new Set(rows.map((r) => r.roomId).filter((v): v is string => !!v))];
  const reelIds = [...new Set(rows.map((r) => r.reelId).filter((v): v is string => !!v))];

  const [users, posts, rooms, reels] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } } }) : Promise.resolve([]),
    postIds.length
      ? db.communityPost.findMany({ where: { id: { in: postIds } }, include: { content: true, user: true } })
      : Promise.resolve([]),
    roomIds.length ? db.communityRoom.findMany({ where: { id: { in: roomIds } } }) : Promise.resolve([]),
    reelIds.length ? db.communityReel.findMany({ where: { id: { in: reelIds } } }) : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((u) => [u.id, legacyUser(u)]));
  const postMap = new Map(posts.map((p) => [p.id, legacyPostRow(p as PostWithRelations)]));
  const roomMap = new Map(rooms.map((r) => [r.id, legacyRoomRow(r)]));
  const reelMap = new Map(reels.map((r) => [r.id, legacyReelRow(r)]));

  return rows.map((r) => ({
    id: r.id,
    my_user_id: r.myUserId,
    user_id: r.userId,
    post_id: r.postId,
    room_id: r.roomId,
    comment_id: r.commentId,
    reel_id: r.reelId,
    reel_comment_id: r.reelCommentId,
    type: r.type,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    user: r.userId ? (userMap.get(r.userId) ?? null) : null,
    post: r.postId ? (postMap.get(r.postId) ?? null) : null,
    room: r.roomId ? (roomMap.get(r.roomId) ?? null) : null,
    reel: r.reelId ? (reelMap.get(r.reelId) ?? null) : null,
  }));
}

// ═══════════════════════════════════ AUTH (AuthController.php) ═══════════════

// POST /auth/register
wrap(router, "post", "/auth/register", async (req, res) => {
  const p = params(req);
  const name = str(p.name).trim();
  const email = str(p.email).trim().toLowerCase();
  const password = str(p.password);

  const missing = firstMissing(p, ["name", "email", "password"]);
  if (missing) return fail(res, missing);
  if (!validEmail(email)) return fail(res, "The email must be a valid email address.");
  if (password.length < 8) return fail(res, "The password must be at least 8 characters.");

  const ip = clientIp(req.headers);
  if (!checkRateLimit(`m:register:ip:${ip}`, 10, 10 * 60 * 1000).allowed)
    return fail(res, "Too many attempts. Please try again later.");

  const existing = await db.user.findFirst({ where: { email } });
  if (existing) return fail(res, "The email has already been taken.");

  const username = await generateUsername(email);
  const user = await db.user.create({
    data: {
      name,
      email,
      password: hashPassword(password),
      username,
      loginType: 2, // email/password (legacy identity = email)
      deviceType: num(p.device_type),
      deviceToken: optStr(p.device_token),
      status: "ACTIVE",
    },
  });

  const token = issueToken({ userId: user.id, role: user.role, name: user.name, email: user.email });
  return data(res, "Registration successful", {
    user: legacyUser(user),
    token,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
});

// POST /auth/login
wrap(router, "post", "/auth/login", async (req, res) => {
  const p = params(req);
  const email = str(p.email).trim().toLowerCase();
  const password = str(p.password);

  const missing = firstMissing(p, ["email", "password"]);
  if (missing) return fail(res, missing);
  if (!validEmail(email)) return fail(res, "The email must be a valid email address.");

  // Throttle brute force by IP and by the targeted account (mirrors routes/auth.ts).
  const ip = clientIp(req.headers);
  if (!checkRateLimit(`m:login:ip:${ip}`, 20, 10 * 60 * 1000).allowed)
    return fail(res, "Too many attempts. Please try again later.");
  if (!checkRateLimit(`m:login:email:${email}`, 10, 10 * 60 * 1000).allowed)
    return fail(res, "Too many attempts. Please try again later.");

  const user = await db.user.findFirst({ where: { email } });
  if (!user || !verifyPassword(password, user.password)) return fail(res, "Invalid credentials");

  // Update device token / type when provided (legacy login behavior).
  const upd: Record<string, unknown> = {};
  if (p.device_token !== undefined && str(p.device_token) !== "") upd.deviceToken = str(p.device_token);
  if (p.device_type !== undefined && p.device_type !== null && str(p.device_type) !== "") upd.deviceType = num(p.device_type);
  // Upgrade legacy plain-text passwords to scrypt on successful login.
  if (!user.password.includes(":")) upd.password = hashPassword(password);
  if (Object.keys(upd).length) await db.user.update({ where: { id: user.id }, data: upd });

  const fresh = Object.keys(upd).length ? await db.user.findUniqueOrThrow({ where: { id: user.id } }) : user;
  const token = issueToken({ userId: fresh.id, role: fresh.role, name: fresh.name, email: fresh.email });
  return data(res, "Login successful", {
    user: legacyUser(fresh),
    token,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
});

// POST /auth/logout — revoke every token (revocation watermark, see session.ts).
router.post(
  "/auth/logout",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    await db.user.update({ where: { id: s.userId }, data: { tokenValidAfter: new Date() } });
    return ok(res, "Logged out successfully");
  })
);

// POST /auth/refresh — sliding 7-day expiry.
router.post(
  "/auth/refresh",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const token = issueToken(s);
    return data(res, "Token refreshed", {
      token,
      expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    });
  })
);

// GET /auth/me
router.get(
  "/auth/me",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const user = await db.user.findUnique({ where: { id: s.userId } });
    if (!user) return fail(res, "User not found");
    return data(res, "User retrieved", { user: legacyUser(user) });
  })
);

// POST /auth/forgot-password — OTP by email only (never in the response).
wrap(router, "post", "/auth/forgot-password", async (req, res) => {
  const p = params(req);
  const email = str(p.email).trim().toLowerCase();
  if (!email) return fail(res, "The email field is required.");
  if (!validEmail(email)) return fail(res, "The email must be a valid email address.");

  if (!checkRateLimit(`m:forgot-password:${email}:${clientIp(req.headers)}`, 5, 60 * 60 * 1000).allowed)
    return fail(res, "Too many reset requests. Please try again later.");

  const user = await db.user.findFirst({ where: { email } });
  if (!user) return fail(res, "User not found with this email");

  await issueOtpEmail(email, user.name, "reset");
  // Legacy returned the OTP in data.otp — deliberately dropped (it leaked the
  // code); the empty string keeps the Dart parser (`response['data']['otp'] ?? ''`) alive.
  return data(res, "OTP sent to email", { otp: "" });
});

// POST /auth/reset-password
wrap(router, "post", "/auth/reset-password", async (req, res) => {
  const p = params(req);
  const email = str(p.email).trim().toLowerCase();
  const otp = str(p.otp).trim();
  const password = str(p.password);

  if (!email) return fail(res, "The email field is required.");
  if (!/^\d{6}$/.test(otp)) return fail(res, "The otp must be 6 characters.");
  if (password.length < 6) return fail(res, "The password must be at least 6 characters.");

  if (!checkRateLimit(`m:reset-password:${email}:${clientIp(req.headers)}`, 5, 60 * 60 * 1000).allowed)
    return fail(res, "Too many attempts. Please request a new code.");

  const user = await db.user.findFirst({ where: { email } });
  if (!user) return fail(res, "Invalid or expired OTP");

  const pending = await db.passwordReset.findMany({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const match = pending.find((row) => verifyPassword(otp, row.otpHash));
  if (!match) {
    const expired = await db.passwordReset.findFirst({ where: { email, usedAt: null } });
    return fail(res, expired ? "Invalid OTP" : "Invalid or expired OTP");
  }

  await db.user.update({
    where: { id: user.id },
    data: { password: hashPassword(password), tokenValidAfter: new Date() },
  });
  await db.passwordReset.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
  return ok(res, "Password reset successful");
});

// POST /auth/send-verification-otp
wrap(router, "post", "/auth/send-verification-otp", async (req, res) => {
  const p = params(req);
  const email = str(p.email).trim().toLowerCase();
  if (!email) return fail(res, "The email field is required.");
  if (!validEmail(email)) return fail(res, "The email must be a valid email address.");

  const user = await db.user.findFirst({ where: { email } });
  if (!user) return fail(res, "User not found with this email");
  if (user.emailVerifiedAt) return fail(res, "Email already verified");

  await issueOtpEmail(email, user.name, "verify");
  return data(res, "Verification OTP sent to email", { otp: "" });
});

// POST /auth/verify-email
wrap(router, "post", "/auth/verify-email", async (req, res) => {
  const p = params(req);
  const email = str(p.email).trim().toLowerCase();
  const otp = str(p.otp).trim();

  if (!email) return fail(res, "The email field is required.");
  if (!/^\d{6}$/.test(otp)) return fail(res, "The otp must be 6 characters.");

  const pending = await db.passwordReset.findMany({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const match = pending.find((row) => verifyPassword(otp, row.otpHash));
  if (!match) return fail(res, "Invalid or expired OTP");

  const user = await db.user.findFirst({ where: { email } });
  if (!user) return fail(res, "User not found");

  const updated = await db.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date() },
  });
  await db.passwordReset.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
  return data(res, "Email verified successfully", { user: legacyUser(updated) });
});

// POST /auth/delete-account (auth required; optional password confirmation)
router.post(
  "/auth/delete-account",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const p = params(req);
    const user = await db.user.findUnique({ where: { id: s.userId } });
    if (!user) return fail(res, "User not authenticated");

    const password = p.password === undefined || p.password === null ? "" : str(p.password);
    if (password !== "" && !verifyPassword(password, user.password)) return fail(res, "Invalid password");

    await deleteUserCascade(user.id);
    return ok(res, "Account deleted successfully");
  })
);

// ═══════════════════════════════════ USERS (UserController.php) ══════════════

// POST /addUser — legacy social/email identity sign-in-or-register.
wrap(router, "post", "/addUser", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["identity", "login_type", "device_type", "device_token"]);
  if (missing) return fail(res, missing);

  const identity = str(p.identity).trim();
  // New schema stores the identity IN the (unique) email column — legacyUser
  // maps identity ← email, so the app sees the same value back.
  const email = identity.toLowerCase();

  const existing = await db.user.findFirst({ where: { email } });
  if (existing) {
    const updated = await db.user.update({
      where: { id: existing.id },
      data: { deviceType: num(p.device_type), deviceToken: str(p.device_token) },
    });
    return res.json({ status: false, message: "User is already exist", data: legacyUser(updated) });
  }

  const username = await generateUsername(email);
  const user = await db.user.create({
    data: {
      email,
      name: str(p.full_name).trim() || "User",
      password: hashPassword(randomBytes(24).toString("hex")), // social logins have no password
      username,
      loginType: num(p.login_type, 2),
      deviceType: num(p.device_type),
      deviceToken: str(p.device_token),
      status: "ACTIVE",
    },
  });
  return data(res, "User Added succesfully", legacyUser(user));
});

// POST /editProfile (multipart or JSON)
router.post(
  "/editProfile",
  multipart,
  h(async (req, res) => {
    const p = params(req);
    const userId = str(p.user_id);
    if (!userId) return fail(res, "The user id field is required.");

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return fail(res, "User Not Found");

    const upd: Record<string, unknown> = {};
    if (p.username !== undefined) {
      const username = str(p.username).trim();
      if (username && username !== user.username) {
        const taken = await db.user.findFirst({ where: { username, id: { not: userId } }, select: { id: true } });
        if (taken) return fail(res, "Username is not available");
        upd.username = username;
      }
    }
    const profileUrl = await saveFieldFile(req, "profile", "profiles");
    if (profileUrl) upd.avatar = profileUrl;
    const bgUrl = await saveFieldFile(req, "background_image", "profiles");
    if (bgUrl) upd.backgroundImage = bgUrl;
    if (p.bio !== undefined) upd.about = str(p.bio);
    if (p.full_name !== undefined) upd.name = str(p.full_name);
    if (p.interest_ids !== undefined) upd.interestIds = str(p.interest_ids);
    if (p.block_user_ids !== undefined) upd.blockUserIds = str(p.block_user_ids);
    if (p.saved_music_ids !== undefined) upd.savedMusicIds = str(p.saved_music_ids);
    if (p.saved_reel_ids !== undefined) upd.savedReelIds = str(p.saved_reel_ids);
    if (p.is_push_notifications !== undefined) upd.isPushNotifications = num(p.is_push_notifications);
    if (p.is_invited_to_room !== undefined) upd.isInvitedToRoom = num(p.is_invited_to_room);
    if (p.is_verified !== undefined) upd.isVerified = num(p.is_verified);
    if (p.device_token !== undefined) upd.deviceToken = optStr(p.device_token);

    const updated = Object.keys(upd).length
      ? await db.user.update({ where: { id: userId }, data: upd })
      : user;
    return data(res, "User Updated Successfully", legacyUser(updated));
  })
);

// POST /followUser
wrap(router, "post", "/followUser", async (req, res) => {
  const p = params(req);
  const myId = str(p.my_user_id);
  const targetId = str(p.user_id);

  const fromUser = await db.user.findUnique({ where: { id: myId } });
  const toUser = await db.user.findUnique({ where: { id: targetId } });
  if (!fromUser || !toUser) return fail(res, "User Not Found");
  if (myId === targetId) return fail(res, "Lol You did not follow yourself");

  const existing = await db.userFollow.findFirst({
    where: { myUserId: myId, userId: targetId },
  });
  if (existing) return fail(res, "User is Already in following list");
  if (csvHas(fromUser.blockUserIds, targetId)) return fail(res, "You blocked this User");

  const follow = await db.userFollow.create({ data: { myUserId: myId, userId: targetId } });
  await db.user.update({ where: { id: myId }, data: { followingCount: { increment: 1 } } });
  await db.user.update({ where: { id: targetId }, data: { followersCount: { increment: 1 } } });

  if (toUser.isPushNotifications === 1) {
    await sendPush({
      userId: toUser.id,
      title: process.env.APP_NAME || "Chatter",
      body: `${fromUser.name} has stared following you.`, // legacy typo preserved
    });
  }
  await db.savedNotification.create({
    data: { myUserId: targetId, userId: myId, type: 1 }, // notificationTypeFollow
  });

  return data(res, "User Added in Following List", legacyFollowRow(follow, legacyUser(fromUser)));
});

// POST /fetchFollowingList — rows where my_user_id = me (who I follow).
wrap(router, "post", "/fetchFollowingList", async (req, res) => {
  const p = params(req);
  const myId = str(p.my_user_id);
  const me = await db.user.findUnique({ where: { id: myId } });
  if (!me) return fail(res, "User not found");

  const { start, limit } = page(req);
  const edges = await db.userFollow.findMany({
    where: {
      myUserId: myId,
      followed: { isBlock: 0 },
      userId: { notIn: csvStrs(me.blockUserIds) },
    },
    include: { followed: true },
    skip: start,
    take: limit,
  });
  return data(res, "Fetch Following List", edges.map((e) => legacyUser(e.followed)));
});

// POST /fetchFollowersList — rows where user_id = me (who follows me).
wrap(router, "post", "/fetchFollowersList", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");

  const keyword = str(p.keyword).trim();
  const { start, limit } = page(req);
  const edges = await db.userFollow.findMany({
    where: {
      userId,
      follower: {
        isBlock: 0,
        ...(keyword
          ? {
              OR: [
                { name: { contains: keyword, mode: "insensitive" } },
                { username: { contains: keyword, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    },
    include: { follower: true },
    skip: start,
    take: limit,
  });
  return data(res, "Fetch Followers List", edges.map((e) => legacyUser(e.follower)));
});

// POST /unfollowUser
wrap(router, "post", "/unfollowUser", async (req, res) => {
  const p = params(req);
  const myId = str(p.my_user_id);
  const targetId = str(p.user_id);

  const me = await db.user.findUnique({ where: { id: myId } });
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!me || !target) return fail(res, "User Not Found");
  if (myId === targetId)
    return fail(res, "Lol You did not Remove yourself, Bcz You dont follow yourself");

  const follow = await db.userFollow.findFirst({ where: { myUserId: myId, userId: targetId } });
  if (!follow) return fail(res, "User Not Found");

  await db.user.updateMany({
    where: { id: myId, followingCount: { gt: 0 } },
    data: { followingCount: { decrement: 1 } },
  });
  await db.user.updateMany({
    where: { id: targetId, followersCount: { gt: 0 } },
    data: { followersCount: { decrement: 1 } },
  });
  await db.savedNotification.deleteMany({
    where: { myUserId: targetId, userId: myId, type: 1 }, // notificationTypeFollow
  });
  await db.userFollow.delete({ where: { id: follow.id } });

  return data(res, "Unfollow user", legacyFollowRow(follow));
});

// POST /checkUsername
wrap(router, "post", "/checkUsername", async (req, res) => {
  const p = params(req);
  const username = str(p.username);
  if (!username) return ok(res, "Username is available");
  const taken = await db.user.findFirst({ where: { username }, select: { id: true } });
  if (!taken) return ok(res, "Username is available");
  return fail(res, "Username is not available");
});

// POST /fetchRandomProfile — random unblocked profile matching my interests.
wrap(router, "post", "/fetchRandomProfile", async (req, res) => {
  const p = params(req);
  const myId = str(p.my_user_id);
  if (!myId) return fail(res, "The my user id field is required.");

  const me = await db.user.findUnique({ where: { id: myId } });
  if (!me) return fail(res, "User not Found");

  const interestIds = csvStrs(me.interestIds);
  if (!interestIds.length) return fail(res, "Interests not found");

  const blockIds = csvStrs(me.blockUserIds);
  const candidates = await db.user.findMany({
    where: { isBlock: 0, id: { not: myId, notIn: blockIds }, about: { not: null } },
    take: 200,
  });

  let randomUser = null;
  for (const interestId of shuffle(interestIds)) {
    const matches = candidates.filter((c) => csvHas(c.interestIds, interestId));
    if (matches.length) {
      randomUser = matches[Math.floor(Math.random() * matches.length)];
      break;
    }
  }
  if (!randomUser && candidates.length)
    randomUser = candidates[Math.floor(Math.random() * candidates.length)];

  return data(res, "Random profile found", randomUser ? legacyUser(randomUser) : null);
});

// POST /reportUser — CommunityReport type 2 (user).
wrap(router, "post", "/reportUser", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["user_id", "reason", "desc"]);
  if (missing) return fail(res, missing);

  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "User Not Found");
  if (user.isBlock === 1) return fail(res, "User is already block");

  const report = await db.communityReport.create({
    data: { type: 2, userId: user.id, reason: str(p.reason), desc: str(p.desc) },
  });
  return data(res, "User Report Added Successfully", {
    id: report.id,
    type: report.type,
    user_id: report.userId,
    reason: report.reason,
    desc: report.desc,
    created_at: report.createdAt.toISOString(),
    updated_at: report.updatedAt.toISOString(),
  });
});

// POST /fetchBlockedUserList
wrap(router, "post", "/fetchBlockedUserList", async (req, res) => {
  const p = params(req);
  const myId = str(p.my_user_id);
  if (!myId) return fail(res, "The my user id field is required.");

  const me = await db.user.findUnique({ where: { id: myId } });
  if (!me) return fail(res, "User not found");

  const blockIds = csvStrs(me.blockUserIds);
  const blocked = blockIds.length
    ? await db.user.findMany({ where: { id: { in: blockIds } } })
    : [];
  return data(res, "Fetch blocked user list successfully", blocked.map(legacyUser));
});

// POST /fetchPostByUser
wrap(router, "post", "/fetchPostByUser", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["user_id", "my_user_id"]);
  if (missing) return fail(res, missing);

  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "User not found");

  const { start, limit } = page(req);
  const posts = await db.communityPost.findMany({
    where: { userId: user.id },
    include: { content: true, user: true },
    orderBy: { createdAt: "desc" },
    skip: start,
    take: limit,
  });

  // Legacy recomputes counts excluding blocked users.
  const blockedUsers = await db.user.findMany({ where: { isBlock: 1 }, select: { id: true } });
  const blockedIds = blockedUsers.map((b) => b.id);

  const out = [];
  for (const post of posts) {
    const like = await db.communityLike.findFirst({
      where: { userId: str(p.my_user_id), postId: post.id },
    });
    const [commentsCount, likesCount] = await Promise.all([
      db.communityComment.count({ where: { postId: post.id, userId: { notIn: blockedIds } } }),
      db.communityLike.count({ where: { postId: post.id, userId: { notIn: blockedIds } } }),
    ]);
    out.push(legacyPostRow(post as PostWithRelations, {
      isLike: like ? 1 : 0,
      commentsCount,
      likesCount,
      reactionType: like?.reactionType ?? null,
    }));
  }
  return data(res, "Fetch post successfully", out);
});

// POST /fetchProfile — profile + followingStatus + last-24h stories + interests.
wrap(router, "post", "/fetchProfile", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["my_user_id", "user_id"]);
  if (missing) return fail(res, missing);

  const myId = str(p.my_user_id);
  const profileId = str(p.user_id);

  const profile = await db.user.findUnique({ where: { id: profileId } });
  if (!profile) return fail(res, "Profile Not found");

  const me = await db.user.findUnique({ where: { id: myId }, select: { isBlock: true } });

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

  const stories = await db.communityStory.findMany({
    where: { userId: profileId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  const interestRows = csvToInts(profile.interestIds).length
    ? await db.communityInterest.findMany({ where: { id: { in: csvToInts(profile.interestIds) } } })
    : [];

  return data(res, "Getting profile successfully", {
    ...legacyUser(profile),
    followingStatus,
    stories: stories.map(legacyStoryRow),
    interest: interestRows.map(legacyInterestRow),
  });
});

// POST /deleteUser — full legacy cascade.
wrap(router, "post", "/deleteUser", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User not found");

  await deleteUserCascade(user.id);
  return data(res, "User Delete successfully", legacyUser(user));
});

// POST /searchProfile
wrap(router, "post", "/searchProfile", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["my_user_id", "start", "limit"]);
  if (missing) return fail(res, missing);

  const me = await db.user.findUnique({ where: { id: str(p.my_user_id) } });
  if (!me) return fail(res, "User not found.");

  const keyword = str(p.keyword).trim();
  const { start, limit } = page(req);
  const users = await db.user.findMany({
    where: {
      isBlock: 0,
      id: { notIn: csvStrs(me.blockUserIds) },
      username: { not: null },
      avatar: { not: null },
      ...(keyword
        ? {
            OR: [
              { username: { contains: keyword, mode: "insensitive" } },
              { name: { contains: keyword, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: start,
    take: limit,
  });
  return data(res, "User profile", users.map(legacyUser));
});

// POST /logOut — clears the legacy device token.
wrap(router, "post", "/logOut", async (req, res) => {
  const p = params(req);
  const userId = str(p.user_id);
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User not found");

  const updated = await db.user.update({ where: { id: userId }, data: { deviceToken: null } });
  return data(res, "User logout successfully", legacyUser(updated));
});

// POST /UserBlockedByUser — unfollow both ways + append to my blocklist CSV.
wrap(router, "post", "/UserBlockedByUser", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["my_user_id", "user_id"]);
  if (missing) return fail(res, missing);

  const myId = str(p.my_user_id);
  const targetId = str(p.user_id);

  const fromUser = await db.user.findUnique({ where: { id: myId } });
  if (!fromUser) return fail(res, "User not found");
  const toUser = await db.user.findUnique({ where: { id: targetId } });
  if (!toUser) return fail(res, "User not found");

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

  if (csvHas(fromUser.blockUserIds, targetId)) return fail(res, "User already Blocked");

  const updated = await db.user.update({
    where: { id: myId },
    data: { blockUserIds: (fromUser.blockUserIds ?? "") + targetId + "," }, // legacy trailing-comma CSV
  });
  await db.savedNotification.deleteMany({ where: { myUserId: myId, type: 1 } });

  return data(res, "User Block Successfully", legacyUser(toUser) && { ...legacyUser(toUser), block_user_ids: updated.blockUserIds });
});

// POST /UserUnblockedByUser — remove the id from my blocklist CSV.
wrap(router, "post", "/UserUnblockedByUser", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["my_user_id", "user_id"]);
  if (missing) return fail(res, missing);

  const myId = str(p.my_user_id);
  const targetId = str(p.user_id);

  const fromUser = await db.user.findUnique({ where: { id: myId } });
  if (!fromUser) return fail(res, "User not found");
  const toUser = await db.user.findUnique({ where: { id: targetId } });
  if (!toUser) return fail(res, "User not found");

  const updated = await db.user.update({
    where: { id: myId },
    data: { blockUserIds: csvStrs(fromUser.blockUserIds).filter((id) => id !== targetId).join(",") },
  });
  return data(res, "User Unblock Successfully", legacyUser(updated));
});

// POST /fetchUserNotification — saved-notifications feed with joins.
wrap(router, "post", "/fetchUserNotification", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["my_user_id", "start", "limit"]);
  if (missing) return fail(res, missing);

  const { start, limit } = page(req);
  const feed = await savedNotificationFeed(str(p.my_user_id), start, limit);
  return data(res, "Fetch Saved Notification Successfully", feed);
});

// ═══════════════════════ MODERATOR (UserController.php) ══════════════════════

// POST /Moderator/deletePostByModerator
wrap(router, "post", "/Moderator/deletePostByModerator", async (req, res) => {
  const mod = await moderatorOrFail(req, res);
  if (!mod) return;
  const postId = str(params(req).post_id);

  const post = await db.communityPost.findUnique({ where: { id: postId } });
  if (!post) return fail(res, "Post Not Found");

  await db.communityPostContent.deleteMany({ where: { postId } });
  await db.communityComment.deleteMany({ where: { postId } });
  await db.communityLike.deleteMany({ where: { postId } });
  await db.savedNotification.deleteMany({ where: { postId } });
  await db.communityReport.deleteMany({ where: { postId } });
  await db.communityPost.delete({ where: { id: postId } });

  return ok(res, "Post Deleted Successfully");
});

// POST /Moderator/deleteCommentByModerator
wrap(router, "post", "/Moderator/deleteCommentByModerator", async (req, res) => {
  const mod = await moderatorOrFail(req, res);
  if (!mod) return;
  const commentId = str(params(req).comment_id);

  const comment = await db.communityComment.findUnique({ where: { id: commentId } });
  if (!comment) return fail(res, "Comment not found");

  const post = await db.communityPost.findUnique({
    where: { id: comment.postId },
    select: { id: true, commentsCount: true },
  });
  if (post)
    await db.communityPost.update({
      where: { id: post.id },
      data: { commentsCount: Math.max(0, post.commentsCount - 1) },
    });
  await db.savedNotification.deleteMany({
    where: { userId: str(params(req).user_id), postId: comment.postId, type: 2 },
  });
  await db.communityComment.delete({ where: { id: commentId } });

  return data(res, "Comment Delete successfully", legacyCommentRow(comment));
});

// POST /Moderator/deleteRoomByModerator
wrap(router, "post", "/Moderator/deleteRoomByModerator", async (req, res) => {
  const mod = await moderatorOrFail(req, res);
  if (!mod) return;
  const roomId = str(params(req).room_id);

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room not found");

  await db.communityRoomUser.deleteMany({ where: { roomId } });
  await db.savedNotification.deleteMany({ where: { roomId } });
  await db.communityReport.deleteMany({ where: { roomId } });
  await db.communityRoom.delete({ where: { id: roomId } });

  return data(res, "Room deleted successfully", legacyRoomRow(room));
});

// POST /Moderator/deleteStoryByModerator
wrap(router, "post", "/Moderator/deleteStoryByModerator", async (req, res) => {
  const mod = await moderatorOrFail(req, res);
  if (!mod) return;
  const storyId = str(params(req).story_id);

  const story = await db.communityStory.findUnique({ where: { id: storyId } });
  if (!story) return fail(res, "Story not found");

  await db.communityStory.delete({ where: { id: storyId } });
  return data(res, "Story deleted successfully", legacyStoryRow(story));
});

// POST /Moderator/userBlockByModerator — sets is_block on the target user.
wrap(router, "post", "/Moderator/userBlockByModerator", async (req, res) => {
  const mod = await moderatorOrFail(req, res);
  if (!mod) return;
  const p = params(req);
  const toUserId = str(p.to_user_id);

  const toUser = await db.user.findUnique({ where: { id: toUserId } });
  if (!toUser) return fail(res, "User not found");
  if (str(p.user_id) === toUserId) return fail(res, "Lol, You can not block yourself");

  const updated = await db.user.update({ where: { id: toUserId }, data: { isBlock: 1 } });
  await db.communityReport.deleteMany({ where: { userId: toUserId } }); // reports about the user

  return data(res, "User Blocked successfully", legacyUser(updated));
});

// POST /Moderator/deleteReelCommentByModerator
wrap(router, "post", "/Moderator/deleteReelCommentByModerator", async (req, res) => {
  const mod = await moderatorOrFail(req, res);
  if (!mod) return;
  const reelCommentId = str(params(req).reel_comment_id);

  const reelComment = await db.communityReelComment.findUnique({ where: { id: reelCommentId } });
  if (!reelComment) return fail(res, "Reel Comment not found.");

  const reel = await db.communityReel.findUnique({
    where: { id: reelComment.reelId },
    select: { id: true, commentsCount: true },
  });
  if (reel)
    await db.communityReel.update({
      where: { id: reel.id },
      data: { commentsCount: Math.max(0, reel.commentsCount - 1) },
    });
  await db.savedNotification.deleteMany({ where: { reelCommentId, type: 10 } });
  await db.communityReelComment.delete({ where: { id: reelCommentId } });

  return data(res, "Reel Comment Delete Successfully By Moderator.", legacyReelCommentRow(reelComment));
});

// POST /Moderator/deleteReelByModerator
wrap(router, "post", "/Moderator/deleteReelByModerator", async (req, res) => {
  const mod = await moderatorOrFail(req, res);
  if (!mod) return;
  const reelId = str(params(req).reel_id);

  const reel = await db.communityReel.findUnique({ where: { id: reelId } });
  if (!reel) return fail(res, "Reel not found");

  const reelComments = await db.communityReelComment.findMany({ where: { reelId } });
  for (const rc of reelComments) {
    await db.savedNotification.deleteMany({ where: { reelCommentId: rc.id, type: { in: [9, 2, 10] } } });
  }
  await db.communityReelComment.deleteMany({ where: { reelId } });
  await db.communityLike.deleteMany({ where: { reelId } });
  await db.communityReport.deleteMany({ where: { reelId } });
  await db.savedNotification.deleteMany({ where: { reelId, type: { in: [9, 2, 10] } } });
  await db.communityReel.delete({ where: { id: reelId } });

  return data(res, "Reel Deleted Successfully By Moderator.", legacyReelRow(reel));
});

// ═══════════════════ PROFILE VERIFICATION (ProfileVerificationController) ════

// POST /profileVerification (multipart: user_id, full_name, document_type, document, selfie)
router.post(
  "/profileVerification",
  multipart,
  h(async (req, res) => {
    const p = params(req);
    const userId = str(p.user_id);
    if (!userId) return fail(res, "The user id field is required.");

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return fail(res, "User not found");
    if (user.isVerified === 1) return fail(res, "Profile verification in pending");
    if (user.isVerified !== 0) return fail(res, "Profile is already verified");

    const fullName = str(p.full_name);
    if (!fullName) return fail(res, "The full name field is required.");
    const documentType = str(p.document_type);
    if (!documentType) return fail(res, "The document type field is required.");

    const selfieUrl = await saveFieldFile(req, "selfie", "verification");
    if (!selfieUrl) return fail(res, "The selfie field is required.");
    const documentUrl = await saveFieldFile(req, "document", "verification");
    if (!documentUrl) return fail(res, "The document field is required.");

    const row = await db.profileVerification.create({
      data: { userId, selfie: selfieUrl, document: documentUrl, documentType, fullName },
    });
    await db.user.update({ where: { id: userId }, data: { isVerified: 1 } }); // pending review

    return data(res, "Profile verification added Successfully", {
      id: row.id,
      user_id: row.userId,
      selfie: row.selfie,
      document: row.document,
      document_type: row.documentType,
      full_name: row.fullName,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    });
  })
);

// ═══════════════════ NOTIFICATIONS (NotificationController.php) ══════════════

// POST /notifications/register-token — device_type 1 = iOS (APNs), 2 = Android (FCM).
router.post(
  "/notifications/register-token",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const p = params(req);
    const deviceToken = str(p.device_token);
    const deviceType = num(p.device_type);
    if (!deviceToken) return fail(res, "The device token field is required.");
    if (deviceType !== 1 && deviceType !== 2) return fail(res, "The selected device type is invalid.");

    await db.user.update({
      where: { id: s.userId },
      data: {
        ...(deviceType === 1 ? { apnsToken: deviceToken } : { fcmToken: deviceToken }),
        deviceType,
        deviceToken, // backward compatibility
      },
    });
    return ok(res, "Device token registered successfully");
  })
);

// POST /notifications/send — push to one user (legacy NotificationController::sendToUser).
wrap(router, "post", "/notifications/send", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["user_id", "title", "body"]);
  if (missing) return fail(res, missing);

  const user = await db.user.findUnique({ where: { id: str(p.user_id) } });
  if (!user) return fail(res, "User not found");

  const token = user.fcmToken || user.apnsToken || user.deviceToken;
  if (!token) return fail(res, "No device token available for this user");

  const row = await sendPush({
    userId: user.id,
    title: str(p.title),
    body: str(p.body),
    type: optStr(p.notification_type) ?? "MOBILE",
    data: {
      ...((p.data as Record<string, unknown> | undefined) ?? {}),
      ...(p.entity_type !== undefined ? { entity_type: str(p.entity_type) } : {}),
      ...(p.entity_id !== undefined ? { entity_id: str(p.entity_id) } : {}),
    },
  });
  return ok(res, "Notification sent successfully", { notification_id: row.id });
});

// GET /notifications/list — the app parses this with UserNotificationModel
// (saved-notifications feed), so serve the same shape as fetchUserNotification.
wrap(router, "get", "/notifications/list", async (req, res) => {
  const p = params(req);
  let myUserId = str(p.my_user_id);
  if (!myUserId) {
    try {
      myUserId = session(req).userId;
    } catch {
      myUserId = "";
    }
  }
  if (!myUserId) return fail(res, "The my user id field is required.");

  const { start, limit } = page(req);
  const feed = await savedNotificationFeed(myUserId, start, limit);
  return data(res, "Fetch Saved Notification Successfully", feed);
});

// POST /notifications/:notificationId/read
router.post(
  "/notifications/:notificationId/read",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const id = str((req.params as Record<string, string>).notificationId);
    const row = await db.notification.findFirst({ where: { id, userId: s.userId } });
    if (!row) return fail(res, "Notification not found");
    await db.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
    return ok(res, "Notification marked as read");
  })
);

// POST /notifications/read-all
router.post(
  "/notifications/read-all",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    await db.notification.updateMany({
      where: { userId: s.userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return ok(res, "All notifications marked as read");
  })
);

// ═════════════ PLATFORM NOTIFICATIONS (AdminController.php) ══════════════════

// POST /fetchPlatformNotification — global announcements (Notification rows
// with userId = null) in the PlatformNotification wire shape.
wrap(router, "post", "/fetchPlatformNotification", async (req, res) => {
  const p = params(req);
  const missing = firstMissing(p, ["start", "limit"]);
  if (missing) return fail(res, missing);

  const { start, limit } = page(req);
  const rows = await db.notification.findMany({
    where: { userId: null },
    orderBy: { createdAt: "desc" },
    skip: start,
    take: limit,
  });
  return data(
    res,
    "fetch plateform notification successfully", // legacy message (typo preserved)
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.message,
      created_at: r.createdAt.toISOString(),
      updated_at: null, // Notification rows carry no updatedAt
    }))
  );
});

// ═════════════ VOLUNTEER / SUPPORTER (VolunteerApplicationController.php) ════

// POST /user/select-type — one-time supporter|volunteer choice.
router.post(
  "/user/select-type",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const p = params(req);
    const userType = str(p.user_type);
    if (userType !== "supporter" && userType !== "volunteer")
      return fail(res, "The selected user type is invalid.");

    const user = await db.user.findUnique({ where: { id: s.userId } });
    if (!user) return fail(res, "User not found");
    if (user.userType !== null && user.userType !== undefined)
      return fail(res, "User type has already been selected");

    const updated = await db.user.update({
      where: { id: s.userId },
      data: {
        userType,
        ...(userType === "volunteer"
          ? { volunteerStatus: "pending", volunteerRequestedAt: new Date() }
          : {}),
      },
    });
    return data(res, "User type selected successfully", legacyUser(updated));
  })
);

// POST /volunteer/apply
router.post(
  "/volunteer/apply",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const p = params(req);

    const skills = jsonArr(p.skills);
    const availability = jsonArr(p.availability);
    if (!skills || !skills.length) return fail(res, "The skills field is required.");
    if (!availability || !availability.length) return fail(res, "The availability field is required.");
    if (!str(p.city).trim()) return fail(res, "The city field is required.");
    if (!str(p.state).trim()) return fail(res, "The state field is required.");
    if (!str(p.motivation).trim()) return fail(res, "The motivation field is required.");

    const user = await db.user.findUnique({ where: { id: s.userId } });
    if (!user) return fail(res, "User not found");
    if (user.userType !== "volunteer") return fail(res, "Only volunteer users can submit applications");

    const existing = await db.volunteerApplication.findFirst({ where: { userId: user.id } });
    if (existing) return fail(res, "You have already submitted an application");

    const application = await db.volunteerApplication.create({
      data: {
        userId: user.id,
        fullName: user.name,
        email: user.email,
        phone: user.phone ?? "",
        city: str(p.city),
        state: str(p.state),
        country: optStr(p.country) ?? "USA",
        skills: JSON.stringify(skills),
        customSkills: jsonArr(p.custom_skills) ? JSON.stringify(jsonArr(p.custom_skills)) : null,
        availability: JSON.stringify(availability),
        isFlexible: bool(p.is_flexible),
        postalCode: optStr(p.postal_code),
        latitude: optNum(p.latitude),
        longitude: optNum(p.longitude),
        serviceAreas: jsonArr(p.service_areas) ? JSON.stringify(jsonArr(p.service_areas)) : null,
        willingToTravel: bool(p.willing_to_travel),
        maxTravelDistance: optNum(p.max_travel_distance),
        remoteVolunteering: bool(p.remote_volunteering),
        motivation: str(p.motivation),
        priorExperience: optStr(p.prior_experience),
        emergencyContact: optStr(p.emergency_contact),
        emergencyPhone: optStr(p.emergency_phone),
        addressLine1: optStr(p.address_line1),
        addressLine2: optStr(p.address_line2),
        status: "PENDING",
      },
    });
    return data(res, "Application submitted successfully", legacyVolunteerApp(application));
  })
);

// GET /volunteer/status
router.get(
  "/volunteer/status",
  mobileAuth,
  h(async (req, res) => {
    const s = session(req);
    const application = await db.volunteerApplication.findFirst({
      where: { userId: s.userId },
      orderBy: { createdAt: "desc" },
    });
    if (!application) return res.json({ status: false, message: "No application found", data: null });
    return data(res, "Application retrieved successfully", legacyVolunteerApp(application));
  })
);

// GET /admin/volunteer/applications (admin/moderator gate)
router.get(
  "/admin/volunteer/applications",
  mobileAuth,
  requireModerator,
  h(async (req, res) => {
    const p = params(req);
    const statusWire = (str(p.status) || "pending").toLowerCase();
    const statusDb = APP_STATUS_DB[statusWire] ?? "PENDING";

    const pageNum = Math.max(1, num(p.page, 1));
    const perPage = 25; // legacy paginate(25)
    const [rows, total] = await Promise.all([
      db.volunteerApplication.findMany({
        where: { status: statusDb },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * perPage,
        take: perPage,
      }),
      db.volunteerApplication.count({ where: { status: statusDb } }),
    ]);

    return data(res, "Applications retrieved successfully", {
      current_page: pageNum,
      data: rows.map(legacyVolunteerApp),
      per_page: perPage,
      last_page: Math.max(1, Math.ceil(total / perPage)),
      total,
    });
  })
);

// POST /admin/volunteer/applications/:id/approve
router.post(
  "/admin/volunteer/applications/:id/approve",
  mobileAuth,
  requireModerator,
  h(async (req, res) => {
    const s = session(req);
    const id = str((req.params as Record<string, string>).id);
    const p = params(req);

    const application = await db.volunteerApplication.findUnique({ where: { id } });
    if (!application) return fail(res, "Application not found");
    if (application.status !== "PENDING") return fail(res, "Application has already been reviewed");

    const notes = optStr(p.notes);
    const reviewedAt = new Date();
    await db.volunteerApplication.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedBy: s.userId,
        reviewedAt,
        reviewNote: notes,
        adminNotes: notes,
        rejectionReason: null,
      },
    });
    await db.user.update({
      where: { id: application.userId ?? "" },
      data: {
        volunteerStatus: "approved",
        volunteerApprovedAt: reviewedAt,
        volunteerApprovedBy: s.userId,
        volunteerRejectionReason: null,
      },
    }).catch(() => undefined); // applicant row may already be gone

    return data(res, "Application approved successfully", {
      application_id: application.id,
      status: "approved",
      reviewed_at: reviewedAt.toISOString(),
    });
  })
);

// POST /admin/volunteer/applications/:id/reject
router.post(
  "/admin/volunteer/applications/:id/reject",
  mobileAuth,
  requireModerator,
  h(async (req, res) => {
    const s = session(req);
    const id = str((req.params as Record<string, string>).id);
    const p = params(req);

    const reason = str(p.reason);
    if (!reason) return fail(res, "The reason field is required.");

    const application = await db.volunteerApplication.findUnique({ where: { id } });
    if (!application) return fail(res, "Application not found");
    if (application.status !== "PENDING") return fail(res, "Application has already been reviewed");

    const notes = optStr(p.notes);
    const reviewedAt = new Date();
    await db.volunteerApplication.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedBy: s.userId,
        reviewedAt,
        reviewNote: notes,
        adminNotes: notes,
        rejectionReason: reason,
      },
    });
    await db.user.update({
      where: { id: application.userId ?? "" },
      data: { volunteerStatus: "rejected", volunteerRejectionReason: reason },
    }).catch(() => undefined); // applicant row may already be gone

    return data(res, "Application rejected", {
      application_id: application.id,
      status: "rejected",
      rejection_reason: reason,
      reviewed_at: reviewedAt.toISOString(),
    });
  })
);
