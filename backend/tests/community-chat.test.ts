/**
 * S5 — generic chat + audio-space + realtime endpoints (vitest + supertest).
 *
 * Ports of the legacy mobile-only handlers onto the generic contract:
 *   chat         → /api/chat/* (conversations, cursor-paged messages,
 *                  unread counters, read/mute/clear/delete, media upload,
 *                  MessageSent broadcast + push fan-out)
 *   audio spaces → /api/audio-spaces/* (create/join/leave, roles, mic, kick,
 *                  messages, end)
 *   realtime     → POST /api/realtime/auth (Pusher channel auth) +
 *                  POST /api/realtime/agora-token (participant-checked)
 *
 * Runs against the TEST database and only touches rows it creates (users with
 * a unique email prefix + their direct children).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `s5-${Date.now()}`;
const PASSWORD = "pw-123456";

let app: express.Express;
let aToken = "";
let bToken = "";
let eveToken = "";
let aId = "";
let bId = "";
let eveId = "";
let conversationId = "";
let spaceId = "";
let privateSpaceId = "";
const audioMessageIds: string[] = [];
const png = { filename: "s5.png", contentType: "image/png" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildApp() {
  const [{ router: chatRouter }, { router: audioSpacesRouter }, { router: realtimeRouter }] =
    await Promise.all([import("@/routes/chat"), import("@/routes/audio-spaces"), import("@/routes/realtime")]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/chat", chatRouter);
  a.use("/api/audio-spaces", audioSpacesRouter);
  a.use("/api/realtime", realtimeRouter);
  return a;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const convos = await db.conversation.findMany({
      where: { OR: [{ user1Id: { in: ids } }, { user2Id: { in: ids } }] },
      select: { id: true },
    });
    const convoIds = convos.map((c) => c.id);
    await db.message.deleteMany({ where: { OR: [{ conversationId: { in: convoIds } }, { senderId: { in: ids } }] } });
    await db.conversation.deleteMany({ where: { id: { in: convoIds } } });
    await db.audioSpaceMessage.deleteMany({ where: { audioSpaceId: { in: [spaceId, privateSpaceId].filter(Boolean) } } });
    await db.audioSpaceParticipant.deleteMany({ where: { audioSpaceId: { in: [spaceId, privateSpaceId].filter(Boolean) } } });
    await db.audioSpace.deleteMany({ where: { id: { in: [spaceId, privateSpaceId].filter(Boolean) } } });
    await db.notification.deleteMany({ where: { userId: { in: ids } } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { issueToken, hashPassword } = await import("@/infrastructure/auth/session");

  const mk = (tag: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        email: `${PREFIX}-${tag}@test.local`,
        name: `${PREFIX} ${tag}`,
        role: "DONOR",
        password: hashPassword(PASSWORD),
        ...extra,
      },
    });

  const a = await mk("alice");
  const b = await mk("bob", { username: `${PREFIX}-bob`, avatar: "http://x/bob.png" });
  const eve = await mk("eve");
  aId = a.id;
  bId = b.id;
  eveId = eve.id;
  aToken = issueToken({ userId: a.id, role: a.role, name: a.name, email: a.email });
  bToken = issueToken({ userId: b.id, role: b.role, name: b.name, email: b.email });
  eveToken = issueToken({ userId: eve.id, role: eve.role, name: eve.name, email: eve.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ═══════════════════════════ CONVERSATIONS ═══════════════════════════
describe("POST /api/chat/conversations (create-or-get 1:1)", () => {
  it("creates a conversation with the other user ({userId})", async () => {
    const res = await request(app).post("/api/chat/conversations").set(auth(aToken)).send({ userId: bId });
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe("string");
    expect(res.body.id.length).toBeGreaterThan(10);
    expect(res.body.type).toBe(1);
    expect(res.body.created).toBe(true);
    conversationId = res.body.id;
  });

  it("returns the SAME conversation on the reverse pair (idempotent)", async () => {
    const res = await request(app).post("/api/chat/conversations").set(auth(bToken)).send({ userId: aId });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(conversationId);
    expect(res.body.created).toBe(false);
  });

  it("rejects self, missing and unknown userId", async () => {
    const self = await request(app).post("/api/chat/conversations").set(auth(aToken)).send({ userId: aId });
    expect(self.status).toBe(400);
    const missing = await request(app).post("/api/chat/conversations").set(auth(aToken)).send({});
    expect(missing.status).toBe(400);
    const ghost = await request(app).post("/api/chat/conversations").set(auth(aToken)).send({ userId: "nope" });
    expect(ghost.status).toBe(404);
  });
});

// ═══════════════════════════ SEND / LIST MESSAGES ═══════════════════════════
describe("POST /api/chat/messages + GET .../messages", () => {
  it("sends a text message (camelCase wire, sender embedded)", async () => {
    const res = await request(app)
      .post("/api/chat/messages")
      .set(auth(aToken))
      .send({ conversationId, message: "hello bob", type: 1 });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("hello bob");
    expect(res.body.senderId).toBe(aId);
    expect(res.body.conversationId).toBe(conversationId);
    expect(res.body.type).toBe(1);
    expect(res.body.sender.id).toBe(aId);
    expect(res.body.sender.name).toBe(`${PREFIX} alice`);
    expect(res.body.isRead).toBe(false);
  });

  it("accepts an image message with mediaUrl and an empty caption", async () => {
    const res = await request(app)
      .post("/api/chat/messages")
      .set(auth(aToken))
      .send({ conversationId, message: "", type: 2, mediaUrl: "http://x/y.jpg" });
    expect(res.status).toBe(201);
    expect(res.body.mediaUrl).toBe("http://x/y.jpg");

    // The conversation list advertises the media in lastMessage.
    const list = await request(app).get("/api/chat/conversations").set(auth(bToken));
    const row = list.body.items.find((c: { id: string }) => c.id === conversationId);
    expect(row.lastMessage).toBe("sent an image");
    expect(row.unreadCount).toBe(2); // text + image, bob hasn't read yet
  });

  it("accepts a multipart media upload", async () => {
    const res = await request(app)
      .post("/api/chat/messages")
      .set(auth(aToken))
      .field("conversationId", conversationId)
      .field("message", "")
      .field("type", "2")
      .attach("media", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), png);
    expect(res.status).toBe(201);
    expect(res.body.mediaUrl).toContain("/api/files/");
  });

  it("rejects an empty message with no media, and an invalid/missing type", async () => {
    const empty = await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: "", type: 1 });
    expect(empty.status).toBe(400);
    const badType = await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: "x", type: 9 });
    expect(badType.status).toBe(400);
    const noType = await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: "x" });
    expect(noType.status).toBe(400);
  });

  it("sends via POST /conversations/:id/messages too", async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages`)
      .set(auth(aToken))
      .send({ message: "path variant", type: 1 });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("path variant");
  });

  it("lists messages oldest-first with the sender embedded", async () => {
    const res = await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth(bToken));
    expect(res.status).toBe(200);
    const messages = res.body.items as Array<Record<string, unknown>>;
    expect(messages.length).toBe(4);
    expect(messages[0].message).toBe("hello bob");
    const sender = messages[0].sender as Record<string, unknown>;
    expect(sender.id).toBe(aId);
    expect(sender.name).toBe(`${PREFIX} alice`);
    expect(res.body.conversationId).toBe(conversationId);
  });

  it("denies a non-participant and an unauthenticated reader", async () => {
    const outsider = await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth(eveToken));
    expect(outsider.status).toBe(403);
    const anon = await request(app).get(`/api/chat/conversations/${conversationId}/messages`);
    expect(anon.status).toBe(401);
  });
});

// ═══════════════════════════ UNREAD / READ ═══════════════════════════
describe("unread counters + mark-as-read", () => {
  it("fetching messages marks them read for the caller", async () => {
    await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: "unread probe", type: 1 });
    const theirs = await request(app).get("/api/chat/conversations").set(auth(bToken));
    const theirsRow = theirs.body.items.find((c: { id: string }) => c.id === conversationId);
    expect(theirsRow.unreadCount).toBe(1);

    await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth(bToken));
    const after = await request(app).get("/api/chat/conversations").set(auth(bToken));
    const afterRow = after.body.items.find((c: { id: string }) => c.id === conversationId);
    expect(afterRow.unreadCount).toBe(0);
    const senderRow = (await request(app).get("/api/chat/conversations").set(auth(aToken))).body.items.find(
      (c: { id: string }) => c.id === conversationId
    );
    expect(senderRow.unreadCount).toBe(0); // sender never accumulates
  });

  it("POST /conversations/:id/read zeroes the counter", async () => {
    await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: "again", type: 1 });
    const read = await request(app).post(`/api/chat/conversations/${conversationId}/read`).set(auth(bToken));
    expect(read.status).toBe(200);
    expect(read.body.ok).toBe(true);
    const after = await request(app).get("/api/chat/conversations").set(auth(bToken));
    expect(after.body.items.find((c: { id: string }) => c.id === conversationId).unreadCount).toBe(0);
  });
});

// ═══════════════════════════ CURSOR PAGING ═══════════════════════════
describe("GET /conversations/:id/messages cursor paging (?before=&limit=)", () => {
  it("pages with limit and the nextCursor pointing at older messages", async () => {
    for (let i = 0; i < 4; i++) {
      await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: `page msg ${i}`, type: 1 });
      await sleep(5); // guarantee distinct createdAt ordering
    }
    const page1 = await request(app).get(`/api/chat/conversations/${conversationId}/messages`).query({ limit: 3 }).set(auth(bToken));
    const m1 = page1.body.items;
    expect(m1).toHaveLength(3);
    expect(m1.map((m: { message?: string }) => m.message)).toEqual(["page msg 1", "page msg 2", "page msg 3"]); // newest page, oldest-first
    expect(page1.body.nextCursor).toBe(m1[0].id);

    const page2 = await request(app)
      .get(`/api/chat/conversations/${conversationId}/messages`)
      .query({ limit: 10, before: m1[0].id })
      .set(auth(bToken));
    const m2 = page2.body.items;
    expect(m2.length).toBeGreaterThan(0);
    expect(m2.map((m: { message?: string }) => m.message)).toContain("page msg 0");
    expect(m2.map((m: { message?: string }) => m.message)).not.toContain("page msg 3");
    expect(page2.body.nextCursor).toBeNull(); // exhausted
  });

  it("rejects an unknown before cursor", async () => {
    const res = await request(app)
      .get(`/api/chat/conversations/${conversationId}/messages`)
      .query({ before: "ghost-id" })
      .set(auth(bToken));
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════ MUTE / CLEAR / DELETE ═══════════════════════════
describe("mute / unmute / clear / delete", () => {
  it("mutes and unmutes for the caller only", async () => {
    const mute = await request(app).post(`/api/chat/conversations/${conversationId}/mute`).set(auth(bToken));
    expect(mute.status).toBe(200);
    let mine = await request(app).get("/api/chat/conversations").set(auth(bToken));
    expect(mine.body.items.find((c: { id: string }) => c.id === conversationId).isMuted).toBe(true);
    let other = await request(app).get("/api/chat/conversations").set(auth(aToken));
    expect(other.body.items.find((c: { id: string }) => c.id === conversationId).isMuted).toBe(false);

    const unmute = await request(app).delete(`/api/chat/conversations/${conversationId}/mute`).set(auth(bToken));
    expect(unmute.status).toBe(200);
    mine = await request(app).get("/api/chat/conversations").set(auth(bToken));
    expect(mine.body.items.find((c: { id: string }) => c.id === conversationId).isMuted).toBe(false);
  });

  it("clears for the caller only — older messages stay visible to the peer", async () => {
    await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: "before clear", type: 1 });
    await sleep(1100); // cleared_at has second precision (legacy timestamp format)
    const clear = await request(app).post(`/api/chat/conversations/${conversationId}/clear`).set(auth(bToken));
    expect(clear.status).toBe(200);

    const bobView = await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth(bToken));
    expect(bobView.body.items.map((m: { message?: string }) => m.message)).not.toContain("before clear");

    await request(app).post("/api/chat/messages").set(auth(aToken)).send({ conversationId, message: "after clear", type: 1 });
    const bobAfter = await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth(bToken));
    expect(bobAfter.body.items.map((m: { message?: string }) => m.message)).toEqual(["after clear"]);

    const aliceView = await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth(aToken));
    expect(aliceView.body.items.map((m: { message?: string }) => m.message)).toContain("before clear");
  });

  it("deletes a 1:1 conversation for the caller only ('d' prefix)", async () => {
    const del = await request(app).delete(`/api/chat/conversations/${conversationId}`).set(auth(aToken));
    expect(del.status).toBe(200);
    const mine = await request(app).get("/api/chat/conversations").set(auth(aToken));
    expect(mine.body.items.find((c: { id: string }) => c.id === conversationId)).toBeUndefined();
    const theirs = await request(app).get("/api/chat/conversations").set(auth(bToken));
    expect(theirs.body.items.find((c: { id: string }) => c.id === conversationId)).toBeDefined();
  });

  it("deactivates the caller's participant row for group conversations", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const group = await db.conversation.create({
      data: {
        type: 2,
        groupName: `${PREFIX} group`,
        adminId: aId,
        participants: { create: [{ userId: bId, isActive: true, unreadCount: 3 }] },
      },
    });
    const leave = await request(app).delete(`/api/chat/conversations/${group.id}`).set(auth(bToken));
    expect(leave.status).toBe(200);
    const mine = await request(app).get("/api/chat/conversations").set(auth(bToken));
    expect(mine.body.items.find((c: { id: string }) => c.id === group.id)).toBeUndefined();

    // S4 room group conversations (created via the DB) are listed and served.
    const roomGroup = await db.conversation.create({
      data: {
        type: 2,
        groupName: `${PREFIX} room group`,
        adminId: aId,
        participants: { create: [{ userId: bId, isActive: true }] },
      },
    });
    const listed = await request(app).get("/api/chat/conversations").set(auth(bToken));
    const row = listed.body.items.find((c: { id: string }) => c.id === roomGroup.id);
    expect(row.type).toBe(2);
    expect(row.adminId).toBe(aId);
    expect(row.participantsCount).toBe(1);
    expect(row.roomId).toBeNull(); // no CommunityRoom linked
    await db.conversation.delete({ where: { id: roomGroup.id } });
  });
});

// ═══════════════════════════ AUDIO SPACES ═══════════════════════════
describe("/api/audio-spaces", () => {
  it("creates a public space with a client-supplied id (the Agora channel)", async () => {
    spaceId = `s5-space-${Date.now()}`;
    const res = await request(app)
      .post("/api/audio-spaces")
      .set(auth(aToken))
      .send({
        id: spaceId,
        title: `${PREFIX} space`,
        description: "desc",
        topics: "",
        type: "public",
        users: [{ id: aId, type: "admin", micStatus: "on" }],
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(spaceId);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].type).toBe("admin");
    expect(res.body.users[0].micStatus).toBe("on");
    expect(res.body.leavedUsers).toEqual([]);
    expect(res.body.createdAt).toBeTruthy();
  });

  it("rejects duplicate ids, invalid types, missing users and unknown participants", async () => {
    const dup = await request(app).post("/api/audio-spaces").set(auth(bToken)).send({
      id: spaceId, type: "public", users: [{ id: bId }],
    });
    expect(dup.status).toBe(409);
    const badType = await request(app).post("/api/audio-spaces").set(auth(bToken)).send({
      id: `s5-x-${Date.now()}`, type: "bogus", users: [{ id: bId }],
    });
    expect(badType.status).toBe(400);
    const noUsers = await request(app).post("/api/audio-spaces").set(auth(bToken)).send({
      id: `s5-x-${Date.now()}`, type: "public",
    });
    expect(noUsers.status).toBe(400);
    const ghostUser = await request(app).post("/api/audio-spaces").set(auth(bToken)).send({
      id: `s5-x-${Date.now()}`, type: "public", users: [{ id: "nope" }],
    });
    expect(ghostUser.status).toBe(400);
  });

  it("lists spaces (public + mine) in the paged envelope", async () => {
    const res = await request(app).get("/api/audio-spaces").set(auth(bToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.map((s: { id: string }) => s.id)).toContain(spaceId);
  });

  it("hides private spaces from non-participants", async () => {
    privateSpaceId = `s5-private-${Date.now()}`;
    await request(app)
      .post("/api/audio-spaces")
      .set(auth(aToken))
      .send({ id: privateSpaceId, type: "private", users: [{ id: aId, type: "admin" }] });
    const denied = await request(app).get(`/api/audio-spaces/${privateSpaceId}`).set(auth(eveToken));
    expect(denied.status).toBe(403);
    const allowed = await request(app).get(`/api/audio-spaces/${privateSpaceId}`).set(auth(aToken));
    expect(allowed.status).toBe(200);
    expect(allowed.body.id).toBe(privateSpaceId);
  });

  it("joins, changes roles, toggles mics and kicks (admin checks)", async () => {
    const join = await request(app).post(`/api/audio-spaces/${spaceId}/join`).set(auth(bToken));
    expect(join.status).toBe(200);
    expect(join.body.joined).toBe(true);
    const again = await request(app).post(`/api/audio-spaces/${spaceId}/join`).set(auth(bToken));
    expect(again.body.joined).toBe(false); // already in

    let detail = await request(app).get(`/api/audio-spaces/${spaceId}`).set(auth(bToken));
    expect(detail.body.users.find((u: { id: string }) => u.id === bId).type).toBe("listener");

    // Role change: admin (alice) promotes bob; bob cannot promote anyone.
    const promote = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${bId}/role`)
      .set(auth(aToken))
      .send({ type: "host" });
    expect(promote.status).toBe(200);
    const promoteDenied = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${aId}/role`)
      .set(auth(bToken))
      .send({ type: "listener" });
    expect(promoteDenied.status).toBe(403);
    const badRole = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${bId}/role`)
      .set(auth(aToken))
      .send({ type: "boss" });
    expect(badRole.status).toBe(400);

    // Mic: self-toggle always allowed; toggling others needs admin.
    const selfMic = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${bId}/mic`)
      .set(auth(bToken))
      .send({ micStatus: "on" });
    expect(selfMic.status).toBe(200);
    const otherMicDenied = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${aId}/mic`)
      .set(auth(bToken))
      .send({ micStatus: "muted" });
    expect(otherMicDenied.status).toBe(403);
    const badMic = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${bId}/mic`)
      .set(auth(aToken))
      .send({ micStatus: "loud" });
    expect(badMic.status).toBe(400);

    // Kick: admin only → bob lands in leavedUsers as kicked_out.
    const kick = await request(app).post(`/api/audio-spaces/${spaceId}/participants/${bId}/kick`).set(auth(aToken));
    expect(kick.status).toBe(200);
    const kickDenied = await request(app).post(`/api/audio-spaces/${spaceId}/participants/${aId}/kick`).set(auth(bToken));
    expect(kickDenied.status).toBe(403);
    detail = await request(app).get(`/api/audio-spaces/${spaceId}`).set(auth(aToken));
    expect(detail.body.users.find((u: { id: string }) => u.id === bId)).toBeUndefined();
    expect(detail.body.leavedUsers.find((u: { id: string }) => u.id === bId).type).toBe("kicked_out");
  });

  it("serves space messages to participants only", async () => {
    const messageId = `s5-msg-${Date.now()}`;
    audioMessageIds.push(messageId);
    const sent = await request(app)
      .post(`/api/audio-spaces/${spaceId}/messages`)
      .set(auth(aToken))
      .send({ id: messageId, content: "hello space" });
    expect(sent.status).toBe(201);
    expect(sent.body.content).toBe("hello space");
    expect(sent.body.userId).toBe(aId);
    expect(sent.body.user.fullName).toBe(`${PREFIX} alice`);

    const dup = await request(app)
      .post(`/api/audio-spaces/${spaceId}/messages`)
      .set(auth(aToken))
      .send({ id: messageId, content: "again" });
    expect(dup.status).toBe(409);

    const deniedSend = await request(app)
      .post(`/api/audio-spaces/${spaceId}/messages`)
      .set(auth(eveToken))
      .send({ id: `s5-msg-x-${Date.now()}`, content: "sneak" });
    expect(deniedSend.status).toBe(403);

    const list = await request(app).get(`/api/audio-spaces/${spaceId}/messages`).set(auth(aToken));
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: { id: string }) => m.id)).toContain(messageId);
    const deniedList = await request(app).get(`/api/audio-spaces/${spaceId}/messages`).set(auth(eveToken));
    expect(deniedList.status).toBe(403);
  });

  it("leaves and ends the space (admin only, soft delete)", async () => {
    // bob was kicked out earlier — rejoin first so the leave path is exercised.
    const rejoin = await request(app).post(`/api/audio-spaces/${spaceId}/join`).set(auth(bToken));
    expect(rejoin.body.joined).toBe(true);
    const leave = await request(app).post(`/api/audio-spaces/${spaceId}/leave`).set(auth(bToken));
    expect(leave.status).toBe(200);
    const leaveAgain = await request(app).post(`/api/audio-spaces/${spaceId}/leave`).set(auth(bToken));
    expect(leaveAgain.status).toBe(400);

    const endDenied = await request(app).delete(`/api/audio-spaces/${spaceId}`).set(auth(bToken));
    expect(endDenied.status).toBe(403); // bob is kicked_out, not admin
    const end = await request(app).delete(`/api/audio-spaces/${spaceId}`).set(auth(aToken));
    expect(end.status).toBe(200);
    const gone = await request(app).get(`/api/audio-spaces/${spaceId}`).set(auth(aToken));
    expect(gone.status).toBe(404);
  });
});

// ═══════════════════════════ REALTIME ═══════════════════════════
describe("/api/realtime/auth (Pusher channel authorization)", () => {
  it("signs socket_id + channel for a valid session", async () => {
    const res = await request(app)
      .post("/api/realtime/auth")
      .set(auth(aToken))
      .send({ socket_id: "1234.5678", channel_name: `private-conversation.${conversationId}` });
    expect(res.status).toBe(200);
    const { channelAuth } = await import("@/infrastructure/external-services/pusher-server");
    expect(res.body.auth).toBe(channelAuth("1234.5678", `private-conversation.${conversationId}`));
  });

  it("403s a non-member of the conversation (channel authorization)", async () => {
    const res = await request(app)
      .post("/api/realtime/auth")
      .set(auth(eveToken))
      .send({ socket_id: "1234.5678", channel_name: `private-conversation.${conversationId}` });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Channel access denied");
  });

  it("signs a user's OWN user-scoped channel but 403s another user's", async () => {
    const own = await request(app)
      .post("/api/realtime/auth")
      .set(auth(aToken))
      .send({ socket_id: "1234.5678", channel_name: `private-user.${aId}` });
    expect(own.status).toBe(200);
    // Laravel-style user channel (legacy App.Models.User broadcast names).
    const ownLaravel = await request(app)
      .post("/api/realtime/auth")
      .set(auth(bToken))
      .send({ socket_id: "1234.5678", channel_name: `private-App.Models.User.${bId}` });
    expect(ownLaravel.status).toBe(200);

    const other = await request(app)
      .post("/api/realtime/auth")
      .set(auth(bToken))
      .send({ socket_id: "1234.5678", channel_name: `private-user.${aId}` });
    expect(other.status).toBe(403);
  });

  it("authorizes public channels for everyone but denies unknown private/presence patterns", async () => {
    const pub = await request(app)
      .post("/api/realtime/auth")
      .set(auth(eveToken))
      .send({ socket_id: "1234.5678", channel_name: `conversation.${conversationId}` });
    expect(pub.status).toBe(200); // the legacy public broadcast channel

    const unknownPrivate = await request(app)
      .post("/api/realtime/auth")
      .set(auth(aToken))
      .send({ socket_id: "1234.5678", channel_name: "private-unknown.123" });
    expect(unknownPrivate.status).toBe(403);
    const presence = await request(app)
      .post("/api/realtime/auth")
      .set(auth(aToken))
      .send({ socket_id: "1234.5678", channel_name: `presence-conversation.${conversationId}` });
    expect(presence.status).toBe(403);
  });

  it("accepts urlencoded bodies exactly like the Flutter PusherChannelAuthorizer sends them", async () => {
    const res = await request(app)
      .post("/api/realtime/auth")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set(auth(bToken))
      .send(`socket_id=99.88&channel_name=private-conversation.${conversationId}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toContain("auth");
  });

  it("401s a bad session and rejects missing fields", async () => {
    const bad = await request(app)
      .post("/api/realtime/auth")
      .set(auth("junk"))
      .send({ socket_id: "1.2", channel_name: "private-conversation.x" });
    expect(bad.status).toBe(401);
    const missing = await request(app).post("/api/realtime/auth").set(auth(aToken)).send({});
    expect(missing.status).toBe(401);
  });
});

describe("POST /api/realtime/agora-token", () => {
  beforeAll(() => {
    process.env.AGORA_APP_ID = `s5-agora-app-${PREFIX}`;
    process.env.AGORA_APP_CERT = `s5-agora-cert-${PREFIX}`;
  });
  afterAll(() => {
    delete process.env.AGORA_APP_ID;
    delete process.env.AGORA_APP_CERT;
  });

  it("mints a 006 RTC token for a participant's channel", async () => {
    const res = await request(app).post("/api/realtime/agora-token").set(auth(aToken)).send({ channelName: privateSpaceId });
    expect(res.status).toBe(200);
    expect(String(res.body.token)).toMatch(/^006/);
  });

  it("refuses non-participants of a known channel and rejects a missing channel", async () => {
    const outsider = await request(app).post("/api/realtime/agora-token").set(auth(eveToken)).send({ channelName: privateSpaceId });
    expect(outsider.status).toBe(403);
    const missing = await request(app).post("/api/realtime/agora-token").set(auth(aToken)).send({});
    expect(missing.status).toBe(400);
  });
});
