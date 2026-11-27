/**
 * Volunteer attendances (vitest + supertest integration, real routers).
 *
 *   GET  /api/volunteer-attendances?volunteerId=&from=&to=&limit= — ADMIN all;
 *        VOLUNTEER scoped to their own register
 *   POST /api/volunteer-attendances — ACTIVE volunteer self check-in for today
 *        (idempotent: 201 recorded / 200 duplicate) · ADMIN records a day
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-volatt-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerAToken: string;
let volunteerBToken: string;
let inactiveToken: string;

let volunteerAId: string;
let volunteerBId: string;
let taskAId: string;
let firstCheckIn: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: volunteerAttendancesRouter } = await import("@/routes/volunteer-attendances");
  const { router: volunteerTasksRouter } = await import("@/routes/volunteer-tasks");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/volunteer-attendances", volunteerAttendancesRouter);
  a.use("/api/volunteer-tasks", volunteerTasksRouter);
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
  const r = request(app).get(`/api/volunteer-attendances${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/volunteer-attendances");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.volunteerAttendance.deleteMany({ where: { volunteer: { code: { startsWith: PREFIX } } } });
  await db.volunteerTask.deleteMany({ where: { volunteer: { code: { startsWith: PREFIX } } } });
  await db.volunteer.deleteMany({ where: { code: { startsWith: PREFIX } } });
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

  const mkVolunteer = async (tag: string, status: string) => {
    const user = await db.user.create({
      data: {
        email: `${PREFIX}-${tag}@test.local`,
        name: `${PREFIX} ${tag}`,
        role: "VOLUNTEER",
        password: hashPassword(PASSWORD),
      },
    });
    return db.volunteer.create({
      data: { code: `${PREFIX}-vol-${tag.toUpperCase()}`, userId: user.id, status },
    });
  };
  const volunteerA = await mkVolunteer("vol-a", "ACTIVE");
  volunteerAId = volunteerA.id;
  const volunteerB = await mkVolunteer("vol-b", "ACTIVE");
  volunteerBId = volunteerB.id;
  await mkVolunteer("vol-i", "INACTIVE"); // cannot self check-in

  const taskA = await db.volunteerTask.create({
    data: {
      volunteerId: volunteerAId,
      title: `${PREFIX} ward drive`,
      location: "Ward 9",
      scheduledDate: new Date(),
    },
  });
  taskAId = taskA.id;

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  volunteerAToken = await login("vol-a");
  volunteerBToken = await login("vol-b");
  inactiveToken = await login("vol-i");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/volunteer-attendances (volunteer self check-in)", () => {
  it("records a 201 check-in with the task's location", async () => {
    const res = await post({ taskId: taskAId }, volunteerAToken);
    expect(res.status).toBe(201);
    expect(res.body.volunteerId).toBe(volunteerAId);
    expect(res.body.location).toBe("Ward 9");
    expect(res.body.notes).toBe(`Self check-in · ${PREFIX} ward drive`);
    expect(res.body.checkIn).toBeTruthy();
    firstCheckIn = res.body.checkIn;
  });

  it("a second tap the same day is 200 and keeps the first check-in (idempotent)", async () => {
    const again = await post({ taskId: taskAId }, volunteerAToken);
    expect(again.status).toBe(200); // duplicate → 200, not 201
    expect(again.body.checkIn).toBe(firstCheckIn);
    expect(again.body.id).toBeTruthy();
  });

  it("404s on another volunteer's task", async () => {
    const res = await post({ taskId: taskAId }, volunteerBToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Task not found");
  });

  it("403s for a non-ACTIVE volunteer", async () => {
    const res = await post({}, inactiveToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only active volunteers can check in");
  });

  it("falls back to GPS coordinates for the location when no task is given", async () => {
    const res = await post({ latitude: 12.9716, longitude: 77.5946 }, volunteerBToken);
    expect(res.status).toBe(201);
    expect(res.body.location).toBe("12.97160,77.59460");
  });

  it("401s without a token", async () => {
    const anon = await post({});
    expect(anon.status).toBe(401);
  });
});

describe("POST /api/volunteer-attendances (admin day record)", () => {
  it("records a past day with derived hours from the check-in/out pair", async () => {
    const res = await post(
      {
        volunteerId: volunteerBId,
        date: "2026-03-10",
        checkIn: "2026-03-10T09:00:00.000Z",
        checkOut: "2026-03-10T12:30:00.000Z",
        location: "Depot",
      },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.volunteerId).toBe(volunteerBId);
    expect(res.body.hours).toBe(3.5); // derived from the pair
    expect(res.body.location).toBe("Depot");
  });

  it("upserts the same day instead of duplicating", async () => {
    const res = await post(
      { volunteerId: volunteerBId, date: "2026-03-10", checkIn: "2026-03-10T08:00:00.000Z", hours: 6 },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.hours).toBe(6);
    const { db } = await import("@/infrastructure/database/prisma");
    const rows = await db.volunteerAttendance.findMany({
      where: { volunteerId: volunteerBId, date: new Date("2026-03-10") },
    });
    expect(rows).toHaveLength(1);
  });

  it("400s on missing volunteerId / bad hours / bad date, 404s on unknown volunteer", async () => {
    const noVol = await post({}, adminToken);
    expect(noVol.status).toBe(400);
    expect(noVol.body.error).toBe("volunteerId is required");

    const ghost = await post({ volunteerId: "no-such-volunteer" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Volunteer not found");

    const badHours = await post({ volunteerId: volunteerAId, hours: 30 }, adminToken);
    expect(badHours.status).toBe(400);
    expect(badHours.body.error).toBe("Hours must be between 0 and 24");

    const negative = await post({ volunteerId: volunteerAId, hours: -1 }, adminToken);
    expect(negative.status).toBe(400);

    const badDate = await post({ volunteerId: volunteerAId, date: "whenever" }, adminToken);
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("Date is invalid");
  });

  it("role-branches VOLUNTEER sessions into self check-in regardless of body fields", async () => {
    // a VOLUNTEER session with a volunteerId body still self-checks-in (own record)
    const res = await post({ volunteerId: volunteerBId }, volunteerBToken);
    expect([200, 201]).toContain(res.status);
    expect(res.body.volunteerId).toBe(volunteerBId); // own record, not a stranger's
  });
});

describe("GET /api/volunteer-attendances", () => {
  it("ADMIN filters with ?volunteerId and the register carries volunteer.user", async () => {
    const res = await get(`?volunteerId=${volunteerBId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((r: { volunteerId: string }) => r.volunteerId === volunteerBId)).toBe(true);
    expect(res.body[0].volunteer.user.name).toContain(PREFIX);
  });

  it("VOLUNTEER sessions are scoped to their own register (volunteerId ignored)", async () => {
    const res = await get(`?volunteerId=${volunteerBId}`, volunteerAToken);
    expect(res.status).toBe(200);
    expect(res.body.every((r: { volunteerId: string }) => r.volunteerId === volunteerAId)).toBe(true);
  });

  it("filters with ?from&to", async () => {
    const res = await get("?from=2026-03-01&to=2026-03-31", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((r: { volunteerId: string }) => r.volunteerId === volunteerBId)).toBe(true);
  });

  it("401s without a token", async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });
});
