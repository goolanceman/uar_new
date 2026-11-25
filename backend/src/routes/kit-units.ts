/**
 * Kit units route — /api/kit-units
 * Converted 1:1 from src/app/api/kit-units/route.ts (Next.js route handler) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const router = Router();

// GET /api/kit-units?batchId=&status=&q=&mine=1&limit= (auth) — orderBy code asc
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const batchId = sp.get("batchId") || undefined;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;
    const limit = Math.min(
      500,
      Math.max(1, Math.trunc(Number(sp.get("limit")) || 200))
    );

    const where: Prisma.KitUnitWhereInput = {};
    if (batchId) where.batchId = batchId;
    if (status) where.status = status;
    if (q) where.code = { contains: q };
    if (sp.get("mine")) where.scannedById = session.userId;

    const units = await db.kitUnit.findMany({
      where,
      orderBy: { code: "asc" },
      take: limit,
      include: {
        batch: { select: { name: true, template: { select: { name: true } } } },
      },
    });
    return json(res, units);
  } catch (e) {
    return handleError(e, res);
  }
});
