/**
 * Masters module — picklist catalog /api/masters (real router via
 * @/routes/masters).
 *
 * Covers ?category / ?categories / ?all reads, the admin upsert + patch +
 * delete, the exact validation messages, the 404-before-400 ordering, the
 * value-conflict 409 and the 401/403 gates. Only touches masters in the
 * unique PREFIX category.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `masters-${Date.now()}`;
const CATEGORY = `testcat-${Date.now()}`;
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let donorToken = "";

async function buildApp() {
  const { router } = await import("@/routes/masters");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/masters", router);
  // the centralized error middleware (app.ts) — master controllers forward
  // errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.master.deleteMany({ where: { category: CATEGORY } });
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

  await db.master.create({ data: { category: CATEGORY, value: "v-one", label: "V One", sortOrder: 1 } });
  await db.master.create({ data: { category: CATEGORY, value: "v-two", label: "V Two", sortOrder: 2 } });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/masters", () => {
  it("lists active {value,label}[] for a category ordered by sortOrder", async () => {
    const res = await request(app).get("/api/masters").query({ category: CATEGORY });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { value: "v-one", label: "V One" },
      { value: "v-two", label: "V Two" },
    ]);
  });

  it("lists distinct categories with ?categories=1", async () => {
    const res = await request(app).get("/api/masters").query({ categories: 1 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain(CATEGORY);
  });

  it("lists every row with ?all=1 for an admin (403 for others)", async () => {
    const ok = await request(app).get("/api/masters").query({ all: 1 }).set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    const row = ok.body.find((m: { category: string; value: string }) => m.category === CATEGORY && m.value === "v-one");
    expect(row).toBeTruthy();

    const forbidden = await request(app)
      .get("/api/masters")
      .query({ all: 1 })
      .set("Authorization", `Bearer ${donorToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You do not have permission for this action");
  });
});

describe("POST /api/masters (ADMIN)", () => {
  it("upserts by (category, value) and echoes the row", async () => {
    const res = await request(app)
      .post("/api/masters")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ category: CATEGORY, value: "v-one", label: "V One Renamed", sortOrder: 1 });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe(CATEGORY);
    expect(res.body.value).toBe("v-one");
    expect(res.body.active).toBe(true);

    // same (category, value) again → upsert, not a conflict
    const again = await request(app)
      .post("/api/masters")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ category: CATEGORY, value: "v-one" });
    expect(again.status).toBe(201);
  });

  it("rejects a missing category/value with the exact message", async () => {
    const res = await request(app)
      .post("/api/masters")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ category: CATEGORY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("category and value are required");
  });

  it("401 without a token, 403 for a non-admin role", async () => {
    const unauth = await request(app).post("/api/masters").send({ category: CATEGORY, value: "x" });
    expect(unauth.status).toBe(401);

    const forbidden = await request(app)
      .post("/api/masters")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ category: CATEGORY, value: "x" });
    expect(forbidden.status).toBe(403);
  });
});

describe("PATCH /api/masters/:id (ADMIN)", () => {
  it("edits label/sortOrder/active", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.master.findFirst({ where: { category: CATEGORY, value: "v-two" } });

    const res = await request(app)
      .patch(`/api/masters/${row!.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "V Two Edited", sortOrder: 5, active: false });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("V Two Edited");
    expect(res.body.sortOrder).toBe(5);
    expect(res.body.active).toBe(false);
  });

  it("404s before field checks (legacy 404-before-400)", async () => {
    const res = await request(app)
      .patch("/api/masters/nonexistent-master-id")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: "" }); // would be a 400 — but the 404 comes first
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Master entry not found");
  });

  it("rejects an empty value with the exact message", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.master.findFirst({ where: { category: CATEGORY, value: "v-two" } });

    const res = await request(app)
      .patch(`/api/masters/${row!.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("value cannot be empty");
  });

  it("409s on a value conflict within the same category", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.master.findFirst({ where: { category: CATEGORY, value: "v-two" } });

    const res = await request(app)
      .patch(`/api/masters/${row!.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: "v-one" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A master entry with this value already exists in the category");
  });
});

describe("DELETE /api/masters/:id (ADMIN)", () => {
  it("removes a row and 404s unknown ids", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.master.findFirst({ where: { category: CATEGORY, value: "v-two" } });

    const res = await request(app)
      .delete(`/api/masters/${row!.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const missing = await request(app)
      .delete(`/api/masters/${row!.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Master entry not found");
  });
});
