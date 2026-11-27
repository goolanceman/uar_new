/**
 * Inventory forecast repository contract — read model of ACTIVE recurring
 * needs with their master item and beneficiary for the stockout forecast.
 */
export interface ForecastItemSnapshot {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  minStock: number;
}

export interface ForecastBeneficiarySnapshot {
  id: string;
  name: string;
}

export interface ForecastNeedRow {
  id: string;
  itemId: string;
  beneficiaryId: string;
  qtyPerCycle: number;
  cycle: string;
  nextDueAt: Date;
  item: ForecastItemSnapshot;
  beneficiary: ForecastBeneficiarySnapshot;
}

export interface InventoryForecastRepository {
  /** Every ACTIVE recurring need with item + beneficiary snapshots. */
  listActiveNeeds(): Promise<ForecastNeedRow[]>;
}
