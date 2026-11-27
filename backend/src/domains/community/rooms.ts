/**
 * Community rooms domain logic — shared by the generic /api/rooms router
 * (web + mobile) and pinned for the posts feed (suggested rooms, reused by the
 * posts slice). Ported from the legacy mobile handlers
 * (src/routes/mobile/reels-rooms.ts RoomController + posts.ts getSuggestedRooms):
 *   - membership types (1 request | 2 member | 3 co-admin | 4 invited | 5 admin)
 *   - member-count caps (Setting "mobile.app".setRoomUsersLimit, legacy 16)
 *   - group Conversation + ConversationParticipant creation and sync
 *   - invitations, join requests, admins, mute
 *   - SavedNotification rows + push (same types as the legacy wire)
 *
 * The actor is ALWAYS the session user — ids never come from the body.
 */
import { Prisma, type CommunityReport, type CommunityRoom, type CommunityRoomUser } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/logging/logger";
import { ApiError, requireAuth, type Session } from "@/infrastructure/auth/session";
import { communityAuthor, communityAuthorSelect, communityUser, communityUserSelect, csvList } from "@/domains/community/serializers";
import { sendPush } from "@/domains/community/push";
import { deleteFileByUrl } from "@/domains/community/reels";
import { invalidateCatalog } from "@/infrastructure/cache";

const log = logger.child("community:rooms");

// ─── Legacy constants (app/Models/Constants.php) ─────────────────────────────

// CommunityRoomUser.type
export const RU_REQUEST = 1;
export const RU_MEMBER = 2;
export const RU_CO_ADMIN = 3;
export const RU_INVITED = 4;
export const RU_ADMIN = 5;

// SavedNotification room types
export const TYPE_ROOM_INVITE = 4;
export const TYPE_ACCEPT_INVITE_ROOM = 5;
export const TYPE_JOIN_ROOM = 6;
export const TYPE_DIRECT_JOIN_ROOM = 7;
export const TYPE_ACCEPT_ROOM_REQUEST = 8;

const UNBLOCKED = 0;
const PUSH_ON = 1;
/** Legacy FCM title (env('APP_NAME') of the chatter app). */
const PUSH_TITLE = "Chatter.";

// ─── Row types ───────────────────────────────────────────────────────────────

type RoomRow = CommunityRoom;
type RoomUserRow = CommunityRoomUser;

// ─── Helpers (moved out of the legacy mobile module; it imports them back) ────

/** Room-members cap — legacy Setting::setRoomUsersLimit (kept as the `mobile.app`
 *  setting JSON; 16 = legacy seed default). */
