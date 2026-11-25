/**
 * Food Security domain module — the single source of truth for the food
 * programme lifecycle: status enums, transition rules, package-requirement
 * maths and transactional FEFO (First Expired, First Out) batch handling.
 *
 * All food API routes import from here — no route may re-implement a
 * transition check or a stock movement (no duplicate business logic).
 */
import { ApiError } from "@/lib/session";
import { SETTING_DEFAULTS } from "@/lib/settings-core";
import { FOOD_EVENT_TRANSITIONS } from "@/lib/food-workflows";

/** Reads a configured hourly limit (per-hour window is fixed by the key name). */
export async function hourlyLimit(
  key: "food.applications.rateLimitPerHour" | "food.statusCheck.rateLimitPerHour" | "food.pledges.rateLimitPerHour"
): Promise<number> {
  const { db } = await import("@/lib/db");
  const row = await db.setting.findUnique({ where: { key } });
  const n = parseInt(row?.value ?? SETTING_DEFAULTS[key], 10);
  return Number.isFinite(n) && n >= 1 ? n : parseInt(SETTING_DEFAULTS[key], 10);
}

/** Reads a configured day-window (expiry alerts / AI waste-prevention horizon). */
export async function foodWindowDays(key: "food.expiryAlertDays" | "food.aiRiskWindowDays"): Promise<number> {
  const { db } = await import("@/lib/db");
  const row = await db.setting.findUnique({ where: { key } });
  const n = parseInt(row?.value ?? SETTING_DEFAULTS[key], 10);
  return Number.isFinite(n) && n >= 1 ? n : parseInt(SETTING_DEFAULTS[key], 10);
}

/**
 * Settings-driven rate limit guard for public food endpoints — throws 429
 * with a friendly retry message when the caller exceeds the configured
 * per-hour limit for that bucket (bucket = purpose + client IP).
 *
 * Changing the configured limit takes effect IMMEDIATELY: the bucket resets
 * when the setting changes (an operator raising limits for a camp shouldn't
 * wait for the current window to expire — and tests stay deterministic).
 */
const seenLimits = new Map<string, number>(); // bucket → last configured limit

export async function enforceFoodRateLimit(
  h: Headers,
  bucket: "applications" | "status" | "pledges",
  key: "food.applications.rateLimitPerHour" | "food.statusCheck.rateLimitPerHour" | "food.pledges.rateLimitPerHour"
): Promise<void> {
  const { checkRateLimit, resetRateLimit, clientIp } = await import("@/lib/rate-limit");
  const limit = await hourlyLimit(key);
  const bucketKey = `food-${bucket}:${clientIp(h)}`;
  if (seenLimits.get(bucketKey) !== limit) {
    resetRateLimit(bucketKey);
    seenLimits.set(bucketKey, limit);
  }
  const result = checkRateLimit(bucketKey, limit, 60 * 60 * 1000);
  if (!result.allowed)
    throw new ApiError(
      `Too many ${bucket === "status" ? "status checks" : bucket} from this connection — the limit is ${limit} per hour. Please retry in ${Math.ceil(result.retryAfterMs / 60000)} minutes.`,
      429
    );
}

type Tx = Omit<
  import("@prisma/client").PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/* ─────────────────────────── status definitions ─────────────────────────── */

// These tables are client-safe; API routes may import them through this module,
// while client views import directly from food-workflows.ts to avoid pulling in
// server-only session and database dependencies.
export {
  FOOD_EVENT_STATUSES,
  FOOD_EVENT_TRANSITIONS,
  FOOD_PUBLIC_EVENT_STATUSES,
  FOOD_OPERATIONAL_STATUSES,
  FOOD_REGISTRATION_STATUSES,
  FOOD_PLEDGE_TRANSITIONS,
  FOOD_REGISTRATION_TRANSITIONS,
  FOOD_PROGRAMME_STATUSES,
  FOOD_PROGRAMME_TRANSITIONS,
  FOOD_BATCH_QUALITY_TRANSITIONS,
  FOOD_ACTIVE_REG_STATUSES,
  FOOD_ACK_METHODS,
} from "@/lib/food-workflows";

export function assertEventTransition(from: string, to: string): void {
  if (from === to) return; // no-op updates (e.g. editing fields) stay allowed
  const allowed = FOOD_EVENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to))
    throw new ApiError(
      `Cannot move a food event from ${from} to ${to}. Allowed: ${allowed.join(", ") || "none"}`,
      400
    );
}

/* ─────────────────────── package template helpers ───────────────────────── */

export interface TemplateItem {
  name: string;
  qty: number;
  unit?: string;
}

