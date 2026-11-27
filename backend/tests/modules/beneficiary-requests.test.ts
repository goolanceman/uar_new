/**
 * Beneficiary requests — /api/beneficiary-requests (vitest + supertest,
 * integration style).
 *
 * Covers every route: guest/session submission, the branch-dependent list
 * (?mine=1 self-list vs admin queue with role gates), the admin review
 * PATCH (transition machine + urgency) and the ADMIN delete.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tbr-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string; // donor WITH a linked Beneficiary record
let otherDonorToken: string; // donor without beneficiary link
let donorUserId: string;

let guestRequestId: string;
let donorRequestId: string;

async function buildApp() {
  const { router: beneficiaryRequestsRouter } = await import("@/routes/beneficiary-requests");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/beneficiary-requests", beneficiaryRequestsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/beneficiary-requests${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/beneficiary-requests");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/beneficiary-requests/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/beneficiary-requests/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}

async function login(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.beneficiaryRequest.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.activityLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: PREFIX } }, { details: { contains: PREFIX } }] },
  });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");

  const admin = await db.user.create({
    data: { email: `${PREFIX}-admin@test.local`, name: `${PREFIX} admin`, password: PASSWORD, role: "ADMIN" },
  });
  const volunteer = await db.user.create({
    data: { email: `${PREFIX}-vol@test.local`, name: `${PREFIX} vol`, password: PASSWORD, role: "VOLUNTEER" },
  });
  const donor = await db.user.create({
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });
  const other = await db.user.create({
    data: { email: `${PREFIX}-other@test.local`, name: `${PREFIX} other`, password: PASSWORD, role: "DONOR" },
  });
  donorUserId = donor.id;

  await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN`, name: `${PREFIX} beneficiary`, userId: donor.id },
  });

  adminToken = await login(admin.email);
  volunteerToken = await login(volunteer.email);
  donorToken = await login(donor.email);
  otherDonorToken = await login(other.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── POST /api/beneficiary-requests ──────────────────────────────────────────
describe("POST /api/beneficiary-requests", () => {
  it("accepts an anonymous submission with the legacy defaults", async () => {
    const res = await post({
      name: `${PREFIX} guest`,
      details: `${PREFIX} need help with ration`,
      phone: "9876543210",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.urgency).toBe("MEDIUM");
    expect(res.body.category).toBe("OTHER");
    expect(res.body.userId).toBeNull();
    expect(res.body.beneficiaryId).toBeNull();
    guestRequestId = res.body.id;
  });

  it("links the caller's beneficiary record when a session is present", async () => {
    const res = await post(
      { name: `${PREFIX} linked`, details: `${PREFIX} monthly medicines`, urgency: "high" },
      donorToken
    );
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(donorUserId);
    expect(res.body.beneficiaryId).toBeTruthy(); // resolved via Beneficiary.userId
    expect(res.body.urgency).toBe("HIGH"); // case-insensitive
    donorRequestId = res.body.id;
  });

  it("validates name/details and the urgency vocabulary", async () => {
    const missing = await post({ name: "  ", details: "   " });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Name and request details are required");

    const badUrgency = await post({ name: "x", details: "y", urgency: "WHENEVER" });
    expect(badUrgency.status).toBe(400);
    expect(badUrgency.body.error).toBe("Invalid urgency level");
  });
});

// ─── GET /api/beneficiary-requests ───────────────────────────────────────────
describe("GET /api/beneficiary-requests — branch-dependent gates", () => {
  it("?mine=1 requires any signed-in role and scopes to the caller", async () => {
    expect((await get("/?mine=1")).status).toBe(401);

    const res = await get("/?mine=1", donorToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(donorRequestId);

    const others = await get("/?mine=1", otherDonorToken);
    expect(others.body).toHaveLength(0);
  });

  it("the admin queue is ADMIN/VOLUNTEER-only", async () => {
    expect((await get("/")).status).toBe(401);
    expect((await get("/", donorToken)).status).toBe(403);

    const res = await get("/", adminToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list.some((r) => r.id === guestRequestId)).toBe(true);
  });

  it("supports the status filter on the admin queue", async () => {
    const res = await get("/?status=PENDING", volunteerToken);
    expect(res.status).toBe(200);
    expect((res.body as Array<Record<string, unknown>>).every((r) => r.status === "PENDING")).toBe(true);
  });
});

// ─── PATCH /api/beneficiary-requests/:id — the review machine ────────────────
describe("PATCH /api/beneficiary-requests/:id", () => {
  it("404 before any field validation (legacy ordering)", async () => {
    const res = await patch("/does-not-exist", { status: "BOGUS" }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Request not found");
  });

  it("403 for donors", async () => {
    expect((await patch(`/${guestRequestId}`, { status: "IN_REVIEW" }, donorToken)).status).toBe(403);
  });

  it("validates the status vocabulary and the transition machine", async () => {
    const badStatus = await patch(`/${guestRequestId}`, { status: "MAYBE" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid request status");

    const badTransition = await patch(`/${guestRequestId}`, { status: "FULFILLED" }, adminToken);
    expect(badTransition.status).toBe(400);
    expect(badTransition.body.error).toBe(
      "Cannot move beneficiary request from PENDING to FULFILLED. Allowed: IN_REVIEW, APPROVED, REJECTED"
    );
  });

  it("reviews a request: PENDING → IN_REVIEW stamps reviewer + urgency edit", async () => {
    const res = await patch(
      `/${guestRequestId}`,
      { status: "IN_REVIEW", urgency: "CRITICAL", reviewNote: `${PREFIX} verified by phone` },
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_REVIEW");
    expect(res.body.urgency).toBe("CRITICAL");
    expect(res.body.reviewedBy).toBe(`${PREFIX} admin`);
    expect(res.body.reviewedAt).toBeTruthy();
  });

  it("volunteers can review too", async () => {
    const res = await patch(`/${guestRequestId}`, { status: "APPROVED" }, volunteerToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
  });

  it("rejects empty patches", async () => {
    const res = await patch(`/${guestRequestId}`, {}, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Nothing to update");
  });
});

// ─── DELETE /api/beneficiary-requests/:id ────────────────────────────────────
describe("DELETE /api/beneficiary-requests/:id", () => {
  it("403 volunteers, 404 unknown", async () => {
    expect((await del("/does-not-exist", adminToken)).status).toBe(404);
    expect((await del(`/${guestRequestId}`, volunteerToken)).status).toBe(403);
  });

  it("removes the request (admin)", async () => {
    const res = await del(`/${guestRequestId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { db } = await import("@/infrastructure/database/prisma");
    expect(await db.beneficiaryRequest.findUnique({ where: { id: guestRequestId } })).toBeNull();
  });
});
