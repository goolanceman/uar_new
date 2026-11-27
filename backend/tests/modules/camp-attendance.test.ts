/**
 * Camp attendance (vitest + supertest integration, real routers).
 *
 *   GET   /api/camp-attendance            — queue listing (ADMIN/VOLUNTEER/HOSPITAL/DOCTOR/NURSE)
 *   GET   /api/camp-attendance?summary=1  — live dashboard counters for one camp
 *   POST  /api/camp-attendance            — the CHECK-IN (idempotent, per-camp queue tokens)
 *   PATCH /api/camp-attendance            — patient-journey status transitions
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-campatt-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string;
let hospitalToken: string;

let campId: string;
let completedCampId: string;
let registration1: { id: string; code: string };
let registration2: { id: string };
let registrationCancelled: { id: string };
let registrationCompletedCamp: { id: string };

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: campAttendanceRouter } = await import("@/routes/camp-attendance");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/camp-attendance", campAttendanceRouter);
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
  const r = request(app).get(`/api/camp-attendance${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token: string) {
  return request(app).post("/api/camp-attendance").set("Authorization", `Bearer ${token}`).send(body);
}
function patch(body: Record<string, unknown>, token: string) {
  return request(app).patch("/api/camp-attendance").set("Authorization", `Bearer ${token}`).send(body);
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
  const admin = await mk("admin", "ADMIN");
  const volunteer = await mk("vol", "VOLUNTEER");
  const donor = await mk("donor", "DONOR");
  await mk("hospital", "HOSPITAL");

  const camp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP`,
      title: `${PREFIX} camp`,
      campDate: new Date(),
      venue: "Community hall",
      status: "LIVE",
      capacity: 10,
    },
  });
  campId = camp.id;
  const doneCamp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP-DONE`,
      title: `${PREFIX} completed camp`,
      campDate: new Date(),
      venue: "School ground",
      status: "COMPLETED",
      capacity: 10,
    },
  });
  completedCampId = doneCamp.id;

  const mkBen = async (n: number) =>
    db.beneficiary.create({
      data: { code: `${PREFIX}-BEN-${n}`, name: `${PREFIX} ben ${n}` },
    });
  const b1 = await mkBen(1);
  const b2 = await mkBen(2);
  const b3 = await mkBen(3);
  const b4 = await mkBen(4);

  registration1 = await db.campRegistration.create({
    data: { campId, beneficiaryId: b1.id, code: `${PREFIX}-REG-1` },
  });
  registration2 = await db.campRegistration.create({
    data: { campId, beneficiaryId: b2.id, code: `${PREFIX}-REG-2` },
  });
  registrationCancelled = await db.campRegistration.create({
    data: { campId, beneficiaryId: b3.id, code: `${PREFIX}-REG-3`, status: "CANCELLED" },
  });
  registrationCompletedCamp = await db.campRegistration.create({
    data: { campId: completedCampId, beneficiaryId: b4.id, code: `${PREFIX}-REG-4` },
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
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/camp-attendance (check-in)", () => {
  it("checks in with the next per-camp queue token", async () => {
    const res = await post({ registrationId: registration1.id, method: "QR" }, adminToken);
    expect(res.status).toBe(201);
    expect(res.body.registrationId).toBe(registration1.id);
    expect(res.body.campId).toBe(campId);
    expect(res.body.status).toBe("CHECKED_IN");
    expect(res.body.queueToken).toBe(1);
    expect(res.body.checkInMethod).toBe("QR");
    expect(res.body.checkInAt).toBeTruthy();
    expect(res.body.operatorName).toBe(`${PREFIX} admin`);
  });

  it("409s on a re-check-in while the attendance is still in the queue", async () => {
    const res = await post({ registrationId: registration1.id }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Already checked in");
  });

  it("assigns incrementing tokens per camp", async () => {
    const res = await post({ registrationId: registration2.id }, volunteerToken);
    expect(res.status).toBe(201);
    expect(res.body.queueToken).toBe(2);
  });

  it("rejects an unknown registration with 404", async () => {
    const res = await post({ registrationId: "nonexistent-reg" }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Registration not found");
  });

  it("400s on a missing registrationId and an invalid method", async () => {
    const missing = await post({}, adminToken);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("registrationId is required");

    const badMethod = await post({ registrationId: registration2.id, method: "PIGEON" }, adminToken);
    expect(badMethod.status).toBe(400);
    expect(badMethod.body.error).toBe("Invalid check-in method");
  });

  it("blocks check-in when the camp is not LIVE/SCHEDULED", async () => {
    const res = await post({ registrationId: registrationCompletedCamp.id }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("requires LIVE or SCHEDULED");
  });

  it("blocks check-in for a CANCELLED registration", async () => {
    const res = await post({ registrationId: registrationCancelled.id }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Registration is CANCELLED — check-in not allowed");
  });

  it("reviving a cancelled attendance reuses the original queue token", async () => {
    // cancel registration2's attendance, then re-check-in
    const list = await get(`?campId=${campId}&status=CHECKED_IN`, adminToken);
    const row = list.body.items.find((i: { registrationId: string }) => i.registrationId === registration2.id);
    const cancelled = await patch({ id: row.id, status: "CANCELLED", cancelReason: "went home" }, adminToken);
    expect(cancelled.status).toBe(200);

    const again = await post({ registrationId: registration2.id }, adminToken);
    expect(again.status).toBe(201);
    expect(again.body.queueToken).toBe(2); // re-used, not a fresh token
    expect(again.body.status).toBe("CHECKED_IN");
    expect(again.body.cancelReason).toBeNull();
  });
});

describe("GET /api/camp-attendance (queue + summary)", () => {
  it("lists the queue ordered for a camp (paged envelope)", async () => {
    const res = await get(`?campId=${campId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("pages");
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items.every((i: { campId: string }) => i.campId === campId)).toBe(true);
  });

  it("filters by status", async () => {
    const res = await get(`?campId=${campId}&status=CHECKED_IN`, volunteerToken);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items.every((i: { status: string }) => i.status === "CHECKED_IN")).toBe(true);
  });

  it("returns live dashboard counters with summary=1", async () => {
    const res = await get(`?campId=${campId}&summary=1`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      registered: expect.any(Number),
      checkedIn: expect.any(Number),
      waiting: 0,
      inConsultation: 0,
      completed: 0,
      checkedOut: 0,
      noShow: 0,
      cancelled: expect.any(Number),
    });
    // registration1 + registration2 are CHECKED_IN (registration2's attendance
    // was cancelled then revived); registration3 has no attendance row at all
    expect(res.body.checkedIn).toBe(2);
    expect(res.body.cancelled).toBe(0);
    expect(res.body.registered).toBe(2);
  });

  it("400s when summary=1 has no campId", async () => {
    const res = await get("?summary=1", adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("campId is required for summary");
  });

  it("scopes a HOSPITAL caller without a linked org to an empty list", async () => {
    const res = await get("", hospitalToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0, page: 1, pages: 1 });
  });

  it("401s without a token and 403s for a non-member role", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const donor = await get("", donorToken);
    expect(donor.status).toBe(403);
  });
});

describe("PATCH /api/camp-attendance (patient journey)", () => {
  it("walks CHECKED_IN → WAITING → IN_CONSULTATION → COMPLETED → CHECKED_OUT", async () => {
    const list = await get(`?campId=${campId}`, adminToken);
    const row = list.body.items.find(
      (i: { registrationId: string; status: string }) =>
        i.registrationId === registration1.id && i.status === "CHECKED_IN"
    );
    expect(row).toBeTruthy();

    const waiting = await patch({ id: row.id, status: "WAITING" }, adminToken);
    expect(waiting.status).toBe(200);
    expect(waiting.body.status).toBe("WAITING");

    const consult = await patch({ id: row.id, status: "IN_CONSULTATION" }, adminToken);
    expect(consult.status).toBe(200);

    const completed = await patch({ id: row.id, status: "COMPLETED" }, adminToken);
    expect(completed.status).toBe(200);
    expect(completed.body.checkOutAt).toBeNull(); // COMPLETED does NOT check out

    const out = await patch({ id: row.id, status: "CHECKED_OUT" }, adminToken);
    expect(out.status).toBe(200);
    expect(out.body.checkOutAt).toBeTruthy();

    // CHECKED_OUT is terminal
    const after = await patch({ id: row.id, status: "WAITING" }, adminToken);
    expect(after.status).toBe(409);
    expect(after.body.error).toContain("Cannot move attendance from CHECKED_OUT");
  });

  it("400s when CANCELLED has no cancelReason", async () => {
    // an unknown id fails at the attendance lookup first (404-before-400)
    const ghost = await patch({ id: "whatever", status: "CANCELLED" }, adminToken);
    expect(ghost.status).toBe(404);

    // a real CHECKED_IN row cancelled without a reason → 400
    const list = await get(`?campId=${campId}&status=CHECKED_IN`, adminToken);
    const row = list.body.items[0];
    const noReason = await patch({ id: row.id, status: "CANCELLED" }, adminToken);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("cancelReason is required when cancelling attendance");
  });

  it("rejects an invalid status and an illegal transition", async () => {
    const list = await get(`?campId=${campId}&status=CHECKED_IN`, adminToken);
    const row = list.body.items[0];

    const badStatus = await patch({ id: row.id, status: "LUNCH" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid status");

    const badJump = await patch({ id: row.id, status: "CHECKED_OUT" }, adminToken);
    expect(badJump.status).toBe(409);
    expect(badJump.body.error).toContain("Cannot move attendance from CHECKED_IN to CHECKED_OUT");
  });

  it("404s on an unknown attendance id and an unknown doctorId", async () => {
    const missing = await patch({ id: "no-such-attendance", status: "WAITING" }, adminToken);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Attendance record not found");

    const list = await get(`?campId=${campId}&status=CHECKED_IN`, adminToken);
    const row = list.body.items[0];
    const badDoctor = await patch({ id: row.id, status: "WAITING", doctorId: "no-doctor" }, adminToken);
    expect(badDoctor.status).toBe(404);
    expect(badDoctor.body.error).toBe("Doctor not found");
  });

  it("401s without a token and 403s for HOSPITAL (not in the PATCH gate)", async () => {
    const anon = await patch({ id: "x", status: "WAITING" }, "");
    expect(anon.status).toBe(401);
    const hospital = await patch({ id: "x", status: "WAITING" }, hospitalToken);
    expect(hospital.status).toBe(403);
  });
});
