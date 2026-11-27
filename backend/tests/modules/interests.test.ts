/**
 * Interests module — /api/interests (real router via @/routes/interests).
 * Public paged list + the elevated-gated CRUD (create/update/delete). Only
 * touches CommunityInterest rows with the unique PREFIX.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `interests-${Date.now()}`;

let app: express.Express;
let adminToken = "";
let donorToken = "";
let interestId = 0;

async function buildApp() {
  const { router } = await import("@/routes/interests");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json());
  a.use("/api/interests", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.communityInterest.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
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
      password: hashPassword("[redacted]]]"),
      status: "ACTIVE",
      isActive: true,
    },
  });
  const donor = await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: `${PREFIX} donor`,
      role: "DONOR",
      password: hashPassword("[redacted]]]"),
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

describe("GET /api/interests (public)", () => {
  it("serves a paged list with totalRoomOfInterest", async () => {
    const res = await request(app).get("/api/interests").query({ page: 1, limit: 100 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    for (const item of res.body.items) {
      expect(item).toHaveProperty("totalRoomOfInterest");
    }
  });
});

describe("POST /api/interests (elevated)", () => {
  it("401 without a token and 403 for a non-staff role", async () => {
    const noAuth = await request(app).post("/api/interests").send({ title: "x" });
    expect(noAuth.status).toBe(401);

    const donor = await request(app).post("/api/interests").set("Authorization", `Bearer ${donorToken}`).send({ title: "x" });
    expect(donor.status).toBe(403);
  });

  it("creates an interest and rejects a blank title with the exact message", async () => {
    const res = await request(app)
      .post("/api/interests")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} cricket` });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe(`${PREFIX} cricket`);
    interestId = res.body.id;

    const blank = await request(app).post("/api/interests").set("Authorization", `Bearer ${adminToken}`).send({ title: "  " });
    expect(blank.status).toBe(400);
    expect(blank.body.error).toContain("The title field is required");
  });
});

describe("PATCH /api/interests/:id (elevated)", () => {
  it("renames an interest", async () => {
    const res = await request(app)
      .patch(`/api/interests/${interestId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} renamed` });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(`${PREFIX} renamed`);
  });
});

describe("DELETE /api/interests/:id (elevated)", () => {
  it("deletes the interest", async () => {
    const res = await request(app).delete(`/api/interests/${interestId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    interestId = 0;
  });
});
