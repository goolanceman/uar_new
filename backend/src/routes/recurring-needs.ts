/**
 * Recurring-needs routes — /api/recurring-needs, /api/recurring-needs/:id
 * Converted 1:1 from src/app/api/recurring-needs/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireRole, json, handleError, ApiError, logActivity } from "@/lib/session";
import { RECURRING_NEED_STATUSES } from "@/lib/recurring-needs";

export const router = Router();

const log = logger.child("recurring-needs");

const CYCLES = ["WEEKLY", "MONTHLY", "QUARTERLY"];
const STATUSES = RECURRING_NEED_STATUSES;

const INCLUDE = {
  beneficiary: { select: { id: true, name: true, city: true, category: true, urgencyLevel: true, isActive: true, caseStatus: true, verificationStatus: true } },
  item: { select: { id: true, name: true, unit: true, quantity: true, minStock: true } },
} satisfies Prisma.RecurringNeedInclude;

// GET /api/recurring-needs?beneficiaryId=&itemId=&status=&dueBy=  (staff)
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const where: Prisma.RecurringNeedWhereInput = {};

    const beneficiaryId = sp.get("beneficiaryId")?.trim();
    if (beneficiaryId) where.beneficiaryId = beneficiaryId;

    const itemId = sp.get("itemId")?.trim();
    if (itemId) where.itemId = itemId;

    const status = sp.get("status")?.trim().toUpperCase();
    if (status && STATUSES.includes(status)) where.status = status;

    const dueBy = sp.get("dueBy")?.trim();
    if (dueBy) {
      const d = new Date(dueBy);
      if (!Number.isNaN(d.getTime())) where.nextDueAt = { lte: d };
    }

    const rows = await db.recurringNeed.findMany({
      where,
      include: INCLUDE,
      orderBy: { nextDueAt: "asc" },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/recurring-needs (ADMIN | VOLUNTEER) — register a beneficiary's standing need
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = req.body as Record<string, unknown>;

    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    const itemId = String(body.itemId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    if (!itemId) throw new ApiError("itemId is required", 400);

    const beneficiary = await db.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary) {
      log.warn("recurring_need_beneficiary_not_found", { beneficiaryId, actor: session.userId });
      throw new ApiError("Beneficiary not found", 404);
    }
    const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) {
      log.warn("recurring_need_item_not_found", { itemId, actor: session.userId });
      throw new ApiError("Inventory item not found", 404);
    }

    const cycle = String(body.cycle ?? "MONTHLY").trim().toUpperCase();
    if (!CYCLES.includes(cycle)) throw new ApiError("Invalid cycle", 400);

    const qtyPerCycle = Math.max(1, Math.trunc(Number(body.qtyPerCycle) || 1));
    const startDate = body.startDate ? new Date(String(body.startDate)) : new Date();
    if (Number.isNaN(startDate.getTime())) throw new ApiError("Invalid startDate", 400);

    const row = await db.recurringNeed.create({
      data: {
        beneficiaryId,
        itemId,
        qtyPerCycle,
        cycle,
        reason: body.reason ? String(body.reason).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
        startDate,
        nextDueAt: startDate,
      },
      include: INCLUDE,
    });

    log.info("recurring_need_created", {
      recurringNeedId: row.id,
      beneficiaryId,
      itemId,
      cycle,
      qtyPerCycle,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CREATE",
      "RecurringNeed",
      `${beneficiary.name} → ${item.name} ×${qtyPerCycle}/${cycle}`,
      session.userId
    );

    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/recurring-needs/:id (ADMIN | VOLUNTEER) — edit qty/cycle, pause/resume/complete
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const existing = await db.recurringNeed.findUnique({ where: { id } });
    if (!existing) {
      log.warn("recurring_need_update_not_found", { recurringNeedId: id, actor: session.userId });
      throw new ApiError("Recurring need not found", 404);
    }

    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      data.status = status;
    }
    if (body.cycle !== undefined) {
      const cycle = String(body.cycle).trim().toUpperCase();
      if (!CYCLES.includes(cycle)) throw new ApiError("Invalid cycle", 400);
      data.cycle = cycle;
    }
    if (body.qtyPerCycle !== undefined) {
      const q = Math.max(1, Math.trunc(Number(body.qtyPerCycle) || 1));
      data.qtyPerCycle = q;
    }
    if (body.nextDueAt !== undefined) {
      const d = new Date(String(body.nextDueAt));
      if (Number.isNaN(d.getTime())) throw new ApiError("Invalid nextDueAt", 400);
      data.nextDueAt = d;
    }
    if (body.reason !== undefined) data.reason = body.reason ? String(body.reason).trim() : null;
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const row = await db.recurringNeed.update({
      where: { id },
      data,
      include: {
        beneficiary: { select: { id: true, name: true } },
        item: { select: { id: true, name: true, unit: true } },
      },
    });

    log.info("recurring_need_updated", {
      recurringNeedId: id,
      fields: Object.keys(data),
      ...(data.status ? { newStatus: data.status } : {}),
      actor: session.userId,
    });
    await logActivity(session.name, "UPDATE", "RecurringNeed", JSON.stringify(data), session.userId);
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/recurring-needs/:id (ADMIN only) — cancel a standing need
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.recurringNeed.findUnique({ where: { id } });
    if (!existing) {
      log.warn("recurring_need_delete_not_found", { recurringNeedId: id, actor: session.userId });
      throw new ApiError("Recurring need not found", 404);
    }

    await db.recurringNeed.delete({ where: { id } });
    log.info("recurring_need_deleted", { recurringNeedId: id, actor: session.userId });
    await logActivity(session.name, "DELETE", "RecurringNeed", id, session.userId);
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
