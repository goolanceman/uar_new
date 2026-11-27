/**
 * Corridor events (vitest + supertest integration, real routers).
 *
 *   GET /api/corridor-events?missionId=&method=&congestion=&limit= (auth)
 *   — the mission alert feed, newest first.
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-correv-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let donorToken: string;

let missionAId: string;
let missionBId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: corridorEventsRouter } = await import("@/routes/corridor-events");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/corridor-events", corridorEventsRouter);
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
  const r = request(app).get(`/api/corridor-events${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const missions = await db.mission.findMany({ where: { pickup: { startsWith: PREFIX } }, select: { id: true } });
  if (missions.length) {
    await db.corridorEvent.deleteMany({ where: { missionId: { in: missions.map((m) => m.id) } } });
  }
  await db.mission.deleteMany({ where: { pickup: { startsWith: PREFIX } } });
  await db.ambulance.deleteMany({ where: { base: { startsWith: PREFIX } } });
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

  await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: `${PREFIX} admin`,
      role: "ADMIN",
      password: hashPassword(PASSWORD),
    },
  });
  await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: `${PREFIX} donor`,
      role: "DONOR",
      password: hashPassword(PASSWORD),
    },
  });

  const ambulance = await db.ambulance.create({
    data: { code: `${PREFIX}-AMB`, base: `${PREFIX} base`, driverName: `${PREFIX} driver` },
  });
  const missionA = await db.mission.create({
    data: {
      requestRef: `${PREFIX}-MA`,
      patientName: `${PREFIX} patient A`,
      contact: "5550100200",
      pickup: `${PREFIX} pickup A`,
      destination: `${PREFIX} destination A`,
      status: "DISPATCHED",
      ambulanceId: ambulance.id,
    },
  });
  missionAId = missionA.id;
  const missionB = await db.mission.create({
    data: {
      requestRef: `${PREFIX}-MB`,
      patientName: `${PREFIX} patient B`,
      contact: "5550100201",
      pickup: `${PREFIX} pickup B`,
      destination: `${PREFIX} destination B`,
    },
  });
  missionBId = missionB.id;

  // three events on mission A (distinct createdAt for a deterministic order),
  // one on mission B
  const t = Date.now();
  await db.corridorEvent.create({
    data: {
      missionId: missionAId,
      segment: "Hebbal Flyover",
      method: "V2X_5G",
      congestion: "GRIDLOCK",
      vehiclesAlerted: 180,
      timeSavedSec: 360,
      createdAt: new Date(t - 3000),
    },
  });
  await db.corridorEvent.create({
    data: {
      missionId: missionAId,
      segment: "Outer Ring Road",
      method: "CELL_BROADCAST",
      congestion: "HEAVY",
      vehiclesAlerted: 100,
      timeSavedSec: 200,
      createdAt: new Date(t - 2000),
    },
  });
  await db.corridorEvent.create({
    data: {
      missionId: missionAId,
      segment: "Silk Board Junction",
      method: "BLE_MESH",
      congestion: "MODERATE",
      vehiclesAlerted: 40,
      timeSavedSec: 60,
      createdAt: new Date(t - 1000),
    },
  });
  await db.corridorEvent.create({
    data: {
      missionId: missionBId,
      segment: "KR Puram Junction",
      method: "FM_RDS",
      congestion: "HEAVY",
      vehiclesAlerted: 70,
      timeSavedSec: 150,
      createdAt: new Date(t - 500),
    },
  });

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  donorToken = await login("donor");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/corridor-events", () => {
  it("lists the alert feed newest first with the mission include", async () => {
    const res = await get("", adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    const created = res.body.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
    expect([...created].sort((a: number, b: number) => b - a)).toEqual(created); // desc
    const row = res.body.find((e: { missionId: string }) => e.missionId === missionAId);
    expect(row.mission.requestRef).toBe(`${PREFIX}-MA`);
  });

  it("filters by missionId, method and congestion", async () => {
    const byMission = await get(`?missionId=${missionBId}`, adminToken);
    expect(byMission.status).toBe(200);
    expect(byMission.body).toHaveLength(1);
    expect(byMission.body[0].segment).toBe("KR Puram Junction");

    const byMethod = await get("?method=V2X_5G", adminToken);
    expect(byMethod.status).toBe(200);
    expect(byMethod.body.length).toBeGreaterThanOrEqual(1);
    expect(byMethod.body.every((e: { method: string }) => e.method === "V2X_5G")).toBe(true);

    const byCongestion = await get("?congestion=GRIDLOCK", adminToken);
    expect(byCongestion.status).toBe(200);
    expect(byCongestion.body.every((e: { congestion: string }) => e.congestion === "GRIDLOCK")).toBe(true);
  });

  it("bounds the take with ?limit=", async () => {
    const res = await get("?limit=2", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(2);
  });

  it("401s without a token (any authenticated role may read)", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const donor = await get("", donorToken);
    expect(donor.status).toBe(200);
  });
});
