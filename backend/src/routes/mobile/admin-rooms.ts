/**
 * Mobile community ADMIN routes — admin-rooms module (PHP admin panel parity).
 * Mounted under /api via routes/mobile/index.ts. Auth: mobileAuth (JWT — the
 * admin dashboard sends Authorization: Bearer; mobile admin users send
 * authtoken) + an ADMIN/MODERATOR role gate, mirroring the legacy checkLogin.
 *
 * Ports the legacy admin-panel ROOMS + PROFILE-VERIFICATION + REPORTS flows:
 *   uar/php/admin/app/Http/Controllers/RoomController.php
 *     (roomsListWeb, deleteThisRoom, roomDetails, allRoomUsersListTableWeb,
 *      roomMembersListTableWeb, roomCoAdminTableWeb, userRoomsOwnTable,
 *      userRoomInTable, updatePrivateStatus, updateJoinRequestStatus)
 *   ProfileVerificationController.php
 *     (profileVerificationList, approvedProfileVerification/:id,
 *      rejectProfileVerification/:id)
 *   UserController.php (deleteUserReport, blockUserFromReport) +
 *   RoomController.php (deleteReport, deleteReportWithRoom)
 *
 * Complements the existing /community/admin/reports (list) and
 * /community/admin/reports/resolve routes in charity.ts — no overlap.
 *
 * Wire notes:
 *  - Room report actions mirror the PHP: deleteReport removes every report
 *    pointing at the reported room; deleteReportWithRoom cascades reports +
 *    room_users + saved notifications (+ the linked group conversation) and
 *    then the room. The generalized route dispatches on report.type: 0 room,
 *    1 post, 2 user, 3 reel — user reports fall back to deleteUserReport
 *    semantics (drop every type-2 report about that user).
 *  - blockUserFromReport blocks the *reported* user (legacy blocks
 *    Report.user_id, which /reportUser stores as the reported user). For
 *    content reports the owner is resolved through the content relation
 *    (room.admin / post.user / comment.user / reel.user).
 *  - Verifications: status shown = the user's is_verified (0 none | 1 pending
 *    | 2 verified). Approve sets 2, reject resets to 0 — both delete the
 *    ProfileVerification row afterwards (legacy deletes the files too; here
 *    media lives in the shared FileAsset store and is kept for audit).
 *
 * DELETE /community/admin/rooms is additionally aliased as POST for the admin
 * dashboard client, whose shared mfetch helper only speaks GET (no body) and
 * POST — the same handler serves both verbs.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@/lib/db";
import {
  ok,
  data,
  fail,
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
} from "@/lib/mobile/compat";
import type { Session } from "@/lib/session";
import { Prisma, type CommunityRoom, CommunityRoomUser, User } from "@prisma/client";

export const router = Router();

/** wrap() single-handler form — lets middleware (mobileAuth) run first. */
function h(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) =>
    Promise.resolve(handler(req, res)).catch((e) => mobileErrorHandler(e, res));
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Session with an elevated role (admin dashboard endpoints). */
function requireElevated(req: Request, res: Response): Session | null {
  try {
    const s = session(req);
    if (s.role !== "ADMIN" && s.role !== "MODERATOR") {
      res.status(401).json({ status: false, message: "Unauthorized Access", reason: "Moderator access required" });
      return null;
    }
    return s;
  } catch {
    res.status(401).json({ status: false, message: "Unauthorized Access", reason: "Invalid or expired token" });
    return null;
  }
}

// ─── Serializers ──────────────────────────────────────────────────────────────

/** RoomUser.type → the legacy admin-panel badge label. */
function memberTypeLabel(type: number): string {
  switch (type) {
    case 1: return "Requested";
    case 2: return "Member";
    case 3: return "Co-Admin";
    case 4: return "Invited";
    case 5: return "Admin";
    default: return String(type);
  }
}

