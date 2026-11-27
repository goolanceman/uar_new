/**
 * Activity logs module — /api/activity-logs (real router via
 * @/routes/activity-logs).
 *
 * The admin audit trail: list happy path (newest first, optional limit),
 * the 401/403 gates. The query schema deliberately accepts everything the
 * legacy URLSearchParams parsing accepted (no validation rejection exists);
 * there is no 404 on a collection read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `actlog-${Date.now()}`;
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let donorToken = "";

async function buildApp() {
  const { router } = await import("@/routes/activity-logs");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/activity-logs", router);
  // the centralized error middleware (app.ts) — activity-log controllers
  // forward errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.activityLog.deleteMany({ where: { actorName: { startsWith: PREFIX } } });
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

  // audit rows this suite can find (newest first ⇒ create newest last)
  await db.activityLog.create({
    data: { userId: admin.id, actorName: `${PREFIX} admin`, action: "ACTLOG_TEST_A", entityType: "TEST", details: `${PREFIX} older` },
  });
  await db.activityLog.create({
    data: { userId: admin.id, actorName: `${PREFIX} admin`, action: "ACTLOG_TEST_B", entityType: "TEST", details: `${PREFIX} newer` },
  });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/activity-logs (ADMIN)", () => {
  it("lists the audit trail newest first", async () => {
    const res = await request(app).get("/api/activity-logs").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const mine = res.body.filter((row: { details?: string }) => row.details?.startsWith(PREFIX));
    expect(mine.length).toBe(2);
    expect(mine[0].action).toBe("ACTLOG_TEST_B"); // newest first
    expect(mine[1].action).toBe("ACTLOG_TEST_A");
  });

  it("honours the ?limit clause", async () => {
    const res = await request(app)
      .get("/api/activity-logs")
      .query({ limit: 1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(1);
  });

  it("accepts the legacy query surface (empty/absent/odd limit values)", async () => {
    const empty = await request(app)
      .get("/api/activity-logs")
      .query({ limit: "" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(empty.status).toBe(200); // "" → default 60, no rejection

    const weird = await request(app)
      .get("/api/activity-logs")
      .query({ limit: "abc" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(weird.status).toBe(200); // parseInt("abc") → NaN → no take clause
  });
});

describe("activity-logs auth gates", () => {
  it("401 without a token", async () => {
    const res = await request(app).get("/api/activity-logs");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to continue");
  });

  it("403 for a non-admin role", async () => {
    const res = await request(app)
      .get("/api/activity-logs")
      .set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You do not have permission for this action");
  });
});
