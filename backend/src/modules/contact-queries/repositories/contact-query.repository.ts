/**
 * Prisma implementation of the contact query repository — the ONLY place in
 * the contact-queries module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { ContactQueryRepository, ContactQueryRow } from "./contact-query.repository.interface";
import type { Prisma } from "@prisma/client";

export class PrismaContactQueryRepository implements ContactQueryRepository {
  async list(status?: string): Promise<ContactQueryRow[]> {
    return db.contactQuery.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: {
    name: string;
    email: string;
    phone: string | null;
    subject: string;
    message: string;
    status: string;
  }): Promise<ContactQueryRow> {
    return db.contactQuery.create({ data });
  }

  async findById(id: string): Promise<ContactQueryRow | null> {
    return db.contactQuery.findUnique({ where: { id } });
  }

  async update(id: string, data: Prisma.ContactQueryUpdateInput): Promise<ContactQueryRow> {
    // P2025-guarded (delete race).
    return mapPrismaError(() => db.contactQuery.update({ where: { id }, data }));
  }

  async remove(id: string): Promise<void> {
    // P2025-guarded (delete race).
    await mapPrismaError(() => db.contactQuery.delete({ where: { id } }));
  }
}
