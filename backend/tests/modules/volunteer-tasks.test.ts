/**
 * Volunteer tasks (vitest + supertest integration, real routers).
 *
 *   GET    /api/volunteer-tasks        — ?mine=1 (auth) own tasks desc; else ADMIN
 *                                        filters ?status&type&volunteerId&refType&refId&q
 *   POST   /api/volunteer-tasks        — ADMIN manual creation (createdFrom MANUAL)
 *   PATCH  /api/volunteer-tasks/:id    — ADMIN any task · VOLUNTEER only their own
 *                                        (shared ASSIGNED→IN_PROGRESS→COMPLETED machine)
 *   DELETE /api/volunteer-tasks/:id    — ADMIN
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-voltask-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerAToken: string;
let volunteerBToken: string;

let volunteerAId: string;
let volunteerBId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: volunteerTasksRouter } = await import("@/routes/volunteer-tasks");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
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
  const r = request(app).get(`/api/volunteer-tasks${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/volunteer-tasks");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/volunteer-tasks/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/volunteer-tasks/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
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

  const mkVolunteer = async (tag: string) => {
    const user = await db.user.create({
      data: {
        email: `${PREFIX}-${tag}@test.local`,
        name: `${PREFIX} ${tag}`,
        role: "VOLUNTEER",
        password: hashPassword(PASSWORD),
      },
    });
    return db.volunteer.create({
      data: { code: `${PREFIX}-vol-${tag.toUpperCase()}`, userId: user.id, status: "ACTIVE" },
    });
  };
  volunteerAId = (await mkVolunteer("vol-a")).id;
  volunteerBId = (await mkVolunteer("vol-b")).id;
  // a VOLUNTEER login with NO volunteer profile (for the ?mine=1 empty case)
  await db.user.create({
    data: {
      email: `${PREFIX}-plain@test.local`,
      name: `${PREFIX} plain`,
      role: "VOLUNTEER",
      password: hashPassword(PASSWORD),
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
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/volunteer-tasks (ADMIN manual creation)", () => {
  it("creates a MANUAL task with defaults", async () => {
    const when = "2026-12-10T09:00:00.000Z";
    const res = await post(
      {
        volunteerId: volunteerAId,
        title: `${PREFIX} kit drive`,
        description: "Scan and hand out kits",
        scheduledDate: when,
        location: "Depot",
      },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.createdFrom).toBe("MANUAL");
    expect(res.body.status).toBe("ASSIGNED");
    expect(res.body.type).toBe("DISTRIBUTION"); // default
    expect(res.body.priority).toBe("MEDIUM"); // default
    expect(new Date(res.body.scheduledDate).toISOString()).toBe(when);
  });

  it("400s on missing title / volunteerId / scheduledDate and invalid enums", async () => {
    const noTitle = await post({ volunteerId: volunteerAId, scheduledDate: new Date() }, adminToken);
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error).toBe("title is required");

    const noVol = await post({ title: "x", scheduledDate: new Date() }, adminToken);
    expect(noVol.status).toBe(400);
    expect(noVol.body.error).toBe("volunteerId is required");

    const noDate = await post({ volunteerId: volunteerAId, title: "x" }, adminToken);
    expect(noDate.status).toBe(400);
    expect(noDate.body.error).toBe("scheduledDate is required");

    const badDate = await post(
      { volunteerId: volunteerAId, title: "x", scheduledDate: "sometime" },
      adminToken
    );
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("scheduledDate is required");

    const badType = await post(
      { volunteerId: volunteerAId, title: "x", scheduledDate: new Date(), type: "TELEPORT" },
      adminToken
    );
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("Invalid task type");

    const badPriority = await post(
      { volunteerId: volunteerAId, title: "x", scheduledDate: new Date(), priority: "URGENT" },
      adminToken
    );
    expect(badPriority.status).toBe(400);
    expect(badPriority.body.error).toBe("Invalid priority");
  });

  it("validates the optional refType/refId pair", async () => {
    const badRefType = await post(
      { volunteerId: volunteerAId, title: "x", scheduledDate: new Date(), refType: "PANTRY" },
      adminToken
    );
    expect(badRefType.status).toBe(400);
    expect(badRefType.body.error).toBe("Invalid refType");

    const noRefId = await post(
      { volunteerId: volunteerAId, title: "x", scheduledDate: new Date(), refType: "MISSION" },
      adminToken
    );
    expect(noRefId.status).toBe(400);
    expect(noRefId.body.error).toBe("refId is required when refType is provided");

    const ok = await post(
      {
        volunteerId: volunteerAId,
        title: `${PREFIX} linked task`,
        scheduledDate: new Date(),
        refType: "MISSION",
        refId: "any-mission-id",
      },
      adminToken
    );
    expect(ok.status).toBe(201);
    expect(ok.body.refType).toBe("MISSION");
    expect(ok.body.refId).toBe("any-mission-id");
  });

  it("404s on an unknown volunteer", async () => {
    const res = await post({ volunteerId: "no-such-volunteer", title: "x", scheduledDate: new Date() }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Volunteer not found");
  });

  it("401s without a token and 403s for VOLUNTEER", async () => {
    const anon = await post({ volunteerId: volunteerAId, title: "x", scheduledDate: new Date() });
    expect(anon.status).toBe(401);
    const vol = await post(
      { volunteerId: volunteerAId, title: "x", scheduledDate: new Date() },
      volunteerAToken
    );
    expect(vol.status).toBe(403);
  });
});

describe("GET /api/volunteer-tasks", () => {
  it("?mine=1 returns the session volunteer's tasks newest scheduledDate first", async () => {
    const created: string[] = [];
    for (const day of ["2026-11-01", "2026-12-01", "2026-10-01"]) {
      const res = await post(
        { volunteerId: volunteerBId, title: `${PREFIX} ${day}`, scheduledDate: `${day}T10:00:00.000Z` },
        adminToken
      );
      created.push(res.body.id);
    }
    const res = await get("?mine=1", volunteerBToken);
    expect(res.status).toBe(200);
    const mine = res.body.filter((t: { id: string }) => created.includes(t.id));
    expect(mine.map((t: { id: string }) => t.id)).toEqual([created[1], created[0], created[2]]); // desc

    // a user without a volunteer profile gets an empty array
    const { db } = await import("@/infrastructure/database/prisma");
    const plain = await db.user.findFirst({ where: { email: `${PREFIX}-plain@test.local` } });
    const { issueToken } = await import("@/infrastructure/auth/session");
    const plainToken = issueToken({
      userId: plain!.id,
      role: plain!.role,
      name: plain!.name,
      email: plain!.email,
    });
    const empty = await get("?mine=1", plainToken);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
  });

  it("without ?mine=1 the ADMIN roster filters apply (?status&type&volunteerId&q, ?page envelope)", async () => {
    const filtered = await get(`?volunteerId=${volunteerBId}&status=ASSIGNED`, adminToken);
    expect(filtered.status).toBe(200);
    expect(filtered.body.length).toBeGreaterThanOrEqual(3);
    expect(
      filtered.body.every(
        (t: { volunteerId: string; status: string }) =>
          t.volunteerId === volunteerBId && t.status === "ASSIGNED"
      )
    ).toBe(true);

    const byQ = await get(`?q=${encodeURIComponent("2026-12-01")}&volunteerId=${volunteerBId}`, adminToken);
    expect(byQ.status).toBe(200);
    expect(byQ.body.length).toBe(1);

    const paged = await get("?page=1&limit=2", adminToken);
    expect(paged.status).toBe(200);
    expect(paged.body.items.length).toBeLessThanOrEqual(2);
    expect(paged.body.total).toBeGreaterThanOrEqual(4);
    expect(paged.body.pages).toBeGreaterThanOrEqual(2);
  });

  it("401s without a token and 403s for a non-admin on the roster branch", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const vol = await get("", volunteerAToken);
    expect(vol.status).toBe(403);
  });
});

describe("PATCH /api/volunteer-tasks/:id", () => {
  it("a volunteer advances their own task and completion stamps completedAt", async () => {
    const created = await post(
      { volunteerId: volunteerAId, title: `${PREFIX} patch flow`, scheduledDate: new Date() },
      adminToken
    );
    const id = created.body.id;

    const started = await patch(id, { status: "IN_PROGRESS", notes: "on the way" }, volunteerAToken);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("IN_PROGRESS");
    expect(started.body.notes).toBe("on the way");
    expect(started.body.completedAt).toBeNull();

    const done = await patch(id, { status: "COMPLETED" }, volunteerAToken);
    expect(done.status).toBe(200);
    expect(done.body.completedAt).toBeTruthy();

    // COMPLETED is terminal
    const terminal = await patch(id, { status: "IN_PROGRESS" }, adminToken);
    expect(terminal.status).toBe(409);
    expect(terminal.body.error).toContain("Cannot move task from COMPLETED to IN_PROGRESS");
  });

  it("a volunteer cannot update someone else's task", async () => {
    const created = await post(
      { volunteerId: volunteerBId, title: `${PREFIX} not yours`, scheduledDate: new Date() },
      adminToken
    );
    const res = await patch(created.body.id, { status: "CANCELLED" }, volunteerAToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only update your own tasks");
  });

  it("400s on an invalid status, 404s on an unknown task (lookup first)", async () => {
    const created = await post(
      { volunteerId: volunteerAId, title: `${PREFIX} bad status`, scheduledDate: new Date() },
      adminToken
    );
    const badStatus = await patch(created.body.id, { status: "LOST" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid status");

    const ghost = await patch("no-such-task", { status: "LOST" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Task not found");
  });
});

describe("DELETE /api/volunteer-tasks/:id (ADMIN)", () => {
  it("deletes a task for ADMIN", async () => {
    const created = await post(
      { volunteerId: volunteerAId, title: `${PREFIX} doomed`, scheduledDate: new Date() },
      adminToken
    );
    const res = await del(created.body.id, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const gone = await del(created.body.id, adminToken);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("Task not found");
  });

  it("401s without a token and 403s for VOLUNTEER", async () => {
    const anon = await del("whatever");
    expect(anon.status).toBe(401);
    const vol = await del("whatever", volunteerAToken);
    expect(vol.status).toBe(403);
  });
});
