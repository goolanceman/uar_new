/**
 * Camp registrations (vitest + supertest integration, real routers).
 *
 *   GET   /api/camp-registrations        — ADMIN/VOLUNTEER all; HOSPITAL partner camps; BENEFICIARY own
 *   POST  /api/camp-registrations        — desk registration + BENEFICIARY self-service
 *   GET   /api/camp-registrations/:id    — ADMIN/VOLUNTEER detail
 *   PATCH /api/camp-registrations/:id    — ADMIN/VOLUNTEER status/slot/notes
 *
 * Covers the capacity and duplicate 409s of the camps chain.
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-campreg-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string;
let hospitalToken: string;
let beneficiaryToken: string;
let ghostBeneficiaryToken: string;

let campId: string; // SCHEDULED, capacity 10
let selfCampId: string; // SCHEDULED, capacity 10 (self-service target)
let forbidCampId: string; // SCHEDULED, capacity 10 (BENEFICIARY-gate target)
let draftCampId: string;
let fullCampId: string; // capacity 1, already full
let beneficiaryId: string;
let otherBeneficiaryId: string;
let registrationId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: campRegistrationsRouter } = await import("@/routes/camp-registrations");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/camp-registrations", campRegistrationsRouter);
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
  const r = request(app).get(`/api/camp-registrations${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/camp-registrations");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/camp-registrations/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.campAttendance.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campRegistration.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campExpense.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campStaff.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campPartner.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.medicalCamp.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.beneficiary.deleteMany({ where: { code: { startsWith: PREFIX } } });
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
  await mk("hospital", "HOSPITAL");
  const beneficiaryUser = await mk("ben", "BENEFICIARY");
  await mk("ben2", "BENEFICIARY"); // no linked beneficiary profile

  const camp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP`,
      title: `${PREFIX} camp`,
      campDate: new Date(),
      venue: "Community hall",
      status: "SCHEDULED",
      capacity: 10,
    },
  });
  campId = camp.id;
  const selfCamp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP-SELF`,
      title: `${PREFIX} self camp`,
      campDate: new Date(),
      venue: "Park pavilion",
      status: "SCHEDULED",
      capacity: 10,
    },
  });
  selfCampId = selfCamp.id;
  const forbidCamp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP-FORBID`,
      title: `${PREFIX} forbid camp`,
      campDate: new Date(),
      venue: "Another hall",
      status: "SCHEDULED",
      capacity: 10,
    },
  });
  forbidCampId = forbidCamp.id;
  const draft = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP-DRAFT`,
      title: `${PREFIX} draft camp`,
      campDate: new Date(),
      venue: "Nowhere",
      status: "DRAFT",
    },
  });
  draftCampId = draft.id;
  const full = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP-FULL`,
      title: `${PREFIX} full camp`,
      campDate: new Date(),
      venue: "Small room",
      status: "LIVE",
      capacity: 1,
    },
  });
  fullCampId = full.id;

  const ben = await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN-1`, name: `${PREFIX} ben one`, userId: beneficiaryUser.id },
  });
  beneficiaryId = ben.id;
  const ben2 = await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN-2`, name: `${PREFIX} ben two` },
  });
  otherBeneficiaryId = ben2.id;
  const ben3 = await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN-3`, name: `${PREFIX} ben three` },
  });
  // fill the capacity-1 camp
  await db.campRegistration.create({
    data: { campId: fullCampId, beneficiaryId: ben2.id, code: `${PREFIX}-REG-FULL` },
  });

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
  hospitalToken = await login("hospital");
  beneficiaryToken = await login("ben");
  ghostBeneficiaryToken = await login("ben2");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/camp-registrations", () => {
  it("registers a beneficiary from the desk with a generated code", async () => {
    const res = await post({ campId, beneficiaryId }, adminToken);
    expect(res.status).toBe(201);
    registrationId = res.body.id;
    expect(res.body.code).toContain("UAR-CREG");
    expect(res.body.status).toBe("REGISTERED");
    expect(res.body.registeredVia).toBe("DESK");
    expect(res.body.registeredByName).toBe(`${PREFIX} admin`);
  });

  it("409s on a duplicate camp+beneficiary registration", async () => {
    const res = await post({ campId, beneficiaryId }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Beneficiary is already registered for this camp");
  });

  it("409s when camp capacity is reached", async () => {
    const res = await post({ campId: fullCampId, beneficiaryId }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Camp capacity reached");
  });

  it("409s when the camp is DRAFT (requires SCHEDULED or LIVE)", async () => {
    const res = await post({ campId: draftCampId, beneficiaryId }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("requires SCHEDULED or LIVE");
  });

  it("404s on an unknown camp / beneficiary and 400s on missing fields", async () => {
    const ghostCamp = await post({ campId: "no-camp", beneficiaryId }, adminToken);
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostBen = await post({ campId, beneficiaryId: "no-ben" }, adminToken);
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const noCamp = await post({ beneficiaryId }, adminToken);
    expect(noCamp.status).toBe(400);
    expect(noCamp.body.error).toBe("campId is required");

    const noBen = await post({ campId }, adminToken);
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    // the duplicate check runs BEFORE the registeredVia/slot validation —
    // use a beneficiary that is not yet registered for this camp
    const badVia = await post(
      { campId, beneficiaryId: otherBeneficiaryId, registeredVia: "DRONE" },
      adminToken
    );
    expect(badVia.status).toBe(400);
    expect(badVia.body.error).toBe("Invalid registeredVia");

    const badSlot = await post(
      { campId, beneficiaryId: otherBeneficiaryId, scheduledSlot: "not-a-date" },
      adminToken
    );
    expect(badSlot.status).toBe(400);
    expect(badSlot.body.error).toBe("scheduledSlot is not a valid date");
  });

  it("a BENEFICIARY session may self-register (registeredVia SELF only)", async () => {
    const res = await post({ campId: selfCampId, beneficiaryId, registeredVia: "SELF" }, beneficiaryToken);
    expect(res.status).toBe(201);
    expect(res.body.registeredVia).toBe("SELF");
    expect(res.body.registeredByName).toBe(`${PREFIX} ben`);
  });

  it("blocks a BENEFICIARY registering via DESK or for someone else", async () => {
    const desk = await post(
      { campId: forbidCampId, beneficiaryId, registeredVia: "DESK" },
      beneficiaryToken
    );
    expect(desk.status).toBe(403);
    expect(desk.body.error).toBe("Beneficiaries may only self-register (registeredVia: SELF)");

    const other = await post(
      { campId: forbidCampId, beneficiaryId: otherBeneficiaryId, registeredVia: "SELF" },
      beneficiaryToken
    );
    expect(other.status).toBe(403);
    expect(other.body.error).toBe("You can only register yourself for a camp");

    const ghost = await post(
      { campId: forbidCampId, beneficiaryId, registeredVia: "SELF" },
      ghostBeneficiaryToken
    );
    expect(ghost.status).toBe(403);
    expect(ghost.body.error).toBe("No beneficiary profile is linked to your account");
  });

  it("401s without a token and 403s for DONOR", async () => {
    const anon = await post({ campId, beneficiaryId });
    expect(anon.status).toBe(401);
    const donor = await post({ campId, beneficiaryId }, donorToken);
    expect(donor.status).toBe(403);
  });
});

describe("GET /api/camp-registrations", () => {
  it("lists registrations for ADMIN with the beneficiary include", async () => {
    const res = await get(`?campId=${campId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const row = res.body.items.find((r: { id: string }) => r.id === registrationId);
    expect(row.beneficiary.name).toBe(`${PREFIX} ben one`);
    expect(row.campId).toBe(campId);
  });

  it("scopes a BENEFICIARY session to its own rows and HOSPITAL (no org) to empty", async () => {
    const own = await get("", beneficiaryToken);
    expect(own.status).toBe(200);
    expect(own.body.items.every((r: { beneficiaryId: string }) => r.beneficiaryId === beneficiaryId)).toBe(true);

    const hospital = await get("", hospitalToken);
    expect(hospital.status).toBe(200);
    expect(hospital.body).toEqual({ items: [], total: 0, page: 1, pages: 1 });
  });

  it("401s without a token and 403s for DONOR", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const donor = await get("", donorToken);
    expect(donor.status).toBe(403);
  });
});

describe("GET /api/camp-registrations/:id", () => {
  it("returns the detail row for ADMIN and VOLUNTEER", async () => {
    const admin = await get(`/${registrationId}`, adminToken);
    expect(admin.status).toBe(200);
    expect(admin.body.id).toBe(registrationId);
    expect(admin.body.beneficiaryId).toBe(beneficiaryId);

    const vol = await get(`/${registrationId}`, volunteerToken);
    expect(vol.status).toBe(200);
  });

  it("404s on an unknown id", async () => {
    const res = await get("/no-such-registration", adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Registration not found");
  });

  it("401s without a token and 403s for BENEFICIARY (ADMIN/VOLUNTEER only)", async () => {
    const anon = await get(`/${registrationId}`);
    expect(anon.status).toBe(401);
    const ben = await get(`/${registrationId}`, beneficiaryToken);
    expect(ben.status).toBe(403);
  });
});

describe("PATCH /api/camp-registrations/:id", () => {
  it("confirms a registration and updates slot + notes", async () => {
    const slot = "2026-12-01T10:00:00.000Z";
    const res = await patch(
      registrationId,
      { status: "CONFIRMED", scheduledSlot: slot, notes: "morning queue" },
      volunteerToken
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.scheduledSlot).toContain("10:00");
    expect(res.body.notes).toBe("morning queue");
  });

  it("409s on an illegal transition and 400s on an invalid status", async () => {
    const badJump = await patch(registrationId, { status: "REJECTED" }, adminToken);
    expect(badJump.status).toBe(409);
    expect(badJump.body.error).toContain("Cannot move camp registration from CONFIRMED to REJECTED");

    const badStatus = await patch(registrationId, { status: "TELEPORTED" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid status");
  });

  it("400s on an invalid scheduledSlot", async () => {
    const res = await patch(registrationId, { scheduledSlot: "whenever" }, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("scheduledSlot is not a valid date");
  });

  it("cancels a confirmed registration; CANCELLED is terminal", async () => {
    const cancel = await patch(registrationId, { status: "CANCELLED" }, adminToken);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("CANCELLED");

    const again = await patch(registrationId, { status: "CONFIRMED" }, adminToken);
    expect(again.status).toBe(409);
    expect(again.body.error).toContain("Cannot move camp registration from CANCELLED");
  });

  it("404s on an unknown id and 403s for non-editor roles", async () => {
    const ghost = await patch("no-such-registration", { status: "CONFIRMED" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Registration not found");

    const ben = await patch(registrationId, { status: "CONFIRMED" }, beneficiaryToken);
    expect(ben.status).toBe(403);
  });
});
