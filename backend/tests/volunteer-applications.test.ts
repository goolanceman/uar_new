/**
 * Volunteer applications (vitest + supertest).
 *
 * The legacy mobile-only apply/status/admin-review copies are gone — the Flutter
 * app calls the SAME website module the web frontend uses
 * (frontend/src/components/public/volunteer.tsx + admin volunteers-view.tsx):
 *   POST /api/volunteer-applications        — apply (session profile fills
 *                                             fullName/email/phone)
 *   GET  /api/volunteer-applications/mine   — status screen
 *   PATCH /api/volunteer-applications/:id   — admin review (mirrors
 *                                             User.volunteerStatus so the
 *                                             app's badge/login routing works)
 *
 * Requests go straight to the generic routers (no apikey — the web envelope).
 * Only touches rows it creates (unique email prefix; no table wipes).
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
let applicant3: { id: string };
let token3: string;
let flowApplicationId: string;

async function buildApp() {
  const { router: volunteerApplicationsRouter } = await import("@/routes/volunteer-applications");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/volunteer-applications", volunteerApplicationsRouter);
  return a;
}

/** Plain web-style calls (no apikey — the generic envelope). */
function mget(path: string) {
  return request(app).get(`/api/${path}`);
}
function mpost(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function mpatch(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/${path}`);
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
  applicant3 = await db.user.create({
    data: {
      email: `${PREFIX}-three@test.local`,
      name: `${PREFIX} applicant three`,
      phone: "5551112223",
      city: "Springfield",
      password: "Flow@12345",
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

  const login3 = await request(app)
    .post("/api/auth/login")
    .send({ email: `${PREFIX}-three@test.local`, password: "Flow@12345" });
  expect(login3.status).toBe(200);
  token3 = login3.body.token;

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
describe("POST /api/volunteer-applications (the website module, app caller)", () => {
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
      { skills: ["Teaching"], availability: ["Monday - Morning"], city: "Springfield", phone: "5551234500" },
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

  it("a legacy apikey request to a retired compat path is a plain 404", async () => {
    const apply = await request(app)
      .post("/api/volunteer/apply")
      
      .set("Authorization", `Bearer ${authToken}`)
      .send({ skills: ["x"] });
    expect(apply.status).toBe(404);
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
        phone: "5551234501",
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

// ═══════════ PHASE 5 — review machine + owner resubmit ═══════════
describe("volunteer application review machine (phase 5)", () => {
  it("enforces the authoritative field rules with identical 400 messages", async () => {
    const base = { city: "Springfield", motivation: "I want to help my community every weekend" };

    const shortName = await mpost("volunteer-applications", { ...base, fullName: "A", phone: "5551112223" }, token3);
    expect(shortName.status).toBe(400);
    expect(shortName.body.error).toBe("Full name must be at least 3 characters");

    const badEmail = await mpost(
      "volunteer-applications",
      { ...base, fullName: "Valid Name", email: "not-an-email", phone: "5551112223" },
      token3
    );
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("Enter a valid email address");

    const badPhone = await mpost(
      "volunteer-applications",
      { ...base, fullName: "Valid Name", phone: "12345" },
      token3
    );
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error).toBe("Phone must be exactly 10 digits");

    const noCity = await mpost(
      "volunteer-applications",
      { fullName: "Valid Name", phone: "5551112223", motivation: base.motivation },
      token3
    );
    expect(noCity.status).toBe(400);
    expect(noCity.body.error).toBe("City is required");

    const shortMotivation = await mpost(
      "volunteer-applications",
      { ...base, fullName: "Valid Name", phone: "5551112223", motivation: "too short" },
      token3
    );
    expect(shortMotivation.status).toBe(400);
    expect(shortMotivation.body.error).toContain("at least 20 characters");
  });

  it("walks PENDING → UNDER_REVIEW → INFO_REQUESTED and back via an owner resubmit", async () => {
    // 1. applicant three applies
    const apply = await mpost(
      "volunteer-applications",
      {
        fullName: `${PREFIX} applicant three`,
        email: `${PREFIX}-three@test.local`,
        phone: "5551112223",
        city: "Springfield",
        skills: ["Driving"],
        availability: ["WEEKENDS"],
        motivation: "Happy to drive supplies to weekend distribution drives",
        serviceAreas: ["Downtown"],
        willingToTravel: true,
        maxTravelDistance: 30,
      },
      token3
    );
    expect(apply.status).toBe(201);
    flowApplicationId = apply.body.application.id;
    expect(apply.body.application.status).toBe("PENDING");

    // 2. admin marks it under review — applicant mirror stays "pending"
    const review = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { status: "UNDER_REVIEW" },
      adminToken
    );
    expect(review.status).toBe(200);
    expect(review.body.application.status).toBe("UNDER_REVIEW");
    const { db } = await import("@/lib/db");
    const afterReview = await db.user.findUnique({ where: { id: applicant3.id } });
    expect(afterReview?.volunteerStatus).toBe("pending");

    // 3. requesting information without a note is rejected
    const noNote = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { status: "INFO_REQUESTED" },
      adminToken
    );
    expect(noNote.status).toBe(400);
    expect(noNote.body.error).toContain("review note is required");

    // 4. with the note it succeeds and GET /mine carries the timeline + note
    const info = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { status: "INFO_REQUESTED", reviewNote: "Please share your weekend availability window" },
      adminToken
    );
    expect(info.status).toBe(200);
    expect(info.body.application.reviewNote).toContain("availability");

    const mine = await mget("volunteer-applications/mine").set("Authorization", `Bearer ${token3}`);
    expect(mine.status).toBe(200);
    expect(mine.body.application.status).toBe("INFO_REQUESTED");
    expect(mine.body.timeline.map((t: { key: string }) => t.key)).toEqual([
      "SUBMITTED",
      "INFO_REQUESTED",
    ]);
    expect(mine.body.timeline[1].note).toContain("availability");

    // 5. the owner cannot resubmit while another review state is running —
    //    here the application IS info-requested, so first prove the guard on
    //    a pending application further below; resubmit now.
    const resubmit = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      {
        // body form wins for provided fields; omitted optionals are preserved
        phone: "5554443332",
        city: "Mysuru",
        motivation: "Updated motivation — still happy to drive weekend supplies",
      },
      token3
    );
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.application.status).toBe("PENDING");
    expect(resubmit.body.application.phone).toBe("5554443332");
    expect(resubmit.body.application.city).toBe("Mysuru");
    expect(JSON.parse(resubmit.body.application.serviceAreas)).toEqual(["Downtown"]);
    expect(resubmit.body.application.willingToTravel).toBe(true);

    // 6. resubmission is a no-op field edit away from the queue: owner can
    //    no longer edit while the status is plain PENDING
    const blocked = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { city: "Hubballi" },
      token3
    );
    expect(blocked.status).toBe(403);

    // 7. a different non-admin account cannot touch someone else's application
    const stranger = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { city: "Hubballi" },
      token2
    );
    expect(stranger.status).toBe(403);

    // 8. invalid review jump (PENDING → nothing wrong here, but REJECTED
    //    applications may not go straight to UNDER_REVIEW)
    const reject = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { status: "REJECTED", reviewNote: "Not enough weekend drivers yet" },
      adminToken
    );
    expect(reject.status).toBe(200);

    const invalid = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { status: "UNDER_REVIEW" },
      adminToken
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toContain("Cannot move volunteer application from REJECTED");

    // 9. decisions can be undone back to PENDING (mirror returns to pending)
    const reopen = await mpatch(
      `volunteer-applications/${flowApplicationId}`,
      { status: "PENDING" },
      adminToken
    );
    expect(reopen.status).toBe(200);
    const user = await db.user.findUnique({ where: { id: applicant3.id } });
    expect(user?.volunteerStatus).toBe("pending");
  });
});