/** Parses the KitTemplate.items JSON safely. */
export function parseTemplateItems(itemsJson: string | null | undefined): TemplateItem[] {
  try {
    const parsed = JSON.parse(itemsJson ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i) => i && typeof i === "object" && String(i.name ?? "").trim())
      .map((i) => ({
        name: String(i.name).trim(),
        qty: Number(i.qty) > 0 ? Number(i.qty) : 1,
        unit: i.unit ? String(i.unit) : undefined,
      }));
  } catch {
    return [];
  }
}

export interface RequiredLine {
  name: string;
  unit: string | null;
  qtyPerUnit: number;
  total: number;
  itemId: string | null; // matched master inventory item (case-insensitive name)
  available: number | null; // master stock when matched
}

/**
 * Computes the stock needed to pack `units` packages from a template,
 * matching template lines to master InventoryItems by case-insensitive name
 * so requirement lines carry live availability.
 */
export function calcRequirements(
  itemsJson: string | null | undefined,
  units: number,
  inventory: Array<{ id: string; name: string; quantity: number }>
): RequiredLine[] {
  return parseTemplateItems(itemsJson).map((item) => {
    const match = inventory.find(
      (i) => i.name.trim().toLowerCase() === item.name.trim().toLowerCase()
    );
    return {
      name: item.name,
      unit: item.unit ?? null,
      qtyPerUnit: item.qty,
      total: item.qty * units,
      itemId: match?.id ?? null,
      available: match ? match.quantity : null,
    };
  });
}

/* ───────────────────────── food batch stock maths ───────────────────────── */

export type FoodBatchRow = {
  id: string;
  quantityReceived: number;
  quantityReserved: number;
  quantityConsumed: number;
  quantityWasted: number;
  quantityReturned: number;
  expiryDate: Date | null;
  qualityStatus: string;
  status: string;
};

/** Free (unreserved, unconsumed) quantity left in a batch. */
export function availableOf(b: FoodBatchRow): number {
  return (
    b.quantityReceived - b.quantityReserved - b.quantityConsumed -
    b.quantityWasted - b.quantityReturned
  );
}

/** A batch may only be allocated when inspected-passed, active and unexpired. */
export function isAllocatable(b: FoodBatchRow, now = new Date()): boolean {
  return (
    b.qualityStatus === "PASSED" &&
    b.status === "ACTIVE" &&
    (!b.expiryDate || b.expiryDate.getTime() >= now.getTime())
  );
}

/**
 * FEFO reservation — splits `quantity` of an item across its allocatable
 * batches, earliest expiry first. Runs inside the caller's transaction and
 * creates one FoodStockAllocation row per (event, batch). Throws ApiError(400)
 * with the shortfall when stock is insufficient — nothing is written then.
 */
export async function fefoReserve(
  tx: Tx,
  eventId: string,
  itemId: string,
  quantity: number,
  actorName: string
): Promise<Array<{ batchId: string; quantity: number }>> {
  if (quantity <= 0) throw new ApiError("Reservation quantity must be positive", 400);

  const batches = await tx.foodBatch.findMany({
    where: { itemId, qualityStatus: "PASSED", status: "ACTIVE" },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
  });

  const usable = batches
    .filter((b) => isAllocatable(b))
    .map((b) => ({ batch: b, free: availableOf(b) }))
    .filter((b) => b.free > 0);

  const totalFree = usable.reduce((sum, b) => sum + b.free, 0);
  if (totalFree < quantity)
    throw new ApiError(
      `Insufficient inspected stock: ${totalFree} unit(s) allocatable, ${quantity} needed — receive or inspect more stock first`,
      400
    );

  const made: Array<{ batchId: string; quantity: number }> = [];
  let remaining = quantity;
  for (const { batch, free } of usable) {
    if (remaining <= 0) break;
    const take = Math.min(free, remaining);
    await tx.foodStockAllocation.create({
      data: { eventId, itemId, batchId: batch.id, quantity: take, notes: `FEFO by ${actorName}` },
    });
    await tx.foodBatch.update({
      where: { id: batch.id },
      data: { quantityReserved: { increment: take } },
    });
    made.push({ batchId: batch.id, quantity: take });
    remaining -= take;
  }
  return made;
}

/**
 * Issue a RESERVED allocation into event packages — moves the quantity from
 * `reserved` to `consumed` on the batch, decrements master InventoryItem
 * stock and writes an ISSUED InventoryTransaction for the audit trail.
 */
