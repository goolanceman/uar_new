/**
 * Prisma implementation of the testimonial repository — the ONLY place in
 * the testimonials module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  TestimonialCreateData,
  TestimonialRepository,
  TestimonialRow,
  TestimonialUpdateData,
} from "./testimonial.repository.interface";

export class PrismaTestimonialRepository implements TestimonialRepository {
  async findWall(): Promise<TestimonialRow[]> {
    return db.testimonial.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
    });
  }

  async findById(id: string): Promise<TestimonialRow | null> {
    return db.testimonial.findUnique({ where: { id } });
  }

  async create(data: TestimonialCreateData): Promise<TestimonialRow> {
    return mapPrismaError(() => db.testimonial.create({ data }));
  }

  async update(id: string, data: TestimonialUpdateData): Promise<TestimonialRow> {
    return mapPrismaError(() => db.testimonial.update({ where: { id }, data }));
  }

  async delete(id: string): Promise<void> {
    await db.testimonial.delete({ where: { id } });
  }
}
