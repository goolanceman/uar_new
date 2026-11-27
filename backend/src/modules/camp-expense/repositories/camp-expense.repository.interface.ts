/**
 * Camp expense repository contract — persistence operations for medical-camp
 * expenses. The service layer depends on this interface, never on Prisma
 * directly.
 */
export interface CampSnapshot {
  id: string;
  code: string;
  title: string;
  city: string | null;
}

export interface CampExpenseRow {
  id: string;
  campId: string;
  head: string;
  amount: number;
  notes: string | null;
  spentByName: string | null;
  spentAt: Date;
  camp: CampSnapshot;
}

export interface CampOption {
  id: string;
  code: string;
  title: string;
}

export interface CreatedCampExpense {
  id: string;
  campId: string;
  head: string;
  amount: number;
  notes: string | null;
  spentByName: string | null;
  spentAt: Date;
  camp: {
    id: string;
    code: string;
    title: string;
  };
}

export interface CampExpenseTotals {
  amount: number;
  count: number;
}

/** Legacy where-clause: campId present only when a truthy one was supplied. */
export interface CampExpenseWhere {
  campId?: string;
}

export interface CampExpenseRepository {
  countExpenses(where: CampExpenseWhere): Promise<number>;
  listExpenses(where: CampExpenseWhere, skip: number, take: number): Promise<CampExpenseRow[]>;
  aggregateTotals(where: CampExpenseWhere): Promise<CampExpenseTotals>;
  findCampById(id: string): Promise<CampOption | null>;
  createExpense(
    data: { campId: string; head: string; amount: number; notes: string | null; spentByName: string | null }
  ): Promise<CreatedCampExpense>;
}
