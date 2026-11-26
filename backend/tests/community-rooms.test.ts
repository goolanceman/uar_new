/**
 * S4 — generic /api/rooms REST endpoints shared by web + mobile (community
 * migration).
 *
 * Ports of the legacy mobile-only room handlers (src/routes/mobile/reels-rooms.ts
 * RoomController + Moderator/deleteRoomByModerator): create/edit/delete, detail
 * (+ auto group conversation), join/leave, mute, report, invitations, join
 * requests, members/admins, suggested/random/by-interest lists.
 *
 * Runs against the TEST database and only touches rows it creates (users with
 * a unique email prefix + their direct children).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `s4-${Date.now()}`;
const PASSWORD = "password123";
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex");
const pngFile = { filename: "room.png", contentType: "image/png" };

let app: express.Express;
let aToken = ""; // room owner
let bToken = ""; // normal member
let cToken = ""; // member + moderator (isModerator = 1)
let aId = "";
let bId = "";
let cId = "";
let interestId = 0;
const roomIds: string[] = [];

async function buildApp() {
  const { router: roomsRouter } = await import("@/routes/rooms");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/rooms", roomsRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const rooms = await db.communityRoom.findMany({ where: { adminId: { in: ids } }, select: { id: true, conversationId: true } });
    for (const room of rooms) {
      if (room.conversationId) {
        await db.conversationParticipant.deleteMany({ where: { conversationId: room.conversationId } });
        await db.conversation.deleteMany({ where: { id: room.conversationId } });
      }
    }
    await db.savedNotification.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.notification.deleteMany({ where: { userId: { in: ids } } });
    await db.communityReport.deleteMany({ where: { OR: [{ userId: { in: ids } }, { roomId: { in: rooms.map((r) => r.id) } }] } });
    await db.communityRoom.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { id: { in: rooms.map((r) => r.id) } }] } });
    await db.communityRoomUser.deleteMany({ where: { userId: { in: ids } } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (interestId) await db.communityInterest.deleteMany({ where: { id: interestId } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");
  const { hashPassword, issueToken } = await import("@/lib/session");

  const mk = (email: string, name: string, username: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        email,
        name,
        username,
        role: "DONOR",
        password: hashPassword(PASSWORD),
        status: "ACTIVE",
        isActive: true,
        ...extra,
      },
    });

  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} alice`, `${PREFIX}-alice`);
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} bob`, `${PREFIX}-bob`);
  const c = await mk(`${PREFIX}-c@test.local`, `${PREFIX} carol`, `${PREFIX}-carol`, { isModerator: 1 });
  aId = a.id;
  bId = b.id;
  cId = c.id;

  const token = (u: { id: string; role: string; name: string; email: string }) =>
    issueToken({ userId: u.id, role: u.role, name: u.name, email: u.email });
  aToken = token(a);
  bToken = token(b);
  cToken = token(c);

  const interest = await db.communityInterest.create({ data: { title: `${PREFIX} interest` } });
  interestId = interest.id;
  await db.user.update({ where: { id: bId }, data: { interestIds: String(interest.id) } });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

describe("S4 room create + detail", () => {
  it("requires auth and rejects a room without a title", async () => {
    const noAuth = await request(app).get("/api/rooms/mine");
    expect(noAuth.status).toBe(401);

    const noTitle = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${aToken}`)
      .field("desc", "no title here");
    expect(noTitle.status).toBe(400);
  });

  it("creates a room with a photo, group conversation, admin row and participant", async () => {
    const { db } = await import("@/lib/db");
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${aToken}`)
      .field("title", `${PREFIX} room one`)
      .field("desc", "first room")
      .field("interestIds", String(interestId))
      .field("isPrivate", "0")
      .field("isJoinRequestEnable", "0")
      .attach("photo", PNG, pngFile);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(`${PREFIX} room one`);
    expect(res.body.totalMember).toBe(1);
    expect(res.body.conversationId).toBeTruthy();
    expect(res.body.photo).toContain("/api/files/");
    roomIds.push(res.body.id);

    const room = await db.communityRoom.findUnique({ where: { id: res.body.id } });
    expect(room?.isPrivate).toBe(0);
    expect(room?.isJoinRequestEnable).toBe(0);
    expect(room?.interestIds).toBe(String(interestId));

    const conversation = await db.conversation.findUnique({ where: { id: room!.conversationId! } });
    expect(conversation?.type).toBe(2);
    expect(conversation?.groupName).toBe(`${PREFIX} room one`);
    const participant = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: conversation!.id, userId: aId } },
    });
    expect(participant?.role).toBe(2);
    const adminRow = await db.communityRoomUser.findFirst({ where: { roomId: room!.id, userId: aId } });
    expect(adminRow?.type).toBe(5); // RU_ADMIN
  });

  it("creates a join-request room without a photo", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${aToken}`)
      .field("title", `${PREFIX} room two`)
      .field("desc", "second room")
      .field("interestIds", String(interestId))
      .field("isJoinRequestEnable", "1");
    expect(res.status).toBe(200);
    expect(res.body.isJoinRequestEnable).toBe(1);
    roomIds.push(res.body.id);
  });

  it("lists my own rooms and shows the detail with viewer status", async () => {
    const mine = await request(app).get("/api/rooms/mine").set("Authorization", `Bearer ${aToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((r: { id: string }) => r.id)).toEqual(roomIds);

    const detail = await request(app)
      .get(`/api/rooms/${roomIds[0]}`)
      .query({ showMembers: 1 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.userRoomStatus).toBe(5); // admin
    expect(detail.body.admin?.id).toBe(aId);
    expect(detail.body.interests[0]?.id).toBe(interestId);
    expect(detail.body.roomUsers.map((u: { id: string }) => u.id)).toContain(aId);

    // A viewer without a membership row gets userRoomStatus 0 (web can browse).
    const outsider = await request(app).get(`/api/rooms/${roomIds[0]}`).set("Authorization", `Bearer ${bToken}`);
    expect(outsider.status).toBe(200);
    expect(outsider.body.userRoomStatus).toBe(0);
    expect(outsider.body.isMute).toBe(0);
  });

  it("edits a room (admin only, multipart photo)", async () => {
    const forbidden = await request(app)
      .patch(`/api/rooms/${roomIds[0]}`)
      .set("Authorization", `Bearer ${bToken}`)
      .field("title", "hijacked");
    expect(forbidden.status).toBe(403);

    const res = await request(app)
      .patch(`/api/rooms/${roomIds[0]}`)
      .set("Authorization", `Bearer ${aToken}`)
      .field("desc", "edited desc")
      .attach("photo", PNG, pngFile);
    expect(res.status).toBe(200);
    expect(res.body.desc).toBe("edited desc");
    expect(res.body.title).toBe(`${PREFIX} room one`); // untouched field stays
    expect(res.body.photo).toContain("/api/files/");
  });
});

describe("S4 room lists", () => {
  it("finds rooms by interest with the viewer status", async () => {
    const res = await request(app)
      .get(`/api/rooms/by-interest/${interestId}`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((r: { id: string }) => r.id);
    expect(ids).toContain(roomIds[0]);
    expect(ids).toContain(roomIds[1]);
    expect(res.body.items[0].userRoomStatus).toBe(0);
  });

  it("suggests up to 2 public rooms I am not in, preferring my interests", async () => {
    const res = await request(app).get("/api/rooms/suggested").set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(2);
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(roomIds[0]);
    expect(res.body.items.every((r: { adminId: string }) => r.adminId !== bId)).toBe(true);
  });

  it("lists random public rooms with the viewer status", async () => {
    const res = await request(app).get("/api/rooms/random").query({ limit: 50 }).set("Authorization", `Bearer ${cToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(roomIds[0]);
  });
});

describe("S4 membership", () => {
  it("joins a direct-join room: member row, totalMember and conversation participant", async () => {
    const { db } = await import("@/lib/db");
    const res = await request(app).post(`/api/rooms/${roomIds[0]}/join`).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe(2); // RU_MEMBER
    expect(res.body.room.id).toBe(roomIds[0]);

    const room = await db.communityRoom.findUnique({ where: { id: roomIds[0] } });
    expect(room?.totalMember).toBe(2);
    const conversationId = room!.conversationId!;
    const participant = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: bId } },
    });
    expect(participant?.role).toBe(1);

    const again = await request(app).post(`/api/rooms/${roomIds[0]}/join`).set("Authorization", `Bearer ${bToken}`);
    expect(again.status).toBe(409);

    const joined = await request(app).get("/api/rooms/joined").set("Authorization", `Bearer ${bToken}`);
    expect(joined.body.items.map((m: { room: { id: string } }) => m.room.id)).toContain(roomIds[0]);
    const memberships = await request(app).get("/api/rooms/memberships").set("Authorization", `Bearer ${bToken}`);
    expect(memberships.body.items.map((m: { roomId: string }) => m.roomId)).toContain(roomIds[0]);
  });

  it("lists members with their profiles", async () => {
    const res = await request(app).get(`/api/rooms/${roomIds[0]}/members`).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    const types = new Map(res.body.items.map((m: { userId: string; type: number }) => [m.userId, m.type]));
    expect(types.get(aId)).toBe(5);
    expect(types.get(bId)).toBe(2);
    expect(res.body.items[0].user.name).toContain("s4");
  });

  it("mutes and unmutes room notifications (explicit + toggle)", async () => {
    const set = await request(app).post(`/api/rooms/${roomIds[0]}/mute`).set("Authorization", `Bearer ${bToken}`).send({ isMute: 1 });
    expect(set.status).toBe(200);
    expect(set.body.isMute).toBe(1);

    const toggle = await request(app).post(`/api/rooms/${roomIds[0]}/mute`).set("Authorization", `Bearer ${bToken}`);
    expect(toggle.body.isMute).toBe(0);
  });

  it("promotes and demotes a co-admin (admin only)", async () => {
    const forbidden = await request(app).post(`/api/rooms/${roomIds[0]}/admins/${bId}`).set("Authorization", `Bearer ${bToken}`);
    expect(forbidden.status).toBe(403);

    const promote = await request(app).post(`/api/rooms/${roomIds[0]}/admins/${bId}`).set("Authorization", `Bearer ${aToken}`);
    expect(promote.status).toBe(200);
    expect(promote.body.type).toBe(3); // co-admin

    const admins = await request(app).get(`/api/rooms/${roomIds[0]}/admins`).set("Authorization", `Bearer ${aToken}`);
    expect(admins.body.items.map((m: { userId: string }) => m.userId)).toEqual(expect.arrayContaining([aId, bId]));

    const demote = await request(app).delete(`/api/rooms/${roomIds[0]}/admins/${bId}`).set("Authorization", `Bearer ${aToken}`);
    expect(demote.status).toBe(200);
    expect(demote.body.type).toBe(2);
  });

  it("lets a member leave the room", async () => {
    const { db } = await import("@/lib/db");
    const res = await request(app).post(`/api/rooms/${roomIds[0]}/leave`).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    const room = await db.communityRoom.findUnique({ where: { id: roomIds[0] } });
    expect(room?.totalMember).toBe(1);
    expect(await db.communityRoomUser.findFirst({ where: { roomId: roomIds[0], userId: bId } })).toBeNull();
  });
});

describe("S4 invitations", () => {
  it("searches invitable users and invites one (staff only)", async () => {
    const forbidden = await request(app)
      .post(`/api/rooms/${roomIds[0]}/invitations`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ userId: cId });
    expect(forbidden.status).toBe(403);

    const search = await request(app)
      .get(`/api/rooms/${roomIds[0]}/invitable-users`)
      .query({ q: `${PREFIX}-carol` })
      .set("Authorization", `Bearer ${aToken}`);
    expect(search.status).toBe(200);
    expect(search.body.items.map((u: { id: string }) => u.id)).toContain(cId);

    const res = await request(app)
      .post(`/api/rooms/${roomIds[0]}/invitations`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({ userId: cId });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe(4); // invited
    expect(res.body.invitedBy).toBe(aId);

    const dup = await request(app)
      .post(`/api/rooms/${roomIds[0]}/invitations`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({ userId: cId });
    expect(dup.status).toBe(409);
  });

  it("lists my invitations with the room and the inviter, then accepts", async () => {
    const { db } = await import("@/lib/db");
    const list = await request(app).get("/api/rooms/invitations").set("Authorization", `Bearer ${cToken}`);
    expect(list.status).toBe(200);
    const invite = list.body.items.find((i: { room: { id: string } }) => i.room.id === roomIds[0]);
    expect(invite?.invitedUser?.id).toBe(aId);

    const res = await request(app).post(`/api/rooms/${roomIds[0]}/invitations/accept`).set("Authorization", `Bearer ${cToken}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe(2);

    const room = await db.communityRoom.findUnique({ where: { id: roomIds[0] } });
    expect(room?.totalMember).toBe(2);
    const participant = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: room!.conversationId!, userId: cId } },
    });
    expect(participant).toBeTruthy();

    // The room owner gets the accept-invitation saved notification (type 5).
    const notif = await db.savedNotification.findFirst({
      where: { myUserId: aId, userId: cId, roomId: roomIds[0], type: 5 },
    });
    expect(notif).toBeTruthy();

    const again = await request(app).post(`/api/rooms/${roomIds[0]}/invitations/accept`).set("Authorization", `Bearer ${cToken}`);
    expect(again.status).toBe(400);
  });

  it("rejects a pending invitation", async () => {
    await request(app).post(`/api/rooms/${roomIds[0]}/invitations`).set("Authorization", `Bearer ${aToken}`).send({ userId: bId });
    const res = await request(app).post(`/api/rooms/${roomIds[0]}/invitations/reject`).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
  });

  it("removes a member (staff only)", async () => {
    const forbidden = await request(app).delete(`/api/rooms/${roomIds[0]}/members/${cId}`).set("Authorization", `Bearer ${bToken}`);
    expect(forbidden.status).toBe(403);

    const res = await request(app).delete(`/api/rooms/${roomIds[0]}/members/${cId}`).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    const { db } = await import("@/lib/db");
    const room = await db.communityRoom.findUnique({ where: { id: roomIds[0] } });
    expect(room?.totalMember).toBe(1);
  });
});

describe("S4 join requests", () => {
  it("requests, lists, rejects and accepts join requests", async () => {
    const { db } = await import("@/lib/db");
    // carol requests to join room two (isJoinRequestEnable = 1)
    const req1 = await request(app).post(`/api/rooms/${roomIds[1]}/join`).set("Authorization", `Bearer ${cToken}`);
    expect(req1.status).toBe(200);
    expect(req1.body.type).toBe(1); // requested

    const list = await request(app).get(`/api/rooms/${roomIds[1]}/requests`).set("Authorization", `Bearer ${aToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: { userId: string }) => m.userId)).toEqual([cId]);
    expect(list.body.items[0].user.id).toBe(cId);

    const reject = await request(app)
      .post(`/api/rooms/${roomIds[1]}/requests/${cId}/reject`)
      .set("Authorization", `Bearer ${aToken}`);
    expect(reject.status).toBe(200);
    expect(await db.communityRoomUser.findFirst({ where: { roomId: roomIds[1], userId: cId } })).toBeNull();

    // request again, then the admin accepts
    await request(app).post(`/api/rooms/${roomIds[1]}/join`).set("Authorization", `Bearer ${cToken}`);
    const accept = await request(app)
      .post(`/api/rooms/${roomIds[1]}/requests/${cId}/accept`)
      .set("Authorization", `Bearer ${aToken}`);
    expect(accept.status).toBe(200);
    expect(accept.body.type).toBe(2);
    const room = await db.communityRoom.findUnique({ where: { id: roomIds[1] } });
    expect(room?.totalMember).toBe(2);

    // the requester is notified their request was accepted (type 8)
    const notif = await db.savedNotification.findFirst({
      where: { myUserId: cId, roomId: roomIds[1], type: 8 },
    });
    expect(notif).toBeTruthy();

    const staffList = await request(app).get(`/api/rooms/${roomIds[1]}/requests`).set("Authorization", `Bearer ${bToken}`);
    expect(staffList.status).toBe(403); // only room admins/moderators see requests (bob is neither)
  });
});

describe("S4 report + delete", () => {
  it("reports a room", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomIds[0]}/report`)
      .set("Authorization", `Bearer ${cToken}`)
      .send({ reason: "Spam", desc: "test report" });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe(0);
    expect(res.body.roomId).toBe(roomIds[0]);

    const missing = await request(app)
      .post(`/api/rooms/${roomIds[0]}/report`)
      .set("Authorization", `Bearer ${cToken}`)
      .send({ reason: "Spam" });
    expect(missing.status).toBe(400);
  });

  it("deletes a room as the room admin, cascading dependents", async () => {
    const { db } = await import("@/lib/db");
    const forbidden = await request(app).delete(`/api/rooms/${roomIds[0]}`).set("Authorization", `Bearer ${bToken}`);
    expect(forbidden.status).toBe(403); // plain member

    const res = await request(app).delete(`/api/rooms/${roomIds[0]}`).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(roomIds[0]);
    expect(await db.communityRoom.findUnique({ where: { id: roomIds[0] } })).toBeNull();
    expect(await db.communityRoomUser.count({ where: { roomId: roomIds[0] } })).toBe(0);
    expect(await db.savedNotification.count({ where: { roomId: roomIds[0] } })).toBe(0);
    expect(await db.communityReport.count({ where: { roomId: roomIds[0], type: 0 } })).toBe(0);
  });

  it("deletes a room as a moderator (isModerator, no room row)", async () => {
    const { db } = await import("@/lib/db");
    const res = await request(app).delete(`/api/rooms/${roomIds[1]}`).set("Authorization", `Bearer ${cToken}`);
    expect(res.status).toBe(200);
    expect(await db.communityRoom.findUnique({ where: { id: roomIds[1] } })).toBeNull();
  });
});
