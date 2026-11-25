import type { Prisma, PrismaClient } from "@prisma/client";
import { ApiError } from "@/lib/session";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface DistItemInput {
  itemId?: string | null;
  name: string;
  qty: number;
  unit?: string;
}

/** Advances a date by one recurring-need cycle (WEEKLY | MONTHLY | QUARTERLY). */
export function addCycle(date: Date, cycle: string): Date {
  const d = new Date(date);
  switch (cycle) {
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      break;
    case "QUARTERLY":
      d.setMonth(d.getMonth() + 3);
      break;
    case "MONTHLY":
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

/** Normalises a per-cycle quantity to an equivalent monthly quantity for forecasting. */
export function monthlyEquivalent(qtyPerCycle: number, cycle: string): number {
  switch (cycle) {
    case "WEEKLY":
      return qtyPerCycle * (52 / 12);
    case "QUARTERLY":
      return qtyPerCycle / 3;
    case "MONTHLY":
    default:
      return qtyPerCycle;
  }
}

/**
 * Validate + decrement master InventoryItem stock for each line that carries
 * an `itemId`, and record an InventoryDistribution row linking it back to the
 * distribution. Lines without `itemId` (legacy free-text) are left alone.
 * Throws ApiError(400) if any linked item doesn't have enough stock —
 * nothing is written in that case (caller must run this inside a $transaction).
 */
export async function consumeItemsStock(
  tx: Tx,
  distributionId: string,
  items: DistItemInput[]
): Promise<void> {
  const linked = items.filter((i) => i.itemId);
  if (!linked.length) return;

  // Merge duplicate lines referencing the same master item.
  const totals = new Map<string, number>();
  for (const i of linked) {
    totals.set(i.itemId as string, (totals.get(i.itemId as string) ?? 0) + i.qty);
  }

  for (const [itemId, qty] of totals) {
    const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new ApiError(`Inventory item not found (${itemId})`, 400);
    if (item.quantity < qty)
      throw new ApiError(
        `Insufficient stock for "${item.name}" — requested ${qty} ${item.unit}, only ${item.quantity} ${item.unit} in stock`,
        400
      );
    await tx.inventoryItem.update({
      where: { id: itemId },
      data: { quantity: item.quantity - qty },
    });
    await tx.inventoryDistribution.create({
      data: { itemId, quantity: qty, distributionId },
    });
  }
}

/** Reverse all stock drawn by a distribution — restores quantities, removes the link rows. */
export async function restoreItemsStock(tx: Tx, distributionId: string): Promise<void> {
  const rows = await tx.inventoryDistribution.findMany({ where: { distributionId } });
  for (const row of rows) {
    await tx.inventoryItem.update({
      where: { id: row.itemId },
      data: { quantity: { increment: row.quantity } },
    });
  }
  await tx.inventoryDistribution.deleteMany({ where: { distributionId } });
}

/**
 * Consume N ready units from a kit batch for a bulk (non-scanned) hand-out —
 * marks N of its READY units as SCANNED and tags them with distributionId so
 * the effect can be reversed on edit/delete. Throws ApiError(400) if the
 * batch doesn't have enough ready units.
 */
export async function consumeKitBatch(
  tx: Tx,
  distributionId: string,
  kitBatchId: string,
  kitQuantity: number,
  location: string | null
): Promise<void> {
  const batch = await tx.kitBatch.findUnique({ where: { id: kitBatchId } });
  if (!batch) throw new ApiError("Kit batch not found", 400);
  const available = batch.totalUnits - batch.scannedUnits;
  if (available < kitQuantity)
    throw new ApiError(
      `Only ${available} unit(s) left in "${batch.name}" — requested ${kitQuantity}`,
      400
    );

  const units = await tx.kitUnit.findMany({
    where: { batchId: kitBatchId, status: "READY" },
    take: kitQuantity,
    orderBy: { code: "asc" },
  });
  if (units.length < kitQuantity)
    throw new ApiError(`Only ${units.length} ready unit(s) left in "${batch.name}"`, 400);

  await tx.kitUnit.updateMany({
    where: { id: { in: units.map((u) => u.id) } },
    data: {
      status: "SCANNED",
      scannedAt: new Date(),
      location,
      distributionId,
    },
  });

  const scannedUnits = batch.scannedUnits + kitQuantity;
  await tx.kitBatch.update({
    where: { id: kitBatchId },
    data: {
      scannedUnits,
      status: scannedUnits >= batch.totalUnits ? "DEPLETED" : "IN_PROGRESS",
    },
  });
}

/** Reverse kit-unit consumption tied to a distribution — returns units to READY. */
export async function restoreKitBatch(tx: Tx, distributionId: string): Promise<void> {
  const units = await tx.kitUnit.findMany({ where: { distributionId } });
  if (!units.length) return;
  const batchIds = Array.from(new Set(units.map((u) => u.batchId)));

  await tx.kitUnit.updateMany({
    where: { distributionId },
    data: {
      status: "READY",
      scannedAt: null,
      scannedById: null,
      scannedByName: null,
      distributionId: null,
    },
  });

  for (const batchId of batchIds) {
    const batch = await tx.kitBatch.findUnique({ where: { id: batchId } });
    if (!batch) continue;
    const count = units.filter((u) => u.batchId === batchId).length;
    const scannedUnits = Math.max(0, batch.scannedUnits - count);
    await tx.kitBatch.update({
      where: { id: batchId },
      data: {
        scannedUnits,
        status: scannedUnits >= batch.totalUnits ? "DEPLETED" : scannedUnits > 0 ? "IN_PROGRESS" : "READY",
      },
    });
  }
}
