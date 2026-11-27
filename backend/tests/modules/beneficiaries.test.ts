/**
 * Beneficiaries integration tests — /api/beneficiaries (thin routes over
 * src/modules/beneficiaries). Onboarding validation, case/verification
 * transitions, KYC submit → review flow, case notes, delete guard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `ben-${Date.now()}`;
const PASSWORD = "ben-test-pass";

let app: express.Express;
let adminToken = "";
let volunteerToken = "";
let nurseToken = "";
let benToken = "";
let otherBenToken = "";
let beneficiaryUserId = "";

const userIds: string[] = [];
let beneficiaryId = "";

async function buildApp() {
  const { router } = await import("@/routes/beneficiaries");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/beneficiaries", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.fileAsset.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.beneficiaryNote.deleteMany({ where: { beneficiary: { name: { startsWith: PREFIX } } } });
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
  const volunteer = await mk(`${PREFIX}-vol@test.local`, `${PREFIX} vol`, "VOLUNTEER");
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const benUser = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben user`, "BENEFICIARY");
  const otherBen = await mk(`${PREFIX}-ben2@test.local`, `${PREFIX} other ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  volunteerToken = issueToken({ userId: volunteer.id, role: "VOLUNTEER", name: volunteer.name, email: volunteer.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: benUser.id, role: "BENEFICIARY", name: benUser.name, email: benUser.email });
  otherBenToken = issueToken({ userId: otherBen.id, role: "BENEFICIARY", name: otherBen.name, email: otherBen.email });
  beneficiaryUserId = benUser.id;

  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} linked case`, userId: benUser.id },
  });
  beneficiaryId = beneficiary.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("beneficiaries create", () => {
  it("401 anonymous; 403 NURSE (staff create is ADMIN|VOLUNTEER)", async () => {
    const anon = await request(app).post("/api/beneficiaries").send({});
    expect(anon.status).toBe(401);
    const nurse = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ name: `${PREFIX} x` });
    expect(nurse.status).toBe(403);
  });

  it("400 validation: name, category, urgencyLevel, pincode, age, gender", async () => {
    const noName = await request(app).post("/api/beneficiaries").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("name is required");

    const badCat = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, category: "ALIEN" });
    expect(badCat.status).toBe(400);
    expect(badCat.body.error).toBe("Invalid category");

    const badUrg = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, urgencyLevel: "WHENEVER" });
    expect(badUrg.status).toBe(400);
    expect(badUrg.body.error).toBe("Invalid urgencyLevel");

    const badPin = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, pincode: "12" });
    expect(badPin.status).toBe(400);
    expect(badPin.body.error).toBe("PIN code must be 6 digits");

    const badAge = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, age: 150 });
    expect(badAge.status).toBe(400);
    expect(badAge.body.error).toBe("Age must be between 0 and 120");

    const badGender = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, gender: "robot" });
    expect(badGender.status).toBe(400);
    expect(badGender.body.error).toBe("Invalid gender");
  });

  it("VOLUNTEER creates a case record with auto code (201)", async () => {
    const res = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${volunteerToken}`)
      .send({ name: `${PREFIX} onboarded`, category: "PATIENT", urgencyLevel: "HIGH", age: 42, gender: "FEMALE" });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^UAR-BEN-\d{5}$/);
    expect(res.body.caseStatus).toBe("INTAKE");
    expect(res.body.verificationStatus).toBe("PENDING");
    expect(res.body.onboardedByName).toBe(`${PREFIX} vol`);
  });
});

describe("beneficiaries list", () => {
  it("staff unpaginated array shape; paged envelope with ?page", async () => {
    const plain = await request(app).get("/api/beneficiaries").set("Authorization", `Bearer ${adminToken}`);
    expect(plain.status).toBe(200);
    expect(Array.isArray(plain.body)).toBe(true);

    const paged = await request(app)
      .get("/api/beneficiaries")
      .query({ page: 1, limit: 5 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(paged.status).toBe(200);
    expect(Array.isArray(paged.body.items)).toBe(true);
    expect(typeof paged.body.total).toBe("number");
  });

  it("?mine=1 shows the linked beneficiary only; BENEFICIARY without mine gets 403; NURSE staff list ok", async () => {
    const mine = await request(app)
      .get("/api/beneficiaries")
      .query({ mine: "1" })
      .set("Authorization", `Bearer ${benToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).toBe(beneficiaryId);

    const staff = await request(app)
      .get("/api/beneficiaries")
      .query({ q: `${PREFIX} linked` })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(staff.body.map((b: { id: string }) => b.id)).toContain(beneficiaryId);

    const nurse = await request(app)
      .get("/api/beneficiaries")
      .query({ q: `${PREFIX} linked` })
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(nurse.status).toBe(200);
    expect(nurse.body.map((b: { id: string }) => b.id)).toContain(beneficiaryId);

    const benStaffList = await request(app).get("/api/beneficiaries").set("Authorization", `Bearer ${benToken}`);
    expect(benStaffList.status).toBe(403);
  });
});

describe("beneficiaries update + case workflow", () => {
  it("404 before body processing for an unknown id", async () => {
    const res = await request(app)
      .patch("/api/beneficiaries/ghost-ben")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ caseStatus: "TOTALLY_BOGUS" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Beneficiary not found");
  });

  it("400 invalid case status value; legal INTAKE → VERIFICATION move", async () => {
    const bad = await request(app)
      .patch(`/api/beneficiaries/${beneficiaryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ caseStatus: "GOLD" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Invalid case status");

    const ok = await request(app)
      .patch(`/api/beneficiaries/${beneficiaryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ caseStatus: "VERIFICATION" });
    expect(ok.status).toBe(200);
    expect(ok.body.caseStatus).toBe("VERIFICATION");
  });

  it("400 on the illegal INTAKE → ACTIVE skip with the state-machine message", async () => {
    const created = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} intake only` });
    const id = created.body.id;

    const skip = await request(app)
      .patch(`/api/beneficiaries/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ caseStatus: "ACTIVE" });
    expect(skip.status).toBe(400);
    expect(skip.body.error).toBe(
      "Cannot move beneficiary caseStatus from INTAKE to ACTIVE. Allowed: VERIFICATION, CLOSED, REJECTED"
    );
  });

  it("verificationStatus PENDING → DOCUMENTS_REQUESTED legal; VERIFIED terminal (400 back)", async () => {
    const req = await request(app)
      .patch(`/api/beneficiaries/${beneficiaryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ verificationStatus: "DOCUMENTS_REQUESTED" });
    expect(req.status).toBe(200);
    expect(req.body.verificationStatus).toBe("DOCUMENTS_REQUESTED");

    const verified = await request(app)
      .patch(`/api/beneficiaries/${beneficiaryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ verificationStatus: "VERIFIED" });
    expect(verified.status).toBe(200);

    const back = await request(app)
      .patch(`/api/beneficiaries/${beneficiaryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ verificationStatus: "PENDING" });
    expect(back.status).toBe(400);
    expect(back.body.error).toBe(
      "Cannot move beneficiary verificationStatus from VERIFIED to PENDING. Allowed: none"
    );
  });

  it("403 VOLUNTEER… wait, VOLUNTEER may update; BENEFICIARY may not (route gate)", async () => {
    const ben = await request(app)
      .patch(`/api/beneficiaries/${beneficiaryId}`)
      .set("Authorization", `Bearer ${benToken}`)
      .send({ notes: "self-edit" });
    expect(ben.status).toBe(403);

    const vol = await request(app)
      .patch(`/api/beneficiaries/${beneficiaryId}`)
      .set("Authorization", `Bearer ${volunteerToken}`)
      .send({ notes: "volunteer note edit" });
    expect(vol.status).toBe(200);
    expect(vol.body.notes).toBe("volunteer note edit");
  });
});

describe("beneficiaries KYC workflow", () => {
  const fileIds: string[] = [];

  beforeAll(async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    for (let i = 0; i < 3; i++) {
      const f = await db.fileAsset.create({
        data: {
          name: `${PREFIX} kyc-${i}.png`,
          storedName: `${PREFIX}-kyc-${i}.png`,
          mime: "image/png",
          size: 100,
          folder: `kyc/${beneficiaryUserId}`,
          uploadedById: beneficiaryUserId,
          uploadedByName: `${PREFIX} ben user`,
        },
      });
      fileIds.push(f.id);
    }
  });

  it("404 unknown beneficiary; 403 for a non-owning BENEFICIARY", async () => {
    const missing = await request(app)
      .post("/api/beneficiaries/ghost/kyc")
      .set("Authorization", `Bearer ${benToken}`)
      .send({ documentIds: [fileIds[0]] });
    expect(missing.status).toBe(404);

    const foreign = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc`)
      .set("Authorization", `Bearer ${otherBenToken}`)
      .send({ documentIds: [fileIds[0]] });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("You do not have permission for this action");
  });

  it("400 empty / duplicate / over-limit documentIds; 403 foreign files", async () => {
    const empty = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc`)
      .set("Authorization", `Bearer ${benToken}`)
      .send({ documentIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Attach at least one KYC document");

    const dupes = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc`)
      .set("Authorization", `Bearer ${benToken}`)
      .send({ documentIds: [fileIds[0], fileIds[0]] });
    expect(dupes.status).toBe(400);
    expect(dupes.body.error).toBe("documentIds contains duplicates");

    const tooMany = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc`)
      .set("Authorization", `Bearer ${benToken}`)
      .send({ documentIds: Array.from({ length: 11 }, (_, i) => `f${i}`) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toBe("At most 10 documents can be attached");

    const foreignFile = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ documentIds: ["not-a-file"] });
    expect(foreignFile.status).toBe(400);
    expect(foreignFile.body.error).toBe("One or more documents were not found");
  });

  it("owner submits → SUBMITTED; admin reviews → VERIFIED; review of non-SUBMITTED 400", async () => {
    const submit = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc`)
      .set("Authorization", `Bearer ${benToken}`)
      .send({ documentIds: [fileIds[0], fileIds[1]] });
    expect(submit.status).toBe(201);
    expect(submit.body.kycStatus).toBe("SUBMITTED");
    expect(JSON.parse(submit.body.kycDocuments ?? "[]")).toEqual([fileIds[0], fileIds[1]]);

    // review before submitting on a fresh record → 400
    const fresh = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} not submitted` });
    const reviewEarly = await request(app)
      .post(`/api/beneficiaries/${fresh.body.id}/kyc/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "VERIFIED" });
    expect(reviewEarly.status).toBe(400);
    expect(reviewEarly.body.error).toBe("Only SUBMITTED KYC can be reviewed (current: PENDING)");

    const badStatus = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "MAYBE" });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("status must be VERIFIED or REJECTED");

    const review = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "VERIFIED", notes: "papers in order" });
    expect(review.status).toBe(200);
    expect(review.body.kycStatus).toBe("VERIFIED");
    expect(review.body.kycReviewedBy).toBe(`${PREFIX} admin`);
    expect(review.body.kycNotes).toBe("papers in order");

    const forbidden = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/kyc/review`)
      .set("Authorization", `Bearer ${volunteerToken}`)
      .send({ status: "VERIFIED" });
    expect(forbidden.status).toBe(403);
  });
});

describe("beneficiaries case notes", () => {
  it("POST adds a note (authorName from session); GET lists it; 400 empty note; 404 unknown; 403 BENEFICIARY", async () => {
    const added = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/notes`)
      .set("Authorization", `Bearer ${volunteerToken}`)
      .send({ note: `${PREFIX} home visit done` });
    expect(added.status).toBe(201);
    expect(added.body.authorName).toBe(`${PREFIX} vol`);
    expect(added.body.note).toBe(`${PREFIX} home visit done`);

    const list = await request(app)
      .get(`/api/beneficiaries/${beneficiaryId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.map((n: { note: string }) => n.note)).toContain(`${PREFIX} home visit done`);

    const empty = await request(app)
      .post(`/api/beneficiaries/${beneficiaryId}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ note: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Note cannot be empty");

    const missing = await request(app)
      .get("/api/beneficiaries/ghost/notes")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(200); // listing notes of a ghost returns an empty array
    expect(missing.body).toEqual([]);

    const missingNote = await request(app)
      .post("/api/beneficiaries/ghost/notes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ note: "x" });
    expect(missingNote.status).toBe(404);

    const ben = await request(app)
      .get(`/api/beneficiaries/${beneficiaryId}/notes`)
      .set("Authorization", `Bearer ${benToken}`);
    expect(ben.status).toBe(403);
  });
});

describe("beneficiaries delete", () => {
  it("VOLUNTEER 403; ADMIN deletes; 404 afterwards", async () => {
    const created = await request(app)
      .post("/api/beneficiaries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} doomed` });
    const id = created.body.id;

    const vol = await request(app).delete(`/api/beneficiaries/${id}`).set("Authorization", `Bearer ${volunteerToken}`);
    expect(vol.status).toBe(403);

    const ok = await request(app).delete(`/api/beneficiaries/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    const gone = await request(app).delete(`/api/beneficiaries/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("Beneficiary not found");
  });
});
