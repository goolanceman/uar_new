/**
 * Encounters integration tests — /api/encounters (thin routes over
 * src/modules/encounters). DOCTOR-only creation with professional auto-link,
 * draft editing by the owning doctor, sign gate, signed immutability via
 * amendments.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `enc-${Date.now()}`;
const PASSWORD = "enc-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let otherDoctorToken = "";
let nurseToken = "";
let benToken = "";
let strayBenToken = "";

const userIds: string[] = [];
let professionalId = "";
let otherProfessionalId = "";
let beneficiaryId = "";
let strayBeneficiaryId = "";
let campId = "";
let draftEncounterId = "";
let signedEncounterId = "";

async function buildApp() {
  const { router } = await import("@/routes/encounters");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/encounters", router);
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
    await db.medicationDispense.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.prescription.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.vitalObservation.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.screeningRecord.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.diagnosticOrder.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.appointment.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.encounter.deleteMany({ where: { beneficiaryId: { in: benIds } } });
  }
  await db.medicalCamp.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.healthProfessional.deleteMany({ where: { name: { startsWith: PREFIX } } });
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
  const otherDoctor = await mk(`${PREFIX}-dr2@test.local`, `${PREFIX} dr2`, "DOCTOR");
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");
  const stray = await mk(`${PREFIX}-stray@test.local`, `${PREFIX} stray`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  otherDoctorToken = issueToken({ userId: otherDoctor.id, role: "DOCTOR", name: otherDoctor.name, email: otherDoctor.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });
  strayBenToken = issueToken({ userId: stray.id, role: "BENEFICIARY", name: stray.name, email: stray.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr who`, kind: "DOCTOR", userId: doctor.id },
  });
  professionalId = professional.id;
  const otherProfessional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr other`, kind: "DOCTOR", userId: otherDoctor.id },
  });
  otherProfessionalId = otherProfessional.id;

  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;
  const strayBen = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 10)}y`, name: `${PREFIX} stray patient`, userId: stray.id },
  });
  strayBeneficiaryId = strayBen.id;

  const camp = await db.medicalCamp.create({
    data: { code: `UAR-CAMP-${PREFIX.slice(4, 11)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
  });
  campId = camp.id;

  // Pre-seed a SIGNED encounter owned by the other doctor for immutability tests.
  const signed = await db.encounter.create({
    data: {
      beneficiaryId,
      doctorId: otherProfessionalId,
      campId,
      status: "SIGNED",
      diagnosis: "Pre-seeded dx",
      signedAt: new Date(),
      signedByName: `${PREFIX} dr2`,
    },
  });
  signedEncounterId = signed.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("encounters create", () => {
  it("401 anonymous; 403 NURSE (creation is DOCTOR only)", async () => {
    const anon = await request(app).post("/api/encounters").send({});
    expect(anon.status).toBe(401);
    const nurse = await request(app)
      .post("/api/encounters")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId });
    expect(nurse.status).toBe(403);
  });

  it("400 missing beneficiaryId; 404 unknown beneficiary/camp", async () => {
    const noBen = await request(app).post("/api/encounters").set("Authorization", `Bearer ${doctorToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    const ghostBen = await request(app)
      .post("/api/encounters")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId: "ghost" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const ghostCamp = await request(app)
      .post("/api/encounters")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");
  });

  it("403 when the DOCTOR account has no linked professional profile", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const { issueToken } = await import("@/infrastructure/auth/session");
    const unlinkDoc = await db.user.create({
      data: {
        email: `${PREFIX}-unlink@test.local`,
        name: `${PREFIX} unlink doc`,
        role: "DOCTOR",
        password: `${PREFIX}-pw`,
        status: "ACTIVE",
        isActive: true,
      },
    });
    userIds.push(unlinkDoc.id);
    const token = issueToken({ userId: unlinkDoc.id, role: "DOCTOR", name: unlinkDoc.name, email: unlinkDoc.email });

    const res = await request(app)
      .post("/api/encounters")
      .set("Authorization", `Bearer ${token}`)
      .send({ beneficiaryId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(
      "No health-professional profile is linked to your account — ask an admin to create a DOCTOR profile for you"
    );
  });

  it("DOCTOR creates a DRAFT encounter linked to its own professional record (201)", async () => {
    const res = await request(app)
      .post("/api/encounters")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, campId, chiefComplaint: "Fever for 3 days" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.doctorId).toBe(professionalId);
    expect(res.body.chiefComplaint).toBe("Fever for 3 days");
    draftEncounterId = res.body.id;
  });
});

describe("encounters list + detail", () => {
  it("staff list envelope; bad status filter 400; bad from date 400", async () => {
    const list = await request(app).get("/api/encounters").set("Authorization", `Bearer ${nurseToken}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(typeof list.body.total).toBe("number");

    const badStatus = await request(app)
      .get("/api/encounters")
      .query({ status: "CLOSED" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("status must be DRAFT or SIGNED");

    const badFrom = await request(app)
      .get("/api/encounters")
      .query({ from: "not-a-date" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badFrom.status).toBe(400);
    expect(badFrom.body.error).toBe("Invalid from date");
  });

  it("GET /:id — 200 staff, 404 unknown, own BENEFICIARY 200, other BENEFICIARY 403", async () => {
    const staff = await request(app)
      .get(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(staff.status).toBe(200);

    const missing = await request(app)
      .get("/api/encounters/ghost-encounter")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Encounter not found");

    const own = await request(app)
      .get(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${benToken}`);
    expect(own.status).toBe(200);
    expect(own.body.amendments).toEqual([]);

    const foreign = await request(app)
      .get(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${strayBenToken}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("You do not have permission for this action");
  });
});

describe("encounters draft editing", () => {
  it("403 route gate for NURSE; 403 non-owning DOCTOR", async () => {
    const nurse = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ diagnosis: "x" });
    expect(nurse.status).toBe(403);

    const foreign = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${otherDoctorToken}`)
      .send({ diagnosis: "not mine" });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Only the owning doctor can edit this draft encounter");
  });

  it("owning DOCTOR edits; empty patch 400; status via PATCH rejected 400", async () => {
    const edit = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ diagnosis: "Viral fever", advice: "Rest and fluids" });
    expect(edit.status).toBe(200);
    expect(edit.body.diagnosis).toBe("Viral fever");

    const empty = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const viaPatch = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "SIGNED" });
    expect(viaPatch.status).toBe(400);
    expect(viaPatch.body.error).toBe("Use POST /api/encounters/:id/sign to sign an encounter");

    const missing = await request(app)
      .patch("/api/encounters/ghost")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ diagnosis: "x" });
    expect(missing.status).toBe(404);
  });
});

describe("encounters sign + immutability", () => {
  it("sign requires diagnosis or observations (400)", async () => {
    const blank = await request(app)
      .post("/api/encounters")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId });
    const blankId = blank.body.id;

    const res = await request(app)
      .post(`/api/encounters/${blankId}/sign`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Add a diagnosis or observations before signing");
  });

  it("non-owning DOCTOR 403; owner signs → SIGNED + stamped; double-sign 409", async () => {
    const foreign = await request(app)
      .post(`/api/encounters/${draftEncounterId}/sign`)
      .set("Authorization", `Bearer ${otherDoctorToken}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Only the owning doctor can sign this encounter");

    const ok = await request(app)
      .post(`/api/encounters/${draftEncounterId}/sign`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("SIGNED");
    expect(ok.body.signedByName).toBe(`${PREFIX} doctor`);
    expect(ok.body.signedAt).toBeTruthy();

    const again = await request(app)
      .post(`/api/encounters/${draftEncounterId}/sign`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("Encounter is already signed");

    const missing = await request(app)
      .post("/api/encounters/ghost/sign")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });

  it("SIGNED is immutable — PATCH without amendment 409; with amendment appends history", async () => {
    const noNote = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ diagnosis: "corrected dx" });
    expect(noNote.status).toBe(409);
    expect(noNote.body.error).toContain("Signed encounters are immutable");

    const foreign = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${otherDoctorToken}`)
      .send({ amendment: "not mine", diagnosis: "x" });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Only the owning doctor (or an admin) can amend this encounter");

    const amend = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ amendment: "dx corrected after lab review", diagnosis: "Typhoid fever" });
    expect(amend.status).toBe(200);
    expect(amend.body.diagnosis).toBe("Typhoid fever");
    expect(amend.body.amendments).toHaveLength(1);
    expect(amend.body.amendments[0].note).toBe("dx corrected after lab review");
    expect(amend.body.amendments[0].byName).toBe(`${PREFIX} doctor`);

    // ADMIN may amend too
    const adminAmend = await request(app)
      .patch(`/api/encounters/${draftEncounterId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amendment: "admin correction" });
    expect(adminAmend.status).toBe(200);
    expect(adminAmend.body.amendments).toHaveLength(2);
  });

  it("pre-seeded SIGNED encounter of another doctor: ADMIN can sign-edit via amendment", async () => {
    const res = await request(app)
      .patch(`/api/encounters/${signedEncounterId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amendment: "admin note", advice: "review in a week" });
    expect(res.status).toBe(200);
    expect(res.body.advice).toBe("review in a week");
    expect(res.body.amendments).toHaveLength(1);
  });
});

void strayBeneficiaryId;
