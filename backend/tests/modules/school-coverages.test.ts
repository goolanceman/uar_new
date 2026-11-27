/**
 * School coverages (vitest + supertest integration, real routers).
 *
 *   GET  /api/school-coverages?q=&active=1 — ADMIN|VOLUNTEER registry list
 *   POST /api/school-coverages             — ADMIN|VOLUNTEER upsert
 *                                            (existing schoolName → visitsCount+1, 200;
 *                                             new row → 201)
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-schools-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: schoolCoveragesRouter } = await import("@/routes/school-coverages");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/school-coverages", schoolCoveragesRouter);
  // Mirror the real app's final error middleware so next(error) controllers
  // render the legacy { error: message } envelope in this bare harness.
  const { handleError } = await import("@/infrastructure/auth/session");
  a.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      handleError(err, res);
    }
  );
  return a;
}

function get(path = "", token?: string) {
  const r = request(app).get(`/api/school-coverages${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/school-coverages");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.schoolCoverage.deleteMany({ where: { schoolName: { startsWith: PREFIX } } });
  await db.activityLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: PREFIX } }, { details: { contains: PREFIX } }] },
  });
  if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword } = await import("@/infrastructure/auth/session");

  const mk = async (tag: string, role: string) =>
    db.user.create({
      data: {
        email: `${PREFIX}-${tag}@test.local`,
        name: `${PREFIX} ${tag}`,
        role,
        password: hashPassword(PASSWORD),
      },
    });
  await mk("admin", "ADMIN");
  await mk("vol", "VOLUNTEER");
  await mk("donor", "DONOR");

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  volunteerToken = await login("vol");
  donorToken = await login("donor");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/school-coverages (upsert)", () => {
  it("creates a new school (201) starting the visit counter", async () => {
    const res = await post(
      {
        schoolName: `${PREFIX} Govt High School`,
        city: "Bengaluru",
        totalGirls: 250,
        contactPerson: `${PREFIX} headmistress`,
        lastVisited: "2026-11-20T00:00:00.000Z",
      },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.visitsCount).toBe(1); // new row with lastVisited starts at 1
    expect(res.body.isActive).toBe(true);
    expect(res.body.totalGirls).toBe(250);
  });

  it("re-posting the same schoolName bumps visitsCount and returns 200", async () => {
    const res = await post(
      { schoolName: `${PREFIX} Govt High School`, city: "Bengaluru", totalGirls: 260 },
      volunteerToken
    );
    expect(res.status).toBe(200); // update, not create
    expect(res.body.visitsCount).toBe(2);
    expect(res.body.totalGirls).toBe(260);
    expect(res.body.lastVisited).toBeNull(); // omitted this time
  });

  it("a new school without lastVisited starts at 0 visits", async () => {
    const res = await post({ schoolName: `${PREFIX} Anganwadi Centre` }, volunteerToken);
    expect(res.status).toBe(201);
    expect(res.body.visitsCount).toBe(0);
  });

  it("400s on a missing schoolName and a negative totalGirls", async () => {
    const noName = await post({ city: "Bengaluru" }, adminToken);
    expect(noName.status).toBe(400);
    // the validate middleware prefixes Zod messages with "Invalid request body:"
    expect(noName.body.error).toContain("School name is required");

    const negative = await post({ schoolName: `${PREFIX} bad`, totalGirls: -3 }, adminToken);
    expect(negative.status).toBe(400);
    expect(negative.body.error).toContain("Total girls must be zero or more");
  });

  it("401s without a token and 403s for DONOR", async () => {
    const anon = await post({ schoolName: `${PREFIX} anon` });
    expect(anon.status).toBe(401);
    const donor = await post({ schoolName: `${PREFIX} donor school` }, donorToken);
    expect(donor.status).toBe(403);
  });
});

describe("GET /api/school-coverages", () => {
  it("lists the registry for ADMIN and VOLUNTEER", async () => {
    const admin = await get("", adminToken);
    expect(admin.status).toBe(200);
    expect(Array.isArray(admin.body)).toBe(true);
    expect(admin.body.some((s: { schoolName: string }) => s.schoolName === `${PREFIX} Govt High School`)).toBe(true);

    const vol = await get("", volunteerToken);
    expect(vol.status).toBe(200);
  });

  it("filters with ?q= (name contains) and ?active=1", async () => {
    // mark one school inactive directly, then filter
    const { db } = await import("@/infrastructure/database/prisma");
    await db.schoolCoverage.updateMany({
      where: { schoolName: `${PREFIX} Anganwadi Centre` },
      data: { isActive: false },
    });

    const byQ = await get(`?q=${encodeURIComponent("Govt High")}`, adminToken);
    expect(byQ.status).toBe(200);
    expect(byQ.body.length).toBeGreaterThanOrEqual(1);
    expect(byQ.body.every((s: { schoolName: string }) => s.schoolName.includes("Govt High"))).toBe(true);

    const active = await get("?active=1", adminToken);
    expect(active.status).toBe(200);
    expect(active.body.some((s: { schoolName: string }) => s.schoolName === `${PREFIX} Anganwadi Centre`)).toBe(false);
  });

  it("401s without a token and 403s for DONOR", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const donor = await get("", donorToken);
    expect(donor.status).toBe(403);
  });
});