export async function roomUsersLimit(): Promise<number> {
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

/** MySQL FIND_IN_SET(needle, csvColumn) over a Postgres CSV column — the room ids
 *  whose interest_ids CSV contains `interestId` (parameterized, so quoting is safe). */
export async function matchingRoomIds(interestId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM app_rooms WHERE (',' || COALESCE(interest_ids, '') || ',') LIKE ('%,' || ${interestId} || ',%')`;
  return rows.map((r) => r.id);
}

/** Uniformly-random slice of the rows matching `where` (legacy inRandomOrder + take). */
export async function randomRooms(where: Prisma.CommunityRoomWhereInput, take: number): Promise<RoomRow[]> {
  const count = await db.communityRoom.count({ where });
  const skip = count > take ? Math.floor(Math.random() * (count - take)) : 0;
  const rows = await db.communityRoom.findMany({ where, skip, take });
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}

/** Room-user membership count the limit checks run against (members + co-admins,
 *  plus the owner admin when includeAdmins — legacy memberCountWhere). */
export function memberCountWhere(roomId: string, includeAdmins: boolean) {
  return {
    roomId,
    type: includeAdmins ? { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN] } : { in: [RU_MEMBER, RU_CO_ADMIN] },
  };
}

/** Add a room member as a group-conversation participant (idempotent, per PHP). */
export async function addConversationParticipant(conversationId: string | null, userId: string, role: number) {
  if (!conversationId) return;
  const existing = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (existing) return;
  await db.conversationParticipant.create({
    data: { conversationId, userId, role, isActive: true, joinedAt: new Date() },
  });
}

// ─── Access (session user + CommunityRoomUser rows) ──────────────────────────

/** Moderator gate — session role ADMIN/MODERATOR, with the user's role re-read
 *  from the DB (User.isModerator also grants access), per the community contract. */
async function isModerator(session: Session): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { role: true, isModerator: true },
  });
  if (!user) return false;
  return user.role === "ADMIN" || user.role === "MODERATOR" || user.isModerator === 1;
}

function notFound(msg: string): never {
  throw new ApiError(msg, 404);
}

async function requireRoom(roomId: string): Promise<CommunityRoom> {
  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    log.warn("room_not_found", { roomId });
    notFound("Room not found");
  }
  return room;
}

async function roomRow(roomId: string, userId: string): Promise<CommunityRoomUser | null> {
  return db.communityRoomUser.findFirst({ where: { roomId, userId } });
}

/** The session user's own row in the room — 404 when absent. */
async function requireRoomRow(roomId: string, userId: string): Promise<CommunityRoomUser> {
  const row = await roomRow(roomId, userId);
  if (!row) {
    log.warn("room_membership_not_found", { roomId, userId });
    notFound("You are not a member of this room");
  }
  return row;
}

/** Room admin (type 5) OR a moderator — destructive management actions. */
async function requireRoomAdminOrModerator(roomId: string, session: Session): Promise<void> {
  const row = await roomRow(roomId, session.userId);
  if (row?.type === RU_ADMIN) return;
  if (await isModerator(session)) return;
  log.warn("room_admin_required", { roomId, actor: session.userId });
  throw new ApiError("Only the room admin can do this", 403);
}

/** Room admin or co-admin (3|5) OR a moderator — staff actions (invite, requests). */
async function requireRoomStaff(roomId: string, session: Session): Promise<void> {
  const row = await roomRow(roomId, session.userId);
  if (row?.type === RU_ADMIN || row?.type === RU_CO_ADMIN) return;
  if (await isModerator(session)) return;
  log.warn("room_staff_required", { roomId, actor: session.userId });
  throw new ApiError("Only room admins can do this", 403);
}

// ─── Serializers (camelCase community wire) ──────────────────────────────────

/** CSV string, JSON array or comma list → normalized CSV column value. */
export function csvValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(",");
  return String(v ?? "").trim();
}

/** Minimal me-row for getSuggestedRooms (id + interestIds). */
export async function me(userId: string): Promise<{ id: string; interestIds: string | null }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, interestIds: true } });
  if (!user) notFound("User Not Found");
  return user;
}

export function roomWire(r: RoomRow, extra: Record<string, unknown> = {}) {
  return {
    id: r.id,
    adminId: r.adminId,
    conversationId: r.conversationId,
    photo: r.photo,
    title: r.title,
    desc: r.desc,
    interestIds: r.interestIds,
    isPrivate: r.isPrivate,
    isJoinRequestEnable: r.isJoinRequestEnable,
    totalMember: r.totalMember,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...extra,
  };
}

export function roomMemberWire(
  ru: RoomUserRow,
  extra: { user?: unknown; room?: unknown; invitedUser?: unknown } = {}
) {
  return {
    id: ru.id,
    roomId: ru.roomId,
    userId: ru.userId,
    invitedBy: ru.invitedBy,
    type: ru.type,
    isMute: ru.isMute,
    createdAt: ru.createdAt.toISOString(),
    updatedAt: ru.updatedAt.toISOString(),
    ...extra,
  };
}

export function reportWire(r: CommunityReport) {
  return {
    id: r.id,
    type: r.type,
    roomId: r.roomId,
    userId: r.userId,
    postId: r.postId,
    reelId: r.reelId,
    commentId: r.commentId,
    reason: r.reason,
    desc: r.desc,
    createdAt: r.createdAt.toISOString(),
  };
}

function interestWire(i: { id: number; title: string; createdAt: Date; updatedAt: Date }) {
  return { id: i.id, title: i.title, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() };
}

/** userRoomStatus (0 = none) for a viewer on a list of rooms. */
async function statusMap(userId: string, roomIds: string[]): Promise<Map<string, number>> {
  if (roomIds.length === 0) return new Map();
  const rows = await db.communityRoomUser.findMany({ where: { userId, roomId: { in: roomIds } } });
  return new Map(rows.map((r) => [r.roomId, r.type]));
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/** Rooms I own (legacy fetchMyOwnRooms — insertion order). */
export async function listOwnRooms(myId: string, skip: number, take: number) {
  const where = { adminId: myId };
  const [rows, total] = await Promise.all([
    db.communityRoom.findMany({ where, orderBy: { createdAt: "asc" }, skip, take }),
    db.communityRoom.count({ where }),
  ]);
  return { rows: rows.map((r) => roomWire(r)), total };
}

/** Rooms I'm in as member/co-admin/admin, with the membership row (legacy fetchRoomsList). */
export async function listJoinedRooms(myId: string, skip: number, take: number) {
  const where: Prisma.CommunityRoomUserWhereInput = { userId: myId, type: { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN] } };
  const [rows, total] = await Promise.all([
    db.communityRoomUser.findMany({ where, include: { room: true }, orderBy: { createdAt: "asc" }, skip, take }),
    db.communityRoomUser.count({ where }),
  ]);
  return { rows: rows.map((r) => roomMemberWire(r, { room: roomWire(r.room) })), total };
}

/** Every room_users row of mine (legacy fetchRoomsIAmIn — bare rows). */
export async function listMemberships(myId: string, skip: number, take: number) {
  const where = { userId: myId };
  const [rows, total] = await Promise.all([
    db.communityRoomUser.findMany({ where, orderBy: { createdAt: "asc" }, skip, take }),
    db.communityRoomUser.count({ where }),
  ]);
  return { rows: rows.map((r) => roomMemberWire(r)), total };
}

/**
 * Post::getSuggestedRooms — up to 2 public rooms I'm not in, preferring my
 * interests (the shared implementation the posts feed reuses). Includes
 * userRoomStatus for the viewer.
 */
export async function getSuggestedRooms(me: { id: string; interestIds: string | null | undefined }) {
  const limit = await roomUsersLimit();

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

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked: RoomRow[] = [];
  const push = (room: RoomRow) => {
    if (picked.length < 2 && !picked.some((r) => r.id === room.id)) picked.push(room);
  };

  const interests = [...csvList(me.interestIds)];
  for (let i = interests.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [interests[i], interests[j]] = [interests[j], interests[i]];
  }
  if (interests.length === 0) {
    shuffled.slice(0, 2).forEach(push);
  } else {
    for (const interestId of interests) {
      if (picked.length >= 2) break;
      for (const room of shuffled) {
        if (picked.length >= 2) break;
        if (!csvList(room.interestIds).includes(interestId)) continue;
        if (room.totalMember >= limit) continue;
        push(room);
      }
    }
    // Fewer than 2 found → top up with random public rooms.
    for (const room of shuffled) {
      if (picked.length >= 2) break;
      push(room);
    }
  }

  const statuses = await statusMap(me.id, picked.map((r) => r.id));
  return picked.map((r) => roomWire(r, { userRoomStatus: statuses.get(r.id) ?? 0 }));
}

/** Random public rooms from non-blocked admins (legacy fetchRandomRooms). */
export async function listRandomRooms(myId: string, limit: number) {
  const blockedAdminIds = (await db.user.findMany({ where: { isBlock: 1 }, select: { id: true } })).map((u) => u.id);
  const rooms = await randomRooms(
    {
      ...(blockedAdminIds.length ? { adminId: { notIn: blockedAdminIds } } : {}),
      isPrivate: 0,
    },
    limit
  );
  const statuses = await statusMap(myId, rooms.map((r) => r.id));
  return rooms.map((r) => roomWire(r, { userRoomStatus: statuses.get(r.id) ?? 0 }));
}

/** Public, non-full rooms matching a CSV interest (legacy fetchRoomsByInterest). */
export async function listRoomsByInterest(myId: string, interestId: string, skip: number, take: number) {
  const settingLimit = await roomUsersLimit();
  const matching = await matchingRoomIds(interestId);
  const where: Prisma.CommunityRoomWhereInput = {
    id: { in: matching },
    admin: { isBlock: UNBLOCKED },
    isPrivate: 0,
    totalMember: { not: settingLimit },
  };
  const [rooms, total] = await Promise.all([
    db.communityRoom.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    db.communityRoom.count({ where }),
  ]);
  const statuses = await statusMap(myId, rooms.map((r) => r.id));
  return { rows: rooms.map((r) => roomWire(r, { userRoomStatus: statuses.get(r.id) ?? 0 })), total };
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/**
 * Room detail + viewer status + interests + admin (+ members when asked).
 * Auto-creates the linked group conversation when missing and backfills the
 * participants (legacy behavior). A viewer without a room_users row gets
 * userRoomStatus 0 (the legacy mobile wire rejected them instead).
 */
export async function roomDetail(myId: string, roomId: string, showMembers: boolean) {
  let room = await db.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) notFound("Room not found");

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
    log.info("room_conversation_created", { roomId: room.id, conversationId: room.conversationId });
  }

  const userRoomStatus = await roomRow(room.id, myId);
  const interests = await db.communityInterest.findMany({
    where: { id: { in: csvList(room.interestIds).map(Number).filter(Number.isFinite) } },
  });

  const result: Record<string, unknown> = {
    ...roomWire(room),
    userRoomStatus: userRoomStatus?.type ?? 0,
    isMute: userRoomStatus?.isMute ?? 0,
    interests: interests.map(interestWire),
  };

  const admin = await db.user.findUnique({
    where: { id: room.adminId },
    select: communityAuthorSelect,
  });
  result.admin = communityAuthor(admin);

  if (showMembers) {
    const members = await db.communityRoomUser.findMany({
      where: { roomId: room.id, type: { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN] } },
      include: { user: { select: communityAuthorSelect } },
      orderBy: { createdAt: "asc" },
    });
    result.roomUsers = members.map((m) => communityAuthor(m.user));
  }

  return result;
}

// ─── Create / edit / delete ──────────────────────────────────────────────────

export interface CreateRoomInput {
  title: string;
  desc: string;
  interestIds: string;
  isPrivate: number;
  isJoinRequestEnable: number;
}

/** Create a room: linked group Conversation + admin RoomUser(5) + participant. */
export async function createRoom(session: Session, input: CreateRoomInput, photoUrl: string | null) {
  if (!input.title) throw new ApiError("The title field is required", 400);
  if (!input.desc) throw new ApiError("The desc field is required", 400);

  const conversation = await db.conversation.create({
    data: { type: 2, groupName: input.title, adminId: session.userId, groupPhoto: photoUrl },
  });

  const room = await db.communityRoom.create({
    data: {
      adminId: session.userId,
      conversationId: conversation.id,
      photo: photoUrl,
      title: input.title,
      desc: input.desc,
      interestIds: input.interestIds,
      isPrivate: input.isPrivate,
      isJoinRequestEnable: input.isJoinRequestEnable,
      totalMember: 1,
    },
  });
  await invalidateCatalog("interests");

  await db.communityRoomUser.create({
    data: { roomId: room.id, userId: session.userId, type: RU_ADMIN },
  });

  await db.conversationParticipant.create({
    data: { conversationId: conversation.id, userId: session.userId, role: 2, isActive: true, joinedAt: new Date() },
  });

  return { ...roomWire(room), conversationId: conversation.id };
}

export interface EditRoomPatch {
  title?: string;
  desc?: string;
  interestIds?: string;
  isPrivate?: number;
  isJoinRequestEnable?: number;
}

/** Edit a room (only present fields) — room admin or moderator. */
export async function editRoom(session: Session, roomId: string, patch: EditRoomPatch, photoUrl: string | null) {
  const room = await requireRoom(roomId);
  await requireRoomAdminOrModerator(room.id, session);

  const data: Prisma.CommunityRoomUpdateInput = {};
  if (photoUrl) {
    await deleteFileByUrl(room.photo);
    data.photo = photoUrl;
  }
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.desc !== undefined) data.desc = patch.desc;
  if (patch.interestIds !== undefined) data.interestIds = patch.interestIds;
  if (patch.isPrivate !== undefined) data.isPrivate = patch.isPrivate;
  if (patch.isJoinRequestEnable !== undefined) data.isJoinRequestEnable = patch.isJoinRequestEnable;

  if (Object.keys(data).length > 0) {
    await db.communityRoom.update({ where: { id: room.id }, data });
  }
  const fresh = await db.communityRoom.findUnique({ where: { id: room.id } });
  return roomWire(fresh ?? room);
}

/**
 * Delete a room and its dependents (photo file, members, notifications, room
 * reports) — room admin (legacy deleteRoom) OR moderator (legacy
 * Moderator/deleteRoomByModerator).
 */
export async function deleteRoom(session: Session, roomId: string) {
  const room = await requireRoom(roomId);
  await requireRoomAdminOrModerator(room.id, session);

  await deleteFileByUrl(room.photo);
  await db.communityRoomUser.deleteMany({ where: { roomId: room.id } });
  await db.savedNotification.deleteMany({ where: { roomId: room.id } });
  await db.communityReport.deleteMany({ where: { roomId: room.id, type: 0 } });
  await db.communityRoom.delete({ where: { id: room.id } });
  await invalidateCatalog("interests");

  return roomWire(room);
}

// ─── Membership (join / leave / report / mute) ───────────────────────────────

/** Join request (type 1) or direct join (type 2) per room config. */
export async function joinRoom(session: Session, roomId: string) {
  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: session.userId } });
  if (!user) {
    log.warn("room_join_user_blocked", { actor: session.userId });
    notFound("User Not Found");
  }

  const room = await db.communityRoom.findUnique({ where: { id: roomId }, include: { admin: true } });
  if (!room) notFound("Room Not Found");

  const existing = await roomRow(room.id, user.id);
  if (existing) {
    log.warn("room_join_duplicate", { roomId: room.id, actor: user.id });
    throw new ApiError("Already in room users list", 409);
  }

  const limit = await roomUsersLimit();

  if (room.isJoinRequestEnable === 1) {
    const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, false) });
    if (memberCount >= limit) {
      log.warn("room_join_limit_reached", { roomId: room.id, actor: user.id, mode: "request" });
      throw new ApiError("Room users limit reached", 400);
    }

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

    return roomMemberWire(roomUser, { room: roomWire(room) });
  }

  const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, true) });
  if (memberCount >= limit) {
    log.warn("room_join_limit_reached", { roomId: room.id, actor: user.id, mode: "direct" });
    throw new ApiError("Room users limit reached", 400);
  }

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

  return roomMemberWire(roomUser, { room: roomWire(room) });
}

/** Leave a room (deletes the membership row, decrements totalMember). */
export async function leaveRoom(session: Session, roomId: string) {
  const room = await requireRoom(roomId);
  const row = await requireRoomRow(room.id, session.userId);

  await db.communityRoom.update({
    where: { id: room.id },
    data: { totalMember: Math.max(0, room.totalMember - 1) },
  });
  await db.communityRoomUser.delete({ where: { id: row.id } });

  const oldNotification = await db.savedNotification.findFirst({
    where: { roomId: room.id, userId: session.userId, type: TYPE_ACCEPT_ROOM_REQUEST },
  });
  if (oldNotification) await db.savedNotification.delete({ where: { id: oldNotification.id } });

  return roomMemberWire(row);
}

/** Report a room (CommunityReport type 0). */
export async function reportRoom(session: Session, roomId: string, reason: string, desc: string) {
  if (!reason) throw new ApiError("The reason field is required", 400);
  if (!desc) throw new ApiError("The desc field is required", 400);

  const room = await requireRoom(roomId);
  const report = await db.communityReport.create({
    data: { type: 0, roomId: room.id, userId: session.userId, reason, desc },
  });
  return reportWire(report);
}

/** Mute/unmute room notifications for the session user (toggle when isMute omitted). */
export async function setMute(session: Session, roomId: string, isMute?: number) {
  const room = await db.communityRoom.findUnique({ where: { id: roomId } });
  const row = await db.communityRoomUser.findFirst({ where: { roomId, userId: session.userId } });
  if (!room || !row) {
    log.warn("room_mute_membership_missing", { roomId, actor: session.userId });
    throw new ApiError("Something went wrong", 404);
  }

  const next = isMute !== undefined ? (isMute ? 1 : 0) : row.isMute ? 0 : 1;
  const updated = await db.communityRoomUser.update({ where: { id: row.id }, data: { isMute: next } });
  return roomMemberWire(updated);
}

// ─── Invitations ─────────────────────────────────────────────────────────────

/** Invite a user (RoomUser type 4 + SavedNotification type 4 + push) — staff only. */
export async function inviteUser(session: Session, roomId: string, userId: string) {
  if (!userId) throw new ApiError("The userId field is required", 400);

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) {
    log.warn("room_invite_user_not_found", { userId, actor: session.userId });
    notFound("User Not Found");
  }

  const room = await db.communityRoom.findUnique({ where: { id: roomId }, include: { admin: true } });
  if (!room) notFound("Room Not Found");
  await requireRoomStaff(room.id, session);

  if (room.adminId === userId) {
    log.warn("room_invite_admin_self", { roomId: room.id, invitedUserId: userId, actor: session.userId });
    throw new ApiError("Lol, You are the Admin of the room", 400);
  }

  const existing = await db.communityRoomUser.findFirst({ where: { roomId: room.id, userId } });
  if (existing) {
    log.warn("room_invite_duplicate", { roomId: room.id, invitedUserId: userId, actor: session.userId });
    throw new ApiError("User record already exists", 409);
  }

  const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, true) });
  const limit = await roomUsersLimit();
  if (memberCount >= limit) {
    log.warn("room_invite_limit_reached", { roomId: room.id, invitedUserId: userId, actor: session.userId });
    throw new ApiError("Room users limit reached", 400);
  }

  const roomUser = await db.communityRoomUser.create({
    data: { roomId: room.id, userId: user.id, invitedBy: session.userId, type: RU_INVITED },
  });

  if (user.isPushNotifications === PUSH_ON) {
    await sendPush({
      userId: user.id,
      title: PUSH_TITLE,
      body: `${session.name} has invited to room : ${room.title}`,
      type: "ROOM_INVITE",
      data: { room_id: room.id, type: TYPE_ROOM_INVITE },
    });
  }

  await db.savedNotification.create({
    data: { myUserId: user.id, userId: session.userId, roomId: room.id, type: TYPE_ROOM_INVITE },
  });

  return roomMemberWire(roomUser, { room: roomWire(room) });
}

/** My pending invitations (RoomUser type 4 rows) with room + inviter. */
export async function listInvitations(myId: string, skip: number, take: number) {
  const where: Prisma.CommunityRoomUserWhereInput = { userId: myId, type: RU_INVITED };
  const [rows, total] = await Promise.all([
    db.communityRoomUser.findMany({ where, include: { room: true }, orderBy: { createdAt: "asc" }, skip, take }),
    db.communityRoomUser.count({ where }),
  ]);

  const inviterIds = [...new Set(rows.map((r) => r.invitedBy).filter((v): v is string => Boolean(v)))];
  const inviters = inviterIds.length
    ? await db.user.findMany({ where: { id: { in: inviterIds } }, select: communityUserSelect })
    : [];
  const inviterById = new Map(inviters.map((u) => [u.id, u]));

  return {
    rows: rows.map((r) =>
      roomMemberWire(r, {
        room: roomWire(r.room),
        invitedUser: r.invitedBy ? (inviterById.has(r.invitedBy) ? communityUser(inviterById.get(r.invitedBy)!) : null) : null,
      })
    ),
    total,
  };
}

/** Accept my invitation (or join request) — row becomes member (2). */
export async function acceptInvitation(session: Session, roomId: string) {
  const userId = session.userId;
  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) notFound("User Not Found");

  const room = await requireRoom(roomId);
  const row = await requireRoomRow(room.id, userId);
  if (row.type === RU_MEMBER) {
    log.warn("room_invitation_already_accepted", { roomId: room.id, actor: userId });
    throw new ApiError("Invitation Already Accepted", 400);
  }
  if (row.type !== RU_REQUEST && row.type !== RU_INVITED) {
    log.warn("room_invitation_invalid_state", { roomId: room.id, actor: userId, memberType: row.type });
    throw new ApiError("Record not found", 400);
  }

  const inviter = row.invitedBy ? await db.user.findUnique({ where: { id: row.invitedBy } }) : null;

  await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_MEMBER } });
  await db.communityRoom.update({ where: { id: room.id }, data: { totalMember: { increment: 1 } } });
  await addConversationParticipant(room.conversationId, userId, 1);

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
    data: { myUserId: room.adminId, userId, roomId: room.id, type: TYPE_ACCEPT_INVITE_ROOM },
  });

  const fresh = await db.communityRoomUser.findUnique({ where: { id: row.id } });
  return roomMemberWire(fresh ?? row, { room: roomWire(room) });
}

/** Reject my invitation — deletes the membership row. */
export async function rejectInvitation(session: Session, roomId: string) {
  const userId = session.userId;
  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) notFound("User Not Found");

  const room = await requireRoom(roomId);
  const row = await requireRoomRow(room.id, userId);

  await db.communityRoomUser.delete({ where: { id: row.id } });
  return roomMemberWire(row);
}

// ─── Join requests (admin side) ──────────────────────────────────────────────

/** Pending join requests (RoomUser type 1 rows) with the requesting user. */
export async function listRequests(session: Session, roomId: string, skip: number, take: number) {
  const room = await requireRoom(roomId);
  await requireRoomStaff(room.id, session);

  const where: Prisma.CommunityRoomUserWhereInput = { roomId: room.id, type: RU_REQUEST };
  const [requestRows, total] = await Promise.all([
    db.communityRoomUser.findMany({ where, include: { user: { select: communityUserSelect } }, orderBy: { createdAt: "asc" }, skip, take }),
    db.communityRoomUser.count({ where }),
  ]);
  return {
    rows: requestRows.map((r) => roomMemberWire(r, { user: communityUser(r.user) })),
    total,
  };
}

/** Accept a join request (1 → 2) — room admin or moderator. */
export async function acceptRequest(session: Session, roomId: string, userId: string) {
  const room = await db.communityRoom.findUnique({ where: { id: roomId }, include: { admin: true } });
  if (!room) notFound("Room Not Found");
  await requireRoomAdminOrModerator(room.id, session);

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) {
    log.warn("room_user_blocked", { roomId: room.id, targetUserId: userId, actor: session.userId });
    notFound("User Not Found");
  }

  const row = await db.communityRoomUser.findFirst({ where: { roomId: room.id, userId } });
  if (!row) {
    log.warn("room_request_not_found", { roomId: room.id, targetUserId: userId, actor: session.userId });
    notFound("Record Not found");
  }
  if (row.type === RU_MEMBER) {
    log.warn("room_request_already_accepted", { roomId: room.id, targetUserId: userId, actor: session.userId });
    throw new ApiError("Invitation Already Accepted", 400);
  }

  const memberCount = await db.communityRoomUser.count({ where: memberCountWhere(room.id, true) });
  const limit = await roomUsersLimit();
  if (memberCount >= limit) {
    log.warn("room_accept_limit_reached", { roomId: room.id, targetUserId: userId, actor: session.userId });
    throw new ApiError("Room users limit reached", 400);
  }

  await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_MEMBER } });
  await db.communityRoom.update({ where: { id: room.id }, data: { totalMember: { increment: 1 } } });
  await addConversationParticipant(room.conversationId, userId, 1);

  // push goes TO the requesting user (their request was accepted)
  if (room.adminId !== userId && user.isPushNotifications === PUSH_ON) {
    await sendPush({
      userId,
      title: PUSH_TITLE,
      body: `${session.name} has accepted your join request of room : ${room.title}`,
      type: "ROOM_JOIN",
      data: { room_id: room.id, type: TYPE_ACCEPT_ROOM_REQUEST },
    });
  }

  const oldNotification = await db.savedNotification.findFirst({
    where: { roomId: room.id, userId, type: TYPE_JOIN_ROOM },
  });
  if (oldNotification) await db.savedNotification.delete({ where: { id: oldNotification.id } });

  await db.savedNotification.create({
    data: { myUserId: userId, userId: room.adminId, roomId: room.id, type: TYPE_ACCEPT_ROOM_REQUEST },
  });

  const fresh = await db.communityRoomUser.findUnique({ where: { id: row.id } });
  return roomMemberWire(fresh ?? row, { room: roomWire(room) });
}

/** Reject a join request — deletes the row + the join-request notification. */
export async function rejectRequest(session: Session, roomId: string, userId: string) {
  const room = await requireRoom(roomId);
  await requireRoomAdminOrModerator(room.id, session);

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) notFound("User Not Found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId: room.id, userId } });
  if (!row) {
    log.warn("room_request_not_found", { roomId: room.id, targetUserId: userId, actor: session.userId });
    notFound("Record does not exist");
  }

  await db.communityRoomUser.delete({ where: { id: row.id } });

  const oldNotification = await db.savedNotification.findFirst({
    where: { roomId: room.id, userId, type: TYPE_JOIN_ROOM },
  });
  if (oldNotification) await db.savedNotification.delete({ where: { id: oldNotification.id } });

  return roomMemberWire(row);
}

// ─── Members & admins ────────────────────────────────────────────────────────

/** Member list (RoomUser type 2|3|5 rows) with the user. */
export async function listMembers(roomId: string, skip: number, take: number) {
  const room = await requireRoom(roomId);
  const where: Prisma.CommunityRoomUserWhereInput = {
    roomId: room.id,
    type: { in: [RU_MEMBER, RU_CO_ADMIN, RU_ADMIN] },
  };
  const [rows, total] = await Promise.all([
    db.communityRoomUser.findMany({ where, include: { user: { select: communityUserSelect } }, orderBy: { createdAt: "asc" }, skip, take }),
    db.communityRoomUser.count({ where }),
  ]);
  return { rows: rows.map((r) => roomMemberWire(r, { user: communityUser(r.user) })), total };
}

/** Remove a member — room admin/co-admin or moderator (legacy removeUserFromRoom). */
export async function removeMember(session: Session, roomId: string, userId: string) {
  const room = await requireRoom(roomId);
  await requireRoomStaff(room.id, session);

  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: userId } });
  if (!user) {
    log.warn("room_remove_user_not_found", { roomId: room.id, targetUserId: userId, actor: session.userId });
    notFound("User Not Found");
  }

  const row = await db.communityRoomUser.findFirst({ where: { roomId: room.id, userId } });
  if (!row) {
    log.warn("room_remove_membership_not_found", { roomId: room.id, targetUserId: userId, actor: session.userId });
    notFound("User Not Found");
  }

  await db.communityRoom.update({
    where: { id: room.id },
    data: { totalMember: Math.max(0, room.totalMember - 1) },
  });
  await db.communityRoomUser.delete({ where: { id: row.id } });
  return roomMemberWire(row);
}

/** Admin list (RoomUser type 3|5 rows) with the user. */
export async function listAdmins(roomId: string) {
  const room = await requireRoom(roomId);
  const rows = await db.communityRoomUser.findMany({
    where: { roomId: room.id, type: { in: [RU_CO_ADMIN, RU_ADMIN] } },
    include: { user: { select: communityUserSelect } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => roomMemberWire(r, { user: communityUser(r.user) }));
}

/** Promote a member to co-admin (type 3) — room admin or moderator. */
export async function makeAdmin(session: Session, roomId: string, userId: string) {
  const room = await requireRoom(roomId);
  await requireRoomAdminOrModerator(room.id, session);

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) notFound("User not found");

  const row = await db.communityRoomUser.findFirst({ where: { roomId: room.id, userId } });
  if (!row) {
    log.warn("room_promote_membership_not_found", { roomId: room.id, targetUserId: userId, actor: session.userId });
    notFound("Room user not found");
  }

  const updated = await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_CO_ADMIN } });
  return roomMemberWire(updated);
}

/** Demote a co-admin (3 → 2) — room admin or moderator. */
export async function removeAdmin(session: Session, roomId: string, userId: string) {
  const room = await requireRoom(roomId);
  await requireRoomAdminOrModerator(room.id, session);

  const row = await db.communityRoomUser.findFirst({ where: { roomId: room.id, userId, type: RU_CO_ADMIN } });
  if (!row) {
    log.warn("room_demote_not_co_admin", { roomId: room.id, targetUserId: userId, actor: session.userId });
    throw new ApiError("Already User not co-admin", 400);
  }

  const updated = await db.communityRoomUser.update({ where: { id: row.id }, data: { type: RU_MEMBER } });
  return roomMemberWire(updated);
}

/** Invitable users for a room (not already in it, not blocked by me,
 *  isInvitedToRoom=1) — legacy searchUserForInvitation. */
export async function invitableUsers(session: Session, roomId: string, keyword: string, skip: number, take: number) {
  const user = await db.user.findFirst({ where: { isBlock: UNBLOCKED, id: session.userId } });
  if (!user) notFound("User Not Found");

  const room = await requireRoom(roomId);

  const blockUserIds = csvList(user.blockUserIds);
  const alreadyInRoom = (
    await db.communityRoomUser.findMany({ where: { roomId: room.id }, select: { userId: true } })
  ).map((r) => r.userId);

  const where: Prisma.UserWhereInput = {
    isBlock: UNBLOCKED,
    isInvitedToRoom: 1,
    // legacy: notIn(ids already in the room) AND notIn(my blocked users)
    ...(alreadyInRoom.length || blockUserIds.length
      ? { id: { notIn: [...alreadyInRoom, ...blockUserIds] } }
      : {}),
    OR: [{ username: { contains: keyword } }, { name: { contains: keyword } }],
  };

  const [users, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "asc" }, skip, take, select: communityUserSelect }),
    db.user.count({ where }),
  ]);
  return { rows: users.map((u) => communityUser(u)), total };
}
