/**
 * Camp expense routes — /api/camp-expenses
 * Converted 1:1 from src/app/api/camp-expenses/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const log = logger.child("camp-expenses");

function pageParams(url: URL, defLimit = 50) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || defLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// GET /api/camp-expenses?campId= — ADMIN. When campId is given the envelope
// carries a totals block for that camp.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    const campId = url.searchParams.get("campId");
    if (campId) where.campId = campId;

    const [total, items, agg] = await Promise.all([
      db.campExpense.count({ where }),
      db.campExpense.findMany({
        where,
        include: { camp: { select: { id: true, code: true, title: true, city: true } } },
        orderBy: { spentAt: "desc" },
        skip,
        take: limit,
      }),
      db.campExpense.aggregate({ where, _sum: { amount: true }, _count: true }),
    ]);

    return json(res, {
      items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      totals: { amount: agg._sum.amount ?? 0, count: agg._count },
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/camp-expenses — ADMIN. { campId, head, amount, notes? }
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const campId = String(body?.campId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    const camp = await db.medicalCamp.findUnique({
      where: { id: campId },
      select: { id: true, code: true, title: true },
    });
    if (!camp) {
      log.warn("camp_expense_camp_not_found", { campId, actor: session.userId });
      throw new ApiError("Camp not found", 404);
    }

    const head = optText(body?.head);
    if (!head) throw new ApiError("head is required", 400);

    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("amount must be greater than zero", 400);

    const expense = await db.campExpense.create({
      data: {
        campId,
        head,
        amount,
        notes: optText(body?.notes),
        spentByName: session.name,
      },
      include: { camp: { select: { id: true, code: true, title: true } } },
    });

    log.info("camp_expense_created", {
      expenseId: expense.id,
      campId,
      head,
      amount,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "EXPENSE_ADD",
      "CAMP_EXPENSE",
      `${camp.code} — ${head}: ${amount}`,
      session.userId
    );

    return json(res, expense, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
