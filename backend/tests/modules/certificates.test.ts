/**
 * Certificates — /api/certificates (vitest + supertest, integration style).
 *
 * Covers every route: the authenticated list (admin all / others own),
 * admin issue (with the legacy field checks), the public capability detail
 * and the print-ready HTML — plus authz and not-found paths.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tct-${Date.now()}`;
const PASSWORD = "Passw0rd!";
const YEAR = new Date().getFullYear();

let app: express.Express;
let adminToken: string;
let donorToken: string;
let donorUserId: string;

let issuedCode: string;
let userCertCode: string; // issued with userId → the donor's own list

async function buildApp() {
  const { router: certificatesRouter } = await import("@/routes/certificates");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/certificates", certificatesRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/certificates${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/certificates");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function login(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.certificate.deleteMany({
    where: {
      OR: [
        { recipientName: { startsWith: PREFIX } },
        { recipientEmail: { startsWith: PREFIX } },
        { userId: donorUserId },
      ],
    },
  });
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
  const donor = await db.user.create({
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });
  donorUserId = donor.id;

  adminToken = await login(admin.email);
  donorToken = await login(donor.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── GET /api/certificates ───────────────────────────────────────────────────
describe("GET /api/certificates", () => {
  it("401 without a session", async () => {
    expect((await get("/")).status).toBe(401);
  });

  it("returns the caller's own certificates for non-admin roles", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    await db.certificate.create({
      data: {
        code: `UAR-CERT-${YEAR}-${PREFIX}-OWN`,
        type: "DONOR_APPRECIATION",
        recipientName: `${PREFIX} donor`,
        recipientEmail: `${PREFIX}-donor@test.local`,
        userId: donorUserId,
        title: "Certificate of Appreciation",
      },
    });

    const res = await get("/", donorToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list.every((c) => c.userId === donorUserId)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].typeTitle).toBe("Certificate of Appreciation");
  });

  it("ADMIN sees all certificates (including other recipients')", async () => {
    const res = await get("/?limit=200", adminToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list.some((c) => c.userId === donorUserId)).toBe(true);
  });
});

// ─── POST /api/certificates — admin issue ────────────────────────────────────
describe("POST /api/certificates", () => {
  it("403 for a non-admin", async () => {
    const res = await post({ type: "DONOR_APPRECIATION", recipientName: "x" }, donorToken);
    expect(res.status).toBe(403);
  });

  it("issues a certificate with the sequential code and a type title", async () => {
    const res = await post(
      {
        type: "VOLUNTEER_SERVICE",
        recipientName: `${PREFIX} volunteer`,
        recipientEmail: `${PREFIX}-vol@test.local`,
        description: "outstanding service",
        meta: { hours: 120 },
      },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.certificate.code).toMatch(new RegExp(`^UAR-CERT-${YEAR}-\\d{5}$`));
    expect(res.body.certificate.title).toBe("Certificate of Volunteer Service");
    expect(res.body.certificate.issuedBy).toBe(`${PREFIX} admin`);
    expect(JSON.parse(res.body.certificate.meta)).toEqual({ hours: 120 });
    issuedCode = res.body.certificate.code;
  });

  it("links a user and lands in their own list", async () => {
    const res = await post(
      { type: "DONOR_APPRECIATION", recipientName: `${PREFIX} donor`, userId: donorUserId },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.certificate.userId).toBe(donorUserId);
    userCertCode = res.body.certificate.code;
  });

  it("validates the legacy field checks", async () => {
    const badType = await post({ type: "NOBLE_PRIZE", recipientName: "x" }, adminToken);
    expect(badType.status).toBe(400);
    expect(badType.body.error).toContain("type must be one of:");

    const noRecipient = await post({ type: "DONOR_APPRECIATION", recipientName: "  " }, adminToken);
    expect(noRecipient.status).toBe(400);
    expect(noRecipient.body.error).toBe("recipientName is required");

    const badEmail = await post(
      { type: "DONOR_APPRECIATION", recipientName: "x", recipientEmail: "nope" },
      adminToken
    );
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("recipientEmail does not look valid");

    const badUser = await post(
      { type: "DONOR_APPRECIATION", recipientName: "x", userId: "nope" },
      adminToken
    );
    expect(badUser.status).toBe(400);
    expect(badUser.body.error).toBe("Linked user (userId) was not found");
  });
});

// ─── GET /api/certificates/:code — public capability detail ──────────────────
describe("GET /api/certificates/:code", () => {
  it("404 for an unknown code", async () => {
    const res = await get(`/${encodeURIComponent(`UAR-CERT-${PREFIX}-none`)}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Certificate not found");
  });

  it("returns the detail with typeTitle and parsed meta (public verification link)", async () => {
    const res = await get(`/${issuedCode}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(issuedCode);
    expect(res.body.typeTitle).toBe("Certificate of Volunteer Service");
    expect(Array.isArray(res.body.metaParsed)).toBe(true);
    expect(res.body.metaParsed).toContainEqual(["Hours", "120"]); // titleCased key
  });
});

// ─── GET /api/certificates/:code/html — print-ready A4 award ─────────────────
describe("GET /api/certificates/:code/html", () => {
  it("404 for an unknown code", async () => {
    const res = await get(`/${encodeURIComponent(`UAR-CERT-${PREFIX}-none`)}/html`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Certificate not found");
  });

  it("serves the self-contained certificate document", async () => {
    const res = await get(`/${issuedCode}/html`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain(issuedCode);
    expect(res.text).toContain("Certificate of Volunteer Service");
  });
});

// sanity: the user-linked certificate shows in the donor's list
describe("list ownership", () => {
  it("the donor's own list carries the user-linked certificate", async () => {
    const res = await get("/", donorToken);
    const list = res.body as Array<{ code: string }>;
    expect(list.some((c) => c.code === userCertCode)).toBe(true);
  });
});
