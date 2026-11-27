/**
 * Audio spaces module — /api/audio-spaces (real router via
 * @/routes/audio-spaces). Route surface: create (client-supplied Agora
 * channel id), get/list, join/leave, participant role/mic/kick (admin
 * checks), messages list/send, PATCH upsert participants and DELETE (admin
 * only). Only touches rows it creates (unique PREFIX ids/emails).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `aspaces-${Date.now()}`;
let spaceSeq = 0;

let app: express.Express;
let adminToken = ""; // space admin (participant type "admin")
let listenerToken = "";
let outsiderToken = "";
let adminId = "";
let listenerId = "";
let outsiderId = "";
let spaceId = "";

async function buildApp() {
  const { router } = await import("@/routes/audio-spaces");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/audio-spaces", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.audioSpace.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
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

  const admin = await mk(`${PREFIX}-admin@test.local`, `${PREFIX} admin`);
  const listener = await mk(`${PREFIX}-l@test.local`, `${PREFIX} listener`);
  const outsider = await mk(`${PREFIX}-o@test.local`, `${PREFIX} outsider`);
  adminId = admin.id;
  listenerId = listener.id;
  outsiderId = outsider.id;

  const tok = (u: { id: string; role: string; name: string | null; email: string }) =>
    issueToken({ userId: u.id, role: u.role, name: u.name ?? "", email: u.email });
  adminToken = tok(admin);
  listenerToken = tok(listener);
  outsiderToken = tok(outsider);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

/** fresh unique space id per test */
function nextSpaceId() {
  return `${PREFIX}-s${++spaceSeq}`;
}

describe("POST /api/audio-spaces (create)", () => {
  it("creates a public space with the client id + participants (201)", async () => {
    spaceId = nextSpaceId();
    const res = await request(app)
      .post("/api/audio-spaces")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        id: spaceId,
        title: `${PREFIX} space`,
        type: "public",
        users: [
          { id: adminId, type: "admin", micStatus: "on" },
          { id: listenerId },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(spaceId);
    expect(res.body.type).toBe("public");
    expect(res.body.isActive).toBe(true);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users[0].id).toBe(adminId);
  });

  it("rejects missing/duplicate ids, invalid types and empty users", async () => {
    const noId = await request(app)
      .post("/api/audio-spaces")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "x", type: "public", users: [{ id: adminId }] });
    expect(noId.status).toBe(400);
    expect(noId.body.error).toBe("The id field is required");

    const dup = await request(app)
      .post("/api/audio-spaces")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ id: spaceId, type: "public", users: [{ id: adminId }] });
    expect(dup.status).toBe(409);

    const badType = await request(app)
      .post("/api/audio-spaces")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ id: nextSpaceId(), type: "secret", users: [{ id: adminId }] });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("The selected type is invalid");

    const noUsers = await request(app)
      .post("/api/audio-spaces")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ id: nextSpaceId(), type: "public" });
    expect(noUsers.status).toBe(400);
    expect(noUsers.body.error).toBe("The users field is required");
  });

  it("401 without a token", async () => {
    const res = await request(app).post("/api/audio-spaces").send({ id: nextSpaceId() });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/audio-spaces + /:id", () => {
  it("lists public + mine and serves a single space (404 unknown)", async () => {
    const list = await request(app).get("/api/audio-spaces").query({ page: 1, limit: 50 }).set("Authorization", `Bearer ${listenerToken}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.some((s: { id: string }) => s.id === spaceId)).toBe(true);

    const single = await request(app).get(`/api/audio-spaces/${spaceId}`).set("Authorization", `Bearer ${outsiderToken}`);
    expect(single.status).toBe(200);
    expect(single.body.id).toBe(spaceId);

    const missing = await request(app).get("/api/audio-spaces/no-such-space").set("Authorization", `Bearer ${listenerToken}`);
    expect(missing.status).toBe(404);
  });
});

describe("join / leave / participant admin", () => {
  it("joins, changes role, toggles mic, kicks and leaves", async () => {
    const join = await request(app).post(`/api/audio-spaces/${spaceId}/join`).set("Authorization", `Bearer ${outsiderToken}`);
    expect(join.status).toBe(200);
    expect(join.body.joined).toBe(true);

    const roleByNonAdmin = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${outsiderId}/role`)
      .set("Authorization", `Bearer ${listenerToken}`)
      .send({ type: "listener" });
    expect(roleByNonAdmin.status).toBe(403);

    const role = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${outsiderId}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "host" });
    expect(role.status).toBe(200);
    expect(role.body.type).toBe("host");

    const badRole = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${outsiderId}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ type: "wizard" });
    expect(badRole.status).toBe(400);

    const micSelf = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${outsiderId}/mic`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ micStatus: "on" });
    expect(micSelf.status).toBe(200);
    expect(micSelf.body.micStatus).toBe("on");

    const micByStranger = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${adminId}/mic`)
      .set("Authorization", `Bearer ${listenerToken}`)
      .send({ micStatus: "muted" });
    expect(micByStranger.status).toBe(403);

    const kick = await request(app)
      .post(`/api/audio-spaces/${spaceId}/participants/${outsiderId}/kick`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(kick.status).toBe(200);
    expect(kick.body.ok).toBe(true);

    const leave = await request(app).post(`/api/audio-spaces/${spaceId}/leave`).set("Authorization", `Bearer ${listenerToken}`);
    expect(leave.status).toBe(200);

    const leaveAgain = await request(app)
      .post(`/api/audio-spaces/${spaceId}/leave`)
      .set("Authorization", `Bearer ${listenerToken}`);
    expect(leaveAgain.status).toBe(400); // already left
  });
});

