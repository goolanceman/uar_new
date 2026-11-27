/**
 * Prisma implementation of the inventory forecast read model — the ONLY place
 * in the inventory-forecast module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import type { InventoryForecastRepository, ForecastNeedRow } from "./inventory-forecast.repository.interface";

export class PrismaInventoryForecastRepository implements InventoryForecastRepository {
  async listActiveNeeds(): Promise<ForecastNeedRow[]> {
    const needs = await db.recurringNeed.findMany({
      where: { status: "ACTIVE" },
      include: {
        item: { select: { id: true, name: true, unit: true, quantity: true, minStock: true } },
        beneficiary: { select: { id: true, name: true } },
      },
    });
    return needs as ForecastNeedRow[];
  }
}
