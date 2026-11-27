/**
 * Notifications module — /api/notifications (real router via
 * @/routes/notifications).
 *
 * Covers the default list (array shape), the paginated envelope, the community
 * feed switch, the platform announcements feed, mark-read (single + all) and
 * the push endpoint (admin happy path, exact validation message, 403 for
 * non-chat pushes between regular users, 404 for unknown recipients).
 * Only touches notification rows it creates (unique title PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `notif-${Date.now()}`;
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let aToken = "";
let bToken = "";
let adminId = "";
let aId = "";
let bId = "";

async function buildApp() {
  const { router } = await import("@/routes/notifications");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/notifications", router);
  // the centralized error middleware (app.ts) — notification controllers
  // forward errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.notification.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { title: { startsWith: PREFIX } }] },
  });
  if (ids.length) {
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const mk = async (email: string, name: string, role: string) =>
    db.user.create({
      data: {
        email,
        name,
        role,
        password: hashPassword(PASSWORD),
        status: "ACTIVE",
        isActive: true,
      },
    });

  const admin = await mk(`${PREFIX}-admin@test.local`, `${PREFIX} admin`, "ADMIN");
  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} alice`, "DONOR");
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} bob`, "DONOR");
  adminId = admin.id;
  aId = a.id;
  bId = b.id;
  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  aToken = issueToken({ userId: a.id, role: "DONOR", name: a.name, email: a.email });
  bToken = issueToken({ userId: b.id, role: "DONOR", name: b.name, email: b.email });

  // one global announcement + one personal notification for alice
  await db.notification.create({ data: { userId: null, title: `${PREFIX} announce`, message: "hello all" } });
  await db.notification.create({ data: { userId: aId, title: `${PREFIX} personal`, message: "just you" } });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/notifications", () => {
  it("returns the legacy array shape with global + personal rows merged", async () => {
    const res = await request(app).get("/api/notifications").set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const titles = res.body.map((n: { title?: string }) => n.title);
    expect(titles).toContain(`${PREFIX} announce`);
    expect(titles).toContain(`${PREFIX} personal`);
  });

  it("without a session serves only the global announcements", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((n: { title?: string }) => n.title)).toContain(`${PREFIX} announce`);
  });

  it("switches to the paginated envelope with ?page=1", async () => {
    const res = await request(app)
      .get("/api/notifications")
      .query({ page: 1, limit: 5 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("pages");
  });

  it("serves the community feed with ?feed=all", async () => {
    const res = await request(app)
      .get("/api/notifications")
      .query({ feed: "all", page: 1, limit: 10 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe("GET /api/notifications/platform", () => {
  it("serves the global announcements in the paged envelope", async () => {
    const res = await request(app).get("/api/notifications/platform").query({ page: 1, limit: 20 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    const row = res.body.items.find((n: { title?: string }) => n.title === `${PREFIX} announce`);
    expect(row?.description).toBe("hello all"); // camelCase wire shape
    expect(row?.actionUrl).toBeNull();
  });
});

describe("PATCH /api/notifications", () => {
  it("marks one row read by id", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.notification.create({ data: { userId: aId, title: `${PREFIX} mark-one`, message: "m" } });

    const res = await request(app)
      .patch("/api/notifications")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ id: row.id, isRead: true });
    expect(res.status).toBe(200);

    const updated = await db.notification.findUnique({ where: { id: row.id } });
    expect(updated?.isRead).toBe(true);

    const missing = await request(app)
      .patch("/api/notifications")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ id: "nonexistent-notification-id", isRead: true });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Notification not found");

    const forbidden = await request(app)
      .patch("/api/notifications")
      .set("Authorization", `Bearer ${bToken}`)
      .send({ id: row.id, isRead: true });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You cannot modify this notification");
  });

  it("marks every unread row of the signed-in user with { all: true }", async () => {
    const res = await request(app)
      .patch("/api/notifications")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ all: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
  });

  it("rejects a request without id or all (400, exact message)", async () => {
    const res = await request(app).patch("/api/notifications").set("Authorization", `Bearer ${aToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Provide { id, isRead } or { all: true }");
  });

  it("401 without a token", async () => {
    const res = await request(app).patch("/api/notifications").send({ all: true });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to continue");
  });
});

describe("POST /api/notifications/push", () => {
  it("lets an admin push to anyone (persist + deliver)", async () => {
    const res = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: aId, title: `${PREFIX} push`, body: "hello alice" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.notificationId).toBeTruthy();
  });

  it("rejects a push without title/body (400, exact message)", async () => {
    const res = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: aId, title: `${PREFIX} empty` });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("title and body are required");
  });

  it("404s when the recipient does not exist", async () => {
    const res = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: "nonexistent-user-id", title: `${PREFIX} gone`, body: "hello" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("forbids a regular user's non-chat push to another user (403)", async () => {
    const res = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ userId: bId, title: `${PREFIX} sneaky`, body: "hi bob" });
    expect(res.status).toBe(403);
  });
});
