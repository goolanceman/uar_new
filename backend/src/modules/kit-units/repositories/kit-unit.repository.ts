/**
 * Prisma implementation of the kit unit repository — the ONLY place in the
 * kit-units module that touches Prisma models directly. (Read-only list: no
 * unique/FK violation risk, so no mapPrismaError wrap.)
 */
import { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import type { KitUnitListFilter, KitUnitRepository, KitUnitWithBatch } from "./kit-unit.repository.interface";

export class PrismaKitUnitRepository implements KitUnitRepository {
  async list(filter: KitUnitListFilter): Promise<KitUnitWithBatch[]> {
    const where: Prisma.KitUnitWhereInput = {};
    if (filter.batchId) where.batchId = filter.batchId;
    if (filter.status) where.status = filter.status;
    if (filter.q) where.code = { contains: filter.q };
    if (filter.scannedById) where.scannedById = filter.scannedById;

    const units = await db.kitUnit.findMany({
      where,
      orderBy: { code: "asc" },
      take: filter.limit,
      include: {
        batch: { select: { name: true, template: { select: { name: true } } } },
      },
    });
    return units as KitUnitWithBatch[];
  }
}
