/**
 * Camp expense service — business rules for medical-camp expenses. Depends on
 * the repository contract, throws application errors, never touches HTTP.
 *
 * The create validation reproduces the legacy route's exact check order
 * (campId → camp lookup → head → amount) including the warn log emitted
 * between the DB lookup and the 404, so wire behavior is byte-identical.
 */
import { logger } from "@/lib/logger";
import { ApiError, logActivity, type Session } from "@/lib/session";
import type {
  CampExpenseRepository,
  CampExpenseRow,
  CampExpenseTotals,
  CampExpenseWhere,
  CreatedCampExpense,
} from "../repositories/camp-expense.repository.interface";

const log = logger.child("camp-expenses");

export interface CampExpenseList {
  items: CampExpenseRow[];
  total: number;
  page: number;
  pages: number;
  totals: CampExpenseTotals;
}

/** Legacy optText: undefined/null/whitespace-only collapse to null. */
function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export class CampExpenseService {
  constructor(private readonly campExpenseRepository: CampExpenseRepository) {}

  /** GET /api/camp-expenses?campId= — paged list; with a totals block for the camp filter. */
  async list(query: { page: number; limit: number; campId: string | null }): Promise<CampExpenseList> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const where: CampExpenseWhere = {};
    if (query.campId) where.campId = query.campId;

    const [total, items, totals] = await Promise.all([
      this.campExpenseRepository.countExpenses(where),
      this.campExpenseRepository.listExpenses(where, skip, limit),
      this.campExpenseRepository.aggregateTotals(where),
    ]);

    return {
      items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      totals: { amount: totals.amount, count: totals.count },
    };
  }

  /** POST /api/camp-expenses — { campId, head, amount, notes? } with the legacy check order. */
  async create(session: Session, rawBody: Record<string, unknown> | null | undefined): Promise<CreatedCampExpense> {
    const body = rawBody ?? {};

    const campId = String(body?.campId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    const camp = await this.campExpenseRepository.findCampById(campId);
    if (!camp) {
      log.warn("camp_expense_camp_not_found", { campId, actor: session.userId });
      throw new ApiError("Camp not found", 404);
    }

    const head = optText(body?.head);
    if (!head) throw new ApiError("head is required", 400);

    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("amount must be greater than zero", 400);

    const expense = await this.campExpenseRepository.createExpense({
      campId,
      head,
      amount,
      notes: optText(body?.notes),
      spentByName: session.name,
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

    return expense;
  }
}
