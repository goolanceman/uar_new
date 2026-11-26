/**
 * Mobile consolidation — volunteer applications (vitest + supertest).
 *
 * The mobile apply/status/admin-review copies in the wire-compat layer
 * (routes/mobile/auth-users.ts: /volunteer/apply, /volunteer/status,
 * /admin/volunteer/*) were REMOVED — the Flutter app now calls the SAME
 * website module the web frontend uses
 * (frontend/src/components/public/volunteer.tsx + admin volunteers-view.tsx):
 *   POST /api/volunteer-applications        — apply (session profile fills
 *                                             fullName/email/phone)
 *   GET  /api/volunteer-applications/mine   — status screen
 *   PATCH /api/volunteer-applications/:id   — admin review (mirrors
 *                                             User.volunteerStatus so the
 *                                             app's badge/login routing works)
 *   POST /api/user/select-type              — kept on the compat layer (no
 *                                             main equivalent)
 *
 * Mobile requests carry `apikey` (mobileGate) + the same bearer token the web
 * sends. Only touches rows it creates (unique email prefix; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `mvt-${Date.now()}`;

let app: express.Express;
let me: { id: string };
let volunteer2: { id: string };
let authToken: string;
let token2: string;
let adminToken: string;
let applicationId: string;

async function buildApp() {
  const { router: mobileRouter } = await import("@/routes/mobile");
  const { router: volunteerApplicationsRouter } = await import("@/routes/volunteer-applications");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  // same order AND same gate placement as src/index.ts: the apikey gate lives
  // OUTSIDE the compat router so non-apikey requests never reach it
  a.use("/api", (req, res, next) => {
    if (!req.header("apikey")) return next();
    return mobileRouter(req, res, next);
  });
  a.use("/api/auth", authRouter);
  a.use("/api/volunteer-applications", volunteerApplicationsRouter);
  return a;
}

/** Mobile-style calls: apikey header like ApiService, plus the bearer token. */
function mget(path: string) {
  return request(app).get(`/api/${path}`).set("apikey", "test");
}
function mpost(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/${path}`).set("apikey", "test");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function mpatch(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/${path}`).set("apikey", "test");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.volunteerApplication.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.volunteer.deleteMany({ where: { userId: { in: ids } } });
  await db.activityLog.deleteMany({ where: { details: { contains: PREFIX } } });
  if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");

  // an app user with a phone on their profile (the mobile form never collects
  // one — the session profile must fill it in) and one without
  me = await db.user.create({
    data: {
      email: `${PREFIX}-me@test.local`,
      name: `${PREFIX} applicant`,
      phone: "5551234567",
      city: "Springfield",
      userType: "volunteer",
      volunteerStatus: "pending",
      password: "Applicant#1",
    },
  });
  volunteer2 = await db.user.create({
    data: {
      email: `${PREFIX}-two@test.local`,
      name: `${PREFIX} applicant two`,
      password: "Applicant#2",
    },
  });
  await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: `${PREFIX} admin`,
      role: "ADMIN",
      password: "Admin#1234",
    },
  });

  // the app logs in like the website does and sends the bearer token
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: `${PREFIX}-me@test.local`, password: "Applicant#1" });
  expect(login.status).toBe(200);
  authToken = login.body.token;

  const login2 = await request(app)
    .post("/api/auth/login")
    .send({ email: `${PREFIX}-two@test.local`, password: "Applicant#2" });
  expect(login2.status).toBe(200);
  token2 = login2.body.token;

  const adminLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: `${PREFIX}-admin@test.local`, password: "Admin#1234" });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.token;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

