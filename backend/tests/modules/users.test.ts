/**
 * Users module — admin directory /api/users, /api/users/:id (real router
 * via @/routes/users).
 *
 * Covers list/create/get/update/delete happy paths (ADMIN), the exact
 * validation messages from the service, the 401/403 auth gates and the
 * 404s. Only touches rows it creates (unique email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `users-${Date.now()}`;
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let donorToken = "";
let adminId = "";
let createdId = "";

async function buildApp() {
  const { router } = await import("@/routes/users");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/users", router);
  // the centralized error middleware (app.ts) — user controllers forward
  // errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
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
  adminId = admin.id;
  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  donorToken = issueToken({ userId: donor.id, role: "DONOR", name: donor.name, email: donor.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("users CRUD (ADMIN)", () => {
  it("creates a user with a valid role (201, no password hash in the payload)", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} created`, email: `${PREFIX}-created@test.local`, password: PASSWORD, role: "DONOR" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(`${PREFIX}-created@test.local`);
    expect(res.body.role).toBe("DONOR");
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.password).toBeUndefined();
    createdId = res.body.id;
  });

  it("keeps the sequential field checks with exact legacy messages", async () => {
    const missing = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x` });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Name, email, password and role are required");

    const badRole = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, email: `${PREFIX}-x1@test.local`, password: PASSWORD, role: "WIZARD" });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toBe("Invalid role");

    const badEmail = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, email: "not-an-email", password: PASSWORD, role: "DONOR" });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("Please enter a valid email address");

    const shortPw = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, email: `${PREFIX}-x2@test.local`, password: "123", role: "DONOR" });
    expect(shortPw.status).toBe(400);
    expect(shortPw.body.error).toBe("Password must be at least 6 characters");

    const dup = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, email: `${PREFIX}-created@test.local`, password: PASSWORD, role: "DONOR" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("An account with this email already exists");
  });

  it("lists the directory (newest first) and filters by q", async () => {
    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((u: { email: string }) => u.email)).toContain(`${PREFIX}-created@test.local`);
    expect(res.body.every((u: { password?: string }) => u.password === undefined)).toBe(true);

    const filtered = await request(app)
      .get("/api/users")
      .query({ q: `${PREFIX}-created` })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.some((u: { id: string }) => u.id === createdId)).toBe(true);
  });

  it("fetches one user with the audit trail (404 for unknown ids)", async () => {
    const res = await request(app).get(`/api/users/${createdId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(createdId);
    expect(Array.isArray(res.body.activityLogs)).toBe(true);

    const missing = await request(app).get("/api/users/nonexistent-id").set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("User not found");
  });

  it("patches a user and rejects invalid fields with exact messages", async () => {
    const ok = await request(app)
      .patch(`/api/users/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} renamed`, city: "Testville" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe(`${PREFIX} renamed`);

    const badRole = await request(app)
      .patch(`/api/users/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "WIZARD" });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toBe("Invalid role");

    const badPan = await request(app)
      .patch(`/api/users/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ pan: "abc" });
    expect(badPan.status).toBe(400);
    expect(badPan.body.error).toBe("PAN must look like ABCDE1234F");

    const empty = await request(app).patch(`/api/users/${createdId}`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const missing = await request(app)
      .patch("/api/users/nonexistent-id")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "x" });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("User not found");
  });

  it("blocks self-deactivation and self-deletion (409)", async () => {
    const deact = await request(app)
      .patch(`/api/users/${adminId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(deact.status).toBe(409);
    expect(deact.body.error).toBe("You cannot deactivate your own account");

    const del = await request(app).delete(`/api/users/${adminId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("You cannot delete your own account");
  });

  it("deletes a user (200 { ok: true }) and 404s unknown ids", async () => {
    const res = await request(app).delete(`/api/users/${createdId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { db } = await import("@/infrastructure/database/prisma");
    expect(await db.user.findUnique({ where: { id: createdId } })).toBeNull();
    createdId = "";

    const missing = await request(app).delete("/api/users/nonexistent-id").set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("User not found");
  });
});

describe("users auth gates", () => {
  it("401 without a token", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to continue");
  });

  it("403 for a non-admin role", async () => {
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You do not have permission for this action");
  });
});
