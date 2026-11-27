/**
 * Batch service — goods receipt and quality inspection for food stock.
 * Every donation/procurement becomes a traceable batch whose master item
 * quantity increases only when the receipt is recorded (single write path
 * with InventoryTransaction); rejections/waste move stock out the same way.
 * Legacy validation order (item lookup → duplicate gate → enum checks) and
 * the transaction boundary are preserved exactly; `availableOf` stock maths
 * comes from the shared domain layer @/lib/food.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { assertTransition } from "@/lib/workflow";
import { availableOf, FOOD_BATCH_QUALITY_TRANSITIONS } from "@/lib/food";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type { FoodBody } from "../schemas/food.schema";
import type { BatchPatchData, FoodInventoryRepository } from "../repositories/food-inventory.repository.interface";

const log = logger.child("food");

const BATCH_SOURCES = ["DONATED", "PURCHASED", "CSR", "PARTNER", "RECOVERED"];
const BATCH_TEMP = ["AMBIENT", "COOL", "FROZEN", "HOT_HOLD"];

/** Legacy `new Date(body.x)` over raw JSON values (epoch number | ISO string). */
const toDate = (v: unknown): Date => new Date(v as string | number);

export class BatchService {
  constructor(private readonly inventoryRepository: FoodInventoryRepository) {}

  /** GET /api/food/batches?itemId&q&expiring=days&quality — ADMIN stock desk. */
  async list(sp: URLSearchParams): Promise<unknown> {
    return this.inventoryRepository.listBatches({
      itemId: sp.get("itemId"),
      q: sp.get("q")?.trim(),
      quality: sp.get("quality"),
      expiring: sp.get("expiring"),
    });
  }

  /** POST /api/food/batches — ADMIN goods receipt. */
  async receive(body: FoodBody, session: Session): Promise<unknown> {
    const itemId = String(body?.itemId ?? "");
    const batchNo = String(body?.batchNo ?? "").trim();
    const quantity = Number(body?.quantityReceived);
    if (!itemId || !batchNo) throw new ApiError("Inventory item and batch number are required", 400);
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new ApiError("Received quantity must be a positive number", 400);

    const item = await this.inventoryRepository.findItemById(itemId);
    if (!item) {
      log.warn("food_batch_item_not_found", { itemId, actor: session.userId });
      throw new ApiError("Inventory item not found", 400);
    }

    const exists = await this.inventoryRepository.findBatchByItemAndBatchNo(itemId, batchNo);
    if (exists) {
      log.warn("food_batch_duplicate", { itemId, batchNo, actor: session.userId });
      throw new ApiError(`Batch "${batchNo}" already exists for ${item.name}`, 409);
    }

    const source = String(body?.source ?? "PURCHASED").toUpperCase();
    if (!BATCH_SOURCES.includes(source)) throw new ApiError("Invalid source", 400);
    const temp = body?.tempRequirement ? String(body.tempRequirement).toUpperCase() : null;
    if (temp && !BATCH_TEMP.includes(temp)) throw new ApiError("Invalid temperature requirement", 400);

    const row = await withTransaction(async (tx) => {
      const batch = await this.inventoryRepository.createBatch({
        itemId,
        batchNo,
        source,
        donorName: body?.donorName ? String(body.donorName).trim() : null,
        supplierName: body?.supplierName ? String(body.supplierName).trim() : null,
        quantityReceived: quantity,
        mfgDate: body?.mfgDate ? toDate(body.mfgDate) : null,
        expiryDate: body?.expiryDate ? toDate(body.expiryDate) : null,
        storageNotes: body?.storageNotes ? String(body.storageNotes).trim() : null,
        tempRequirement: temp,
        createdByName: session.name,
      }, tx);
      await this.inventoryRepository.incrementItemQuantity(itemId, quantity, tx);
      await this.inventoryRepository.createInventoryTransaction({
        itemId,
        type: "RECEIVED",
        quantity,
        batchNo,
        expiryDate: batch.expiryDate,
        source,
        refType: "FOOD_BATCH",
        refId: batch.id,
        notes: `Food batch receipt (${source.toLowerCase()}) by ${session.name}`,
        handledByName: session.name,
      }, tx);
      return batch;
    });

    log.info("food_batch_received", {
      batchId: row.id,
      itemId,
      itemCode: item.code,
      batchNo,
      quantity,
      source,
      actor: session.userId,
    });
    await logActivity(session.name, "FOOD_BATCH_RECEIVE", "FoodBatch", `${item.code} / ${batchNo} × ${quantity}`, session.userId);
    return row;
  }