// ═══════════ APPLY — the website module, mobile caller ═══════════
describe("POST /api/volunteer-applications (mobile apikey falls through to the website router)", () => {
  it("creates the application from the session profile when the body omits identity fields", async () => {
    const res = await mpost(
      "volunteer-applications",
      {
        // camelCase website body — the app's VolunteerService builds exactly this
        skills: ["Teaching", "Fundraising"],
        customSkills: ["Drone repair"],
        availability: ["Monday - Morning"],
        isFlexible: true,
        city: "Springfield",
        state: "IL",
        country: "USA",
        postalCode: "62704",
        serviceAreas: ["Downtown"],
        willingToTravel: true,
        maxTravelDistance: 25,
        remoteVolunteering: false,
        motivation: "I want to help my community every weekend",
        priorExperience: "Food bank volunteer",
        emergencyContact: "Jane Doe",
        emergencyPhone: "5559876543",
        addressLine1: "12 Main St",
      },
      authToken
    );
    expect(res.status).toBe(201);
    expect(res.body.application.userId).toBe(me.id);
    expect(res.body.application.fullName).toBe(`${PREFIX} applicant`);
    expect(res.body.application.email).toBe(`${PREFIX}-me@test.local`);
    expect(res.body.application.phone).toBe("5551234567"); // session-profile fallback
    expect(res.body.application.status).toBe("PENDING");
    // JSON list columns round-trip as arrays in the body
    expect(JSON.parse(res.body.application.skills)).toEqual(["Teaching", "Fundraising"]);
    applicationId = res.body.application.id;
  });

  it("rejects a signed-in applicant with no motivation (website validation reached the app)", async () => {
    const res = await mpost(
      "volunteer-applications",
      { skills: ["Teaching"], availability: ["Monday - Morning"], city: "Springfield" },
      token2
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("motivation");
  });

  it("serves GET /mine for the status screen", async () => {
    const res = await mget("volunteer-applications/mine").set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.application.id).toBe(applicationId);
    expect(res.body.application.status).toBe("PENDING");
  });

  it("returns { application: null } for a user who never applied", async () => {
    const res = await mget("volunteer-applications/mine").set("Authorization", `Bearer ${token2}`);
    expect(res.status).toBe(200);
    expect(res.body.application).toBeNull();
  });

  it("removed the compat copies: POST /volunteer/apply and GET /volunteer/status are 404", async () => {
    const apply = await mpost("volunteer/apply", { skills: ["x"] }, authToken);
    expect(apply.status).toBe(404);
    const status = await mget("volunteer/status").set("Authorization", `Bearer ${authToken}`);
    expect(status.status).toBe(404);
  });
});

// ═══════════ SELECT-TYPE — still on the compat layer (no main equivalent) ══
describe("POST /api/user/select-type (compat)", () => {
  it("keeps the legacy {status, message, data} envelope", async () => {
    const res = await mpost("user/select-type", { user_type: "supporter" }, token2);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data.user_type).toBe("supporter");
  });
});

// ═══════════ ADMIN REVIEW — website module, mirrors mobile badge state ════
describe("PATCH /api/volunteer-applications/:id (admin review)", () => {
  it("approval mirrors User.volunteerStatus so the app's badge/login routing updates", async () => {
    const res = await mpatch(
      `volunteer-applications/${applicationId}`,
      { status: "APPROVED", reviewNote: "great fit" },
      adminToken
    );
    expect(res.status).toBe(200);

    const { db } = await import("@/lib/db");
    const user = await db.user.findUnique({ where: { id: me.id } });
    expect(user?.volunteerStatus).toBe("approved");
    expect(user?.volunteerApprovedAt).toBeTruthy();

    const volunteer = await db.volunteer.findUnique({ where: { userId: me.id } });
    expect(volunteer?.status).toBe("ACTIVE");

    // the app's status screen now shows approved
    const mine = await mget("volunteer-applications/mine").set("Authorization", `Bearer ${authToken}`);
    expect(mine.body.application.status).toBe("APPROVED");
  });

  it("rejection records the reason and mirrors User.volunteerStatus", async () => {
    const { db } = await import("@/lib/db");
    // applicant two applied via the main module (motivation >= 20 chars)
    const apply = await mpost(
      "volunteer-applications",
      {
        skills: ["Cooking"],
        availability: ["Sunday - Afternoon"],
        city: "Springfield",
        motivation: "Helping at community kitchens every week",
      },
      token2
    );
    expect(apply.status).toBe(201);

    const res = await mpatch(
      `volunteer-applications/${apply.body.application.id}`,
      { status: "REJECTED", reason: "No openings in this city" },
      adminToken
    );
    expect(res.status).toBe(200);

    const user = await db.user.findUnique({ where: { id: volunteer2.id } });
    expect(user?.volunteerStatus).toBe("rejected");
    expect(user?.volunteerRejectionReason).toBe("No openings in this city");
  });

  it("blocks non-admin reviewers", async () => {
    const res = await mpatch(
      `volunteer-applications/${applicationId}`,
      { status: "PENDING" },
      authToken
    );
    expect(res.status).toBe(403);
  });
});
