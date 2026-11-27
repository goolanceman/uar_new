/**
 * Testimonials module — /api/testimonials (real router via
 * @/routes/testimonials).
 *
 * Public wall read (envelope), admin create/update/delete with the legacy
 * rating coercion (default 5, NaN → 5, round + clamp 1..5), the exact
 * validation messages, 404s and the 401/403 gates. Only touches
 * testimonials created here (unique name PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `testi-${Date.now()}`;
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let donorToken = "";
let testimonialId = "";

async function buildApp() {
  const { router } = await import("@/routes/testimonials");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/testimonials", router);
  // the centralized error middleware (app.ts) — testimonial controllers
  // forward errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.testimonial.deleteMany({ where: { name: { startsWith: PREFIX } } });
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

  const row = await db.testimonial.create({
    data: { name: `${PREFIX} seeded`, role: "Donor", message: `${PREFIX} seeded message`, rating: 4 },
  });
  testimonialId = row.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/testimonials (public)", () => {
  it("serves the public wall as an array", async () => {
    const res = await request(app).get("/api/testimonials");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const mine = res.body.find((t: { name: string }) => t.name === `${PREFIX} seeded`);
    expect(mine?.rating).toBe(4);
    expect(mine?.createdAt).toBeTruthy();
  });
});

describe("POST /api/testimonials (ADMIN)", () => {
  it("creates a testimonial with the rating coerced (round + clamp 1..5)", async () => {
    const clamped = await request(app)
      .post("/api/testimonials")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} rater`, role: "Volunteer", message: `${PREFIX} great work`, rating: 99 });
    expect(clamped.status).toBe(201);
    expect(clamped.body.rating).toBe(5);

    const nan = await request(app)
      .post("/api/testimonials")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} nan`, role: "Donor", message: `${PREFIX} fallback`, rating: "abc" });
    expect(nan.status).toBe(201);
    expect(nan.body.rating).toBe(5); // NaN falls back to the default 5
  });

  it("rejects missing fields with the combined legacy message", async () => {
    const res = await request(app)
      .post("/api/testimonials")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, role: "  " });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Name, role and message are required");
  });

  it("401 without a token, 403 for a non-admin role", async () => {
    const unauth = await request(app)
      .post("/api/testimonials")
      .send({ name: `${PREFIX} x`, role: "r", message: "m" });
    expect(unauth.status).toBe(401);

    const forbidden = await request(app)
      .post("/api/testimonials")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ name: `${PREFIX} x`, role: "r", message: "m" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You do not have permission for this action");
  });
});

describe("PATCH /api/testimonials/:id (ADMIN)", () => {
  it("edits a testimonial (404-before-400 ordering preserved)", async () => {
    const ok = await request(app)
      .patch(`/api/testimonials/${testimonialId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ message: `${PREFIX} edited message`, rating: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.message).toBe(`${PREFIX} edited message`);
    expect(ok.body.rating).toBe(3);

    const empty = await request(app)
      .patch(`/api/testimonials/${testimonialId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    // unknown id: the 404 comes before any body field check
    const missing = await request(app)
      .patch("/api/testimonials/nonexistent-testimonial-id")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Testimonial not found");
  });
});

describe("DELETE /api/testimonials/:id (ADMIN)", () => {
  it("removes a testimonial and 404s unknown ids", async () => {
    const res = await request(app)
      .delete(`/api/testimonials/${testimonialId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const missing = await request(app)
      .delete(`/api/testimonials/${testimonialId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Testimonial not found");
    testimonialId = "";
  });
});
