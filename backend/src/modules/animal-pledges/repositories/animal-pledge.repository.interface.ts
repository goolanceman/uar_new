/**
 * Animal pledge repository contract — persistence operations for animal
 * welfare pledges. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface AnimalPledgeRow {
  id: string;
  animalId: string | null;
  shelterFund: string | null;
  donorId: string | null;
  donorName: string;
  kind: string;
  amount: number;
  frequency: string;
  status: string;
  createdAt: Date;
}

export interface AnimalPledgeUpdateData {
  status?: string;
  donorName?: string;
  amount?: number;
  kind?: string;
  frequency?: string;
  shelterFund?: string | null;
  animalId?: string | null;
}

export interface AnimalPledgeRepository {
  findPledgeById(id: string): Promise<AnimalPledgeRow | null>;
  findAnimalById(id: string): Promise<{ id: string } | null>;
  updatePledge(id: string, data: AnimalPledgeUpdateData): Promise<AnimalPledgeRow>;
  deletePledge(id: string): Promise<void>;
}
