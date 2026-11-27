/**
 * Volunteer applications (vitest + supertest integration, real routers).
 *
 *   POST   /api/volunteer-applications        — public apply (session optional)
 *   GET    /api/volunteer-applications        — ?mine=1 (session) | ADMIN list ?status&q
 *   GET    /api/volunteer-applications/mine   — latest application + timeline
 *   PATCH  /api/volunteer-applications/:id    — ADMIN review machine | owner resubmit
 *   DELETE /api/volunteer-applications/:id    — ADMIN remove
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-volapps-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let applicantToken: string;
let secondApplicantToken: string;

let applicationId: string;
let applicantId: string;
let secondApplicationId: string;
let secondApplicantId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: volunteerApplicationsRouter } = await import("@/routes/volunteer-applications");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/volunteer-applications", volunteerApplicationsRouter);
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
  const r = request(app).get(`/api/volunteer-applications${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/volunteer-applications");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/volunteer-applications/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/volunteer-applications/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.volunteerApplication.deleteMany({ where: { email: { startsWith: PREFIX } } });
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
  const applicant = await db.user.create({
    data: {
      email: `${PREFIX}-app1@test.local`,
      name: `${PREFIX} applicant one`,
      role: "DONOR",
      userType: "volunteer",
      volunteerStatus: "pending",
      password: hashPassword(PASSWORD),
    },
  });
  applicantId = applicant.id;
  const second = await db.user.create({
    data: {
      email: `${PREFIX}-app2@test.local`,
      name: `${PREFIX} applicant two`,
      role: "DONOR",
      userType: "volunteer",
      volunteerStatus: "pending",
      password: hashPassword(PASSWORD),
    },
  });
  secondApplicantId = second.id;

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  applicantToken = await login("app1");
  secondApplicantToken = await login("app2");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/volunteer-applications (public apply)", () => {
  it("creates a PENDING application for a signed-in applicant", async () => {
    const res = await post(
      {
        fullName: `${PREFIX} applicant one`,
        email: `${PREFIX}-app1@test.local`,
        phone: "5550100200",
        city: "Bengaluru",
        skills: ["Teaching"],
        availability: ["WEEKENDS"],
        motivation: "I want to help my community every weekend",
      },
      applicantToken
    );
    expect(res.status).toBe(201);
    applicationId = res.body.application.id;
    expect(res.body.application.userId).toBe(applicantId);
    expect(res.body.application.status).toBe("PENDING");
  });

  it("an anonymous application gets a linked applicant account (tempCreds flow)", async () => {
    const res = await post({
      fullName: `${PREFIX} walk-in applicant`,
      email: `${PREFIX}-walkin@test.local`,
      phone: "5550100201",
      city: "Mysuru",
      motivation: "Weekend hands at the distribution drives please",
    });
    expect(res.status).toBe(201);
    // no session → the service links/creates a PENDING applicant account
    expect(res.body.application.userId).toBeTruthy();
    const { db } = await import("@/infrastructure/database/prisma");
    const created = await db.user.findUnique({ where: { id: res.body.application.userId } });
    expect(created?.status).toBe("PENDING");
    expect(created?.isActive).toBe(false);
  });

  it("400s on a missing motivation (website validation reached the caller)", async () => {
    const res = await post(
      { fullName: `${PREFIX} x`, email: `${PREFIX}-x@test.local`, phone: "5550100202", city: "Bengaluru" },
      applicantToken
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("motivation");
  });
});

describe("GET /api/volunteer-applications/mine + ?mine=1", () => {
  it("serves the status screen with the derived timeline", async () => {
    const res = await get("/mine", applicantToken);
    expect(res.status).toBe(200);
    expect(res.body.application.id).toBe(applicationId);
    expect(res.body.application.status).toBe("PENDING");
    expect(res.body.timeline.map((t: { key: string }) => t.key)).toEqual(["SUBMITTED"]);
  });

  it("?mine=1 lists every application of the session user", async () => {
    const res = await get("?mine=1", applicantToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((a: { email: string }) => a.email === `${PREFIX}-app1@test.local`)).toBe(true);
  });

  it("401s without a session", async () => {
    const mine = await get("/mine");
    expect(mine.status).toBe(401);
    const list = await get("?mine=1");
    expect(list.status).toBe(401);
  });
});

describe("GET /api/volunteer-applications (admin list)", () => {
  it("lists applications for ADMIN with ?q filter", async () => {
    const res = await get(`?q=${encodeURIComponent(`${PREFIX} applicant one`)}`, adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("403s for non-admin callers (the ADMIN gate runs after the ?mine=1 branch)", async () => {
    const res = await get("", applicantToken);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/volunteer-applications/:id (admin review machine)", () => {
  it("requests info, then the owner resubmits while INFO_REQUESTED", async () => {
    const info = await patch(
      applicationId,
      { status: "INFO_REQUESTED", reviewNote: "Please share availability" },
      adminToken
    );
    expect(info.status).toBe(200);
    expect(info.body.application.status).toBe("INFO_REQUESTED");

    const resubmit = await patch(
      applicationId,
      { city: "Hubballi", motivation: "Updated motivation — weekends still work best" },
      applicantToken
    );
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.application.status).toBe("PENDING");
    expect(resubmit.body.application.city).toBe("Hubballi");
  });

  it("approval mirrors User.volunteerStatus and creates an ACTIVE volunteer", async () => {
    const res = await patch(applicationId, { status: "APPROVED", reviewNote: "great fit" }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("APPROVED");

    const { db } = await import("@/infrastructure/database/prisma");
    const user = await db.user.findUnique({ where: { id: applicantId } });
    expect(user?.volunteerStatus).toBe("approved");
    expect(user?.volunteerApprovedAt).toBeTruthy();
    const volunteer = await db.volunteer.findUnique({ where: { userId: applicantId } });
    expect(volunteer?.status).toBe("ACTIVE");
  });

  it("the owner can no longer edit an APPROVED application", async () => {
    const res = await patch(applicationId, { city: "Bengaluru" }, applicantToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("only after additional information is requested");
  });

  it("blocks a non-admin reviewer and 404s on an unknown id", async () => {
    const forbidden = await patch(applicationId, { status: "PENDING" }, secondApplicantToken);
    expect(forbidden.status).toBe(403);

    const ghost = await patch("no-such-application", { status: "APPROVED" }, adminToken);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Application not found");
  });

  it("walks PENDING → UNDER_REVIEW for a second applicant", async () => {
    const apply = await post(
      {
        fullName: `${PREFIX} applicant two`,
        email: `${PREFIX}-app2@test.local`,
        phone: "5550100203",
        city: "Bengaluru",
        motivation: "Helping at community kitchens every week",
      },
      secondApplicantToken
    );
    expect(apply.status).toBe(201);
    secondApplicationId = apply.body.application.id;

    const review = await patch(secondApplicationId, { status: "UNDER_REVIEW" }, adminToken);
    expect(review.status).toBe(200);
    expect(review.body.application.status).toBe("UNDER_REVIEW");
    // non-decision states do NOT mirror onto the user badge
    const { db } = await import("@/infrastructure/database/prisma");
    const user = await db.user.findUnique({ where: { id: secondApplicantId } });
    expect(user?.volunteerStatus).toBe("pending");
  });
});

describe("DELETE /api/volunteer-applications/:id (admin remove)", () => {
  it("removes an application for ADMIN", async () => {
    const res = await del(secondApplicationId, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const gone = await del(secondApplicationId, adminToken);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("Application not found");
  });

  it("401s without a token and 403s for non-admin roles", async () => {
    const anon = await del(secondApplicationId);
    expect(anon.status).toBe(401);
    const applicant = await del(secondApplicationId, applicantToken);
    expect(applicant.status).toBe(403);
  });
});
