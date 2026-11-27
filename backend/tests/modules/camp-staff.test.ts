/**
 * Camp staff (vitest + supertest integration, real routers).
 *
 *   GET    /api/camp-staff?campId= — authenticated roster
 *   POST   /api/camp-staff         — ADMIN | HOSPITAL {campId, professionalId?, volunteerId?, role}
 *   DELETE /api/camp-staff?id=     — ADMIN (query-param id, as legacy)
 *   PATCH  /api/camp-staff/:id     — ADMIN advances ASSIGNED → CONFIRMED → ATTENDED
 *
 * HOSPITAL partner gates: linked org + ACCEPTED camp partner + own staff only.
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-campstf-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let hospitalOwnerToken: string;
let hospitalNoOrgToken: string;
let volunteerToken: string;

let campId: string;
let campAcceptedId: string; // camp where the hospital IS an accepted partner
let volunteerId: string;
let verifiedDoctorId: string;
let unverifiedDoctorId: string;
let nurseId: string;
let otherOrgDoctorId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: campStaffRouter } = await import("@/routes/camp-staff");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/camp-staff", campStaffRouter);
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
  const r = request(app).get(`/api/camp-staff${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/camp-staff");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/camp-staff/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/camp-staff?id=${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.campStaff.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campPartner.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campRegistration.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campAttendance.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campExpense.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.medicalCamp.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.healthProfessional.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.healthcareOrg.deleteMany({ where: { name: { startsWith: PREFIX } } });
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
  const hospitalOwner = await db.user.create({
    data: {
      email: `${PREFIX}-hos-own@test.local`,
      name: `${PREFIX} hospital owner`,
      role: "HOSPITAL",
      password: hashPassword(PASSWORD),
    },
  });
  await db.user.create({
    data: {
      email: `${PREFIX}-hos-bare@test.local`,
      name: `${PREFIX} hospital bare`,
      role: "HOSPITAL",
      password: hashPassword(PASSWORD),
    },
  });
  const volUser = await db.user.create({
    data: {
      email: `${PREFIX}-vol@test.local`,
      name: `${PREFIX} vol`,
      role: "VOLUNTEER",
      password: hashPassword(PASSWORD),
    },
  });
  const volunteer = await db.volunteer.create({
    data: { code: `${PREFIX}-vol-1`, userId: volUser.id, status: "ACTIVE" },
  });
  volunteerId = volunteer.id;

  const org = await db.healthcareOrg.create({
    data: { name: `${PREFIX} org`, type: "HOSPITAL", status: "VERIFIED", ownerUserId: hospitalOwner.id },
  });
  const otherOrg = await db.healthcareOrg.create({
    data: { name: `${PREFIX} other org`, type: "HOSPITAL", status: "VERIFIED" },
  });

  const verifiedDoctor = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr verified`, kind: "DOCTOR", orgId: org.id, verificationStatus: "VERIFIED" },
  });
  verifiedDoctorId = verifiedDoctor.id;
  const unverified = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr pending`, kind: "DOCTOR", orgId: org.id, verificationStatus: "PENDING" },
  });
  unverifiedDoctorId = unverified.id;
  const nurse = await db.healthProfessional.create({
    data: { name: `${PREFIX} nurse`, kind: "NURSE", orgId: org.id, verificationStatus: "VERIFIED" },
  });
  nurseId = nurse.id;
  const otherOrgDoctor = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr other org`, kind: "DOCTOR", orgId: otherOrg.id, verificationStatus: "VERIFIED" },
  });
  otherOrgDoctorId = otherOrgDoctor.id;

  const camp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP`,
      title: `${PREFIX} camp`,
      campDate: new Date(),
      venue: "Temple courtyard",
      status: "SCHEDULED",
    },
  });
  campId = camp.id;
  const campAccepted = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP-ACC`,
      title: `${PREFIX} accepted camp`,
      campDate: new Date(),
      venue: "School hall",
      status: "SCHEDULED",
    },
  });
  campAcceptedId = campAccepted.id;
  // the hospital accepted the invitation for campAccepted
  await db.campPartner.create({
    data: { campId: campAcceptedId, orgId: org.id, role: "SUPPORT", status: "ACCEPTED", respondedAt: new Date() },
  });

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  hospitalOwnerToken = await login("hos-own");
  hospitalNoOrgToken = await login("hos-bare");
  volunteerToken = await login("vol");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/camp-staff (ADMIN)", () => {
  it("assigns a volunteer and a verified professional to the roster", async () => {
    const vol = await post({ campId, volunteerId, role: "VOLUNTEER" }, adminToken);
    expect(vol.status).toBe(201);
    expect(vol.body.role).toBe("VOLUNTEER");
    expect(vol.body.status).toBe("ASSIGNED");
    expect(vol.body.campId).toBe(campId);

    const doc = await post({ campId, professionalId: verifiedDoctorId, role: "DOCTOR" }, adminToken);
    expect(doc.status).toBe(201);
    expect(doc.body.professional?.name).toBe(`${PREFIX} dr verified`);
  });

  it("400s on missing campId / neither id / invalid role / kind mismatch / unverified", async () => {
    const noCamp = await post({ volunteerId }, adminToken);
    expect(noCamp.status).toBe(400);
    expect(noCamp.body.error).toBe("campId is required");

    const noTarget = await post({ campId, role: "DOCTOR" }, adminToken);
    expect(noTarget.status).toBe(400);
    expect(noTarget.body.error).toBe("professionalId or volunteerId is required");

    const badRole = await post({ campId, volunteerId, role: "PILOT" }, adminToken);
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toBe("Invalid role");

    const mismatch = await post({ campId, professionalId: nurseId, role: "DOCTOR" }, adminToken);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe("This staff member is a NURSE, not a DOCTOR");

    const unverified = await post({ campId, professionalId: unverifiedDoctorId, role: "DOCTOR" }, adminToken);
    expect(unverified.status).toBe(400);
    expect(unverified.body.error).toBe("Only verified professionals can be assigned to clinical roles");
  });

  it("404s on unknown camp / volunteer / professional", async () => {
    const ghostCamp = await post({ campId: "no-camp", volunteerId }, adminToken);
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostVol = await post({ campId, volunteerId: "no-vol" }, adminToken);
    expect(ghostVol.status).toBe(404);
    expect(ghostVol.body.error).toBe("Volunteer not found");

    const ghostProf = await post({ campId, professionalId: "no-prof" }, adminToken);
    expect(ghostProf.status).toBe(404);
    expect(ghostProf.body.error).toBe("Professional not found");
  });

  it("401s without a token and 403s for VOLUNTEER", async () => {
    const anon = await post({ campId, volunteerId });
    expect(anon.status).toBe(401);
    const vol = await post({ campId, volunteerId }, volunteerToken);
    expect(vol.status).toBe(403);
  });
});

describe("POST /api/camp-staff (HOSPITAL partner gates)", () => {
  it("403s when no healthcare organisation is linked to the account", async () => {
    const res = await post({ campId, professionalId: verifiedDoctorId }, hospitalNoOrgToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("No healthcare organisation is linked to your account");
  });

  it("403s until the camp invitation is ACCEPTED", async () => {
    const res = await post({ campId, professionalId: verifiedDoctorId }, hospitalOwnerToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Accept the camp invitation before assigning staff");
  });

  it("a partner rosters its OWN verified staff on an accepted camp", async () => {
    const res = await post(
      { campId: campAcceptedId, professionalId: verifiedDoctorId, role: "DOCTOR" },
      hospitalOwnerToken
    );
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("DOCTOR");
  });

  it("partners cannot assign another org's staff or a volunteer", async () => {
    const foreign = await post(
      { campId: campAcceptedId, professionalId: otherOrgDoctorId, role: "DOCTOR" },
      hospitalOwnerToken
    );
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Partners can assign only their own staff");

    const vol = await post(
      { campId: campAcceptedId, volunteerId, role: "VOLUNTEER" },
      hospitalOwnerToken
    );
    expect(vol.status).toBe(403);
    expect(vol.body.error).toBe("Partners can assign only their own staff");
  });
});

describe("GET /api/camp-staff", () => {
  it("lists the camp roster for any authenticated caller", async () => {
    const res = await get(`?campId=${campId}`, volunteerToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items.every((s: { campId: string }) => s.campId === campId)).toBe(true);
  });

  it("401s without a token", async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/camp-staff/:id", () => {
  it("advances ASSIGNED → CONFIRMED → ATTENDED", async () => {
    const list = await get(`?campId=${campId}&status=ASSIGNED`, adminToken);
    const row = list.body.items[0];

    const confirmed = await patch(row.id, { status: "CONFIRMED" }, adminToken);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("CONFIRMED");

    const attended = await patch(row.id, { status: "ATTENDED" }, adminToken);
    expect(attended.status).toBe(200);
    expect(attended.body.status).toBe("ATTENDED");

    const terminal = await patch(row.id, { status: "CONFIRMED" }, adminToken);
    expect(terminal.status).toBe(409);
    expect(terminal.body.error).toContain("Cannot move camp staff assignment from ATTENDED");
  });

  it("400s on an invalid status BEFORE the existence lookup, then 404", async () => {
    const badStatus = await patch("no-such-staff", { status: "GHOST" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid camp staff status");

    const ghost = await patch("no-such-staff", { status: "CONFIRMED" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Camp staff record not found");
  });

  it("403s for VOLUNTEER (ADMIN-only PATCH)", async () => {
    const res = await patch("no-such-staff", { status: "CONFIRMED" }, volunteerToken);
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/camp-staff?id=", () => {
  it("removes a roster row by query-param id", async () => {
    const list = await get(`?campId=${campId}&status=ASSIGNED`, adminToken);
    const row = list.body.items[0];
    const res = await del(row.id, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const gone = await del(row.id, adminToken);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("Camp staff record not found");
  });

  it("400s without an id and 403s for non-admin roles", async () => {
    const noId = await request(app).delete("/api/camp-staff").set("Authorization", `Bearer ${adminToken}`);
    expect(noId.status).toBe(400);
    expect(noId.body.error).toBe("id query parameter is required");

    const vol = await del("whatever", volunteerToken);
    expect(vol.status).toBe(403);
  });
});
