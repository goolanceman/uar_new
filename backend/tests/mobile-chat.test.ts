/**
 * Mobile compat API — chat module (vitest + supertest).
 * Mirrors what the Flutter app does (lib/common/api_service/chat_service.dart,
 * websocket_service.dart): createOrGetConversation → sendMessage →
 * getMessages (auto-marks read) → markConversationAsRead → /broadcasting/auth
 * private-channel signing for the Pusher-protocol socket.
 *
 * Runs against the TEST database (vitest.config.ts) and only touches rows it
 * creates (users/conversations/messages with a unique email prefix).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `mch-${Date.now()}`;

let app: express.Express;
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let eve: { id: string; token: string };
let conversationId: string;

async function buildApp() {
  const { router: mobileRouter, broadcastingAuthHandler } = await import("@/routes/mobile");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api", mobileRouter);
  a.post("/broadcasting/auth", broadcastingAuthHandler);
  return a;
}

/** Like ApiService.call: JSON body + apikey header (+ optional authtoken). */
function call(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/${path}`).set("apikey", "test").send(body);
  return token ? r.set("authtoken", token) : r;
}

function get(path: string, query: Record<string, unknown>, token: string) {
  return request(app).get(`/api/${path}`).set("apikey", "test").set("authtoken", token).query(query);
}

async function createUser(tag: string) {
  const { db } = await import("@/lib/db");
  const { issueToken, hashPassword } = await import("@/lib/session");
  const u = await db.user.create({
    data: { email: `${PREFIX}-${tag}@test.local`, name: `${tag} user`, password: hashPassword("pw-123456") },
  });
  const token = issueToken({ userId: u.id, role: u.role, name: u.name, email: u.email });
  return { id: u.id, token };
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  const convos = await db.conversation.findMany({
    where: { OR: [{ user1Id: { in: ids } }, { user2Id: { in: ids } }] },
    select: { id: true },
  });
  const convoIds = convos.map((c) => c.id);
  await db.message.deleteMany({ where: { OR: [{ conversationId: { in: convoIds } }, { senderId: { in: ids } }] } });
  await db.conversation.deleteMany({ where: { id: { in: convoIds } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  alice = await createUser("alice");
  bob = await createUser("bob");
  eve = await createUser("eve");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

// ═══════════════════════════ CONVERSATION CREATION ═══════════════════════════
describe("createOrGetConversation (profile screen chat button)", () => {
  it("creates a one-to-one conversation with a string cuid id", async () => {
    const res = await call("chat/conversations", { other_user_id: bob.id }, alice.token);
    expect(res.body.status).toBe(true);
    expect(typeof res.body.data.id).toBe("string");
    expect(res.body.data.id.length).toBeGreaterThan(10);
    expect(res.body.data.type).toBe(1);
    conversationId = res.body.data.id;
  });

  it("returns the SAME conversation on the reverse pair (idempotent)", async () => {
    const res = await call("chat/conversations", { other_user_id: alice.id }, bob.token);
    expect(res.body.status).toBe(true);
    expect(res.body.data.id).toBe(conversationId);
  });

  it("rejects a missing / invalid other_user_id and self-chat", async () => {
    const missing = await call("chat/conversations", {}, alice.token);
    expect(missing.body.status).toBe(false);
    const self = await call("chat/conversations", { other_user_id: alice.id }, alice.token);
    expect(self.body.status).toBe(false);
    const ghost = await call("chat/conversations", { other_user_id: "nope" }, alice.token);
    expect(ghost.body.status).toBe(false);
  });
});

// ═══════════════════════════ SEND / LIST MESSAGES ═══════════════════════════
describe("sendMessage / getMessages", () => {
  it("sends a text message and echoes the wire shape ChatMessage.fromJson parses", async () => {
    const res = await call(
      "chat/messages",
      { conversation_id: conversationId, message: "hello bob", type: 1 },
      alice.token
    );
    expect(res.body.status).toBe(true);
    expect(typeof res.body.data.id).toBe("string");
    expect(res.body.data.message).toBe("hello bob");
    expect(res.body.data.sender_id).toBe(alice.id);
    expect(res.body.data.type).toBe(1);
    expect(typeof res.body.data.created_at).toBe("string");
  });

  it("accepts an image message with media_url and an empty caption (chat image picker)", async () => {
    const res = await call(
      "chat/messages",
      { conversation_id: conversationId, message: "", type: 2, media_url: "http://x/y.jpg" },
      alice.token
    );
    expect(res.body.status).toBe(true);
    expect(res.body.data.media_url).toBe("http://x/y.jpg");
    // Latest message advertises the media in the conversation list
    const list = await get("chat/conversations", {}, bob.token);
    const row = (list.body.data as Array<Record<string, unknown>>).find((c) => c.id === conversationId)!;
    expect(row.last_message).toBe("sent an image");
    expect(row.unread_count).toBe(2); // text + image, bob hasn't read yet
  });

  it("rejects an empty message with no media, and an invalid type", async () => {
    const empty = await call("chat/messages", { conversation_id: conversationId, message: "", type: 1 }, alice.token);
    expect(empty.body.status).toBe(false);
    const badType = await call(
      "chat/messages",
      { conversation_id: conversationId, message: "x", type: 9 },
      alice.token
    );
    expect(badType.body.status).toBe(false);
    const noType = await call("chat/messages", { conversation_id: conversationId, message: "x" }, alice.token);
    expect(noType.body.status).toBe(false);
  });

  it("lists messages oldest-first with sender info and string ids", async () => {
    const res = await get(`chat/conversations/${conversationId}/messages`, { limit: 50 }, bob.token);
    expect(res.body.status).toBe(true);
    const messages = res.body.data.messages as Array<Record<string, unknown>>;
    expect(messages.length).toBe(2);
    expect(messages[0].message).toBe("hello bob");
    expect(typeof messages[0].id).toBe("string");
    const sender = messages[0].sender as Record<string, unknown>;
    expect(sender.id).toBe(alice.id);
    expect(sender.fullName).toBe("alice user");
    expect(sender.image).toBeNull();
  });

  it("denies a non-participant and an unauthenticated reader", async () => {
    const outsider = await get(`chat/conversations/${conversationId}/messages`, {}, eve.token);
    expect(outsider.body.status).toBe(false);
    const anon = await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set("apikey", "test");
    expect(anon.status).toBe(401);
  });
});

// ═══════════════════════════ UNREAD / READ ═══════════════════════════
describe("unread counters + markAsRead", () => {
  it("increments the recipient's unread_count and leaves the sender at 0", async () => {
    await call("chat/messages", { conversation_id: conversationId, message: "unread probe", type: 1 }, alice.token);
    const mine = await get("chat/conversations", {}, alice.token);
    const theirs = await get("chat/conversations", {}, bob.token);
    const mineRow = (mine.body.data as Array<Record<string, unknown>>).find((c) => c.id === conversationId)!;
    const theirsRow = (theirs.body.data as Array<Record<string, unknown>>).find((c) => c.id === conversationId)!;
    expect(theirsRow.unread_count).toBe(1);
    expect(mineRow.unread_count).toBe(0);
    expect(theirsRow.last_message).toBe("unread probe");
    expect(theirsRow.other_user_id).toBe(alice.id);
  });

  it("fetching messages marks them read for the caller", async () => {
    await get(`chat/conversations/${conversationId}/messages`, {}, bob.token);
    const theirs = await get("chat/conversations", {}, bob.token);
    const theirsRow = (theirs.body.data as Array<Record<string, unknown>>).find((c) => c.id === conversationId)!;
    expect(theirsRow.unread_count).toBe(0);
  });

  it("POST /chat/conversations/:id/read zeroes the counter", async () => {
    await call("chat/messages", { conversation_id: conversationId, message: "again", type: 1 }, alice.token);
    const before = await get("chat/conversations", {}, bob.token);
    const rowBefore = (before.body.data as Array<Record<string, unknown>>).find((c) => c.id === conversationId)!;
    expect(rowBefore.unread_count).toBe(1);

    const read = await call(`chat/conversations/${conversationId}/read`, {}, bob.token);
    expect(read.body.status).toBe(true);
    const after = await get("chat/conversations", {}, bob.token);
    const rowAfter = (after.body.data as Array<Record<string, unknown>>).find((c) => c.id === conversationId)!;
    expect(rowAfter.unread_count).toBe(0);
  });
});

// ═══════════════════════════ PAGINATION ═══════════════════════════
describe("getMessages pagination (before_message_id)", () => {
  it("pages with limit and before_message_id like loadOldData()", async () => {
    for (let i = 0; i < 4; i++) {
      await call("chat/messages", { conversation_id: conversationId, message: `page msg ${i}`, type: 1 }, alice.token);
    }
    const page1 = await get(`chat/conversations/${conversationId}/messages`, { limit: 3 }, bob.token);
    const m1 = page1.body.data.messages as Array<Record<string, unknown>>;
    expect(m1).toHaveLength(3);
    expect(m1[0].message).toBe("page msg 1"); // newest page, oldest-first
    expect(m1[m1.length - 1].message).toBe("page msg 3");

    const page2 = await get(
      `chat/conversations/${conversationId}/messages`,
      { limit: 10, before_message_id: m1[0].id },
      bob.token
    );
    const m2 = page2.body.data.messages as Array<Record<string, unknown>>;
    const m2Texts = m2.map((m) => m.message);
    expect(m2).toHaveLength(5); // everything older than "page msg 1"
    expect(m2Texts).toContain("page msg 0");
    expect(m2Texts).toContain("hello bob");
    expect(m2Texts.some((t) => String(t).startsWith("page msg 1"))).toBe(false);
  });

  it("rejects an unknown before_message_id", async () => {
    const res = await get(
      `chat/conversations/${conversationId}/messages`,
      { before_message_id: "ghost-id" },
      bob.token
    );
    expect(res.body.status).toBe(false);
  });
});

// ═══════════════════════════ AUTH FAILURES ═══════════════════════════
describe("auth failures", () => {
  it("401s chat routes without / with a bad authtoken", async () => {
    const anon = await call("chat/messages", { conversation_id: conversationId, message: "x", type: 1 });
    expect(anon.status).toBe(401);
    const bad = request(app).post("/api/chat/messages").set("apikey", "test").set("authtoken", "junk").send({
      conversation_id: conversationId,
      message: "x",
      type: 1,
    });
    expect((await bad).status).toBe(401);
  });

  it("still 401s chat routes without an apikey (the /chat mobileAuth prefix guard)", async () => {
    const res = await request(app).post("/api/chat/messages").send({ conversation_id: conversationId, message: "x" });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════ BROADCASTING AUTH ═══════════════════════════
describe("/broadcasting/auth (private-channel signature)", () => {
  it("signs socket_id + channel for a valid session", async () => {
    const res = await request(app)
      .post("/broadcasting/auth")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ socket_id: "1234.5678", channel_name: `private-conversation.${conversationId}` });
    expect(res.status).toBe(200);
    const { channelAuth } = await import("@/lib/mobile/pusher");
    expect(res.body.auth).toBe(channelAuth("1234.5678", `private-conversation.${conversationId}`));
    expect(String(res.body.auth)).toMatch(/:.+/);
  });

  it("accepts urlencoded bodies exactly like PusherChannelAuthorizer sends them", async () => {
    const res = await request(app)
      .post("/broadcasting/auth")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("Authorization", `Bearer ${bob.token}`)
      .send(`socket_id=99.88&channel_name=private-conversation.${conversationId}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toContain("auth");
  });

  it("401s a bad session and rejects missing fields", async () => {
    const bad = await request(app)
      .post("/broadcasting/auth")
      .set("Authorization", "Bearer junk")
      .send({ socket_id: "1.2", channel_name: "private-conversation.x" });
    expect(bad.status).toBe(401);
    const missing = await request(app).post("/broadcasting/auth").set("Authorization", `Bearer ${alice.token}`).send({});
    expect(missing.status).toBe(401);
  });
});