type RoomWithCounts = CommunityRoom & { _count: { roomUsers: number; reports: number } };

function roomWire(r: RoomWithCounts) {
  return {
    id: r.id,
    title: r.title,
    desc: r.desc,
    photo: r.photo,
    interest_ids: r.interestIds,
    conversation_id: r.conversationId,
    is_private: r.isPrivate,
    is_join_request_enable: r.isJoinRequestEnable,
    total_member: r.totalMember,
    member_count: r._count.roomUsers,
    report_count: r._count.reports,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
}

function roomUserWire(ru: CommunityRoomUser & { user: User }) {
  return {
    id: ru.id,
    room_id: ru.roomId,
    user_id: ru.userId,
    invited_by: ru.invitedBy,
    type: ru.type,
    type_label: memberTypeLabel(ru.type),
    is_mute: ru.isMute,
    created_at: iso(ru.createdAt),
    user: legacyUser(ru.user),
  };
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

const ROOM_COUNTS = { roomUsers: true, reports: true } as const;

// GET /community/admin/rooms — RoomController::roomsListWeb (paginated rooms
// with admin user, live member count and per-room report count).
router.get("/mobile-admin/rooms", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const { start, limit } = page(req, 30);
  const q = str(p.q).trim();

  const where: Prisma.CommunityRoomWhereInput = { ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}) };
  const [rows, total] = await Promise.all([
    db.communityRoom.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
      include: { admin: true, _count: { select: ROOM_COUNTS } },
    }),
    db.communityRoom.count({ where }),
  ]);

  return data(res, "Rooms retrieved", {
    rooms: rows.map((r) => ({ ...roomWire(r), admin: legacyUser(r.admin) })),
    total_count: total,
  });
}));

// DELETE (and POST alias) /community/admin/rooms — RoomController::deleteThisRoom.
// Cascades the room's reports, room_users, saved notifications and the linked
// group conversation (participants + messages cascade via FK), then the room.
async function deleteRoomHandler(req: Request, res: Response) {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const roomId = str(p.room_id);
  if (!roomId) return fail(res, "The room id field is required.");

  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) return fail(res, "Room Not Found");

  await db.communityReport.deleteMany({ where: { roomId: room.id } });
  await db.communityRoomUser.deleteMany({ where: { roomId: room.id } });
  await db.savedNotification.deleteMany({ where: { roomId: room.id } });
  if (room.conversationId) {
    await db.conversation.delete({ where: { id: room.conversationId } }).catch(() => undefined);
  }
  await db.communityRoom.delete({ where: { id: room.id } });

  feedEvent("room.deleted", { id: room.id, title: room.title, by: s.userId });
  return ok(res, "Room Delete Successfully");
}
router.delete("/mobile-admin/rooms", mobileAuth, h(deleteRoomHandler));
router.post("/mobile-admin/rooms", mobileAuth, h(deleteRoomHandler)); // mfetch alias (GET/POST only)

// GET /community/admin/rooms/details?id= — RoomController::roomDetails +
// allRoomUsersListTableWeb / roomMembersListTableWeb / roomCoAdminTableWeb:
// the room plus its admin and the three member tables (all users = types
// 2,3,5; members only = type 2; co-admins = type 3), legacyUser-shaped.
router.get("/mobile-admin/rooms/details", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const id = str(params(req).id);
  if (!id) return fail(res, "The id field is required.");

  const room = await db.communityRoom.findUnique({
    where: { id },
    include: { admin: true, _count: { select: ROOM_COUNTS } },
  });
  if (!room) return fail(res, "Room not found");

  const roomUsers = await db.communityRoomUser.findMany({
    where: { roomId: room.id, type: { in: [2, 3, 5] } },
    include: { user: true },
    orderBy: { type: "asc" },
  });

  return data(res, "Room details", {
    room: roomWire(room),
    admin: legacyUser(room.admin),
    all_users: roomUsers.map(roomUserWire),
    members: roomUsers.filter((ru) => ru.type === 2).map(roomUserWire),
    co_admins: roomUsers.filter((ru) => ru.type === 3).map(roomUserWire),
  });
}));