export async function issueAllocation(
  tx: Tx,
  allocationId: string,
  actorName: string
): Promise<void> {
  const allocation = await tx.foodStockAllocation.findUnique({ where: { id: allocationId } });
  if (!allocation) throw new ApiError("Allocation not found", 404);
  if (allocation.status !== "RESERVED")
    throw new ApiError(`Allocation is already ${allocation.status.toLowerCase()}`, 409);

  const batch = await tx.foodBatch.findUnique({ where: { id: allocation.batchId } });
  const item = await tx.inventoryItem.findUnique({ where: { id: allocation.itemId } });
  if (!batch || !item) throw new ApiError("Batch or inventory item missing", 400);

  if (item.quantity < allocation.quantity)
    throw new ApiError(
      `Master stock for "${item.name}" is ${item.quantity} — below the ${allocation.quantity} reserved. Reconcile inventory first.`,
      400
    );

  const now = new Date();
  await tx.foodStockAllocation.update({
    where: { id: allocationId },
    data: { status: "ISSUED", issuedAt: now, issuedByName: actorName },
  });
  await tx.foodBatch.update({
    where: { id: batch.id },
    data: {
      quantityReserved: { decrement: allocation.quantity },
      quantityConsumed: { increment: allocation.quantity },
    },
  });
  await tx.inventoryItem.update({
    where: { id: item.id },
    data: { quantity: { decrement: allocation.quantity } },
  });
  await tx.inventoryTransaction.create({
    data: {
      itemId: item.id,
      type: "ISSUED",
      quantity: -allocation.quantity,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      source: batch.source,
      refType: "FOOD_EVENT",
      refId: allocation.eventId,
      notes: `Issued to food event package preparation by ${actorName}`,
      handledByName: actorName,
    },
  });
}

/**
 * Release a RESERVED allocation back to the batch (event change / cancel) —
 * no master-stock movement because reserved stock never left inventory.
 */
export async function cancelAllocation(tx: Tx, allocationId: string): Promise<void> {
  const allocation = await tx.foodStockAllocation.findUnique({ where: { id: allocationId } });
  if (!allocation) throw new ApiError("Allocation not found", 404);
  if (allocation.status !== "RESERVED")
    throw new ApiError(`Only reserved allocations can be released (this one is ${allocation.status})`, 409);

  await tx.foodStockAllocation.update({
    where: { id: allocationId },
    data: { status: "CANCELLED" },
  });
  await tx.foodBatch.update({
    where: { id: allocation.batchId },
    data: { quantityReserved: { decrement: allocation.quantity } },
  });
}

/**
 * Return already-issued stock to the batch + master inventory (used at
 * reconciliation for undistributed packages). Writes a RETURNED
 * InventoryTransaction so the audit trail stays complete.
 */
export async function returnIssuedAllocation(
  tx: Tx,
  allocationId: string,
  quantity: number,
  actorName: string
): Promise<void> {
  const allocation = await tx.foodStockAllocation.findUnique({ where: { id: allocationId } });
  if (!allocation) throw new ApiError("Allocation not found", 404);
  if (allocation.status !== "ISSUED")
    throw new ApiError("Only issued allocations can be returned", 409);
  if (quantity <= 0 || quantity > allocation.quantity)
    throw new ApiError(`Return quantity must be between 1 and ${allocation.quantity}`, 400);

  const batch = await tx.foodBatch.findUnique({ where: { id: allocation.batchId } });
  if (!batch) throw new ApiError("Batch missing", 400);

  await tx.foodStockAllocation.update({
    where: { id: allocationId },
    data: { status: "RETURNED", returnedAt: new Date() },
  });
  await tx.foodBatch.update({
    where: { id: batch.id },
    data: {
      quantityConsumed: { decrement: quantity },
      quantityReturned: { increment: quantity },
    },
  });
  await tx.inventoryItem.update({
    where: { id: allocation.itemId },
    data: { quantity: { increment: quantity } },
  });
  await tx.inventoryTransaction.create({
    data: {
      itemId: allocation.itemId,
      type: "RETURNED",
      quantity,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      source: batch.source,
      refType: "FOOD_EVENT",
      refId: allocation.eventId,
      notes: `Undistributed packages returned at reconciliation by ${actorName}`,
      handledByName: actorName,
    },
  });
}

/** Marks every fully exhausted batch as DEPLETED (called after movements). */
export async function refreshBatchStatuses(tx: Tx, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  const batches = await tx.foodBatch.findMany({
    where: { itemId: { in: Array.from(new Set(itemIds)) }, status: "ACTIVE" },
  });
  for (const b of batches) {
    if (availableOf(b) <= 0 && b.quantityReserved === 0) {
      await tx.foodBatch.update({ where: { id: b.id }, data: { status: "DEPLETED" } });
    }
  }
}
