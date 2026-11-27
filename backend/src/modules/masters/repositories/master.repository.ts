/**
 * Prisma implementation of the master repository — the ONLY place in the
 * masters module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  MasterRepository,
  MasterRow,
  MasterUpdateData,
  MasterUpsertData,
} from "./master.repository.interface";

export class PrismaMasterRepository implements MasterRepository {
  /** ?categories=1 — distinct category strings, alphabetical. */
  async listDistinctCategories(): Promise<Array<{ category: string }>> {
    return db.master.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
  }

  /** ?all=1 — every master row, category then sortOrder. */
  async listAll(): Promise<MasterRow[]> {
    return db.master.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
  }

  /** ?category=X — active {value,label}[] ordered by sortOrder. */
  async listByCategory(category: string): Promise<Array<{ value: string; label: string }>> {
    return db.master.findMany({
      where: { category, active: true },
      orderBy: { sortOrder: "asc" },
      select: { value: true, label: true },
    });
  }

  async findById(id: string): Promise<MasterRow | null> {
    return db.master.findUnique({ where: { id } });
  }

  async findByCategoryValue(category: string, value: string): Promise<MasterRow | null> {
    return db.master.findUnique({
      where: { category_value: { category, value } },
    });
  }

  /** Upsert by the (category, value) unique key — wrapped per the unique/FK
   *  violation rule (a concurrent upsert surfaces as a 409, not a raw
   *  Prisma 500). */
  async upsert(data: MasterUpsertData): Promise<MasterRow> {
    return mapPrismaError(() =>
      db.master.upsert({
        where: { category_value: { category: data.category, value: data.value } },
        update: {
          label: data.label,
          sortOrder: data.sortOrder,
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
        create: { category: data.category, value: data.value, label: data.label, sortOrder: data.sortOrder },
      })
    );
  }

  /** PATCH can change the (category, value) unique member — wrapped per the
   *  unique-violation rule (a concurrent rename surfaces as a 409). */
  async update(id: string, data: MasterUpdateData): Promise<MasterRow> {
    return mapPrismaError(() => db.master.update({ where: { id }, data }));
  }

  /** Nothing references Master (no incoming FK) — plain delete, exactly like
   *  the wave-1 exemplars' deletes. */
  async delete(id: string): Promise<void> {
    await db.master.delete({ where: { id } });
  }
}
