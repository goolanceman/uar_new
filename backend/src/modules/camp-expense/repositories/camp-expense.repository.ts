/**
 * Prisma implementation of the camp expense repository — the ONLY place in
 * the camp-expense module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CampExpenseRepository,
  CampExpenseRow,
  CampExpenseTotals,
  CampExpenseWhere,
  CampOption,
  CreatedCampExpense,
} from "./camp-expense.repository.interface";

export class PrismaCampExpenseRepository implements CampExpenseRepository {
  async countExpenses(where: CampExpenseWhere): Promise<number> {
    return db.campExpense.count({ where });
  }

  async listExpenses(where: CampExpenseWhere, skip: number, take: number): Promise<CampExpenseRow[]> {
    const rows = await db.campExpense.findMany({
      where,
      include: { camp: { select: { id: true, code: true, title: true, city: true } } },
      orderBy: { spentAt: "desc" },
      skip,
      take,
    });
    return rows as CampExpenseRow[];
  }

  async aggregateTotals(where: CampExpenseWhere): Promise<CampExpenseTotals> {
    const agg = await db.campExpense.aggregate({ where, _sum: { amount: true }, _count: true });
    return { amount: agg._sum.amount ?? 0, count: agg._count };
  }

  async findCampById(id: string): Promise<CampOption | null> {
    return db.medicalCamp.findUnique({
      where: { id },
      select: { id: true, code: true, title: true },
    });
  }

  async createExpense(
    data: { campId: string; head: string; amount: number; notes: string | null; spentByName: string | null }
  ): Promise<CreatedCampExpense> {
    // campId carries a FK to MedicalCamp — wrapped per the repository contract.
    return mapPrismaError(() =>
      db.campExpense.create({
        data,
        include: { camp: { select: { id: true, code: true, title: true } } },
      }) as Promise<CreatedCampExpense>
    );
  }
}
