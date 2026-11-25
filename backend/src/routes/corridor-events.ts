/**
 * Corridor events route — /api/corridor-events
 * Converted 1:1 from src/app/api/corridor-events/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const router = Router();

// GET /api/corridor-events?missionId=&limit= (auth) — desc createdAt
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const missionId = sp.get("missionId") || undefined;
    const limit = Math.min(
      200,
      Math.max(1, Math.trunc(Number(sp.get("limit")) || 50))
    );

    const events = await db.corridorEvent.findMany({
      where: {
        ...(missionId ? { missionId } : {}),
        ...(sp.get("method") ? { method: sp.get("method")! } : {}),
        ...(sp.get("congestion") ? { congestion: sp.get("congestion")! } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { mission: { select: { requestRef: true } } },
    });
    return json(res, events);
  } catch (e) {
    return handleError(e, res);
  }
});
