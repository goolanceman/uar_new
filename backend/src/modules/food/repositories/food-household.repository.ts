/**
 * Prisma implementation of the food household repository — the ONLY place in
 * the food module that touches Household/HouseholdMember models directly.
 * Legacy query shapes are reproduced verbatim.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  FoodHouseholdRepository,
  HouseholdCreateData,
  HouseholdListRow,
  HouseholdMemberCreateData,
  HouseholdUpdateData,
} from "./food-household.repository.interface";

/** GET /households include — head + members + registration count. */
const HOUSEHOLD_INCLUDE = {
  headBeneficiary: { select: { id: true, code: true, name: true } },
  members: true,
  _count: { select: { registrations: true } },
};

export class PrismaFoodHouseholdRepository implements FoodHouseholdRepository {
  async listHouseholds(q?: string | null): Promise<HouseholdListRow[]> {
    // Legacy where: q contains across name/code/primaryPhone/city.
    const where = q
      ? {
          OR: [
            { name: { contains: q } },
            { code: { contains: q } },
            { primaryPhone: { contains: q } },
            { city: { contains: q } },
          ],
        }
      : {};

    const rows = await db.household.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: HOUSEHOLD_INCLUDE,
    });
    return rows as HouseholdListRow[];
  }

  async findHouseholdById(id: string) {
    return db.household.findUnique({ where: { id } });
  }

  async findHouseholdWithCount(id: string) {
    return db.household.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });
  }

  async createHousehold(data: HouseholdCreateData, client: DbClient) {
    return mapPrismaError(() => client.household.create({ data }));
  }

  async createHouseholdMember(data: HouseholdMemberCreateData, client: DbClient) {
    return client.householdMember.create({ data });
  }

  async updateHousehold(id: string, data: HouseholdUpdateData, client: DbClient) {
    return mapPrismaError(() =>
      client.household.update({
        where: { id },
        data: data as import("@prisma/client").Prisma.HouseholdUncheckedUpdateInput,
      })
    );
  }

  async deleteHouseholdMembers(memberIds: string[], householdId: string, client: DbClient): Promise<void> {
    await client.householdMember.deleteMany({ where: { id: { in: memberIds }, householdId } });
  }

  async deleteHousehold(id: string): Promise<void> {
    await mapPrismaError(() => db.household.delete({ where: { id } }));
  }
}
