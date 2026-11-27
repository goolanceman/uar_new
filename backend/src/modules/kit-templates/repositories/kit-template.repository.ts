/**
 * Prisma implementation of the kit template repository — the ONLY place in
 * the kit-templates module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  KitTemplateCreateData,
  KitTemplateRepository,
  KitTemplateRow,
  KitTemplateUpdateData,
  KitTemplateWithCounts,
} from "./kit-template.repository.interface";

export class PrismaKitTemplateRepository implements KitTemplateRepository {
  async list(): Promise<KitTemplateWithCounts[]> {
    return db.kitTemplate.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { batches: true } } },
    });
  }

  async findById(id: string): Promise<KitTemplateRow | null> {
    return db.kitTemplate.findUnique({ where: { id } });
  }

  async findByIdWithBatchCount(id: string): Promise<KitTemplateWithCounts | null> {
    return db.kitTemplate.findUnique({
      where: { id },
      include: { _count: { select: { batches: true } } },
    });
  }

  async create(data: KitTemplateCreateData): Promise<KitTemplateRow> {
    // Unique-violation guarded (code races).
    return mapPrismaError(() =>
      db.kitTemplate.create({
        data: {
          code: data.code,
          name: data.name,
          kind: data.kind,
          codePrefix: data.codePrefix,
          description: data.description,
          image: data.image,
          items: JSON.stringify(data.items),
          costPerUnit: data.costPerUnit,
          status: data.status,
        },
      })
    );
  }

  async update(id: string, data: KitTemplateUpdateData): Promise<KitTemplateRow> {
    // P2025/FK-guarded (delete race).
    return mapPrismaError(() => {
      const { items, ...rest } = data;
      return db.kitTemplate.update({
        where: { id },
        data: {
          ...rest,
          ...(items !== undefined ? { items: JSON.stringify(items) } : {}),
        },
      });
    });
  }

  async remove(id: string): Promise<void> {
    // P2025-guarded (delete race).
    await mapPrismaError(() => db.kitTemplate.delete({ where: { id } }));
  }
}
