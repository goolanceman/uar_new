/**
 * Prisma implementation of the dashboard read models.
 */
import { db } from "@/infrastructure/database/prisma";
import type { DashboardRepository } from "./dashboard.repository.interface";

export class PrismaDashboardRepository implements DashboardRepository {
  async sumCompletedDonations(): Promise<number> {
    const agg = await db.donation.aggregate({
      _sum: { amount: true },
      where: { paymentStatus: "COMPLETED" },
    });
    return agg._sum.amount || 0;
  }

  async countActiveBeneficiaries(): Promise<number> {
    return db.beneficiary.count({ where: { isActive: true } });
  }

  async countActiveCampaigns(): Promise<number> {
    return db.campaign.count({ where: { status: "ACTIVE" } });
  }

  async countActiveVolunteers(): Promise<number> {
    return db.volunteer.count({ where: { status: "ACTIVE" } });
  }

  async sumInventoryQuantity(): Promise<number> {
    const agg = await db.inventoryItem.aggregate({ _sum: { quantity: true } });
    return agg._sum.quantity || 0;
  }
}
