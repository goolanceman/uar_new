/**
 * Dashboard module — the public root snapshot GET /api
 * (dashboardController.snapshot, exactly as app.ts mounts it).
 *
 * Enveloped contract: { success: true, data } with the five legacy counters.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

let app: express.Express;

async function buildApp() {
  const { dashboardController } = await import("@/modules/dashboard");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.get("/api", dashboardController.snapshot);
  return a;
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api — root dashboard snapshot (public)", () => {
  it("serves the enveloped { success: true, data } contract", async () => {
    const res = await request(app).get("/api");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeUndefined();
  });

  it("carries the five legacy counters as numbers", async () => {
    const res = await request(app).get("/api");
    const data = res.body.data;
    expect(Object.keys(data).sort()).toEqual(
      ["activeCampaigns", "beneficiaries", "inventoryItems", "totalDonations", "volunteers"].sort()
    );
    for (const key of Object.keys(data)) {
      expect(typeof data[key], `${key} must be a number`).toBe("number");
    }
  });
});
