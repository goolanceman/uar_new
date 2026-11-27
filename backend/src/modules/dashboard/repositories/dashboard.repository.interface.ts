/**
 * Dashboard repository contract — read models for the root /api snapshot.
 */
export interface DashboardStats {
  totalDonations: number;
  beneficiaries: number;
  activeCampaigns: number;
  volunteers: number;
  inventoryItems: number;
}

export interface DashboardRepository {
  sumCompletedDonations(): Promise<number>;
  countActiveBeneficiaries(): Promise<number>;
  countActiveCampaigns(): Promise<number>;
  countActiveVolunteers(): Promise<number>;
  sumInventoryQuantity(): Promise<number>;
}