// POST /community/admin/rooms/private-status — RoomController::updatePrivateStatus.
router.post("/mobile-admin/rooms/private-status", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const id = str(p.id);
  const isPrivate = num(p.is_private, -1);
  if (!id) return fail(res, "The id field is required.");
  if (isPrivate !== 0 && isPrivate !== 1) return fail(res, "The is private field must be 0 or 1.");

  const room = await db.communityRoom.findUnique({ where: { id } });
  if (!room) return fail(res, "Room not found");

  await db.communityRoom.update({ where: { id }, data: { isPrivate } });
  feedEvent("room.updated", { id, field: "is_private", value: isPrivate, by: s.userId });
  return ok(res, "Room Status Updated successfully");
}));

// POST /community/admin/rooms/join-request-status — RoomController::updateJoinRequestStatus.
router.post("/mobile-admin/rooms/join-request-status", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const p = params(req);
  const id = str(p.id);
  const isJoinRequestEnable = num(p.is_join_request_enable, -1);
  if (!id) return fail(res, "The id field is required.");
  if (isJoinRequestEnable !== 0 && isJoinRequestEnable !== 1) {
    return fail(res, "The is join request enable field must be 0 or 1.");
  }

  const room = await db.communityRoom.findUnique({ where: { id } });
  if (!room) return fail(res, "Room not found");

  await db.communityRoom.update({ where: { id }, data: { isJoinRequestEnable } });
  feedEvent("room.updated", { id, field: "is_join_request_enable", value: isJoinRequestEnable, by: s.userId });
  return ok(res, "Room Status Updated successfully");
}));

// GET /community/admin/rooms/user-rooms?user_id=&mode=own|in —
// RoomController::userRoomsOwnTable (rooms the user admins, mode "own", the
// default) and userRoomInTable (rooms the user is in, type != 4 invited,
// mode "in").
router.get("/mobile-admin/rooms/user-rooms", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const p = params(req);
  const userId = str(p.user_id);
  const mode = str(p.mode) === "in" ? "in" : "own";
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "User not found");

  if (mode === "in") {
    const rows = await db.communityRoomUser.findMany({
      where: { userId, type: { not: 4 } }, // 4 = invited (legacy invitedForRoom)
      include: { user: true, room: { include: { _count: { select: ROOM_COUNTS } } } },
      orderBy: { createdAt: "desc" },
    });
    return data(res, "Rooms the user is in", {
      rooms: rows
        .filter((ru) => ru.room)
        .map((ru) => ({ ...roomUserWire(ru), room: roomWire(ru.room as RoomWithCounts) })),
      total_count: rows.length,
    });
  }

  const rows = await db.communityRoom.findMany({
    where: { adminId: userId },
    include: { _count: { select: ROOM_COUNTS } },
    orderBy: { createdAt: "desc" },
  });
  return data(res, "Rooms owned by the user", {
    rooms: rows.map(roomWire),
    total_count: rows.length,
  });
}));

// ─── Profile verifications ────────────────────────────────────────────────────

// GET /community/admin/verifications — ProfileVerificationController::
// profileVerificationList. Status mirrors the legacy grid: the user's
// is_verified (0 not | 1 pending | 2 verified).
// GET /api/mobile-admin/verifications/members — verified members (canonical
// User rows with isVerified >= 2). Approved requests are removed, so the
// verified roster lives on the user record.
router.get("/mobile-admin/verifications/members", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const { start, limit } = page(req, 30);
  const p = params(req);
  const q = str(p.q).trim();

  const where: Record<string, unknown> = { isVerified: { gte: 2 } };
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { username: { contains: q } },
      { email: { contains: q } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: start,
      take: limit,
      select: {
        id: true, email: true, name: true, username: true, avatar: true,
        isVerified: true, currentTier: true, totalPoints: true, memberSince: true,
        createdAt: true,
      },
    }),
    db.user.count({ where }),
  ]);

  return data(res, "Verified members retrieved", {
    members: rows.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      avatar: u.avatar,
      is_verified: u.isVerified,
      current_tier: u.currentTier,
      total_points: u.totalPoints,
      member_since: u.memberSince ? u.memberSince.toISOString() : null,
      created_at: u.createdAt.toISOString(),
    })),
    total_count: total,
  });
}));

