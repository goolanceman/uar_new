/**
 * Community rooms routes — /api/rooms (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile room handlers
 * (src/routes/mobile/reels-rooms.ts RoomController + posts.ts getSuggestedRooms
 * + Moderator/deleteRoomByModerator): the actor is ALWAYS the session user, room
 * admin checks read CommunityRoomUser rows, moderators are role ADMIN/MODERATOR
 * or User.isModerator. All business logic lives in @/lib/community/rooms.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth, ApiError, json, handleError } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { multipart, type MulterFile } from "@/lib/multipart";
import { saveUpload } from "@/lib/files";
import * as rooms from "@/lib/community/rooms";

export const router = Router();

/** Path :id param — reject missing ids early. */
function param(req: Request, name: string): string {
  const v = String((req.params as Record<string, string>)[name] ?? "").trim();
  if (!v) throw new ApiError(`${name} is required`, 400);
  return v;
}

function numParam(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** The uploaded file for a multipart field, or null (same as routes/profile.ts). */
function fieldFile(req: Request, fieldname: string): File | null {
  const files = ((req as Request & { files?: unknown }).files ?? []) as Array<MulterFile & { fieldname?: string }>;
  const f = files.find((x) => x.fieldname === fieldname);
  if (!f) return null;
  return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
}

/** Store an uploaded room photo and return its absolute public URL. */
async function savePhoto(req: Request, fieldname: string): Promise<string | null> {
  const file = fieldFile(req, fieldname);
  if (!file) return null;
  const session = await requireAuth(req);
  const asset = await saveUpload(file, { folder: "rooms", uploadedBy: { id: session.userId, name: session.name } });
  const host = req.get("host") ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
  return `${proto}://${host}/api/files/${asset.id}/file`;
}

// GET /api/rooms/mine — rooms I own (legacy fetchMyOwnRooms).
router.get("/mine", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query, 100);
    const { rows, total } = await rooms.listOwnRooms(session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/joined — memberships (2|3|5) with the room (legacy fetchRoomsList).
router.get("/joined", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query, 100);
    const { rows, total } = await rooms.listJoinedRooms(session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/memberships — every room_users row of mine (legacy fetchRoomsIAmIn).
router.get("/memberships", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query, 100);
    const { rows, total } = await rooms.listMemberships(session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/suggested — up to 2 public rooms I'm not in, preferring my
// interests (legacy getSuggestedRooms / fetchSuggestedRooms — also feeds the
// posts router).
router.get("/suggested", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const user = await rooms.me(session.userId);
    const items = await rooms.getSuggestedRooms(user);
    return json(res, paged(items, 1, 2, items.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/random — random public rooms (legacy fetchRandomRooms).
router.get("/random", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const limit = Math.max(1, Math.min(100, numParam(req.query.limit) ?? 20));
    const items = await rooms.listRandomRooms(session.userId, limit);
    return json(res, paged(items, 1, limit, items.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/invitations — my pending invitations (legacy getInvitationList).
// NOTE: mounted before /:id so "invitations" is not swallowed by the param route.
router.get("/invitations", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await rooms.listInvitations(session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/by-interest/:interestId — public, non-full rooms for an interest
// (legacy fetchRoomsByInterest).
router.get("/by-interest/:interestId", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await rooms.listRoomsByInterest(session.userId, param(req, "interestId"), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms — create a room (multipart photo; legacy createRoom).
router.post("/", multipart, async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const photoUrl = await savePhoto(req, "photo");
    const room = await rooms.createRoom(session, {
      title: String(body.title ?? ""),
      desc: String(body.desc ?? ""),
      interestIds: rooms.csvValue(body.interestIds),
      isPrivate: numParam(body.isPrivate) ?? 0,
      isJoinRequestEnable: numParam(body.isJoinRequestEnable) ?? 0,
    }, photoUrl);
    return json(res, room);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/:id — detail + auto conversation (+ members with ?showMembers=1).
router.get("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const showMembers = numParam(req.query.showMembers) === 1 || req.query.showMembers === "true";
    const detail = await rooms.roomDetail(session.userId, param(req, "id"), showMembers);
    return json(res, detail);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/rooms/:id — edit (multipart photo; legacy editRoom).
router.patch("/:id", multipart, async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const photoUrl = await savePhoto(req, "photo");
    const patch: rooms.EditRoomPatch = {};
    if (body.title !== undefined) patch.title = String(body.title ?? "");
    if (body.desc !== undefined) patch.desc = String(body.desc ?? "");
    if (body.interestIds !== undefined) patch.interestIds = rooms.csvValue(body.interestIds);
    if (body.isPrivate !== undefined) patch.isPrivate = numParam(body.isPrivate) ?? 0;
    if (body.isJoinRequestEnable !== undefined) patch.isJoinRequestEnable = numParam(body.isJoinRequestEnable) ?? 0;
    const room = await rooms.editRoom(session, param(req, "id"), patch, photoUrl);
    return json(res, room);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/rooms/:id — room admin OR moderator (legacy deleteRoom +
// Moderator/deleteRoomByModerator).
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const room = await rooms.deleteRoom(session, param(req, "id"));
    return json(res, room);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/join — join request or direct join (legacy joinOrRequestRoom).
router.post("/:id/join", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.joinRoom(session, param(req, "id"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/leave — leave (legacy leaveThisRoom).
router.post("/:id/leave", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.leaveRoom(session, param(req, "id"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/report — { reason, desc } (legacy reportRoom).
router.post("/:id/report", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const report = await rooms.reportRoom(session, param(req, "id"), String(body.reason ?? ""), String(body.desc ?? ""));
    return json(res, report);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/mute — { isMute? } set or toggle (legacy muteUnmuteRoomNotification).
router.post("/:id/mute", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const member = await rooms.setMute(session, param(req, "id"), numParam(body.isMute));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/invitations — { userId } invite (legacy inviteUserToRoom).
router.post("/:id/invitations", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const member = await rooms.inviteUser(session, param(req, "id"), String(body.userId ?? ""));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/invitations/accept — my invitation (legacy acceptInvitation).
router.post("/:id/invitations/accept", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.acceptInvitation(session, param(req, "id"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/invitations/reject — my invitation (legacy rejectInvitation).
router.post("/:id/invitations/reject", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.rejectInvitation(session, param(req, "id"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/:id/invitable-users?q= — invite picker (legacy searchUserForInvitation).
router.get("/:id/invitable-users", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await rooms.invitableUsers(session, param(req, "id"), String(req.query.q ?? ""), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/:id/requests — pending join requests (legacy fetchRoomRequestList).
router.get("/:id/requests", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await rooms.listRequests(session, param(req, "id"), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/requests/:userId/accept (legacy acceptRoomRequest).
router.post("/:id/requests/:userId/accept", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.acceptRequest(session, param(req, "id"), param(req, "userId"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/requests/:userId/reject (legacy rejectRoomRequest).
router.post("/:id/requests/:userId/reject", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.rejectRequest(session, param(req, "id"), param(req, "userId"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/:id/members — member list (legacy fetchRoomUsersList).
router.get("/:id/members", async (req, res) => {
  try {
    await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await rooms.listMembers(param(req, "id"), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/rooms/:id/members/:userId (legacy removeUserFromRoom).
router.delete("/:id/members/:userId", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.removeMember(session, param(req, "id"), param(req, "userId"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/rooms/:id/admins — co-admins + admin (legacy fetchRoomAdmins).
router.get("/:id/admins", async (req, res) => {
  try {
    await requireAuth(req);
    const items = await rooms.listAdmins(param(req, "id"));
    return json(res, paged(items, 1, items.length, items.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/rooms/:id/admins/:userId — promote to co-admin (legacy makeRoomAdmin).
router.post("/:id/admins/:userId", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.makeAdmin(session, param(req, "id"), param(req, "userId"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/rooms/:id/admins/:userId — demote co-admin (legacy removeAdminFromRoom).
router.delete("/:id/admins/:userId", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const member = await rooms.removeAdmin(session, param(req, "id"), param(req, "userId"));
    return json(res, member);
  } catch (e) {
    return handleError(e, res);
  }
});
