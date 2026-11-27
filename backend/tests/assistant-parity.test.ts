/**
 * AI degradation parity — every AI-backed endpoint degrades gracefully when
 * the LLM SDK is down, instead of failing the request:
 *
 *   POST /api/health-ai {action:"camp-plan"}
 *     → 200 with a deterministic OFFLINE plan built from the same aggregate
 *       stats (clearly labelled), the AIInteraction row still recorded as
 *       PENDING for review.
 *   POST /api/assistant/chat
 *     → 200 with the knowledge-base fallback reply (existing behaviour,
 *       pinned here for parity).
 *
 * The z-ai-web-dev-sdk is mocked to ALWAYS fail — only the fallback paths run.
 * Uses the TEST database and only touches rows it creates.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("z-ai-web-dev-sdk", () => ({
  default: {
    create: async (): Promise<never> => {
      throw new Error("simulated AI outage");
    },
  },
}));

const PREFIX = `aiparity-${Date.now()}`;
const PASSWORD = "Test-Pass-123";

let app: express.Express;
let adminToken = "";
let adminId = "";

async function buildApp() {
  const [{ router: healthAiRouter }, { router: assistantRouter }] = await Promise.all([
    import("@/routes/health-ai"),
    import("@/routes/assistant"),
  ]);
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/health-ai", healthAiRouter);
  a.use("/api/assistant", assistantRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.aIInteraction.deleteMany({ where: { userId: { in: ids } } });
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  // /api/assistant/chat may write nothing — nothing else to clean.
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");
  const admin = await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: `${PREFIX} admin`,
      role: "ADMIN",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  adminId = admin.id;
  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/health-ai {action:'camp-plan'} — offline fallback", () => {
  it("returns 200 with a labelled offline plan and still records the PENDING interaction", async () => {
    const res = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "camp-plan", city: "Bengaluru" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("CAMP_PLAN");
    expect(res.body.status).toBe("PENDING");
    expect(res.body.id).toBeTruthy();
    expect(res.body.disclaimer).toBeTruthy();
    expect(Array.isArray(res.body.assumptions)).toBe(true);
    expect(String(res.body.plan)).toContain("Offline plan — AI service unavailable");

    // The interaction is still recorded for human review.
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.aIInteraction.findUnique({ where: { id: res.body.id } });
    expect(row).not.toBeNull();
    expect(row?.action).toBe("CAMP_PLAN");
    expect(row?.status).toBe("PENDING");
    expect(row?.userId).toBe(adminId);
  });
});

describe("POST /api/assistant/chat — offline fallback (parity)", () => {
  it("answers 200 from the knowledge base when the LLM is down", async () => {
    const res = await request(app).post("/api/assistant/chat").send({ message: "How do I volunteer?" });
    expect(res.status).toBe(200);
    expect(typeof res.body.reply).toBe("string");
    expect(res.body.reply.length).toBeGreaterThan(0);
  });
});
