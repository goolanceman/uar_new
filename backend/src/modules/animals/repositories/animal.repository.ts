/**
 * Prisma implementation of the animal repository — the ONLY place in the
 * animals module that touches Prisma models directly.
 */
import { Prisma, type Animal, type AnimalPledge, type AnimalReaction } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type {
  AnimalCreateData,
  AnimalListFilter,
  AnimalPledgeWithAnimal,
  AnimalRepository,
  AnimalUpdateData,
  AnimalWithPledges,
  PledgeListFilter,
  ReactionCountRow,
  ReactionWithAnimal,
} from "./animal.repository.interface";

export class PrismaAnimalRepository implements AnimalRepository {
  async listAnimals(filter: AnimalListFilter): Promise<Animal[]> {
    const where: Prisma.AnimalWhereInput = {};
    if (filter.species) where.species = filter.species;
    if (filter.status) where.status = filter.status;
    if (filter.q)
      where.OR = [
        { name: { contains: filter.q } },
        { code: { contains: filter.q } },
        { location: { contains: filter.q } },
        { breed: { contains: filter.q } },
      ];
    return db.animal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        pledges: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  async findAnimalById(id: string): Promise<Animal | null> {
    return db.animal.findUnique({ where: { id } });
  }

  async findAnimalWithPledges(id: string): Promise<AnimalWithPledges | null> {
    return db.animal.findUnique({
      where: { id },
      include: { pledges: { orderBy: { createdAt: "desc" } } },
    });
  }

  async createAnimal(data: AnimalCreateData): Promise<AnimalWithPledges> {
    // code is unique — a counter race maps to the shared 409 instead of a
    // raw Prisma error.
    return mapPrismaError(() =>
      db.animal.create({
        data,
        include: { pledges: true },
      })
    );
  }

  async updateAnimal(id: string, data: AnimalUpdateData): Promise<AnimalWithPledges> {
    return db.animal.update({
      where: { id },
      data,
      include: { pledges: { orderBy: { createdAt: "desc" } } },
    });
  }

  async deleteAnimal(id: string): Promise<void> {
    await db.animal.delete({ where: { id } });
  }

  /** Legacy delete order: the pledges are emptied before the animal row. */
  async deletePledgesOfAnimal(animalId: string): Promise<void> {
    await db.animalPledge.deleteMany({ where: { animalId } });
  }

  async createPledge(data: {
    animalId: string | null;
    shelterFund: string | null;
    donorId: string | null;
    donorName: string;
    kind: string;
    amount: number;
    frequency: string;
    status: string;
  }): Promise<AnimalPledge> {
    // animalId is an FK — a stale id maps to the shared conflict error.
    return mapPrismaError(() => db.animalPledge.create({ data }));
  }

  async listPledges(filter: PledgeListFilter): Promise<AnimalPledgeWithAnimal[]> {
    const where: Prisma.AnimalPledgeWhereInput = {};
    if (filter.donorId) where.donorId = filter.donorId;
    if (filter.animalId) where.animalId = filter.animalId;
    return db.animalPledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { animal: { select: { name: true, species: true } } },
    });
  }

  async listReactions(
    animalId: string | undefined,
    limit: number
  ): Promise<{ reactions: ReactionWithAnimal[]; counts: ReactionCountRow[] }> {
    const reactions = await db.animalReaction.findMany({
      where: animalId ? { animalId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { animal: { select: { name: true, species: true } } },
    });

    // Per-animal emoji counts (for the whole adopted wall, or for one animal)
    const counts = await db.animalReaction.groupBy({
      by: ["animalId", "emoji"],
      _count: { emoji: true },
      where: animalId ? { animalId } : undefined,
    });

    return { reactions, counts: counts as unknown as ReactionCountRow[] };
  }

  async createReaction(data: {
    animalId: string;
    userId: string | null;
    userName: string;
    emoji: string;
    message: string | null;
  }): Promise<AnimalReaction> {
    // animalId is an FK — a stale id maps to the shared conflict error.
    return mapPrismaError(() => db.animalReaction.create({ data }));
  }
}
