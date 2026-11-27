/**
 * Referrals integration tests — /api/referrals (thin routes over
 * src/modules/referrals). Forward-only workflow for staff, ACCEPTED-only for
 * the receiving HOSPITAL user, org/beneficiary scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `ref-${Date.now()}`;
const PASSWORD = "ref-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let nurseToken = "";
let hospitalToken = "";
let otherHospitalToken = "";
let benToken = "";

const userIds: string[] = [];
let orgId = "";
let otherOrgId = "";
let beneficiaryId = "";
let campId = "";
let encounterId = "";

async function buildApp() {
  const { router } = await import("@/routes/referrals");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/referrals", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const bens = await db.beneficiary.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const benIds = bens.map((b) => b.id);
  if (benIds.length) {
    await db.followUp.deleteMany({ where: { referral: { beneficiaryId: { in: benIds } } } });
    await db.medicalReferral.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.encounter.deleteMany({ where: { beneficiaryId: { in: benIds } } });
  }
  await db.healthProfessional.deleteMany({ where: { org: { name: { startsWith: PREFIX } } } });
  await db.medicalCamp.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.healthcareOrg.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.activityLog.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const mk = async (email: string, name: string, role: string) => {
    const u = await db.user.create({
      data: { email, name, role, password: hashPassword(PASSWORD), status: "ACTIVE", isActive: true },
    });
    userIds.push(u.id);
    return u;
  };

  const admin = await mk(`${PREFIX}-admin@test.local`, `${PREFIX} admin`, "ADMIN");
  const doctor = await mk(`${PREFIX}-doctor@test.local`, `${PREFIX} doctor`, "DOCTOR");
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const hospital = await mk(`${PREFIX}-hosp@test.local`, `${PREFIX} hosp`, "HOSPITAL");
  const otherHospital = await mk(`${PREFIX}-hosp2@test.local`, `${PREFIX} hosp2`, "HOSPITAL");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  hospitalToken = issueToken({ userId: hospital.id, role: "HOSPITAL", name: hospital.name, email: hospital.email });
  otherHospitalToken = issueToken({ userId: otherHospital.id, role: "HOSPITAL", name: otherHospital.name, email: otherHospital.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });

  const org = await db.healthcareOrg.create({
    data: { name: `${PREFIX} receiving org`, type: "HOSPITAL", ownerUserId: hospital.id },
  });
  orgId = org.id;
  const otherOrg = await db.healthcareOrg.create({
    data: { name: `${PREFIX} other org`, type: "CLINIC", ownerUserId: otherHospital.id },
  });
  otherOrgId = otherOrg.id;

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr ref`, kind: "DOCTOR", userId: doctor.id },
  });
  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;
  const camp = await db.medicalCamp.create({
    data: { code: `UAR-CAMP-${PREFIX.slice(4, 11)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
  });
  campId = camp.id;
  const encounter = await db.encounter.create({
    data: { beneficiaryId, doctorId: professional.id, status: "DRAFT" },
  });
  encounterId = encounter.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("referrals create", () => {
  it("401 anonymous; 403 NURSE (creation is DOCTOR|ADMIN)", async () => {
    const anon = await request(app).post("/api/referrals").send({});
    expect(anon.status).toBe(401);

    const nurse = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, reason: "x" });
    expect(nurse.status).toBe(403);
  });

  it("400 missing beneficiaryId/reason/priority; 404 unknown beneficiary/camp/encounter/org", async () => {
    const noBen = await request(app).post("/api/referrals").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    const ghostBen = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: "ghost" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const noReason = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("reason is required");

    const badPriority = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, reason: "needs review", priority: "WHENEVER" });
    expect(badPriority.status).toBe(400);
    expect(badPriority.body.error).toBe("priority must be one of: LOW, MEDIUM, HIGH, EMERGENCY");

    const ghostCamp = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, reason: "r", campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostEnc = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, reason: "r", encounterId: "ghost" });
    expect(ghostEnc.status).toBe(404);
    expect(ghostEnc.body.error).toBe("Encounter not found");

    const ghostOrg = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, reason: "r", receivingOrgId: "ghost" });
    expect(ghostOrg.status).toBe(404);
    expect(ghostOrg.body.error).toBe("Receiving organisation not found");
  });

  it("DOCTOR refers with receiving org + speciality — code UAR-REF, CREATED (201)", async () => {
    const res = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        beneficiaryId,
        campId,
        encounterId,
        reason: "Cardiology evaluation",
        priority: "HIGH",
        receivingOrgId: orgId,
        speciality: "Cardiology",
      });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^UAR-REF-\d{5}$/);
    expect(res.body.status).toBe("CREATED");
    expect(res.body.priority).toBe("HIGH");
    expect(res.body.referralDoctorName).toBe(`${PREFIX} doctor`);
    expect(res.body.receivingOrgId).toBe(orgId);
  });
});

describe("referrals list scoping", () => {
  it("HOSPITAL sees only referrals addressed to its org; BENEFICIARY own-only", async () => {
    // one referral addressed to the OTHER org so scoping is observable
    await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, reason: "Second opinion", priority: "LOW", receivingOrgId: otherOrgId });

    const own = await request(app).get("/api/referrals").set("Authorization", `Bearer ${hospitalToken}`);
    expect(own.status).toBe(200);
    expect(own.body.items.length).toBeGreaterThanOrEqual(1);
    expect(own.body.items.every((r: { receivingOrgId: string | null }) => r.receivingOrgId === orgId)).toBe(true);

    const mine = await request(app).get("/api/referrals").set("Authorization", `Bearer ${benToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items.every((r: { beneficiaryId: string }) => r.beneficiaryId === beneficiaryId)).toBe(true);

    const staff = await request(app)
      .get("/api/referrals")
      .query({ beneficiaryId, priority: "HIGH" })
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(staff.status).toBe(200);
    expect(staff.body.items.every((r: { priority: string }) => r.priority === "HIGH")).toBe(true);
  });
});

describe("referrals staff workflow", () => {
  let createdId = "";

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, reason: "Ortho review", priority: "MEDIUM", receivingOrgId: orgId });
    createdId = created.body.id;
  });

  it("GET /:id — NURSE 200, foreign HOSPITAL 403, 404 unknown", async () => {
    const nurse = await request(app).get(`/api/referrals/${createdId}`).set("Authorization", `Bearer ${nurseToken}`);
    expect(nurse.status).toBe(200);

    const foreignHosp = await request(app)
      .get(`/api/referrals/${createdId}`)
      .set("Authorization", `Bearer ${otherHospitalToken}`);
    expect(foreignHosp.status).toBe(403);
    expect(foreignHosp.body.error).toBe("You do not have permission for this action");

    const missing = await request(app)
      .get("/api/referrals/ghost-ref")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Referral not found");
  });

  it("400 on an unknown status string; forward skip CREATED → ACCEPTED is allowed; empty patch 400; 404", async () => {
    const bad = await request(app)
      .patch(`/api/referrals/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "TELEPORTED" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("status must be a forward move along");

    // legacy semantics: ANY strictly-forward move is legal, not just the next step
    const skip = await request(app)
      .patch(`/api/referrals/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACCEPTED" });
    expect(skip.status).toBe(200);
    expect(skip.body.status).toBe("ACCEPTED");

    const empty = await request(app)
      .patch(`/api/referrals/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const missing = await request(app)
      .patch("/api/referrals/ghost-ref")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SHARED" });
    expect(missing.status).toBe(404);
  });

  it("backward moves are 409; COMPLETED referrals cannot be cancelled", async () => {
    const created = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, reason: "Fast track", priority: "EMERGENCY" });
    const id = created.body.id;

    await request(app).patch(`/api/referrals/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "SHARED" });
    const back = await request(app)
      .patch(`/api/referrals/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CREATED" });
    expect(back.status).toBe(409);
    expect(back.body.error).toBe("Invalid transition SHARED → CREATED — status can only move forward");

    // walk to COMPLETED then try to cancel
    for (const status of ["ACCEPTED", "SCHEDULED", "ATTENDED", "REPORT_RECEIVED", "COMPLETED"]) {
      const step = await request(app)
        .patch(`/api/referrals/${id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status });
      expect(step.status).toBe(200);
    }
    const cancel = await request(app)
      .patch(`/api/referrals/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toBe("Completed referrals cannot be cancelled");
  });

  it("403 NURSE on PATCH (staff workflow is ADMIN|DOCTOR|HOSPITAL)", async () => {
    const nurse = await request(app)
      .patch(`/api/referrals/${createdId}`)
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ status: "ACCEPTED" });
    expect(nurse.status).toBe(403);
  });
});

describe("referrals HOSPITAL accept flow", () => {
  let inboundId = "";

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, reason: "Inbound consult", priority: "MEDIUM", receivingOrgId: orgId });
    inboundId = created.body.id;
  });

  it("HOSPITAL may only set ACCEPTED (403 otherwise)", async () => {
    const wrong = await request(app)
      .patch(`/api/referrals/${inboundId}`)
      .set("Authorization", `Bearer ${hospitalToken}`)
      .send({ status: "SHARED" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe("Hospital users may only set referral status to ACCEPTED");
  });

  it("receiving HOSPITAL accepts while CREATED; 409 once past SHARED; foreign org 403", async () => {
    const accept = await request(app)
      .patch(`/api/referrals/${inboundId}`)
      .set("Authorization", `Bearer ${hospitalToken}`)
      .send({ status: "ACCEPTED" });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe("ACCEPTED");

    // advance it out of reach, then the hospital cannot re-accept
    await request(app).patch(`/api/referrals/${inboundId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "SCHEDULED" });
    await request(app).patch(`/api/referrals/${inboundId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ATTENDED" });
    const late = await request(app)
      .patch(`/api/referrals/${inboundId}`)
      .set("Authorization", `Bearer ${hospitalToken}`)
      .send({ status: "ACCEPTED" });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("Cannot accept a referral in status ATTENDED");

    const foreign = await request(app)
      .patch(`/api/referrals/${inboundId}`)
      .set("Authorization", `Bearer ${otherHospitalToken}`)
      .send({ status: "ACCEPTED" });
    expect(foreign.status).toBe(403);
  });
});
