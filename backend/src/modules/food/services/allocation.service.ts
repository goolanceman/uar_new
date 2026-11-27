/**
 * Allocation service — the stock desk workflow: FEFO reservation for an
 * event and the issue/cancel decision. Stock maths and movements live in the
 * shared domain layer @/lib/food (fefoReserve/issueAllocation/cancelAllocation/
 * refreshBatchStatuses) — never re-implemented here. The multi-line
 * reservation aborts as a whole on shortfall (legacy transaction boundary,
 * reproduced with withTransaction — the tx client flows into the inventory
 * repository and the lib helpers).
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { cancelAllocation, fefoReserve, issueAllocation, refreshBatchStatuses } from "@/lib/food";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodEventRepository } from "../repositories/food-event.repository.interface";
import type { FoodInventoryRepository } from "../repositories/food-inventory.repository.interface";

const log = logger.child("food");

const BLOCKED_EVENT_STATUSES = ["COMPLETED", "RECONCILED", "CLOSED", "CANCELLED"];

export class AllocationService {
  constructor(
    private readonly inventoryRepository: FoodInventoryRepository,
    private readonly eventRepository: FoodEventRepository
  ) {}

  /**
   * POST /api/food/allocations — ADMIN reserves stock for an event.
   * Body: { eventId, lines: [{ itemId, quantity }] }
   * Each line is reserved FEFO across inspected batches inside one transaction;
   * a shortfall aborts the whole reservation (no partial events).
   */
  async reserve(body: FoodBody, session: Session): Promise<{ reserved: Array<{ itemId: string; batchId: string; quantity: number }> }> {
    const eventId = String(body?.eventId ?? "");
    const lines = Array.isArray(body?.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    if (!eventId || !lines.length) throw new ApiError("eventId and at least one line are required", 400);

    const event = await this.eventRepository.findEventById(eventId);
    if (!event) {
      log.warn("food_event_not_found", { eventId, actor: session.userId });
      throw new ApiError("Food event not found", 404);
    }
    if (BLOCKED_EVENT_STATUSES.includes(event.status)) {
      log.warn("food_allocation_event_blocked", {
        eventId,
        eventCode: event.code,
        status: event.status,
        actor: session.userId,
      });
      throw new ApiError(`Stock cannot be reserved for a ${event.status.toLowerCase()} event`, 409);
    }

    const reserved: Array<{ itemId: string; batchId: string; quantity: number }> = [];
    await withTransaction(async (tx) => {
      for (const line of lines) {
        const itemId = String(line?.itemId ?? "");
        const quantity = Number(line?.quantity);
        if (!itemId || !Number.isFinite(quantity) || quantity <= 0)
          throw new ApiError("Every line needs an itemId and a positive quantity", 400);
        const item = await this.inventoryRepository.findItemById(itemId, tx);
        if (!item) throw new ApiError(`Inventory item not found (${itemId})`, 400);
        const made = await fefoReserve(tx, eventId, itemId, Math.ceil(quantity), session.name);
        for (const m of made) reserved.push({ itemId, ...m });
      }
    });

    log.info("food_stock_reserved", {
      eventId,
      eventCode: event.code,
      reservations: reserved.length,
      lines: lines.length,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FOOD_STOCK_RESERVE",
      "FoodEvent",
      `${event.code}: ${reserved.length} batch reservation(s)`,
      session.userId
    );
    return { reserved };
  }

  /** PATCH /api/food/allocations/:id — ADMIN { action: "issue" | "cancel" }. */
  async decide(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const action = String(body?.action ?? "");

    const allocation = await this.inventoryRepository.findAllocationWithEvent(id);
    if (!allocation) {
      log.warn("food_allocation_not_found", { allocationId: id, actor: session.userId });
      throw new ApiError("Allocation not found", 404);
    }

    await withTransaction(async (tx) => {
      if (action === "issue") await issueAllocation(tx, id, session.name);
      else if (action === "cancel") await cancelAllocation(tx, id);
      else throw new ApiError("action must be issue or cancel", 400);
      await refreshBatchStatuses(tx, [allocation.itemId]);
    });

    log.info(action === "issue" ? "food_allocation_issued" : "food_allocation_cancelled", {
      allocationId: id,
      eventId: allocation.eventId,
      eventCode: allocation.event.code,
      itemId: allocation.itemId,
      quantity: allocation.quantity,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      action === "issue" ? "FOOD_STOCK_ISSUE" : "FOOD_STOCK_RELEASE",
      "FoodStockAllocation",
      `${allocation.event.code}: ${allocation.quantity} unit(s) ${action === "issue" ? "issued" : "released"}`,
      session.userId
    );
    // Legacy re-read the allocation after the audit trail (outside the tx).
    return this.inventoryRepository.findAllocationById(id);
  }
}
