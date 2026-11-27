/**
 * Inventory forecast service — aggregates ACTIVE recurring needs per master
 * item, normalises them to a monthly quantity, and compares against current
 * stock to flag shortfalls ("tablets need to go out monthly, do we have
 * enough in 30/60/90 days?"). Pure computation over the repository read
 * model — the legacy route's exact math, ordering, and response shape.
 */
import { monthlyEquivalent } from "@/lib/distribution-stock";
import type { InventoryForecastRepository, ForecastNeedRow } from "../repositories/inventory-forecast.repository.interface";

export interface ForecastEntry {
  itemId: string;
  name: string;
  unit: string;
  currentStock: number;
  minStock: number;
  monthlyRequired: number;
  beneficiaryCount: number;
  monthsOfCover: number | null;
  shortThisMonth: boolean;
  shortage: number;
}

export interface DueSoonEntry {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string;
  itemId: string;
  itemName: string;
  qtyPerCycle: number;
  unit: string;
  cycle: string;
  nextDueAt: Date;
  overdue: boolean;
  stockAvailable: boolean;
}

export interface InventoryForecast {
  forecast: ForecastEntry[];
  dueSoon: DueSoonEntry[];
  summary: {
    activeNeeds: number;
    itemsAtRisk: number;
    overdueCount: number;
  };
}

export class InventoryForecastService {
  constructor(private readonly inventoryForecastRepository: InventoryForecastRepository) {}

  async getForecast(): Promise<InventoryForecast> {
    const needs = await this.inventoryForecastRepository.listActiveNeeds();

    const byItem = new Map<
      string,
      {
        itemId: string;
        name: string;
        unit: string;
        currentStock: number;
        minStock: number;
        monthlyRequired: number;
        beneficiaryCount: Set<string>;
      }
    >();

    for (const n of needs) {
      const key = n.itemId;
      const monthly = monthlyEquivalent(n.qtyPerCycle, n.cycle);
      const row =
        byItem.get(key) ??
        {
          itemId: n.item.id,
          name: n.item.name,
          unit: n.item.unit,
          currentStock: n.item.quantity,
          minStock: n.item.minStock,
          monthlyRequired: 0,
          beneficiaryCount: new Set<string>(),
        };
      row.monthlyRequired += monthly;
      row.beneficiaryCount.add(n.beneficiaryId);
      byItem.set(key, row);
    }

    const forecast = Array.from(byItem.values())
      .map((r) => {
        const monthsOfCover = r.monthlyRequired > 0 ? r.currentStock / r.monthlyRequired : Infinity;
        return {
          itemId: r.itemId,
          name: r.name,
          unit: r.unit,
          currentStock: r.currentStock,
          minStock: r.minStock,
          monthlyRequired: Math.round(r.monthlyRequired * 100) / 100,
          beneficiaryCount: r.beneficiaryCount.size,
          monthsOfCover: Number.isFinite(monthsOfCover) ? Math.round(monthsOfCover * 10) / 10 : null,
          shortThisMonth: r.currentStock < r.monthlyRequired,
          shortage: Math.max(0, Math.round((r.monthlyRequired - r.currentStock) * 100) / 100),
        };
      })
      .sort((a, b) => (a.monthsOfCover ?? 999) - (b.monthsOfCover ?? 999));

    // Overdue / due-soon recurring needs worklist (next 7 days or already overdue).
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dueSoon = needs
      .filter((n: ForecastNeedRow) => n.nextDueAt <= soon)
      .map((n: ForecastNeedRow) => ({
        id: n.id,
        beneficiaryId: n.beneficiaryId,
        beneficiaryName: n.beneficiary.name,
        itemId: n.itemId,
        itemName: n.item.name,
        qtyPerCycle: n.qtyPerCycle,
        unit: n.item.unit,
        cycle: n.cycle,
        nextDueAt: n.nextDueAt,
        overdue: n.nextDueAt < now,
        stockAvailable: n.item.quantity >= n.qtyPerCycle,
      }))
      .sort((a, b) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime());

    return {
      forecast,
      dueSoon,
      summary: {
        activeNeeds: needs.length,
        itemsAtRisk: forecast.filter((f) => f.shortThisMonth).length,
        overdueCount: dueSoon.filter((d) => d.overdue).length,
      },
    };
  }
}
