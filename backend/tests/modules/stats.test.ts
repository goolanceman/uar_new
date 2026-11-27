/**
 * Stats module — public aggregate snapshot /api/stats (real router via
 * @/routes/stats).
 *
 * Public read: covers the all-time envelope keys, the range-scoped variant
 * and the legacy leniency (invalid dates silently fall back to all-time —
 * the schema never rejects). No auth, no params, no 404 surface.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

let app: express.Express;

async function buildApp() {
  const { router } = await import("@/routes/stats");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/stats", router);
  return a;
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/stats (public)", () => {
  it("serves the all-time snapshot with the legacy keys", async () => {
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.totals).toBeTypeOf("object");
    expect(typeof res.body.totals.raised).toBe("number");
    expect(typeof res.body.totals.donations).toBe("number");
    expect(typeof res.body.totals.campaigns).toBe("number");
    expect(Array.isArray(res.body.monthly)).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(Array.isArray(res.body.recentDonations)).toBe(true);
  });

  it("scopes the numbers to a ?from=&to= window and adds deltas", async () => {
    const res = await request(app)
      .get("/api/stats")
      .query({ from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.totals.raised).toBeTypeOf("number");
    expect(res.body.deltas).toBeTypeOf("object"); // vs the previous equal-length window
    expect(res.body.deltas.raised).toBeTypeOf("object");
  });

  it("silently falls back to all-time for unparseable dates (legacy leniency)", async () => {
    const res = await request(app).get("/api/stats").query({ from: "not-a-date", to: "also-not" });
    expect(res.status).toBe(200);
    expect(res.body.totals).toBeTypeOf("object");
    expect(res.body.deltas).toBeUndefined(); // no window ⇒ no deltas
  });
});
