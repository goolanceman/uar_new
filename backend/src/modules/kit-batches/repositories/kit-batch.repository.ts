/**
 * Prisma implementation of the kit batch repository — the ONLY place in the
 * kit-batches module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  BatchBuildPlan,
  KitBatchRepository,
  KitBatchRow,
  KitBatchTemplateSummary,
  KitBatchWithTemplate,
  StockAssertion,
} from "./kit-batch.repository.interface";

const BATCH_INCLUDE = {
  template: { select: { name: true, kind: true, codePrefix: true, costPerUnit: true, items: true } },
  _count: { select: { units: true } },
} as const;

export class PrismaKitBatchRepository implements KitBatchRepository {
  async listBatches(status?: string): Promise<KitBatchWithTemplate[]> {
    const batches = await db.kitBatch.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: BATCH_INCLUDE,
    });
    return batches as KitBatchWithTemplate[];
  }

  async findTemplateById(id: string): Promise<KitBatchTemplateSummary | null> {
    return db.kitTemplate.findUnique({ where: { id } });
  }

  async countKitUnits(): Promise<number> {
    return db.kitUnit.count();
  }

  async findUnitCodeClash(codes: string[]): Promise<{ code: string } | null> {
    return db.kitUnit.findFirst({
      where: { code: { in: codes } },
      orderBy: { code: "desc" },
      select: { code: true },
    });
  }

  async findBatchById(id: string): Promise<KitBatchRow | null> {
    return db.kitBatch.findUnique({ where: { id } });
  }

  async findBatchWithTemplate(id: string): Promise<KitBatchWithTemplate | null> {
    return db.kitBatch.findUnique({
      where: { id },
      include: BATCH_INCLUDE,
    }) as Promise<KitBatchWithTemplate | null>;
  }

  /**
   * Building a batch draws its template's component list from the master
   * inventory (totalUnits × qty per unit) — short of stock, the batch isn't
   * created at all (assertStock throws inside the transaction). Components
   * with no inventory match are skipped (legacy free-text templates may not
   * map 1:1 to the master). unit codes are unique and templateId an FK — the
   * transaction maps those to 409s instead of raw 500s.
   */
  async createBatchWithUnits(plan: BatchBuildPlan, assertStock: StockAssertion): Promise<KitBatchRow> {
    return mapPrismaError(() =>
      db.$transaction(async (tx) => {
        for (const line of plan.lines) {
          // Prefer the explicit itemId saved by the template composer; fall
          // back to name matching for legacy free-text templates that predate
          // itemId linking.
          const q = line.name.toLowerCase();
          const match =
            (line.itemId ? await tx.inventoryItem.findUnique({ where: { id: line.itemId } }) : null) ??
            (line.name ? await tx.inventoryItem.findFirst({ where: { name: { equals: line.name } } }) : null) ??
            (line.name ? await tx.inventoryItem.findFirst({ where: { name: { contains: q } } }) : null);
          if (!match) continue;
          assertStock(
            { id: match.id, name: match.name, unit: match.unit, quantity: match.quantity },
            line.needed
          );
          await tx.inventoryItem.update({
            where: { id: match.id },
            data: { quantity: match.quantity - line.needed },
          });
          await tx.inventoryDistribution.create({
            data: {
              itemId: match.id,
              quantity: line.needed,
              notes: `Consumed building kit batch "${plan.name}" (${plan.templateName})`,
            },
          });
        }

        const created = await tx.kitBatch.create({
          data: {
            templateId: plan.templateId,
            name: plan.name,
            totalUnits: plan.totalUnits,
            instructions: plan.instructions,
            status: "READY",
          },
        });
        await tx.kitUnit.createMany({
          data: plan.codes.map((code) => ({ batchId: created.id, code })),
        });
        return created;
      })
    );
  }

  async update(id: string, data: { name?: string; instructions?: string | null }): Promise<KitBatchRow> {
    return db.kitBatch.update({ where: { id }, data });
  }

  async deleteUnits(batchId: string): Promise<number> {
    const result = await db.kitUnit.deleteMany({ where: { batchId } });
    return result.count;
  }

  async delete(id: string): Promise<void> {
    await db.kitBatch.delete({ where: { id } });
  }
}
