/**
 * Prisma implementation of the food pledge repository — the ONLY place in
 * the food module that touches FoodDonationPledge models directly (the
 * receive flow's batch/stock writes live in the inventory repository).
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  FoodPledgeRepository,
  NotificationCreateData,
  PledgeClaimData,
  PledgeCreateData,
} from "./food-pledge.repository.interface";

export class PrismaFoodPledgeRepository implements FoodPledgeRepository {
  async listPledgesByUser(userId: string) {
    return db.foodDonationPledge.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async listPledges(status?: string | null) {
    return db.foodDonationPledge.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async findPledgeById(id: string) {
    return db.foodDonationPledge.findUnique({ where: { id } });
  }

  async countPledges(): Promise<number> {
    return db.foodDonationPledge.count();
  }

  async findPledgeCodeOwner(code: string) {
    return db.foodDonationPledge.findUnique({ where: { code }, select: { code: true } });
  }

  async findDuplicatePledge(phone: string, items: string, since: Date) {
    return db.foodDonationPledge.findFirst({
      where: {
        phone,
        status: "PENDING",
        items,
        createdAt: { gte: since },
      },
      select: { code: true },
    });
  }

  async createPledge(data: PledgeCreateData) {
    return mapPrismaError(() => db.foodDonationPledge.create({ data }));
  }

  async createNotification(data: NotificationCreateData): Promise<void> {
    await db.notification.create({ data });
  }

  async claimPledgeStatus(id: string, fromStatus: string, data: PledgeClaimData, client?: DbClient): Promise<number> {
    const result = await (client ?? db).foodDonationPledge.updateMany({
      where: { id, status: fromStatus },
      data,
    });
    return result.count;
  }

  async findPledgeByIdOrThrow(id: string, client?: DbClient) {
    return (client ?? db).foodDonationPledge.findUniqueOrThrow({ where: { id } });
  }
}
