/**
 * Pledges routes — /api/pledges, /api/pledges/:id
 * Converted 1:1 from src/app/api/pledges/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { recomputeCause } from "@/lib/causes";

export const router = Router();

const STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"];

// GET /api/pledges?status=&q= — admin list of all medicine pledges
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status") ?? undefined;
    const q = sp.get("q") ?? undefined;
    const rows = await db.pledge.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q ? { donorName: { contains: q } } : {}),
      },
      include: {
        cause: { select: { code: true, patientName: true, condition: true, monthlyCost: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/pledges/:id — ADMIN or the pledge's own donor → {pledge}
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const pledge = await db.pledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    const isOwner = Boolean(pledge.donorId) && pledge.donorId === session.userId;
    if (session.role !== "ADMIN" && !isOwner)
      throw new ApiError("You can only manage your own pledges", 403);

    const status = String(body.status ?? "").trim().toUpperCase();
    if (!STATUSES.includes(status))
      throw new ApiError("status must be ACTIVE, COMPLETED or CANCELLED", 400);

    const updated = await db.pledge.update({
      where: { id },
      data: { status },
    });
    await recomputeCause(updated.causeId);
    await logActivity(
      session.name,
      "PLEDGE_UPDATE",
      "Pledge",
      `${id} → ${status}`,
      session.userId
    );

    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/pledges/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const pledge = await db.pledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    await db.pledge.delete({ where: { id } });
    await recomputeCause(pledge.causeId);
    await logActivity(
      session.name,
      "PLEDGE_DELETE",
      "Pledge",
      id,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
