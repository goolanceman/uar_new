/**
 * Volunteers (vitest + supertest integration, real routers).
 *
 *   GET   /api/volunteers               — ADMIN roster array; ?analytics=1 roll-up;
 *                                         ?page&limit paged envelope
 *   GET   /api/volunteers/me            — session volunteer profile incl tasks + application
 *   PATCH /api/volunteers/:id           — ADMIN any field; VOLUNTEER self-service
 *                                         roster fields only (status/assignedArea stripped)
 *   GET   /api/volunteers/:id           — ADMIN profile with tasks + attendance stats
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-vols-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerAToken: string;
let volunteerBToken: string;
let plainVolunteerToken: string;

let volunteerAId: string;
let volunteerBId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: volunteersRouter } = await import("@/routes/volunteers");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/volunteers", volunteersRouter);
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

function get(path: string, token?: string) {
  const r = request(app).get(`/api/volunteers${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/volunteers/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.volunteerAttendance.deleteMany({ where: { volunteer: { code: { startsWith: PREFIX } } } });
  await db.volunteerTask.deleteMany({ where: { volunteer: { code: { startsWith: PREFIX } } } });
  await db.volunteerApplication.deleteMany({ where: { email: { startsWith: PREFIX } } });
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
  const userA = await mk("vol-a", "VOLUNTEER");
  const userB = await mk("vol-b", "VOLUNTEER");
  await mk("plain", "VOLUNTEER"); // VOLUNTEER login with NO volunteer profile

  const volunteerA = await db.volunteer.create({
    data: { code: `${PREFIX}-vol-a`, userId: userA.id, status: "ACTIVE", skills: '["Driving"]' },
  });
  volunteerAId = volunteerA.id;
  const volunteerB = await db.volunteer.create({
    data: { code: `${PREFIX}-vol-b`, userId: userB.id, status: "ACTIVE" },
  });
  volunteerBId = volunteerB.id;

  // task + attendance fixtures for the analytics roll-up and detail stats
  await db.volunteerTask.create({
    data: {
      volunteerId: volunteerAId,
      title: `${PREFIX} finished drive`,
      type: "DISTRIBUTION",
      status: "COMPLETED",
      completedAt: new Date(),
      scheduledDate: new Date(),
    },
  });
  await db.volunteerTask.create({
    data: {
      volunteerId: volunteerAId,
      title: `${PREFIX} open drive`,
      type: "EVENT",
      status: "ASSIGNED",
      scheduledDate: new Date(),
    },
  });
  await db.volunteerTask.create({
    data: {
      volunteerId: volunteerAId,
      title: `${PREFIX} cancelled drive`,
      type: "EVENT",
      status: "CANCELLED",
      scheduledDate: new Date(),
    },
  });
  await db.volunteerAttendance.create({
    data: {
      volunteerId: volunteerAId,
      date: new Date(), // this month → hoursThisMonth + monthlyHours trend
      checkIn: new Date(),
      hours: 3.5,
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
  volunteerAToken = await login("vol-a");
  volunteerBToken = await login("vol-b");
  plainVolunteerToken = await login("plain");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/volunteers (roster + analytics)", () => {
  it("returns the roster array with the linked user for ADMIN", async () => {
    const res = await get("", adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const mine = res.body.filter((v: { code: string }) => v.code.startsWith(PREFIX));
    expect(mine).toHaveLength(2);
    expect(mine[0].user.name).toContain(PREFIX);
  });

  it("?analytics=1 returns the analytics roll-up shape", async () => {
    const res = await get("?analytics=1", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.kpis.totalVolunteers).toBeGreaterThanOrEqual(2);
    expect(res.body.kpis.activeVolunteers).toBeGreaterThanOrEqual(2);
    expect(res.body.kpis.tasksAssigned).toBeGreaterThanOrEqual(2); // 3 minus 1 cancelled
    expect(res.body.kpis.tasksCompleted).toBeGreaterThanOrEqual(1);
    expect(res.body.kpis.hoursThisMonth).toBeGreaterThanOrEqual(3.5);

    expect(res.body.tasksByType).toHaveLength(6); // canonical TASK_TYPES
    expect(res.body.taskStatus).toHaveLength(4); // canonical TASK_STATUSES
    expect(res.body.taskStatus.find((s: { status: string }) => s.status === "COMPLETED").count).toBeGreaterThanOrEqual(1);

    const me = res.body.leaderboard.find((l: { volunteerId: string }) => l.volunteerId === volunteerAId);
    expect(me).toBeTruthy();
    expect(me.completed).toBeGreaterThanOrEqual(1);
    expect(me.name).toContain(PREFIX);

    expect(res.body.monthlyHours).toHaveLength(6);
    const thisMonth = res.body.monthlyHours[res.body.monthlyHours.length - 1];
    expect(thisMonth.hours).toBeGreaterThanOrEqual(3.5);
  });

  it("?page&limit switches to the paged envelope", async () => {
    const res = await get("?page=1&limit=1", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(res.body.pages).toBeGreaterThanOrEqual(2);
  });

  it("401s without a token and 403s for VOLUNTEER", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const vol = await get("", volunteerAToken);
    expect(vol.status).toBe(403);
  });
});

describe("GET /api/volunteers/me", () => {
  it("returns the session volunteer with tasks", async () => {
    const res = await get("/me", volunteerAToken);
    expect(res.status).toBe(200);
    expect(res.body.volunteer.id).toBe(volunteerAId);
    expect(res.body.volunteer.code).toBe(`${PREFIX}-vol-a`);
    expect(res.body.volunteer.tasks).toHaveLength(3);
  });

  it("returns nulls for a signed-in user without a volunteer profile", async () => {
    const res = await get("/me", plainVolunteerToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ volunteer: null, application: null });
  });

  it("401s without a token", async () => {
    const res = await get("/me");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/volunteers/:id (self-service whitelist)", () => {
  it("a volunteer may edit own roster fields — status/assignedArea are stripped", async () => {
    const res = await patch(
      volunteerAId,
      { skills: '["First aid"]', status: "SUSPENDED", assignedArea: "North zone" },
      volunteerAToken
    );
    expect(res.status).toBe(200);
    expect(res.body.skills).toContain("First aid");
    expect(res.body.status).toBe("ACTIVE"); // stripped for VOLUNTEER callers
    expect(res.body.assignedArea).toBeNull(); // stripped for VOLUNTEER callers
  });

  it("a volunteer cannot edit someone else's profile", async () => {
    const res = await patch(volunteerBId, { skills: '["Hacking"]' }, volunteerAToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You do not have permission for this action");
  });

  it("ADMIN updates any field; status mirrors onto the user account", async () => {
    const res = await patch(volunteerBId, { assignedArea: "South zone", status: "INACTIVE" }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.assignedArea).toBe("South zone");
    expect(res.body.status).toBe("INACTIVE");

    const { db } = await import("@/infrastructure/database/prisma");
    const user = await db.volunteer.findUnique({ where: { id: volunteerBId } }).user();
    expect(user?.status).toBe("ACTIVE"); // INACTIVE mirrors isActive=false, not SUSPENDED
    expect(user?.isActive).toBe(false);
  });

  it("400s on nothing to update and an invalid status; 404s on unknown id", async () => {
    const empty = await patch(volunteerAId, {}, adminToken);
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const badStatus = await patch(volunteerAId, { status: "ELITE" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid volunteer status");

    // the volunteer lookup runs BEFORE the field checks (404-before-400)
    const ghost = await patch("no-such-volunteer", { status: "ELITE" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Volunteer not found");
  });
});

describe("GET /api/volunteers/:id (admin detail)", () => {
  it("returns the profile with tasks and attendance stats", async () => {
    const res = await get(`/${volunteerAId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(volunteerAId);
    expect(res.body.tasks).toHaveLength(3);
    expect(res.body.stats).toEqual({
      tasksAssigned: 3,
      tasksCompleted: 1,
      daysPresent: 1,
      totalHours: 3.5,
    });
  });

  it("404s on an unknown id", async () => {
    const res = await get("/no-such-volunteer", adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Volunteer not found");
  });

  it("401s without a token and 403s for VOLUNTEER (ADMIN-only)", async () => {
    const anon = await get(`/${volunteerAId}`);
    expect(anon.status).toBe(401);
    const vol = await get(`/${volunteerAId}`, volunteerAToken);
    expect(vol.status).toBe(403);
  });
});
