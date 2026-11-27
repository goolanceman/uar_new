/**
 * Contact queries module — /api/contact-queries (real router via
 * @/routes/contact-queries).
 *
 * Public contact form (POST), the admin inbox (GET), the status update
 * (PATCH) and removal (DELETE) — with the exact legacy validation messages,
 * the 401/403 gates and 404s. Only touches queries created here (unique
 * email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `cq-${Date.now()}`;
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let donorToken = "";
let queryId = "";

async function buildApp() {
  const { router } = await import("@/routes/contact-queries");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/contact-queries", router);
  // the centralized error middleware (app.ts) — contact-query controllers
  // forward errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.contactQuery.deleteMany({ where: { email: { startsWith: PREFIX } } });
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
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

  const admin = await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: `${PREFIX} admin`,
      role: "ADMIN",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  const donor = await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: `${PREFIX} donor`,
      role: "DONOR",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  donorToken = issueToken({ userId: donor.id, role: "DONOR", name: donor.name, email: donor.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/contact-queries (public)", () => {
  it("creates a query with PENDING status (201)", async () => {
    const res = await request(app)
      .post("/api/contact-queries")
      .send({
        name: `${PREFIX} walker`,
        email: `${PREFIX}-walker@test.local`,
        phone: "9876543210",
        subject: `${PREFIX} subject`,
        message: `${PREFIX} message body`,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe("PENDING");
    expect(res.body.email).toBe(`${PREFIX}-walker@test.local`);
    queryId = res.body.id;
  });

  it("rejects missing fields with the combined legacy message", async () => {
    const res = await request(app)
      .post("/api/contact-queries")
      .send({ name: `${PREFIX} x`, email: `${PREFIX}-x@test.local`, subject: "  ", message: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Name, email, subject and message are required");
  });

  it("rejects a malformed email with the exact message", async () => {
    const res = await request(app)
      .post("/api/contact-queries")
      .send({ name: `${PREFIX} x`, email: "not-an-email", subject: "s", message: "m" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Please enter a valid email address");
  });
});

describe("GET /api/contact-queries (ADMIN)", () => {
  it("lists the inbox and filters by status", async () => {
    const res = await request(app).get("/api/contact-queries").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((q: { email: string }) => q.email)).toContain(`${PREFIX}-walker@test.local`);

    const pending = await request(app)
      .get("/api/contact-queries")
      .query({ status: "PENDING" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(pending.status).toBe(200);
    expect(pending.body.some((q: { id: string }) => q.id === queryId)).toBe(true);
  });

  it("401 without a token, 403 for a non-admin role", async () => {
    const unauth = await request(app).get("/api/contact-queries");
    expect(unauth.status).toBe(401);

    const forbidden = await request(app)
      .get("/api/contact-queries")
      .set("Authorization", `Bearer ${donorToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You do not have permission for this action");
  });
});

describe("PATCH /api/contact-queries/:id (ADMIN)", () => {
  it("updates the status (and stamps resolvedAt for RESOLVED)", async () => {
    const res = await request(app)
      .patch(`/api/contact-queries/${queryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "RESOLVED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RESOLVED");
    expect(res.body.resolvedAt).toBeTruthy();
  });

  it("rejects an invalid status with the exact message", async () => {
    const res = await request(app)
      .patch(`/api/contact-queries/${queryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "MAYBE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Status must be RESOLVED, CLOSED or PENDING");
  });

  it("404s unknown ids", async () => {
    const res = await request(app)
      .patch("/api/contact-queries/nonexistent-query-id")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CLOSED" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Query not found");
  });
});

describe("DELETE /api/contact-queries/:id (ADMIN)", () => {
  it("removes a query (200 { ok: true }) and 404s the second time", async () => {
    const res = await request(app)
      .delete(`/api/contact-queries/${queryId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const missing = await request(app)
      .delete(`/api/contact-queries/${queryId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Query not found");
    queryId = "";
  });
});
