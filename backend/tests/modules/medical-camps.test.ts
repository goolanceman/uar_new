/**
 * Medical-camps integration tests — /api/medical-camps (thin routes over
 * src/modules/medical-camps). Lifecycle transitions, anonymous public list,
 * delete guards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `mcp-${Date.now()}`;
const PASSWORD = "mcp-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let nurseToken = "";

const userIds: string[] = [];

async function buildApp() {
  const { router } = await import("@/routes/medical-camps");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/medical-camps", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const camps = await db.medicalCamp.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const campIds = camps.map((c) => c.id);
  if (campIds.length) {
    await db.campAttendance.deleteMany({ where: { campId: { in: campIds } } });
    await db.campRegistration.deleteMany({ where: { campId: { in: campIds } } });
  }
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.medicalCamp.deleteMany({ where: { title: { startsWith: PREFIX } } });
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

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("medical-camps create", () => {
  it("401 anonymous / 403 non-admin", async () => {
    const anon = await request(app).post("/api/medical-camps").send({ title: "x" });
    expect(anon.status).toBe(401);
    const nurse = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ title: `${PREFIX} x`, venue: "v", campDate: new Date() });
    expect(nurse.status).toBe(403);
  });

  it("400 validation: title, venue, campDate, capacity", async () => {
    const noTitle = await request(app).post("/api/medical-camps").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error).toBe("title is required");

    const noVenue = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} t` });
    expect(noVenue.status).toBe(400);
    expect(noVenue.body.error).toBe("venue is required");

    const badDate = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} t`, venue: "v", campDate: "not-a-date" });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("campDate is required and must be a valid date");

    const badCap = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} t`, venue: "v", campDate: new Date(), capacity: 0 });
    expect(badCap.status).toBe(400);
    expect(badCap.body.error).toBe("capacity must be a positive number");
  });

  it("404 for an unknown campaignId", async () => {
    const res = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} t`, venue: "v", campDate: new Date(), campaignId: "ghost-campaign" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Campaign not found");
  });

  it("creates a DRAFT camp with auto code + createdByName (201)", async () => {
    const res = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: `${PREFIX} draft camp`,
        venue: `${PREFIX} community hall`,
        campDate: new Date(),
        city: "Testville",
        services: ["General checkup", "Eye screening"],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.code).toMatch(/^UAR-CAMP-\d{5}$/);
    expect(res.body.createdByName).toBe(`${PREFIX} admin`);
  });
});

describe("medical-camps list", () => {
  it("hides DRAFT camps from anonymous visitors and strips internal fields", async () => {
    const anon = await request(app).get("/api/medical-camps");
    expect(anon.status).toBe(200);
    const titles = anon.body.items.map((c: { title: string }) => c.title);
    expect(titles).not.toContain(`${PREFIX} draft camp`);
    for (const camp of anon.body.items as Record<string, unknown>[]) {
      expect(camp.status === "SCHEDULED" || camp.status === "LIVE" || camp.status === "COMPLETED").toBe(true);
      expect("notes" in camp).toBe(false);
      expect("budget" in camp).toBe(false);
      expect("createdByName" in camp).toBe(false);
    }
  });

  it("authenticated users see DRAFT camps too", async () => {
    const res = await request(app)
      .get("/api/medical-camps")
      .query({ q: `${PREFIX} draft camp` })
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { title: string }) => c.title)).toContain(`${PREFIX} draft camp`);
  });
});

describe("medical-camps detail + lifecycle", () => {
  let campId = "";
  let completedCampId = "";

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} lifecycle camp`, venue: `${PREFIX} venue`, campDate: new Date() });
    campId = created.body.id;
    const completed = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} completed camp`, venue: `${PREFIX} venue`, campDate: new Date() });
    completedCampId = completed.body.id;
  });

  it("GET /:id requires auth (401 anonymous) and 404 for unknown ids", async () => {
    const anon = await request(app).get(`/api/medical-camps/${campId}`);
    expect(anon.status).toBe(401);

    const missing = await request(app)
      .get(`/api/medical-camps/ghost-camp`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Camp not found");
  });

  it("GET /:id returns partners, staff and counts", async () => {
    const res = await request(app)
      .get(`/api/medical-camps/${campId}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(campId);
    expect(res.body.counts).toBeDefined();
    expect(typeof res.body.counts.registrations).toBe("number");
  });

  it("advances DRAFT → SCHEDULED → LIVE → COMPLETED", async () => {
    const s = await request(app)
      .patch(`/api/medical-camps/${campId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SCHEDULED" });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe("SCHEDULED");

    const l = await request(app)
      .patch(`/api/medical-camps/${campId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "LIVE" });
    expect(l.status).toBe(200);
    expect(l.body.status).toBe("LIVE");

    const c = await request(app)
      .patch(`/api/medical-camps/${campId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "COMPLETED" });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe("COMPLETED");
  });

  it("409 on skipping the lifecycle (DRAFT → LIVE) and on reopening a terminal camp", async () => {
    const skip = await request(app)
      .patch(`/api/medical-camps/${completedCampId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "LIVE" }); // DRAFT → LIVE skips SCHEDULED
    expect(skip.status).toBe(409);
    expect(skip.body.error).toBe("Cannot move camp from DRAFT to LIVE");

    // move it properly to COMPLETED then try to reopen
    await request(app).patch(`/api/medical-camps/${completedCampId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "SCHEDULED" });
    await request(app).patch(`/api/medical-camps/${completedCampId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "LIVE" });
    await request(app).patch(`/api/medical-camps/${completedCampId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "COMPLETED" });
    const reopen = await request(app)
      .patch(`/api/medical-camps/${completedCampId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "LIVE" });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error).toBe("Cannot move camp from COMPLETED to LIVE");
  });

  it("400 for an unknown status value and an empty title; 404 unknown camp", async () => {
    const bad = await request(app)
      .patch(`/api/medical-camps/${campId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PAUSED" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Invalid status");

    const emptyTitle = await request(app)
      .patch(`/api/medical-camps/${campId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "   " });
    expect(emptyTitle.status).toBe(400);
    expect(emptyTitle.body.error).toBe("title cannot be empty");

    const missing = await request(app)
      .patch("/api/medical-camps/ghost")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "x" });
    expect(missing.status).toBe(404);
  });
});

describe("medical-camps delete", () => {
  it("403 for non-admin, 409 for non-DRAFT, 409 with registrations, 200 for clean DRAFT, 404 after", async () => {
    const draft = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} delete draft`, venue: `${PREFIX} venue`, campDate: new Date() });
    const draftId = draft.body.id;

    const scheduled = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} delete scheduled`, venue: `${PREFIX} venue`, campDate: new Date() });
    const scheduledId = scheduled.body.id;
    await request(app).patch(`/api/medical-camps/${scheduledId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "SCHEDULED" });

    const withReg = await request(app)
      .post("/api/medical-camps")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} delete withreg`, venue: `${PREFIX} venue`, campDate: new Date() });
    const withRegId = withReg.body.id;
    const { db } = await import("@/infrastructure/database/prisma");
    const ben = await db.beneficiary.create({ data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} reg ben` } });
    await db.campRegistration.create({
      data: { campId: withRegId, beneficiaryId: ben.id, code: `UAR-CREG-${PREFIX.slice(4, 11)}` },
    });

    const nurse = await request(app).delete(`/api/medical-camps/${draftId}`).set("Authorization", `Bearer ${nurseToken}`);
    expect(nurse.status).toBe(403);

    const wrongStatus = await request(app)
      .delete(`/api/medical-camps/${scheduledId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(wrongStatus.status).toBe(409);
    expect(wrongStatus.body.error).toBe("Only camps in DRAFT status can be deleted");

    const hasRegs = await request(app)
      .delete(`/api/medical-camps/${withRegId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(hasRegs.status).toBe(409);
    expect(hasRegs.body.error).toBe("This camp has registrations and cannot be deleted");

    const ok = await request(app).delete(`/api/medical-camps/${draftId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    const gone = await request(app).delete(`/api/medical-camps/${draftId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("Camp not found");
  });
});
