/**
 * Prisma implementation of the recurring-need repository — the ONLY place in
 * the recurring-needs module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  CreateRecurringNeedData,
  RecurringNeedListFilter,
  RecurringNeedRepository,
  RecurringNeedRow,
  RecurringNeedUpdated,
  RecurringNeedWithRelations,
  UpdateRecurringNeedData,
} from "./recurring-need.repository.interface";

/** Include used by the staff list and the create response (legacy shape). */
const FULL_INCLUDE = {
  beneficiary: { select: { id: true, name: true, city: true, category: true, urgencyLevel: true, isActive: true, caseStatus: true, verificationStatus: true } },
  item: { select: { id: true, name: true, unit: true, quantity: true, minStock: true } },
} as const;

export class PrismaRecurringNeedRepository implements RecurringNeedRepository {
  async findBeneficiaryById(id: string): Promise<{ id: string; name: string } | null> {
    return db.beneficiary.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  async findItemById(id: string): Promise<{ id: string; name: string } | null> {
    return db.inventoryItem.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  async findById(id: string): Promise<RecurringNeedRow | null> {
    return db.recurringNeed.findUnique({ where: { id } });
  }

  async list(filter: RecurringNeedListFilter): Promise<RecurringNeedWithRelations[]> {
    const rows = await db.recurringNeed.findMany({
      where: {
        ...(filter.beneficiaryId ? { beneficiaryId: filter.beneficiaryId } : {}),
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.dueByOrBefore ? { nextDueAt: { lte: filter.dueByOrBefore } } : {}),
      },
      include: FULL_INCLUDE,
      orderBy: { nextDueAt: "asc" },
    });
    return rows as RecurringNeedWithRelations[];
  }

  /** beneficiaryId/itemId are FKs — a stale id maps to a 409, not a raw 500. */
  async create(data: CreateRecurringNeedData): Promise<RecurringNeedWithRelations> {
    return mapPrismaError(() =>
      db.recurringNeed.create({ data, include: FULL_INCLUDE })
    );
  }

  async update(id: string, data: UpdateRecurringNeedData): Promise<RecurringNeedUpdated> {
    const row = await db.recurringNeed.update({
      where: { id },
      data,
      include: {
        beneficiary: { select: { id: true, name: true } },
        item: { select: { id: true, name: true, unit: true } },
      },
    });
    return row as RecurringNeedUpdated;
  }

  /** Distributions/sponsorships may reference the need — FK conflicts map to
   *  a 409 instead of a raw 500. */
  async remove(id: string): Promise<void> {
    await mapPrismaError(() => db.recurringNeed.delete({ where: { id } }));
  }
}
