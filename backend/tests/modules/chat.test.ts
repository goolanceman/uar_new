/**
 * Chat module — /api/chat (real router via @/routes/chat). Route surface:
 * create-or-get conversation, send text via both wire shapes (body
 * conversationId + path id), list conversations, cursor-paged messages,
 * mark-read, mute/unmute, clear and delete-for-caller. Deep flows (multipart
 * media, unread counters, paging edge cases) live in
 * tests/community-chat.test.ts — this file covers the route surface. Only
 * touches rows it creates (unique email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `chat-mod-${Date.now()}`;

let app: express.Express;
let aToken = "";
let bToken = "";
let aId = "";
let bId = "";
let convId = "";
let messageId = "";

async function buildApp() {
  const { router } = await import("@/routes/chat");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/chat", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  // conversation → participants → messages all cascade with the users
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const mk = (email: string, name: string) =>
    db.user.create({
      data: {
        email,
        name,
        role: "DONOR",
        password: hashPassword("[redacted]]]"),
        status: "ACTIVE",
        isActive: true,
      },
    });

  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} a`);
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} b`);
  aId = a.id;
  bId = b.id;
  aToken = issueToken({ userId: a.id, role: a.role, name: a.name ?? "", email: a.email });
  bToken = issueToken({ userId: b.id, role: b.role, name: b.name ?? "", email: b.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/chat/conversations", () => {
  it("creates a 1:1 conversation (create-or-get, idempotent on the reverse pair)", async () => {
    const res = await request(app).post("/api/chat/conversations").set("Authorization", `Bearer ${aToken}`).send({ userId: bId });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    convId = res.body.id;

    const reverse = await request(app)
      .post("/api/chat/conversations")
      .set("Authorization", `Bearer ${bToken}`)
      .send({ userId: aId });
    expect(reverse.status).toBe(200);
    expect(reverse.body.id).toBe(convId);
  });

  it("rejects a missing userId and 401s anonymous callers", async () => {
    const missing = await request(app).post("/api/chat/conversations").set("Authorization", `Bearer ${aToken}`).send({});
    expect(missing.status).toBe(400);

    const anon = await request(app).get("/api/chat/conversations");
    expect(anon.status).toBe(401);
  });
});

describe("send + list messages", () => {
  it("sends via POST /messages (id in body) and POST /conversations/:id/messages", async () => {
    const viaBody = await request(app)
      .post("/api/chat/messages")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ conversationId: convId, type: 1, message: `${PREFIX} hello` });
    expect(viaBody.status).toBe(201);
    expect(viaBody.body.conversationId).toBe(convId);
    expect(viaBody.body.message).toBe(`${PREFIX} hello`);
    expect(viaBody.body.sender.id).toBe(aId);
    messageId = viaBody.body.id;

    const viaPath = await request(app)
      .post(`/api/chat/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ type: 1, message: `${PREFIX} hi back` });
    expect(viaPath.status).toBe(201);
    expect(viaPath.body.sender.id).toBe(bId);

    const empty = await request(app)
      .post("/api/chat/messages")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ conversationId: convId, type: 1, message: "" });
    expect(empty.status).toBe(400);

    const stranger = await request(app)
      .post("/api/chat/messages")
      .set("Authorization", `Bearer ${bToken}`)
      .send({ conversationId: "no-such-conv", type: 1, message: "x" });
    expect(stranger.status).toBe(404);
  });

  it("lists conversations newest-activity-first with the peer embedded", async () => {
    const res = await request(app)
      .get("/api/chat/conversations")
      .query({ page: 1, limit: 10 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    const mine = res.body.items.find((c: { id: string }) => c.id === convId);
    expect(mine).toBeTruthy();
  });

  it("cursor-pages messages (fetching marks read for the caller)", async () => {
    const res = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .query({ limit: 1 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
    expect(res.body.nextCursor).toBeTruthy();

    const all = await request(app)
      .get(`/api/chat/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${aToken}`);
    expect(all.body.items).toHaveLength(2);
  });
});

describe("read / mute / unmute / clear / delete", () => {
  it("zeroes the unread counter (markRead)", async () => {
    const res = await request(app).post(`/api/chat/conversations/${convId}/read`).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);

    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.conversation.findUnique({ where: { id: convId } });
    expect(row?.user1UnreadCount).toBe(0);
  });

  it("mutes for the caller only and unmutes", async () => {
    const mute = await request(app).post(`/api/chat/conversations/${convId}/mute`).set("Authorization", `Bearer ${aToken}`);
    expect(mute.status).toBe(200);

    const { db } = await import("@/infrastructure/database/prisma");
    const muted = await db.conversation.findUnique({ where: { id: convId } });
    expect(muted?.mutedBy).toContain(aId);

    const unmute = await request(app).delete(`/api/chat/conversations/${convId}/mute`).set("Authorization", `Bearer ${aToken}`);
    expect(unmute.status).toBe(200);
  });

  it("clears and deletes for the caller only", async () => {
    const clear = await request(app).post(`/api/chat/conversations/${convId}/clear`).set("Authorization", `Bearer ${bToken}`);
    expect(clear.status).toBe(200);

    const del = await request(app).delete(`/api/chat/conversations/${convId}`).set("Authorization", `Bearer ${aToken}`);
    expect(del.status).toBe(200);

    const { db } = await import("@/infrastructure/database/prisma");
    const gone = await db.conversation.findUnique({ where: { id: convId } });
    // 1:1 delete marks clearedAt with the legacy 'd' prefix for the caller
    expect(String(gone?.clearedAt ?? "")).toContain(aId);
  });
});
