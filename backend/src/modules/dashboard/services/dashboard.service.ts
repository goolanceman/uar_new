/**
 * Dashboard service — assembles the public root snapshot. No HTTP concerns.
 */
import { logger } from "@/lib/logger";
import type { DashboardRepository, DashboardStats } from "../repositories/dashboard.repository.interface";

const log = logger.child("dashboard");

export class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  async getSnapshot(): Promise<DashboardStats> {
    const [totalDonations, beneficiaries, activeCampaigns, volunteers, inventoryItems] =
      await Promise.all([
        this.dashboardRepository.sumCompletedDonations(),
        this.dashboardRepository.countActiveBeneficiaries(),
        this.dashboardRepository.countActiveCampaigns(),
        this.dashboardRepository.countActiveVolunteers(),
        this.dashboardRepository.sumInventoryQuantity(),
      ]);
    return { totalDonations, beneficiaries, activeCampaigns, volunteers, inventoryItems };
  }
}

/** Renders the snapshot with the legacy "failed" log event + message. */
export function logSnapshotFailure(error: unknown): void {
  log.error("dashboard_stats_failed", {
    error: error instanceof Error ? error : String(error),
  });
}
