/**
 * Mobile compat API — chat users picker + notifications (vitest + supertest).
 * Mirrors what the Flutter app does: the Chats-tab "new chat" user picker
 * (lib/screens/chats_screen/new_chat_screen/) → /searchUsersForChat; the
 * notification tap router (lib/common/managers/notification_tap_router.dart)
 * → the `data` payload stored on Notification rows by sendPush (follow, chat
 * message) and fetchUserNotification / fetchPlatformNotification feeds.
 *
 * Runs against the TEST database (vitest.config.ts) and only touches rows it
 * creates (users/conversations/messages/notifications with a unique prefix).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `mcun-${Date.now()}`;

let app: express.Express;
let me: { id: string; token: string };
let alice: { id: string; token: string };
let dave: { id: string };
let iBlocked: { id: string };
let blockedMe: { id: string };
let blockedGlobal: { id: string };

async function buildApp() {
  const { router: mobileRouter } = await import("@/routes/mobile");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api", mobileRouter);
  return a;
}

/** Like ApiService.call: JSON body + apikey header (+ optional authtoken). */
function call(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/${path}`).set("apikey", "test").send(body);
  return token ? r.set("authtoken", token) : r;
}

/** GET with query params + apikey header, like fetchUserNotifications. */
function getList(query: Record<string, unknown>) {
  return request(app).get("/api/notifications/list").query(query).set("apikey", "test");
}

async function createUser(tag: string, extra: Record<string, unknown> = {}) {
  const { db } = await import("@/lib/db");
  const { issueToken, hashPassword } = await import("@/lib/session");
  const u = await db.user.create({
    data: {
      email: `${PREFIX}-${tag}@test.local`,
      name: `${tag} user`,
      password: hashPassword("pw-123456"),
      username: `${PREFIX}-${tag}`,
      avatar: "avatar.jpg",
      isPushNotifications: 1,
      ...extra,
    },
  });
  const token = issueToken({ userId: u.id, role: u.role, name: u.name, email: u.email });
  return { id: u.id, token };
}

async function searchChatUsers(body: Record<string, unknown>) {
  const res = await call("searchUsersForChat", { my_user_id: me.id, start: 0, limit: "50", ...body });
  expect(res.body.status).toBe(true);
  return res.body.data as Array<Record<string, unknown>>;
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
  await db.savedNotification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { myUserId: { in: ids } }] } });
  await db.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { userId: null, title: { startsWith: PREFIX } }] } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const { db } = await import("@/lib/db");
  await cleanup();
  app = await buildApp();
  me = await createUser("me");
  alice = await createUser("alice");
  dave = await createUser("dave");
  iBlocked = await createUser("iblocked");
  blockedMe = await createUser("blockedme", { blockUserIds: `${me.id},` });
  blockedGlobal = await createUser("global", { isBlock: 1 });
  // I blocked iBlocked — legacy trailing-comma CSV.
  await db.user.update({ where: { id: me.id }, data: { blockUserIds: `${iBlocked.id},` } });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

// ═══════════════════════ NEW-CHAT USER PICKER ═══════════════════════════
describe("searchUsersForChat (new-chat picker)", () => {
  it("lists other users with string cuid ids, excluding me / blocked / blocked-by / isBlock", async () => {
    const users = await searchChatUsers({});
    const ids = users.map((u) => u.id);
    expect(ids).toContain(alice.id);
    expect(ids).toContain(dave.id);
    expect(ids).not.toContain(me.id);
    expect(ids).not.toContain(iBlocked.id); // I blocked them
    expect(ids).not.toContain(blockedMe.id); // they blocked me
    expect(ids).not.toContain(blockedGlobal.id); // globally blocked
    for (const u of users) {
      expect(typeof u.id).toBe("string");
    }
  });

  it("lists users without a profile photo or username (both optional)", async () => {
    const bare = await createUser("bare", { avatar: null, username: null });
    const ids = (await searchChatUsers({})).map((u) => u.id);
    expect(ids).toContain(bare.id);
  });

  it("searches by keyword like the picker's debounced search bar", async () => {
    const users = await searchChatUsers({ keyword: `${PREFIX}-alice` });
    expect(users.map((u) => u.id)).toEqual([alice.id]);
  });

  it("pages with start/limit like LoadMoreWidget", async () => {
    const page1 = await searchChatUsers({ start: 0, limit: 1 });
    const page2 = await searchChatUsers({ start: 1, limit: 1 });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it("requires my_user_id", async () => {
    const res = await call("searchUsersForChat", { start: 0, limit: "10" });
    expect(res.body.status).toBe(false);
  });
});

// ═══════════════════════ PUSH TAP PAYLOADS ═══════════════════════════
describe("notification tap payloads carry navigation ids", () => {
  it("followUser push stores type=follow + the follower id (profile tap)", async () => {
    const { db } = await import("@/lib/db");
    const res = await call("followUser", { my_user_id: alice.id, user_id: me.id });
    expect(res.body.status).toBe(true);

    const row = await db.notification.findFirst({ where: { userId: me.id } });
    expect(row).not.toBeNull();
    const data = JSON.parse(row!.data ?? "{}");
    expect(data.type).toBe("follow");
    expect(data.user_id).toBe(alice.id);
  });

  it("chat message push stores the conversation + message ids (chat tap)", async () => {
    const { db } = await import("@/lib/db");
    const conv = await call("chat/conversations", { other_user_id: alice.id }, me.token);
    expect(conv.body.status).toBe(true);
    const conversationId = conv.body.data.id;

    const sent = await call(
      "chat/messages",
      { conversation_id: conversationId, message: "tap me", type: 1 },
      me.token
    );
    expect(sent.body.status).toBe(true);

    const row = await db.notification.findFirst({
      where: { userId: alice.id, type: "MOBILE" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    const data = JSON.parse(row!.data ?? "{}");
    expect(data.type).toBe("chat_message");
    expect(data.conversationId).toBe(conversationId);
    expect(data.messageId).toBe(sent.body.data.id);
  });

  it("fetchUserNotification joins the follow user with a string id", async () => {
    const res = await call("fetchUserNotification", { my_user_id: me.id, start: 0, limit: "10" });
    expect(res.body.status).toBe(true);
    const follow = (res.body.data as Array<Record<string, unknown>>).find((n) => n.type === 1);
    expect(follow).toBeTruthy();
    expect(typeof follow!.id).toBe("string");
    expect((follow!.user as Record<string, unknown>).id).toBe(alice.id);
  });

  it("fetchPlatformNotification exposes action_url for the tap-through sheet", async () => {
    const { db } = await import("@/lib/db");
    await db.notification.create({
      data: { userId: null, title: `${PREFIX} announcement`, message: "body", type: "SYSTEM", actionUrl: "https://uar.example/notice" },
    });
    const res = await call("fetchPlatformNotification", { start: 0, limit: "10" });
    expect(res.body.status).toBe(true);
    const row = (res.body.data as Array<Record<string, unknown>>).find((n) => n.title === `${PREFIX} announcement`);
    expect(row).toBeTruthy();
    expect(row!.action_url).toBe("https://uar.example/notice");
    expect(typeof row!.id).toBe("string");
  });
});

// ═══════════════════════ NOTIFICATIONS/LIST MERGE ═════════════════════
describe("notifications/list merges chat-message notifications (type 11)", () => {
  it("lists a chat message from A to B with the new type, sender, conversation and text", async () => {
    const conv = await call("chat/conversations", { other_user_id: alice.id }, me.token);
    const conversationId = conv.body.data.id as string;
    const sent = await call(
      "chat/messages",
      { conversation_id: conversationId, message: "hello from alice", type: 1 },
      alice.token
    );
    expect(sent.body.status).toBe(true);

    const res = await getList({ my_user_id: me.id, start: 0, limit: "20" });
    expect(res.body.status).toBe(true);
    const chat = (res.body.data as Array<Record<string, unknown>>).find((n) => n.type === 11);
    expect(chat).toBeTruthy();
    expect(chat!.conversation_id).toBe(conversationId);
    expect(chat!.message_id).toBe(sent.body.data.id);
    expect(chat!.message).toBe("hello from alice");
    expect(chat!.my_user_id).toBe(me.id);
    expect((chat!.user as Record<string, unknown>).id).toBe(alice.id);
    expect(typeof chat!.notification_id).toBe("string");
  });

  it("orders chat entries newest-first among saved notifications", async () => {
    const { db } = await import("@/lib/db");
    const conv = await call("chat/conversations", { other_user_id: alice.id }, me.token);
    const sent = await call(
      "chat/messages",
      { conversation_id: conv.body.data.id, message: "ordering probe", type: 1 },
      alice.token
    );
    expect(sent.body.status).toBe(true);
    // A saved notification newer than the chat push and one older than everything.
    await db.savedNotification.create({
      data: { myUserId: me.id, userId: alice.id, type: 2, createdAt: new Date() },
    });
    await db.savedNotification.create({
      data: { myUserId: me.id, userId: alice.id, type: 1, createdAt: new Date(Date.now() - 86_400_000) },
    });

    const res = await getList({ my_user_id: me.id, start: 0, limit: "50" });
    const types = (res.body.data as Array<Record<string, unknown>>).map((n) => n.type as number);
    const newSavedIdx = types.indexOf(2);
    const chatIdx = types.indexOf(11);
    const oldestIdx = types.lastIndexOf(1);
    expect(newSavedIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdx).toBeGreaterThan(newSavedIdx);
    expect(oldestIdx).toBeGreaterThan(chatIdx);
  });

  it("pages the merged feed with start/limit", async () => {
    const full = (await getList({ my_user_id: me.id, start: 0, limit: "50" })).body
      .data as Array<Record<string, unknown>>;
    expect(full.length).toBeGreaterThanOrEqual(3);
    const page1 = (await getList({ my_user_id: me.id, start: 0, limit: "2" })).body
      .data as Array<Record<string, unknown>>;
    const page2 = (await getList({ my_user_id: me.id, start: 2, limit: "2" })).body
      .data as Array<Record<string, unknown>>;
    expect(page1).toHaveLength(2);
    const ids = [...page1, ...page2].map((n) => n.id);
    expect(ids).toEqual(full.slice(0, ids.length).map((n) => n.id));
  });

  it("marks the chat notification read via notification_id", async () => {
    const { db } = await import("@/lib/db");
    const list = await getList({ my_user_id: me.id, start: 0, limit: "50" });
    const chat = (list.body.data as Array<Record<string, unknown>>).find((n) => n.type === 11);
    expect(chat).toBeTruthy();
    const read = await request(app)
      .post(`/api/notifications/${chat!.notification_id}/read`)
      .set("apikey", "test")
      .set("authtoken", me.token);
    expect(read.body.status).toBe(true);
    const row = await db.notification.findUnique({ where: { id: chat!.notification_id as string } });
    expect(row?.isRead).toBe(true);
  });

  it("hides chat entries whose conversation was deleted", async () => {
    const { db } = await import("@/lib/db");
    const conv = await call("chat/conversations", { other_user_id: alice.id }, me.token);
    const conversationId = conv.body.data.id as string;
    const sent = await call(
      "chat/messages",
      { conversation_id: conversationId, message: "gone soon", type: 1 },
      me.token
    );
    expect(sent.body.status).toBe(true);

    const before = await getList({ my_user_id: alice.id, start: 0, limit: "50" });
    expect(
      (before.body.data as Array<Record<string, unknown>>).some((n) => n.conversation_id === conversationId)
    ).toBe(true);

    await db.conversation.update({ where: { id: conversationId }, data: { deletedAt: new Date() } });
    const after = await getList({ my_user_id: alice.id, start: 0, limit: "50" });
    expect(
      (after.body.data as Array<Record<string, unknown>>).some((n) => n.conversation_id === conversationId)
    ).toBe(false);
  });
});
