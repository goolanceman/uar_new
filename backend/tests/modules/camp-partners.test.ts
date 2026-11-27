/**
 * Camp partners (vitest + supertest integration, real routers).
 *
 *   GET   /api/camp-partners?campId&status — ADMIN all; HOSPITAL its own invitations
 *   POST  /api/camp-partners               — ADMIN invites an org (INVITED)
 *   PATCH /api/camp-partners/:id           — ADMIN, or the HOSPITAL owning the org
 *                                            {status: ACCEPTED|DECLINED, notes?}
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-campprt-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let hospitalAToken: string;
let hospitalBToken: string;
let volunteerToken: string;

let campId: string;
let orgAId: string;
let orgBId: string;
let partnerAId: string;
let partnerBId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: campPartnersRouter } = await import("@/routes/camp-partners");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/camp-partners", campPartnersRouter);
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
  const r = request(app).get(`/api/camp-partners${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/camp-partners");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/camp-partners/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.campPartner.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campStaff.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campRegistration.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campAttendance.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campExpense.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.medicalCamp.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.healthcareOrg.deleteMany({ where: { name: { startsWith: PREFIX } } });
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
  const hospitalA = await db.user.create({
    data: {
      email: `${PREFIX}-hos-a@test.local`,
      name: `${PREFIX} hospital A`,
      role: "HOSPITAL",
      password: hashPassword(PASSWORD),
    },
  });
  const hospitalB = await db.user.create({
    data: {
      email: `${PREFIX}-hos-b@test.local`,
      name: `${PREFIX} hospital B`,
      role: "HOSPITAL",
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

  const orgA = await db.healthcareOrg.create({
    data: { name: `${PREFIX} org a`, type: "HOSPITAL", status: "VERIFIED", ownerUserId: hospitalA.id },
  });
  orgAId = orgA.id;
  const orgB = await db.healthcareOrg.create({
    data: { name: `${PREFIX} org b`, type: "HOSPITAL", status: "VERIFIED", ownerUserId: hospitalB.id },
  });
  orgBId = orgB.id;

  const camp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP`,
      title: `${PREFIX} camp`,
      campDate: new Date(),
      venue: "City ground",
      status: "SCHEDULED",
    },
  });
  campId = camp.id;

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  hospitalAToken = await login("hos-a");
  hospitalBToken = await login("hos-b");
  volunteerToken = await login("vol");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/camp-partners (invite)", () => {
  it("invites an organisation as INVITED with the requested role", async () => {
    const res = await post({ campId, orgId: orgAId, role: "HOST" }, adminToken);
    expect(res.status).toBe(201);
    partnerAId = res.body.id;
    expect(res.body.campId).toBe(campId);
    expect(res.body.orgId).toBe(orgAId);
    expect(res.body.role).toBe("HOST");
    expect(res.body.status).toBe("INVITED");
    expect(res.body.respondedAt).toBeNull();
  });

  it("defaults the role to SUPPORT", async () => {
    const res = await post({ campId, orgId: orgBId }, adminToken);
    expect(res.status).toBe(201);
    partnerBId = res.body.id;
    expect(res.body.role).toBe("SUPPORT");
  });

  it("409s on a duplicate camp+org invitation", async () => {
    const res = await post({ campId, orgId: orgAId }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This organisation is already a partner of this camp");
  });

  it("400s on missing ids and an invalid role, 404s on unknown records", async () => {
    const noCamp = await post({ orgId: orgAId }, adminToken);
    expect(noCamp.status).toBe(400);
    expect(noCamp.body.error).toBe("campId is required");

    const noOrg = await post({ campId }, adminToken);
    expect(noOrg.status).toBe(400);
    expect(noOrg.body.error).toBe("orgId is required");

    const badRole = await post({ campId, orgId: orgAId, role: "PIZZA" }, adminToken);
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toBe("Invalid role");

    const ghostCamp = await post({ campId: "no-camp", orgId: orgAId }, adminToken);
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostOrg = await post({ campId, orgId: "no-org" }, adminToken);
    expect(ghostOrg.status).toBe(404);
    expect(ghostOrg.body.error).toBe("Organisation not found");
  });

  it("401s without a token and 403s for non-admin roles", async () => {
    const anon = await post({ campId, orgId: orgAId });
    expect(anon.status).toBe(401);
    const vol = await post({ campId, orgId: orgAId }, volunteerToken);
    expect(vol.status).toBe(403);
    const hospital = await post({ campId, orgId: orgAId }, hospitalAToken);
    expect(hospital.status).toBe(403);
  });
});

describe("GET /api/camp-partners", () => {
  it("lists all invitations for ADMIN with org + camp includes", async () => {
    const res = await get("", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const row = res.body.items.find((p: { id: string }) => p.id === partnerAId);
    expect(row.org.name).toBe(`${PREFIX} org a`);
    expect(row.camp.title).toBe(`${PREFIX} camp`);
  });

  it("filters by campId and status", async () => {
    const byCamp = await get(`?campId=${campId}&status=INVITED`, adminToken);
    expect(byCamp.status).toBe(200);
    expect(byCamp.body.total).toBe(2);
  });

  it("scopes a HOSPITAL caller to its own org's invitations", async () => {
    const own = await get("", hospitalAToken);
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(1);
    expect(own.body.items[0].orgId).toBe(orgAId);

    const ghost = own.body.items[0];
    expect(ghost.orgId).not.toBe(orgBId);
  });

  it("returns an empty envelope for a HOSPITAL caller with no linked org", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    await db.user.create({
      data: {
        email: `${PREFIX}-hos-c@test.local`,
        name: `${PREFIX} hospital C`,
        role: "HOSPITAL",
        password: await (async () => {
          const { hashPassword } = await import("@/infrastructure/auth/session");
          return hashPassword(PASSWORD);
        })(),
      },
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-hos-c@test.local`, password: PASSWORD });
    const res = await get("", login.body.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0, page: 1, pages: 1 });
  });

  it("401s without a token and 403s for non-member roles", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const vol = await get("", volunteerToken);
    expect(vol.status).toBe(403);
  });
});

describe("PATCH /api/camp-partners/:id (invitation/accept flow)", () => {
  it("the owning HOSPITAL accepts its invitation — respondedAt stamped", async () => {
    const res = await patch(partnerAId, { status: "ACCEPTED", notes: "sending 2 doctors" }, hospitalAToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACCEPTED");
    expect(res.body.respondedAt).toBeTruthy();
    expect(res.body.notes).toBe("sending 2 doctors");
  });

  it("a different HOSPITAL cannot respond to someone else's invitation", async () => {
    const res = await patch(partnerBId, { status: "DECLINED" }, hospitalAToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You do not have permission for this action");
  });

  it("ACCEPTED is terminal — a second response is a 409", async () => {
    const res = await patch(partnerAId, { status: "DECLINED" }, hospitalAToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Cannot move camp partner from ACCEPTED to DECLINED");
  });

  it("400s on an invalid status and 404s on an unknown partner id", async () => {
    const bad = await patch(partnerBId, { status: "MAYBE" }, adminToken);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("status must be ACCEPTED or DECLINED");

    const ghost = await patch("no-such-partner", { status: "ACCEPTED" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Camp partner record not found");
  });

  it("ADMIN can adjust the role and notes of an invitation", async () => {
    const res = await patch(partnerBId, { role: "SPONSOR", notes: "banner at entrance" }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("SPONSOR");
    expect(res.body.notes).toBe("banner at entrance");
    expect(res.body.respondedAt).toBeNull(); // still awaiting response
  });

  it("401s without a token and 403s for non-member roles", async () => {
    const anon = await patch(partnerBId, { status: "ACCEPTED" });
    expect(anon.status).toBe(401);
    const vol = await patch(partnerBId, { status: "ACCEPTED" }, volunteerToken);
    expect(vol.status).toBe(403);
  });
});
