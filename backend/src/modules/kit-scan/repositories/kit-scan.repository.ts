/**
 * Prisma implementation of the kit scan repository — the ONLY place in the
 * kit-scan module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  KitBatchRow,
  KitScanRepository,
  KitUnitRow,
  KitUnitWithBatch,
} from "./kit-scan.repository.interface";

export class PrismaKitScanRepository implements KitScanRepository {
  async findUnitByCode(code: string): Promise<KitUnitWithBatch | null> {
    const unit = await db.kitUnit.findUnique({
      where: { code },
      include: { batch: true },
    });
    return (unit as KitUnitWithBatch) ?? null;
  }

  async markUnitScanned(
    id: string,
    data: {
      status: string;
      scannedAt: Date;
      scannedById: string | null;
      scannedByName: string | null;
      location: string | null;
    }
  ): Promise<KitUnitRow> {
    // Update-by-id with no unique/FK-bearing fields, wrapped for parity with
    // the repository contract (P2025 maps to the same 500 the raw Prisma
    // error produced).
    return mapPrismaError(() => db.kitUnit.update({ where: { id }, data }) as Promise<KitUnitRow>);
  }

  async updateBatch(id: string, data: { scannedUnits: number; status: string }): Promise<KitBatchRow> {
    return mapPrismaError(() => db.kitBatch.update({ where: { id }, data }) as Promise<KitBatchRow>);
  }
}