router.get("/mobile-admin/verifications", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const { start, limit } = page(req, 30);
  const p = params(req);
  const q = str(p.q).trim();
  const status = str(p.status); // not_verified | pending | verified (mirrors the user is_verified values)

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { fullName: { contains: q } },
      { documentType: { contains: q } },
      { user: { is: { OR: [{ name: { contains: q } }, { username: { contains: q } }, { email: { contains: q } }] } } },
    ];
  }
  if (status === "pending") where.user = { is: { isVerified: 1 } };
  if (status === "verified") where.user = { is: { isVerified: 2 } };
  if (status === "not_verified") where.user = { is: { isVerified: 0 } };

  const [rows, total] = await Promise.all([
    db.profileVerification.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: start,
      take: limit,
    }),
    db.profileVerification.count({ where }),
  ]);

  return data(res, "Verification requests retrieved", {
    verifications: rows.map((v) => ({
      id: v.id,
      user_id: v.userId,
      selfie: v.selfie,
      document: v.document,
      document_type: v.documentType,
      full_name: v.fullName,
      status: v.user.isVerified,
      created_at: iso(v.createdAt),
      user: legacyUser(v.user),
    })),
    total_count: total,
  });
}));

// POST /community/admin/verifications/approve — approvedProfileVerification/:id:
// user.is_verified = 2, then the ProfileVerification row is removed.
async function resolveVerification(req: Request, res: Response, approve: boolean) {
  const s = requireElevated(req, res);
  if (!s) return;
  const userId = str(params(req).user_id);
  if (!userId) return fail(res, "The user id field is required.");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail(res, "Profile Not Found");

  const verification = await db.profileVerification.findFirst({ where: { userId } });
  if (!verification) return fail(res, "Record not found");

  await db.user.update({ where: { id: userId }, data: { isVerified: approve ? 2 : 0 } });
  await db.profileVerification.delete({ where: { id: verification.id } });

  feedEvent(approve ? "verification.approved" : "verification.rejected", {
    user_id: userId, name: user.name, by: s.userId,
  });
  return ok(res, approve ? "Record Approved Successfully" : "Record Rejected");
}

router.post("/mobile-admin/verifications/approve", mobileAuth, h(async (req, res) => {
  return resolveVerification(req, res, true);
}));

router.post("/mobile-admin/verifications/reject", mobileAuth, h(async (req, res) => {
  return resolveVerification(req, res, false);
}));

// ─── Report actions (complement charity.ts list + resolve) ────────────────────

const REPORT_INCLUDE = {
  room: { select: { id: true, title: true, adminId: true } },
  post: { select: { id: true, userId: true } },
  reel: { select: { id: true, userId: true } },
  comment: { select: { id: true, userId: true } },
} as const;

// POST /community/admin/reports/delete — RoomController::deleteReport: drops
// the report row; for room reports the legacy removes every report pointing at
// the same room, which is mirrored here.
router.post("/mobile-admin/reports/delete", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const reportId = str(params(req).report_id);
  if (!reportId) return fail(res, "The report id field is required.");

  const report = await db.communityReport.findUnique({ where: { id: reportId } });
  if (!report) return fail(res, "Report Not Found");

  if (report.roomId) {
    await db.communityReport.deleteMany({ where: { roomId: report.roomId } });
  } else {
    await db.communityReport.delete({ where: { id: report.id } });
  }

  feedEvent("report.deleted", { id: reportId, type: report.type, by: s.userId });
  return ok(res, "Report Delete Successfully");
}));

