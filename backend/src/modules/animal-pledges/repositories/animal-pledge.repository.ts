/**
 * Prisma implementation of the animal pledge repository — the ONLY place in
 * the animal-pledges module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  AnimalPledgeRepository,
  AnimalPledgeRow,
  AnimalPledgeUpdateData,
} from "./animal-pledge.repository.interface";

export class PrismaAnimalPledgeRepository implements AnimalPledgeRepository {
  async findPledgeById(id: string): Promise<AnimalPledgeRow | null> {
    return db.animalPledge.findUnique({ where: { id } });
  }

  async findAnimalById(id: string): Promise<{ id: string } | null> {
    return db.animal.findUnique({ where: { id }, select: { id: true } });
  }

  async updatePledge(id: string, data: AnimalPledgeUpdateData): Promise<AnimalPledgeRow> {
    // animalId is an FK — a stale id could raise a constraint violation.
    return mapPrismaError(() => db.animalPledge.update({ where: { id }, data }));
  }

  async deletePledge(id: string): Promise<void> {
    await db.animalPledge.delete({ where: { id } });
  }
}
