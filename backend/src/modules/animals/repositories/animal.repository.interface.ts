/**
 * Animal repository contract — persistence operations for animals, pledges
 * and reactions. The service layer depends on this interface, never on
 * Prisma directly.
 */
import type { Animal, AnimalPledge, AnimalReaction, Prisma } from "@prisma/client";

/** Animal row with its pledges included (list / get / create / update wire). */
export type AnimalWithPledges = Prisma.AnimalGetPayload<{ include: { pledges: true } }>;

/** Reaction row with the compact animal embed (name + species). */
export type ReactionWithAnimal = Prisma.AnimalReactionGetPayload<{
  include: { animal: { select: { name: true; species: true } } };
}>;

/** Pledge row with the compact animal embed (optional relation — may be null). */
export type AnimalPledgeWithAnimal = Prisma.AnimalPledgeGetPayload<{
  include: { animal: { select: { name: true; species: true } } };
}>;

/** One per-animal emoji-count row from the groupBy. */
export interface ReactionCountRow {
  animalId: string;
  emoji: string;
  _count: {
    emoji: number;
  };
}

/** Optional list filter for GET /api/animals (species/status/q). */
export interface AnimalListFilter {
  species?: string;
  status?: string;
  q?: string;
}

/** Optional list filter for GET /api/animals/pledges (mine / ?animalId=). */
export interface PledgeListFilter {
  donorId?: string;
  animalId?: string;
}

/** Scalar create payload for a new animal (code included). */
export type AnimalCreateData = Omit<Prisma.AnimalCreateInput, "pledges" | "reactions">;

/** Scalar patch payload for an animal update — every field optional. */
export type AnimalUpdateData = {
  name?: string;
  species?: string;
  breed?: string | null;
  ageMonths?: number;
  gender?: string;
  story?: string;
  photos?: string | null;
  healthStatus?: string | null;
  vaccinated?: boolean;
  sterilized?: boolean;
  location?: string;
  monthlyFood?: number;
  adoptedByName?: string | null;
  adoptedById?: string | null;
  status?: string;
};

export interface AnimalRepository {
  listAnimals(filter: AnimalListFilter): Promise<Animal[]>;
  findAnimalById(id: string): Promise<Animal | null>;
  findAnimalWithPledges(id: string): Promise<AnimalWithPledges | null>;
  createAnimal(data: AnimalCreateData): Promise<AnimalWithPledges>;
  updateAnimal(id: string, data: AnimalUpdateData): Promise<AnimalWithPledges>;
  deleteAnimal(id: string): Promise<void>;
  deletePledgesOfAnimal(animalId: string): Promise<void>;

  createPledge(data: {
    animalId: string | null;
    shelterFund: string | null;
    donorId: string | null;
    donorName: string;
    kind: string;
    amount: number;
    frequency: string;
    status: string;
  }): Promise<AnimalPledge>;
  listPledges(filter: PledgeListFilter): Promise<AnimalPledgeWithAnimal[]>;

  listReactions(
    animalId: string | undefined,
    limit: number
  ): Promise<{ reactions: ReactionWithAnimal[]; counts: ReactionCountRow[] }>;
  createReaction(data: {
    animalId: string;
    userId: string | null;
    userName: string;
    emoji: string;
    message: string | null;
  }): Promise<AnimalReaction>;
}
