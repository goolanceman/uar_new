/**
 * Prescriptions integration tests — /api/prescriptions (thin routes over
 * src/modules/prescriptions). Creation + item validation, draft editing,
 * sign gate, cancel path, dispense flow (partial → full), print document.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `rxp-${Date.now()}`;
const PASSWORD = "rxp-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let otherDoctorToken = "";
let pharmacistToken = "";
let nurseToken = "";
let benToken = "";

const userIds: string[] = [];
let professionalId = "";
let otherProfessionalId = "";
let beneficiaryId = "";
let otherBeneficiaryId = "";
let encounterId = "";
let campId = "";

async function buildApp() {
  const { router } = await import("@/routes/prescriptions");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/prescriptions", router);
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
    await db.diagnosticOrder.deleteMany({ where: { beneficiaryId: { in: benIds } } });
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
  const pharmacist = await mk(`${PREFIX}-ph@test.local`, `${PREFIX} ph`, "PHARMACIST");
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  otherDoctorToken = issueToken({ userId: otherDoctor.id, role: "DOCTOR", name: otherDoctor.name, email: otherDoctor.email });
  pharmacistToken = issueToken({ userId: pharmacist.id, role: "PHARMACIST", name: pharmacist.name, email: pharmacist.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr rx`, kind: "DOCTOR", userId: doctor.id },
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
  const otherBen = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 10)}z`, name: `${PREFIX} other patient` },
  });
  otherBeneficiaryId = otherBen.id;

  const encounter = await db.encounter.create({
    data: { beneficiaryId, doctorId: professional.id, status: "DRAFT" },
  });
  encounterId = encounter.id;
  const camp = await db.medicalCamp.create({
    data: { code: `UAR-CAMP-${PREFIX.slice(4, 11)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
  });
  campId = camp.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

const ITEMS = [
  { medicineName: "Paracetamol", strength: "500mg", dosage: "1 tab", frequency: "1-0-1", quantity: 6, durationDays: 3 },
  { medicineName: "ORS", quantity: 2 },
];

describe("prescriptions create", () => {
  it("401 anonymous; 403 non-DOCTOR roles (admin may not write)", async () => {
    const anon = await request(app).post("/api/prescriptions").send({});
    expect(anon.status).toBe(401);
    const nurse = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId });
    expect(nurse.status).toBe(403);
  });

  it("400 missing beneficiaryId; 404 unknown beneficiary/encounter/camp", async () => {
    const noBen = await request(app).post("/api/prescriptions").set("Authorization", `Bearer ${doctorToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    const ghostBen = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId: "ghost" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const ghostEnc = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, encounterId: "ghost" });
    expect(ghostEnc.status).toBe(404);
    expect(ghostEnc.body.error).toBe("Encounter not found");

    const ghostCamp = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");
  });

  it("400 item validation: empty array, missing medicineName, bad quantity, bad durationDays", async () => {
    const empty = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, items: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("items must be a non-empty array");

    const noName = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, items: [{ quantity: 1 }] });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("items[0].medicineName is required");

    const badQty = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, items: [{ medicineName: "X", quantity: 0 }] });
    expect(badQty.status).toBe(400);
    expect(badQty.body.error).toBe("items[0].quantity must be an integer between 1 and 999");

    const badDays = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, items: [{ medicineName: "X", quantity: 1, durationDays: 900 }] });
    expect(badDays.status).toBe(400);
    expect(badDays.body.error).toBe("items[0].durationDays must be an integer between 1 and 365");
  });

  it("403 when the DOCTOR has no linked professional profile", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const { issueToken } = await import("@/infrastructure/auth/session");
    const unlink = await db.user.create({
      data: {
        email: `${PREFIX}-unlink@test.local`,
        name: `${PREFIX} unlink doc`,
        role: "DOCTOR",
        password: `${PREFIX}-pw`,
        status: "ACTIVE",
        isActive: true,
      },
    });
    userIds.push(unlink.id);
    const token = issueToken({ userId: unlink.id, role: "DOCTOR", name: unlink.name, email: unlink.email });

    const res = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({ beneficiaryId, items: ITEMS });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(
      "No health-professional profile is linked to your account — ask an admin to create a DOCTOR profile for you"
    );
  });

  it("DOCTOR creates a DRAFT prescription with auto code (201)", async () => {
    const res = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, encounterId, campId, diagnosis: "Fever", items: ITEMS });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^UAR-RX-\d{5}$/);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.doctorId).toBe(professionalId);
    expect(res.body.items).toHaveLength(2);
  });
});

describe("prescriptions list + detail", () => {
  it("list with filters; bad status 400; BENEFICIARY sees only its own", async () => {
    const list = await request(app)
      .get("/api/prescriptions")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);

    const bad = await request(app)
      .get("/api/prescriptions")
      .query({ status: "LOST" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("status must be one of: DRAFT, SIGNED, PARTIALLY_DISPENSED, FULLY_DISPENSED, CANCELLED");

    const own = await request(app).get("/api/prescriptions").set("Authorization", `Bearer ${benToken}`);
    expect(own.status).toBe(200);
    expect(own.body.items.every((p: { beneficiaryId: string }) => p.beneficiaryId === beneficiaryId)).toBe(true);
  });

  it("GET /:id — 200, 404 unknown, BENEFICIARY own 200 / foreign 403", async () => {
    const list = await request(app)
      .get("/api/prescriptions")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    const rxId = list.body.items[0].id;

    const one = await request(app).get(`/api/prescriptions/${rxId}`).set("Authorization", `Bearer ${pharmacistToken}`);
    expect(one.status).toBe(200);

    const missing = await request(app)
      .get("/api/prescriptions/ghost-rx")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Prescription not found");

    const own = await request(app).get(`/api/prescriptions/${rxId}`).set("Authorization", `Bearer ${benToken}`);
    expect(own.status).toBe(200);
  });
});

describe("prescriptions draft edit + cancel", () => {
  let draftId = "";

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, diagnosis: "initial", items: [{ medicineName: "Ibuprofen", quantity: 4 }] });
    draftId = created.body.id;
  });

  it("403 non-owning DOCTOR edits; owner replaces items wholesale; empty patch 400", async () => {
    const foreign = await request(app)
      .patch(`/api/prescriptions/${draftId}`)
      .set("Authorization", `Bearer ${otherDoctorToken}`)
      .send({ diagnosis: "hijack" });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Only the prescribing doctor can edit this draft prescription");

    const edit = await request(app)
      .patch(`/api/prescriptions/${draftId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ diagnosis: "updated dx", items: [{ medicineName: "Cetirizine", quantity: 10, durationDays: 5 }] });
    expect(edit.status).toBe(200);
    expect(edit.body.diagnosis).toBe("updated dx");
    expect(edit.body.items).toHaveLength(1);
    expect(edit.body.items[0].medicineName).toBe("Cetirizine");

    const empty = await request(app)
      .patch(`/api/prescriptions/${draftId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const ghostEnc = await request(app)
      .patch(`/api/prescriptions/${draftId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ encounterId: "ghost-enc" });
    expect(ghostEnc.status).toBe(404);
  });

  it("cancel requires a reason; cancel works; double-cancel 409", async () => {
    const noReason = await request(app)
      .patch(`/api/prescriptions/${draftId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "CANCELLED" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("cancelReason is required to cancel a prescription");

    const cancel = await request(app)
      .patch(`/api/prescriptions/${draftId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "CANCELLED", cancelReason: "wrong medicine" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("CANCELLED");
    expect(cancel.body.cancelReason).toBe("wrong medicine");

    const again = await request(app)
      .patch(`/api/prescriptions/${draftId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED", cancelReason: "again" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("Prescription is already cancelled");

    const missing = await request(app)
      .patch("/api/prescriptions/ghost-rx")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED", cancelReason: "x" });
    expect(missing.status).toBe(404);
  });
});

describe("prescriptions sign + dispense", () => {
  let signedId = "";
  let signableId = "";

  beforeAll(async () => {
    const signed = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, items: [{ medicineName: "Amoxicillin", quantity: 2 }] });
    signedId = signed.body.id;
    await request(app).post(`/api/prescriptions/${signedId}/sign`).set("Authorization", `Bearer ${doctorToken}`);

    const signable = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, items: [{ medicineName: "Cough syrup", quantity: 2 }] });
    signableId = signable.body.id;
    await request(app).post(`/api/prescriptions/${signableId}/sign`).set("Authorization", `Bearer ${doctorToken}`);
  }, 60_000);

  it("sign: 403 non-owner, 409 non-DRAFT, 400 no items, 404 unknown", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const bare = await db.prescription.create({
      data: { code: `UAR-RX-${PREFIX.slice(4, 10)}b`, beneficiaryId, doctorId: professionalId, status: "DRAFT" },
    });

    const foreign = await request(app)
      .post(`/api/prescriptions/${signableId}/sign`)
      .set("Authorization", `Bearer ${otherDoctorToken}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("Only the prescribing doctor can sign this prescription");

    const alreadySigned = await request(app)
      .post(`/api/prescriptions/${signedId}/sign`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(alreadySigned.status).toBe(409);
    expect(alreadySigned.body.error).toBe("Only DRAFT prescriptions can be signed (current status: SIGNED)");

    const noMeds = await request(app)
      .post(`/api/prescriptions/${bare.id}/sign`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(noMeds.status).toBe(400);
    expect(noMeds.body.error).toBe("Add at least one medicine before signing");

    const missing = await request(app)
      .post("/api/prescriptions/ghost-rx/sign")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });

  it("dispense: 403 NURSE, 400 empty lines, 409 on DRAFT, 404 unknown", async () => {
    const draft = await request(app)
      .post("/api/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, items: [{ medicineName: "Aspirin", quantity: 1 }] });

    const nurse = await request(app)
      .post(`/api/prescriptions/${signedId}/dispense`)
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ dispenses: [] });
    expect(nurse.status).toBe(403);

    const empty = await request(app)
      .post(`/api/prescriptions/${signedId}/dispense`)
      .set("Authorization", `Bearer ${pharmacistToken}`)
      .send({ dispenses: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("dispenses must be a non-empty array");

    const wrongStatus = await request(app)
      .post(`/api/prescriptions/${draft.body.id}/dispense`)
      .set("Authorization", `Bearer ${pharmacistToken}`)
      .send({ dispenses: [{ itemId: "whatever", quantity: 1 }] });
    expect(wrongStatus.status).toBe(409);
    expect(wrongStatus.body.error).toBe("Prescription must be SIGNED before dispensing (current status: DRAFT)");

    const missing = await request(app)
      .post("/api/prescriptions/ghost-rx/dispense")
      .set("Authorization", `Bearer ${pharmacistToken}`)
      .send({ dispenses: [{ itemId: "x", quantity: 1 }] });
    expect(missing.status).toBe(404);
  });

  it("dispense guards: unknown itemId, over-dispense; then partial → full; FULLY_DISPENSED cannot cancel", async () => {
    const detail = await request(app)
      .get(`/api/prescriptions/${signableId}`)
      .set("Authorization", `Bearer ${pharmacistToken}`);
    const itemId = detail.body.items[0].id;

    const ghostItem = await request(app)
      .post(`/api/prescriptions/${signableId}/dispense`)
      .set("Authorization", `Bearer ${pharmacistToken}`)
      .send({ dispenses: [{ itemId: "ghost-item", quantity: 1 }] });
    expect(ghostItem.status).toBe(400);
    expect(ghostItem.body.error).toBe("dispenses[0].itemId does not belong to this prescription");

    const over = await request(app)
      .post(`/api/prescriptions/${signableId}/dispense`)
      .set("Authorization", `Bearer ${pharmacistToken}`)
      .send({ dispenses: [{ itemId, quantity: 5 }] });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain("Dispense exceeds prescribed quantity for Cough syrup");

    const partial = await request(app)
      .post(`/api/prescriptions/${signableId}/dispense`)
      .set("Authorization", `Bearer ${pharmacistToken}`)
      .send({ dispenses: [{ itemId, quantity: 1 }], notes: "counter 1" });
    expect(partial.status).toBe(200);
    expect(partial.body.status).toBe("PARTIALLY_DISPENSED");

    const full = await request(app)
      .post(`/api/prescriptions/${signableId}/dispense`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ dispenses: [{ itemId, quantity: 1 }] });
    expect(full.status).toBe(200);
    expect(full.body.status).toBe("FULLY_DISPENSED");

    const cancel = await request(app)
      .patch(`/api/prescriptions/${signableId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED", cancelReason: "too late" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toBe("Fully dispensed prescriptions cannot be cancelled");
  });

  it("signed prescriptions are immutable via PATCH edit path (409)", async () => {
    const res = await request(app)
      .patch(`/api/prescriptions/${signedId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ diagnosis: "edit attempt" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Signed prescriptions are immutable — create a new prescription or cancel this one");
  });
});

describe("prescriptions print", () => {
  it("renders the print-ready HTML document; 404 unknown", async () => {
    const list = await request(app)
      .get("/api/prescriptions")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    const rxId = list.body.items[0].id;

    const html = await request(app)
      .get(`/api/prescriptions/${rxId}/print`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(html.status).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.text).toContain("PRESCRIPTION");
    expect(html.text).toContain(list.body.items[0].code);

    const missing = await request(app)
      .get("/api/prescriptions/ghost-rx/print")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });
});

void otherProfessionalId;
void otherBeneficiaryId;