// POST /community/admin/reports/delete-with-content — deleteReportWithRoom
// (type 0: cascade reports + room_users + saved notifications + conversation,
// then the room) generalized to the other targets: post / reel / comment
// content is deleted first, then the reports about it. User reports (type 2)
// fall back to deleteUserReport semantics (drop every report about the user).
router.post("/mobile-admin/reports/delete-with-content", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const reportId = str(params(req).report_id);
  if (!reportId) return fail(res, "The report id field is required.");

  const report = await db.communityReport.findUnique({
    where: { id: reportId },
    include: REPORT_INCLUDE,
  });
  if (!report) return fail(res, "Report Not Found");

  if (report.roomId && report.room) {
    await db.communityReport.deleteMany({ where: { roomId: report.roomId } });
    await db.communityRoomUser.deleteMany({ where: { roomId: report.roomId } });
    await db.savedNotification.deleteMany({ where: { roomId: report.roomId } });
    const room = await db.communityRoom.findUnique({ where: { id: report.roomId } });
    if (room?.conversationId) {
      await db.conversation.delete({ where: { id: room.conversationId } }).catch(() => undefined);
    }
    await db.communityRoom.delete({ where: { id: report.roomId } }).catch(() => undefined);
    feedEvent("report.content_deleted", { report_id: reportId, target: "room", id: report.roomId, by: s.userId });
    return ok(res, "Room Delete Successfully.");
  }
  if (report.postId) {
    await db.communityPost.delete({ where: { id: report.postId } }).catch(() => undefined);
    await db.communityReport.deleteMany({ where: { postId: report.postId } });
    feedEvent("report.content_deleted", { report_id: reportId, target: "post", id: report.postId, by: s.userId });
    return ok(res, "Reported post deleted");
  }
  if (report.reelId) {
    await db.communityReel.delete({ where: { id: report.reelId } }).catch(() => undefined);
    await db.communityReport.deleteMany({ where: { reelId: report.reelId } });
    feedEvent("report.content_deleted", { report_id: reportId, target: "reel", id: report.reelId, by: s.userId });
    return ok(res, "Reported reel deleted");
  }
  if (report.commentId) {
    await db.communityComment.delete({ where: { id: report.commentId } }).catch(() => undefined);
    await db.communityReport.deleteMany({ where: { commentId: report.commentId } });
    feedEvent("report.content_deleted", { report_id: reportId, target: "comment", id: report.commentId, by: s.userId });
    return ok(res, "Reported comment deleted");
  }
  // type 2 user report — deleteUserReport semantics: clear every report about
  // the reported user (the legacy Report.user_id IS the reported user there).
  if (report.userId) {
    await db.communityReport.deleteMany({ where: { userId: report.userId, type: 2 } });
    feedEvent("report.deleted", { id: reportId, type: report.type, by: s.userId });
    return ok(res, "Report Delete Successfully");
  }
  await db.communityReport.delete({ where: { id: report.id } });
  return ok(res, "Report Delete Successfully");
}));

