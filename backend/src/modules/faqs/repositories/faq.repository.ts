/**
 * Prisma implementation of the FAQ repository — the ONLY place in the faqs
 * module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  FaqRepository,
  FaqRow,
  FaqTypeRow,
  FaqTypeWithFaqs,
} from "./faq.repository.interface";

export class PrismaFaqRepository implements FaqRepository {
  async findTypeByTitle(title: string): Promise<FaqTypeRow | null> {
    return db.faqType.findFirst({ where: { title, isDeleted: 0 } });
  }

  async findTypeById(id: number): Promise<FaqTypeRow | null> {
    return db.faqType.findFirst({ where: { id, isDeleted: 0 } });
  }

  async createType(title: string): Promise<FaqTypeRow> {
    return mapPrismaError(() => db.faqType.create({ data: { title } }));
  }

  async updateType(id: number, title: string): Promise<FaqTypeRow> {
    return mapPrismaError(() => db.faqType.update({ where: { id }, data: { title } }));
  }

  async softDeleteType(id: number): Promise<void> {
    await db.faqType.update({ where: { id }, data: { isDeleted: 1 } });
  }

  /** Hard-deletes the questions belonging to a type (legacy type-delete behavior). */
  async deleteFaqsOfType(typeId: number): Promise<number> {
    const result = await db.faq.deleteMany({ where: { faqsTypeId: typeId } });
    return result.count;
  }

  async findFaqById(id: number): Promise<FaqRow | null> {
    return db.faq.findUnique({ where: { id } });
  }

  async createFaq(data: { faqsTypeId: number; question: string; answer: string }): Promise<FaqRow> {
    return db.faq.create({ data });
  }

  async updateFaq(
    id: number,
    data: Partial<{ question: string; answer: string; faqsTypeId: number }>
  ): Promise<FaqRow> {
    return mapPrismaError(() => db.faq.update({ where: { id }, data }));
  }

  async deleteFaq(id: number): Promise<void> {
    await db.faq.delete({ where: { id } });
  }

  async listTypesWithFaqs(skip: number, limit: number): Promise<{ rows: FaqTypeWithFaqs[]; total: number }> {
    const where = { isDeleted: 0 };
    const [types, total] = await Promise.all([
      db.faqType.findMany({
        where,
        include: { faqs: true },
        orderBy: { id: "asc" },
        skip,
        take: limit,
      }),
      db.faqType.count({ where }),
    ]);
    return { rows: types as FaqTypeWithFaqs[], total };
  }
}
