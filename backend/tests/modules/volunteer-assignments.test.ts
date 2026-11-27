/**
 * Volunteer assignments (vitest + supertest integration, real routers).
 *
 *   POST /api/volunteer-assignments                     — ADMIN auto-generates ONE
 *     VolunteerTask per volunteer (createdFrom AUTO), duplicates skipped
 *   GET  /api/volunteer-assignments?refType=&refId=     — ADMIN tasks for one record
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-vassign-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;

let volunteerAId: string;
let volunteerBId: string;
let distributionId: string;
let campaignId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: volunteerAssignmentsRouter } = await import("@/routes/volunteer-assignments");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/volunteer-assignments", volunteerAssignmentsRouter);
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
  const r = request(app).get(`/api/volunteer-assignments${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/volunteer-assignments");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.volunteerTask.deleteMany({ where: { volunteer: { code: { startsWith: PREFIX } } } });
  await db.distribution.deleteMany({ where: { location: { startsWith: PREFIX } } });
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
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
  await db.user.create({
    data: {
      email: `${PREFIX}-vol@test.local`,
      name: `${PREFIX} vol`,
      role: "VOLUNTEER",
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
      data: { code: `${PREFIX}-VOL-${tag.toUpperCase()}`, userId: user.id, status: "ACTIVE" },
    });
  };
  volunteerAId = (await mkVolunteer("va")).id;
  volunteerBId = (await mkVolunteer("vb")).id;

  const distribution = await db.distribution.create({
    data: { type: "FOOD", quantity: 40, value: 2000, location: `${PREFIX} distribution point` },
  });
  distributionId = distribution.id;
  const campaign = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP`,
      title: `${PREFIX} campaign`,
      slug: `${PREFIX}-campaign`,
      description: `${PREFIX} assignment campaign fixture`,
      status: "ACTIVE",
      targetAmount: 100000,
    },
  });
  campaignId = campaign.id;

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  volunteerToken = await login("vol");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/volunteer-assignments (ADMIN)", () => {
  it("creates ONE AUTO task per volunteer with the ref in the description", async () => {
    const res = await post(
      { refType: "DISTRIBUTION", refId: distributionId, volunteerIds: [volunteerAId, volunteerBId] },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.tasks).toHaveLength(2);
    expect(res.body.skipped).toBe(0);

    for (const task of res.body.tasks) {
      expect(task.createdFrom).toBe("AUTO");
      expect(task.title).toBe("Distribution support"); // default title
      expect(task.type).toBe("DISTRIBUTION");
      expect(task.refType).toBe("DISTRIBUTION");
      expect(task.refId).toBe(distributionId);
      expect(task.description).toContain(distributionId);
      expect(task.status).toBe("ASSIGNED");
    }
    const volunteers = res.body.tasks.map((t: { volunteerId: string }) => t.volunteerId).sort();
    expect(volunteers).toEqual([volunteerAId, volunteerBId].sort());
  });

  it("skips duplicates on a re-assign (same volunteer+ref, not CANCELLED)", async () => {
    const res = await post(
      { refType: "DISTRIBUTION", refId: distributionId, volunteerIds: [volunteerAId] },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.tasks).toHaveLength(0);
    expect(res.body.skipped).toBe(1);
  });

  it("honours title / priority / scheduledDate / notes overrides", async () => {
    const when = "2026-12-05T09:00:00.000Z";
    const res = await post(
      {
        refType: "CAMPAIGN",
        refId: campaignId,
        volunteerIds: [volunteerAId],
        title: `${PREFIX} stall crew`,
        priority: "HIGH",
        scheduledDate: when,
        location: `${PREFIX} stall`,
        notes: "bring banners",
      },
      adminToken
    );
    expect(res.status).toBe(201);
    const task = res.body.tasks[0];
    expect(task.title).toBe(`${PREFIX} stall crew`);
    expect(task.priority).toBe("HIGH");
    expect(task.type).toBe("EVENT"); // campaign refs run events
    expect(task.location).toBe(`${PREFIX} stall`);
    expect(task.notes).toBe("bring banners");
    expect(new Date(task.scheduledDate).toISOString()).toBe(when);
    expect(task.description).toContain(`${PREFIX} campaign`);
  });

  it("EVENT refs are free-form (no record lookup)", async () => {
    const res = await post(
      { refType: "EVENT", refId: `${PREFIX}-freeform-event`, volunteerIds: [volunteerBId] },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].type).toBe("EVENT");
  });

  it("404s on unknown volunteers / distributions / campaigns", async () => {
    const ghostVol = await post(
      { refType: "EVENT", refId: "any", volunteerIds: ["no-such-volunteer"] },
      adminToken
    );
    expect(ghostVol.status).toBe(404);
    expect(ghostVol.body.error).toBe(`Volunteer(s) not found: no-such-volunteer`);

    const ghostDist = await post(
      { refType: "DISTRIBUTION", refId: "no-such-distribution", volunteerIds: [volunteerAId] },
      adminToken
    );
    expect(ghostDist.status).toBe(404);
    expect(ghostDist.body.error).toBe("Distribution not found");

    const ghostCampaign = await post(
      { refType: "CAMPAIGN", refId: "no-such-campaign", volunteerIds: [volunteerAId] },
      adminToken
    );
    expect(ghostCampaign.status).toBe(404);
    expect(ghostCampaign.body.error).toBe("Campaign not found");
  });

  it("400s on invalid refType / empty volunteerIds / missing refId", async () => {
    const badType = await post(
      { refType: "MISSION", refId: "x", volunteerIds: [volunteerAId] },
      adminToken
    );
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("refType must be DISTRIBUTION, CAMPAIGN or EVENT");

    const emptyIds = await post({ refType: "EVENT", refId: "x", volunteerIds: [] }, adminToken);
    expect(emptyIds.status).toBe(400);
    expect(emptyIds.body.error).toBe("volunteerIds must contain at least one volunteer");

    const noRefId = await post({ refType: "EVENT", volunteerIds: [volunteerAId] }, adminToken);
    expect(noRefId.status).toBe(400);
    expect(noRefId.body.error).toBe("refId is required");

    const badPriority = await post(
      { refType: "EVENT", refId: "x", volunteerIds: [volunteerAId], priority: "URGENT" },
      adminToken
    );
    expect(badPriority.status).toBe(400);
    expect(badPriority.body.error).toBe("priority must be LOW, MEDIUM or HIGH");
  });

  it("401s without a token and 403s for non-admin roles", async () => {
    const anon = await post({ refType: "EVENT", refId: "x", volunteerIds: [volunteerAId] });
    expect(anon.status).toBe(401);
    const vol = await post(
      { refType: "EVENT", refId: "x", volunteerIds: [volunteerAId] },
      volunteerToken
    );
    expect(vol.status).toBe(403);
  });
});

describe("GET /api/volunteer-assignments?refType&refId (ADMIN)", () => {
  it("lists the tasks of one record, newest first, with the volunteer's user", async () => {
    const res = await get(`?refType=DISTRIBUTION&refId=${distributionId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const task of res.body) {
      expect(task.refId).toBe(distributionId);
      expect(task.volunteer.user.name).toContain(PREFIX);
    }
  });

  it("400s on an invalid refType and a missing refId", async () => {
    const badType = await get("?refType=MISSION&refId=x", adminToken);
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("refType must be DISTRIBUTION, CAMPAIGN or EVENT");

    const noRefId = await get("?refType=DISTRIBUTION", adminToken);
    expect(noRefId.status).toBe(400);
    expect(noRefId.body.error).toBe("refId is required");
  });

  it("401s without a token and 403s for non-admin roles", async () => {
    const anon = await get("?refType=EVENT&refId=x");
    expect(anon.status).toBe(401);
    const vol = await get("?refType=EVENT&refId=x", volunteerToken);
    expect(vol.status).toBe(403);
  });
});
