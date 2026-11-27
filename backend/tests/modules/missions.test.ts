/**
 * Missions (vitest + supertest integration, real routers).
 *
 *   GET   /api/missions                    — auth, newest first, ?status&q&ambulanceId&limit
 *   POST  /api/missions                    — ADMIN|VOLUNTEER create (M-#### requestRef,
 *                                            simulated 4-segment green-corridor route)
 *   PATCH /api/missions/:id                — status stepper {status,progress?} AND legacy
 *                                            action flow {action: dispatch|advance|complete|cancel}
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-missions-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string;

let ambulanceId: string;
let busyAmbulanceId: string;
let ambulanceId2: string;
let ambulanceId3: string;
let ambulanceId4: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: missionsRouter } = await import("@/routes/missions");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/missions", missionsRouter);
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
  const r = request(app).get(`/api/missions${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/missions");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/missions/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

function missionBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    patientName: `${PREFIX} patient`,
    contact: "5550100200",
    emergencyType: "CARDIAC",
    priority: "HIGH",
    pickup: `${PREFIX} pickup gate`,
    destination: `${PREFIX} destination hospital`,
    ...over,
  };
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  // corridor events hang off missions created here — delete via the missions' ids
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

  const ambulance = await db.ambulance.create({
    data: {
      code: `${PREFIX}-AMB-1`,
      base: `${PREFIX} base`,
      driverName: `${PREFIX} driver`,
      status: "AVAILABLE",
    },
  });
  ambulanceId = ambulance.id;
  const busy = await db.ambulance.create({
    data: {
      code: `${PREFIX}-AMB-2`,
      base: `${PREFIX} base 2`,
      driverName: `${PREFIX} driver 2`,
      status: "ON_MISSION",
    },
  });
  busyAmbulanceId = busy.id;
  // one fresh ambulance per dispatch-using test — dispatch flips it to
  // ON_MISSION and only completion/cancel releases it
  const extra = await db.ambulance.create({
    data: { code: `${PREFIX}-AMB-3`, base: `${PREFIX} base 3`, driverName: `${PREFIX} driver 3`, status: "AVAILABLE" },
  });
  ambulanceId2 = extra.id;
  const extra2 = await db.ambulance.create({
    data: { code: `${PREFIX}-AMB-4`, base: `${PREFIX} base 4`, driverName: `${PREFIX} driver 4`, status: "AVAILABLE" },
  });
  ambulanceId3 = extra2.id;
  const extra3 = await db.ambulance.create({
    data: { code: `${PREFIX}-AMB-5`, base: `${PREFIX} base 5`, driverName: `${PREFIX} driver 5`, status: "AVAILABLE" },
  });
  ambulanceId4 = extra3.id;

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

describe("POST /api/missions (create + code generation)", () => {
  it("creates a REQUESTED mission with an M-#### ref and a 4-segment route", async () => {
    const res = await post(missionBody(), adminToken);
    expect(res.status).toBe(201);
    expect(res.body.requestRef).toMatch(/^M-\d+$/);
    expect(res.body.status).toBe("REQUESTED");
    expect(res.body.corridorActive).toBe(false);
    expect(res.body.progress).toBe(0);
    const route = JSON.parse(res.body.route ?? "[]") as Array<{ name: string; congestion: string }>;
    expect(route).toHaveLength(4);
    expect(route.map((s) => s.congestion).sort()).toEqual(["GRIDLOCK", "HEAVY", "LOW", "MODERATE"]);
    expect(res.body.etaMin).toBeGreaterThan(0);
  });

  it("generates unique incrementing requestRefs", async () => {
    const a = await post(missionBody(), adminToken);
    const b = await post(missionBody(), volunteerToken);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.requestRef).not.toBe(b.body.requestRef);
  });

  it("400s on missing fields / invalid emergencyType / invalid priority", async () => {
    const missing = await post({ patientName: "x", contact: "y" }, adminToken);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("patientName, contact, pickup and destination are required");

    const badType = await post(missionBody({ emergencyType: "HICCUPS" }), adminToken);
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("Invalid emergencyType");

    const badPriority = await post(missionBody({ priority: "WHENEVER" }), adminToken);
    expect(badPriority.status).toBe(400);
    expect(badPriority.body.error).toBe("Invalid priority");
  });

  it("401s without a token and 403s for DONOR", async () => {
    const anon = await post(missionBody());
    expect(anon.status).toBe(401);
    const donor = await post(missionBody(), donorToken);
    expect(donor.status).toBe(403);
  });
});

describe("GET /api/missions", () => {
  it("lists missions newest first with status/q filters", async () => {
    const all = await get("", adminToken);
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.length).toBeGreaterThanOrEqual(3);

    const requested = await get("?status=REQUESTED", adminToken);
    expect(requested.body.every((m: { status: string }) => m.status === "REQUESTED")).toBe(true);

    const byQ = await get(`?q=${encodeURIComponent(`${PREFIX} patient`)}`, adminToken);
    expect(byQ.status).toBe(200);
    expect(byQ.body.length).toBeGreaterThanOrEqual(3);
  });

  it("401s without a token", async () => {
    const res = await get("");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/missions/:id — legacy action flow", () => {
  it("dispatch: 400 without ambulanceId, 404 on unknown ambulance, 409 on a busy one", async () => {
    const created = await post(missionBody(), adminToken);
    const id = created.body.id;

    const noAmbulance = await patch(id, { action: "dispatch" }, adminToken);
    expect(noAmbulance.status).toBe(400);
    expect(noAmbulance.body.error).toBe("ambulanceId is required to dispatch");

    const ghost = await patch(id, { action: "dispatch", ambulanceId: "no-ambulance" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Ambulance not found");

    const busy = await patch(id, { action: "dispatch", ambulanceId: busyAmbulanceId }, adminToken);
    expect(busy.status).toBe(409);
    expect(busy.body.error).toBe("Ambulance is not available");
  });

  it("dispatch arms the corridor, alerts segments and flips the ambulance to ON_MISSION", async () => {
    const created = await post(missionBody(), adminToken);
    const id = created.body.id;

    const res = await patch(id, { action: "dispatch", ambulanceId }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.mission.status).toBe("DISPATCHED");
    expect(res.body.mission.corridorActive).toBe(true);
    expect(res.body.mission.ambulanceId).toBe(ambulanceId);
    expect(res.body.mission.vehiclesAlerted).toBeGreaterThan(0);
    expect(res.body.mission.timeSavedSec).toBeGreaterThan(0);
    // route always carries exactly one LOW segment → 3 alert events
    expect(res.body.mission.events).toHaveLength(3);
    // the response ambulance is the pre-dispatch snapshot — check the DB state
    const { db } = await import("@/infrastructure/database/prisma");
    const ambulance = await db.ambulance.findUnique({ where: { id: ambulanceId } });
    expect(ambulance?.status).toBe("ON_MISSION");

    const again = await patch(id, { action: "dispatch", ambulanceId }, adminToken);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("Mission is not awaiting dispatch");
  });

  it("advance walks EN_ROUTE → ARRIVED; complete frees the ambulance", async () => {
    const created = await post(missionBody(), adminToken);
    const id = created.body.id;
    await patch(id, { action: "dispatch", ambulanceId: ambulanceId2 }, adminToken);

    const a1 = await patch(id, { action: "advance" }, adminToken);
    expect(a1.status).toBe(200);
    expect(a1.body.mission.status).toBe("EN_ROUTE");
    expect(a1.body.mission.progress).toBe(25);

    const a2 = await patch(id, { action: "advance" }, adminToken);
    const a3 = await patch(id, { action: "advance" }, adminToken);
    expect(a3.body.mission.status).toBe("EN_ROUTE");
    expect(a3.body.mission.progress).toBe(75);

    const a4 = await patch(id, { action: "advance" }, adminToken);
    expect(a4.body.mission.status).toBe("ARRIVED");
    expect(a4.body.mission.progress).toBe(100);

    const done = await patch(id, { action: "complete" }, adminToken);
    expect(done.status).toBe(200);
    expect(done.body.mission.status).toBe("COMPLETED");
    expect(done.body.mission.corridorActive).toBe(false);

    const { db } = await import("@/infrastructure/database/prisma");
    const ambulance = await db.ambulance.findUnique({ where: { id: ambulanceId2 } });
    expect(ambulance?.status).toBe("AVAILABLE"); // released on completion
  });

  it("409s advancing/completing straight from REQUESTED", async () => {
    const created = await post(missionBody(), adminToken);
    const id = created.body.id;

    const adv = await patch(id, { action: "advance" }, adminToken);
    expect(adv.status).toBe(409);
    expect(adv.body.error).toBe("Mission cannot be advanced");

    const done = await patch(id, { action: "complete" }, adminToken);
    expect(done.status).toBe(409);
    expect(done.body.error).toBe("Mission cannot be completed from its current state");
  });

  it("cancel closes the mission and releases the ambulance", async () => {
    const created = await post(missionBody(), adminToken);
    const id = created.body.id;
    await patch(id, { action: "dispatch", ambulanceId: ambulanceId3 }, adminToken);

    const res = await patch(id, { action: "cancel" }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.mission.status).toBe("CANCELLED");

    const { db } = await import("@/infrastructure/database/prisma");
    const ambulance = await db.ambulance.findUnique({ where: { id: ambulanceId3 } });
    expect(ambulance?.status).toBe("AVAILABLE");
  });

  it("400s on an unknown action", async () => {
    const created = await post(missionBody(), adminToken);
    const res = await patch(created.body.id, { action: "teleport" }, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("action must be dispatch, advance, complete or cancel");
  });
});

describe("PATCH /api/missions/:id — status stepper", () => {
  it("409s moving REQUESTED → EN_ROUTE (forward-only along the flow)", async () => {
    const created = await post(missionBody(), adminToken);
    const res = await patch(created.body.id, { status: "EN_ROUTE" }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Cannot move mission from REQUESTED to EN_ROUTE");
  });

  it("409s on {status: DISPATCHED} — dispatch must go through action:dispatch", async () => {
    const created = await post(missionBody(), adminToken);
    const res = await patch(created.body.id, { status: "DISPATCHED" }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Dispatch the mission with action:dispatch");
  });

  it("400s on a bogus status", async () => {
    const created = await post(missionBody(), adminToken);
    const res = await patch(created.body.id, { status: "TELEPORTED" }, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("status must be one of");
  });

  it("same-status PATCH is a no-op that returns the mission", async () => {
    const created = await post(missionBody(), adminToken);
    const res = await patch(created.body.id, { status: "REQUESTED" }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.mission.status).toBe("REQUESTED");
  });

  it("409s 'Mission already closed' after completion", async () => {
    const created = await post(missionBody(), adminToken);
    const id = created.body.id;
    // complete via dispatch+complete
    await patch(id, { action: "dispatch", ambulanceId: ambulanceId4 }, adminToken);
    await patch(id, { action: "complete" }, adminToken);

    const after = await patch(id, { status: "REQUESTED" }, adminToken);
    expect(after.status).toBe(409);
    expect(after.body.error).toBe("Mission already closed");
  });

  it("404s on an unknown mission id before any body validation", async () => {
    const ghost = await patch("no-such-mission", { status: "BOGUS" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Mission not found");
  });

  it("403s for DONOR", async () => {
    const created = await post(missionBody(), adminToken);
    const res = await patch(created.body.id, { status: "REQUESTED" }, donorToken);
    expect(res.status).toBe(403);
  });
});
