/**
 * Camp expenses (vitest + supertest integration, real routers).
 *
 *   GET  /api/camp-expenses?campId= — ADMIN paged list with a totals block
 *   POST /api/camp-expenses         — ADMIN create { campId, head, amount, notes? }
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-campexp-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let campId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: campExpensesRouter } = await import("@/routes/camp-expenses");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/camp-expenses", campExpensesRouter);
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

function get(path = "", token?: string) {
  const r = request(app).get(`/api/camp-expenses${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token: string) {
  return request(app).post("/api/camp-expenses").set("Authorization", `Bearer ${token}`).send(body);
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.campExpense.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campAttendance.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campRegistration.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campStaff.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.campPartner.deleteMany({ where: { camp: { code: { startsWith: PREFIX } } } });
  await db.medicalCamp.deleteMany({ where: { code: { startsWith: PREFIX } } });
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
  await db.user.create({
    data: {
      email: `${PREFIX}-vol@test.local`,
      name: `${PREFIX} vol`,
      role: "VOLUNTEER",
      password: hashPassword(PASSWORD),
    },
  });
  const camp = await db.medicalCamp.create({
    data: {
      code: `${PREFIX}-CAMP`,
      title: `${PREFIX} camp`,
      campDate: new Date(),
      venue: "Town hall",
      status: "LIVE",
    },
  });
  campId = camp.id;

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  volunteerToken = await login("vol");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/camp-expenses", () => {
  it("creates an expense with the acting admin stamped as spentBy", async () => {
    const res = await post({ campId, head: "Medicines", amount: 1500.5, notes: "first-aid restock" }, adminToken);
    expect(res.status).toBe(201);
    expect(res.body.campId).toBe(campId);
    expect(res.body.head).toBe("Medicines");
    expect(res.body.amount).toBe(1500.5);
    expect(res.body.notes).toBe("first-aid restock");
    expect(res.body.spentByName).toBe(`${PREFIX} admin`);
    expect(res.body.spentAt).toBeTruthy();
  });

  it("400s on a missing campId / missing head / non-positive amount", async () => {
    const noCamp = await post({ head: "Food", amount: 100 }, adminToken);
    expect(noCamp.status).toBe(400);
    expect(noCamp.body.error).toBe("campId is required");

    const noHead = await post({ campId, amount: 100 }, adminToken);
    expect(noHead.status).toBe(400);
    expect(noHead.body.error).toBe("head is required");

    const blankHead = await post({ campId, head: "   ", amount: 100 }, adminToken);
    expect(blankHead.status).toBe(400);
    expect(blankHead.body.error).toBe("head is required");

    const zero = await post({ campId, head: "Food", amount: 0 }, adminToken);
    expect(zero.status).toBe(400);
    expect(zero.body.error).toBe("amount must be greater than zero");

    const junk = await post({ campId, head: "Food", amount: "abc" }, adminToken);
    expect(junk.status).toBe(400);
    expect(junk.body.error).toBe("amount must be greater than zero");
  });

  it("404s when the camp does not exist", async () => {
    const res = await post({ campId: "no-such-camp", head: "Food", amount: 10 }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Camp not found");
  });

  it("401s without a token and 403s for non-admin roles", async () => {
    const anon = await post({ campId, head: "Food", amount: 10 }, "");
    expect(anon.status).toBe(401);
    const vol = await post({ campId, head: "Food", amount: 10 }, volunteerToken);
    expect(vol.status).toBe(403);
  });
});

describe("GET /api/camp-expenses", () => {
  it("lists expenses for a camp with a totals block", async () => {
    await post({ campId, head: "Transport", amount: 500 }, adminToken);
    const res = await get(`?campId=${campId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.pages).toBe(1);
    expect(res.body.totals).toEqual({ amount: 2000.5, count: 2 });
    expect(res.body.items.every((e: { campId: string }) => e.campId === campId)).toBe(true);
  });

  it("aggregates across all camps when no campId filter is given", async () => {
    const res = await get("", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.totals.count).toBeGreaterThanOrEqual(2);
    expect(res.body.totals.amount).toBeGreaterThanOrEqual(2000.5);
  });

  it("401s without a token and 403s for non-admin roles", async () => {
    const anon = await get("");
    expect(anon.status).toBe(401);
    const vol = await get("", volunteerToken);
    expect(vol.status).toBe(403);
  });
});