// POST /community/admin/reports/block-user — UserController::blockUserFromReport:
// sets the *reported* user is_block = 1 and clears the reports about them.
// The reported user is resolved through the content owner (room admin / post /
// comment / reel author); for type-2 user reports the legacy stores the
// reported user in Report.user_id, which /reportUser mirrors.
router.post("/mobile-admin/reports/block-user", mobileAuth, h(async (req, res) => {
  const s = requireElevated(req, res);
  if (!s) return;
  const reportId = str(params(req).report_id);
  if (!reportId) return fail(res, "The report id field is required.");

  const report = await db.communityReport.findUnique({
    where: { id: reportId },
    include: REPORT_INCLUDE,
  });
  if (!report) return fail(res, "Report Not Found");

  const reportedUserId =
    report.type === 2
      ? report.userId
      : (report.room?.adminId ?? report.post?.userId ?? report.comment?.userId ?? report.reel?.userId ?? report.userId);
  if (!reportedUserId) return fail(res, "User not found");

  const user = await db.user.findUnique({ where: { id: reportedUserId } });
  if (!user) return fail(res, "User not found");

  await db.user.update({ where: { id: user.id }, data: { isBlock: 1 } });

  // Clear the reports about the blocked user/content (legacy deletes every
  // report sharing the reported user; here content-scoped siblings too).
  await db.communityReport.deleteMany({ where: { userId: user.id, type: 2 } });
  if (report.roomId) await db.communityReport.deleteMany({ where: { roomId: report.roomId } });
  if (report.postId) await db.communityReport.deleteMany({ where: { postId: report.postId } });
  if (report.reelId) await db.communityReport.deleteMany({ where: { reelId: report.reelId } });
  if (report.commentId) await db.communityReport.deleteMany({ where: { commentId: report.commentId } });
  await db.communityReport.deleteMany({ where: { id: report.id, type: { not: 2 } } });

  feedEvent("user.blocked", { user_id: user.id, name: user.name, from_report: reportId, by: s.userId });
  return ok(res, "User Added in Blocklist");
}));

// (const export above is the module surface — ../index.ts imports `router`).

// ─── Rooms create + update (full CRUD) ──────────────────────────────────────
// Admin-created rooms are owned by the admin's unified user identity.

// POST /api/mobile-admin/rooms/create
router.post("/mobile-admin/rooms/create", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const title = str(b.title).trim();
  const desc = str(b.desc).trim() || str(b.description).trim();
  if (!title) return fail(res, "The title field is required.");
  if (!desc) return fail(res, "The desc field is required.");

  const room = await db.communityRoom.create({
    data: {
      adminId: session(req).userId,
      title,
      desc,
      interestIds: str(b.interest_ids) || "",
      isPrivate: num(b.is_private) ? 1 : 0,
      isJoinRequestEnable: num(b.is_join_request_enable) ? 1 : 0,
      totalMember: 1,
      photo: optStr(b.photo),
    },
  });
  await db.communityRoomUser.create({
    data: { roomId: room.id, userId: session(req).userId, type: 5 }, // 5 = admin
  });
  feedEvent("room.created", { id: room.id, title: room.title, by: session(req).name });
  return data(res, "Room created successfully", { id: room.id, title: room.title });
}));

// POST /api/mobile-admin/rooms/update
router.post("/mobile-admin/rooms/update", mobileAuth, h(async (req, res) => {
  if (!requireElevated(req, res)) return;
  const b = params(req);
  const id = str(b.room_id);
  const room = await db.communityRoom.findUnique({ where: { id } });
  if (!room) return fail(res, "Room not found");
  const patch: any = {};
  const title = optStr(b.title);
  if (title !== null) patch.title = title;
  const desc = optStr(b.desc) ?? optStr(b.description);
  if (desc !== null) patch.desc = desc;
  const interests = optStr(b.interest_ids);
  if (interests !== null) patch.interestIds = interests;
  const photo = optStr(b.photo);
  if (photo !== null) patch.photo = photo;
  if (b.is_private !== undefined) patch.isPrivate = num(b.is_private) ? 1 : 0;
  if (b.is_join_request_enable !== undefined) patch.isJoinRequestEnable = num(b.is_join_request_enable) ? 1 : 0;
  if (Object.keys(patch).length === 0) return fail(res, "Nothing to update");
  await db.communityRoom.update({ where: { id }, data: patch });
  feedEvent("room.moderated", { id, changes: Object.keys(patch).join(","), by: session(req).name });
  return ok(res, "Room updated successfully");
}));