  /** PATCH /api/food/batches/:id — ADMIN quality inspection & stock control. */
  async inspect(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const batch = await this.inventoryRepository.findBatchWithItem(id);
    if (!batch) {
      log.warn("food_batch_not_found", { batchId: id, actor: session.userId });
      throw new ApiError("Food batch not found", 404);
    }

    const data: BatchPatchData = {};
    if (body?.storageNotes !== undefined) data.storageNotes = body.storageNotes ? String(body.storageNotes).trim() : null;
    if (body?.tempRequirement !== undefined) data.tempRequirement = body.tempRequirement ? String(body.tempRequirement).toUpperCase() : null;

    if (body?.qualityStatus !== undefined) {
      const quality = String(body.qualityStatus).toUpperCase();
      if (!["PENDING", "PASSED", "QUARANTINED", "REJECTED"].includes(quality))
        throw new ApiError("Invalid quality status", 400);
      assertTransition(FOOD_BATCH_QUALITY_TRANSITIONS, batch.qualityStatus, quality, "food batch quality", 409);
      if (quality === "REJECTED" && !body?.rejectionReason)
        throw new ApiError("A rejection reason is required", 400);
      data.qualityStatus = quality;
      data.inspectedByName = session.name;
      data.inspectedAt = new Date();
      if (body?.rejectionReason !== undefined) data.rejectionReason = body.rejectionReason ? String(body.rejectionReason).trim() : null;
      if (quality === "REJECTED" || quality === "QUARANTINED") {
        data.status = "BLOCKED";
      } else if (quality === "PASSED" && batch.status === "BLOCKED") {
        data.status = availableOf(batch) > 0 ? "ACTIVE" : "DEPLETED";
      }
    }

    if (body?.wasteQty !== undefined) {
      const qty = Number(body.wasteQty);
      if (!Number.isInteger(qty) || qty <= 0) throw new ApiError("Waste quantity must be a positive whole number", 400);
      if (qty > availableOf(batch)) {
        log.warn("food_batch_waste_insufficient_stock", {
          batchId: id,
          batchNo: batch.batchNo,
          wasteQty: qty,
          available: availableOf(batch),
          actor: session.userId,
        });
        throw new ApiError(`Only ${availableOf(batch)} unit(s) are free in this batch — ${qty} cannot be written off`, 400);
      }
      if (!body?.wasteReason) throw new ApiError("A waste reason is required", 400);
      data.quantityWasted = { increment: qty };
    }

    const updated = await withTransaction(async (tx) => {
      const row = await this.inventoryRepository.updateBatch(id, data, tx);

      const wasteQty = body?.wasteQty !== undefined ? Number(body.wasteQty) : 0;
      if (wasteQty > 0) {
        await this.inventoryRepository.decrementItemQuantity(batch.itemId, wasteQty, tx);
        await this.inventoryRepository.createInventoryTransaction({
          itemId: batch.itemId,
          type: "CONSUMED",
          quantity: -wasteQty,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          source: batch.source,
          refType: "FOOD_BATCH",
          refId: batch.id,
          notes: `Waste (${String(body.wasteReason).slice(0, 200)}) by ${session.name}`,
          handledByName: session.name,
        }, tx);
      }
      return row;
    });

    log.info("food_batch_inspected", {
      batchId: id,
      batchNo: batch.batchNo,
      qualityStatus: updated.qualityStatus,
      status: updated.status,
      wasted: body?.wasteQty !== undefined ? Number(body.wasteQty) : 0,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      body?.wasteQty ? "FOOD_BATCH_WASTE" : "FOOD_BATCH_INSPECT",
      "FoodBatch",
      `${batch.batchNo} → ${updated.qualityStatus}${body?.wasteQty ? ` (-${body.wasteQty})` : ""}`,
      session.userId
    );
    return updated;
  }
}
