/**
 * Corridor stats (vitest + supertest integration, real routers).
 *
 *   GET /api/corridor-stats (auth) — green-corridor + fleet analytics snapshot.
 *   Keeps every legacy key (missions / vehiclesAlerted / timeSavedMin /
 *   avgSavedSec / byMethod / bySegment) plus the richer analytics payload.
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-corstat-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;

let availableAmbulanceId: string;
let busyAmbulanceId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: corridorStatsRouter } = await import("@/routes/corridor-stats");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/corridor-stats", corridorStatsRouter);
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

function get(token?: string) {
  const r = request(app).get("/api/corridor-stats");
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

  const available = await db.ambulance.create({
    data: { code: `${PREFIX}-AMB-A`, base: `${PREFIX} base A`, driverName: `${PREFIX} driver A`, status: "AVAILABLE" },
  });
  availableAmbulanceId = available.id;
  const busy = await db.ambulance.create({
    data: { code: `${PREFIX}-AMB-B`, base: `${PREFIX} base B`, driverName: `${PREFIX} driver B`, status: "ON_MISSION" },
  });
  busyAmbulanceId = busy.id;
  await db.ambulance.create({
    data: { code: `${PREFIX}-AMB-C`, base: `${PREFIX} base C`, driverName: `${PREFIX} driver C`, status: "MAINTENANCE" },
  });

  // completed mission with corridor events on the busy ambulance
  const completed = await db.mission.create({
    data: {
      requestRef: `${PREFIX}-M1`,
      patientName: `${PREFIX} patient one`,
      contact: "5550100200",
      emergencyType: "CARDIAC",
      pickup: `${PREFIX} pickup one`,
      destination: `${PREFIX} destination one`,
      status: "COMPLETED",
      ambulanceId: busyAmbulanceId,
      corridorActive: false,
      vehiclesAlerted: 200,
      timeSavedSec: 600,
    },
  });
  await db.corridorEvent.create({
    data: {
      missionId: completed.id,
      segment: "Hebbal Flyover",
      method: "V2X_5G",
      congestion: "GRIDLOCK",
      vehiclesAlerted: 200,
      timeSavedSec: 600,
    },
  });
  // active mission (no ambulance) with one mesh event
  const active = await db.mission.create({
    data: {
      requestRef: `${PREFIX}-M2`,
      patientName: `${PREFIX} patient two`,
      contact: "5550100201",
      emergencyType: "ACCIDENT",
      pickup: `${PREFIX} pickup two`,
      destination: `${PREFIX} destination two`,
      status: "DISPATCHED",
      corridorActive: true,
      vehiclesAlerted: 40,
      timeSavedSec: 60,
    },
  });
  await db.corridorEvent.create({
    data: {
      missionId: active.id,
      segment: "Silk Board Junction",
      method: "BLE_MESH",
      congestion: "MODERATE",
      vehiclesAlerted: 40,
      timeSavedSec: 60,
    },
  });
  // a REQUESTED mission (no events yet)
  await db.mission.create({
    data: {
      requestRef: `${PREFIX}-M3`,
      patientName: `${PREFIX} patient three`,
      contact: "5550100202",
      emergencyType: "TRANSFER",
      pickup: `${PREFIX} pickup three`,
      destination: `${PREFIX} destination three`,
    },
  });

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: `${PREFIX}-admin@test.local`, password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = login.body.token;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/corridor-stats", () => {
  it("returns the full analytics snapshot for an authenticated caller", async () => {
    const res = await get(adminToken);
    expect(res.status).toBe(200);

    // legacy keys survive
    expect(res.body.missions.total).toBeGreaterThanOrEqual(3);
    expect(res.body.missions.completed).toBeGreaterThanOrEqual(1);
    expect(res.body.missions.active).toBeGreaterThanOrEqual(1);
    expect(res.body.vehiclesAlerted).toBeGreaterThanOrEqual(240);
    expect(res.body.timeSavedMin).toBeGreaterThanOrEqual(11); // round(660/60)
    // avg over ALL completed missions in the DB — stay monotonic, no exact pin
    expect(res.body.avgSavedSec).toBeGreaterThanOrEqual(0);

    // canonical 5-layer alert chain, in order, never reordered
    expect(res.body.byMethod.map((m: { method: string }) => m.method)).toEqual([
      "V2X_5G",
      "CELL_BROADCAST",
      "BLE_MESH",
      "FM_RDS",
      "SIREN",
    ]);
    const v2x = res.body.byMethod[0];
    expect(v2x.count).toBeGreaterThanOrEqual(1);
    expect(v2x.savedSec).toBeGreaterThanOrEqual(600);

    expect(res.body.bySegment.some((s: { segment: string }) => s.segment === "Hebbal Flyover")).toBe(true);
    expect(res.body.topSegments.length).toBeLessThanOrEqual(6);

    // richer analytics payload
    expect(res.body.completionRate).toBeGreaterThan(0);
    expect(res.body.byEmergencyType.some((t: { type: string; count: number }) => t.count > 0)).toBe(true);
    expect(res.body.congestionDistribution.some((c: { congestion: string; count: number }) => c.count > 0)).toBe(true);
    expect(res.body.weekly).toHaveLength(8); // Monday-start weekly buckets
  });

  it("sums the fleet and utilisation per ambulance", async () => {
    const res = await get(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.fleet.total).toBeGreaterThanOrEqual(3);
    expect(res.body.fleet.available).toBeGreaterThanOrEqual(1);
    expect(res.body.fleet.onMission).toBeGreaterThanOrEqual(1);
    expect(res.body.fleet.maintenance).toBeGreaterThanOrEqual(1);
    expect(res.body.fleet.availabilityPct).toBeGreaterThan(0);

    const busy = res.body.fleetUtilization.find(
      (a: { id: string }) => a.id === busyAmbulanceId
    );
    expect(busy.missions).toBeGreaterThanOrEqual(1);
    expect(busy.completed).toBeGreaterThanOrEqual(1);
    expect(busy.savedSec).toBeGreaterThanOrEqual(600);

    const idle = res.body.fleetUtilization.find(
      (a: { id: string }) => a.id === availableAmbulanceId
    );
    expect(idle.missions).toBe(0);
  });

  it("401s without a token", async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });
});
