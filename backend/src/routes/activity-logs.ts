/**
 * Activity log routes — /api/activity-logs
 * Converted 1:1 from src/app/api/activity-logs/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireRole, json, handleError } from "@/lib/session";

export const router = Router();

// GET /api/activity-logs?limit=60 — admin audit trail
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");

    const sp = new URL(req.url, "http://localhost").searchParams;
    const limit = sp.get("limit") ? parseInt(sp.get("limit")!, 10) : 60;

    const logs = await db.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      ...(limit > 0 ? { take: limit } : {}),
    });

    return json(res, logs);
  } catch (e) {
    return handleError(e, res);
  }
});