describe("space messages", () => {
  it("sends (client id, 201) and lists oldest-first for participants only", async () => {
    const send = await request(app)
      .post(`/api/audio-spaces/${spaceId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ id: `${PREFIX}-msg-1`, content: `${PREFIX} hello` });
    expect(send.status).toBe(201);
    expect(send.body.content).toBe(`${PREFIX} hello`);

    const dup = await request(app)
      .post(`/api/audio-spaces/${spaceId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ id: `${PREFIX}-msg-1`, content: "again" });
    expect(dup.status).toBe(409);

    const denied = await request(app)
      .post(`/api/audio-spaces/${spaceId}/messages`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ id: `${PREFIX}-msg-2`, content: "sneak" });
    expect(denied.status).toBe(403); // kicked out earlier

    const list = await request(app)
      .get(`/api/audio-spaces/${spaceId}/messages`)
      .query({ limit: 10 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items ?? list.body)).toBe(true);
    const items = list.body.items ?? list.body;
    expect(items.map((m: { content: string }) => m.content)).toContain(`${PREFIX} hello`);
  });
});

describe("PATCH / DELETE /:id (admin only)", () => {
  it("403s a non-admin and upserts participants for the admin", async () => {
    const forbidden = await request(app)
      .patch(`/api/audio-spaces/${spaceId}`)
      .set("Authorization", `Bearer ${listenerToken}`)
      .send({ users: [{ id: listenerId }] });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/audio-spaces/${spaceId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ users: [{ id: listenerId, isLeft: false, type: "listener" }] });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });

  it("403s a non-admin delete and ends the space for the admin (soft)", async () => {
    const doomed = nextSpaceId();
    await request(app)
      .post("/api/audio-spaces")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ id: doomed, title: `${PREFIX} doomed`, type: "public", users: [{ id: adminId, type: "admin" }] });

    const stranger = await request(app)
      .delete(`/api/audio-spaces/${doomed}`)
      .set("Authorization", `Bearer ${listenerToken}`);
    expect(stranger.status).toBe(403);

    const ok = await request(app).delete(`/api/audio-spaces/${doomed}`).set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    const gone = await request(app).get(`/api/audio-spaces/${doomed}`).set("Authorization", `Bearer ${adminToken}`);
    expect(gone.status).toBe(404); // soft-deleted
  });
});
