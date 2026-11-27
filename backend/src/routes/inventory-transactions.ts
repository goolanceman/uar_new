/**
 * Inventory transactions route — /api/inventory-transactions
 * Converted 1:1 from src/app/api/inventory-transactions/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const log = logger.child("inventory-transactions");

const VALID_TYPES = ["RECEIVED", "ISSUED", "TRANSFERRED", "CONSUMED", "RETURNED", "ADJUSTED"];
// Signed quantity deltas applied to InventoryItem.quantity per type.
// ADJUSTED expects an explicit signed delta; TRANSFERRED moves stock between
// locations without changing the total, so it carries no delta here.
const DELTAS: Record<string, number> = {
  RECEIVED: 1,
  ISSUED: -1,
  CONSUMED: -1,
  RETURNED: 1,
  ADJUSTED: 0, // signed as provided
  TRANSFERRED: 0,
};

function pageParams(url: URL, defLimit = 50) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || defLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function optDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// GET /api/inventory-transactions — ADMIN.
// Filters: itemId, campId, type. Includes the item name.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    for (const f of ["itemId", "campId", "type"]) {
      const v = url.searchParams.get(f);
      if (v) {
        if (f === "type" && !VALID_TYPES.includes(v))
          throw new ApiError(`type must be one of: ${VALID_TYPES.join(", ")}`, 400);
        where[f] = v;
      }
    }

    const [total, items] = await Promise.all([
      db.inventoryTransaction.count({ where }),
      db.inventoryTransaction.findMany({
        where,
        include: { item: { select: { id: true, code: true, name: true, unit: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/inventory-transactions — ADMIN.
// { itemId, campId?, type, quantity (signed), batchNo?, expiryDate?, source?,
//   notes? } — the quantity delta is applied to InventoryItem.quantity
// (RECEIVED + / ISSUED − / CONSUMED − / RETURNED + / ADJUSTED explicit signed
// delta) and the stock is never allowed to go below zero (409).
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const itemId = String(body?.itemId ?? "").trim();
    if (!itemId) throw new ApiError("itemId is required", 400);
    const item = await db.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, code: true, name: true, quantity: true },
    });
    if (!item) {
      log.warn("inventory_txn_item_not_found", { itemId, actor: session.userId });
      throw new ApiError("Inventory item not found", 404);
    }

    const type = String(body?.type ?? "").trim().toUpperCase();
    if (!VALID_TYPES.includes(type))
      throw new ApiError(`type must be one of: ${VALID_TYPES.join(", ")}`, 400);

    const quantity = Number(body?.quantity);
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity === 0)
      throw new ApiError("quantity must be a non-zero integer", 400);

    let delta: number;
    if (type === "ADJUSTED") {
      delta = quantity; // explicit signed delta
    } else {
      const sign = DELTAS[type];
      delta = sign === 0 ? 0 : sign * Math.abs(quantity);
    }

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: campId }, select: { id: true } });
      if (!camp) {
        log.warn("inventory_txn_camp_not_found", { itemId, campId, actor: session.userId });
        throw new ApiError("Camp not found", 404);
      }
    }

    let updated = item;
    if (delta !== 0) {
      const result = await db.inventoryItem.updateMany({
        where: delta < 0 ? { id: itemId, quantity: { gte: Math.abs(delta) } } : { id: itemId },
        data: { quantity: { increment: delta } },
      });
      if (result.count === 0) {
        log.warn("inventory_txn_insufficient_stock", {
          itemId,
          itemCode: item.code,
          type,
          currentQuantity: item.quantity,
          requested: Math.abs(delta),
          actor: session.userId,
        });
        throw new ApiError(
          `Insufficient stock for ${item.name} (current quantity ${item.quantity}, tried to remove ${Math.abs(delta)})`,
          409
        );
      }
      updated = await db.inventoryItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { id: true, code: true, name: true, quantity: true },
      });
    }

    const txn = await db.inventoryTransaction.create({
      data: {
        itemId,
        campId,
        type,
        quantity: delta,
        batchNo: optText(body?.batchNo),
        expiryDate: optDate(body?.expiryDate),
        source: optText(body?.source),
        owner: "UAR",
        notes: optText(body?.notes),
        handledByName: session.name,
      },
      include: { item: { select: { id: true, code: true, name: true, unit: true } } },
    });

    log.info("inventory_txn_created", {
      txnId: txn.id,
      itemId,
      itemCode: item.code,
      type,
      quantity: delta,
      newQuantity: updated.quantity,
      ...(campId ? { campId } : {}),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "INVENTORY_TXN",
      "INVENTORY_TRANSACTION",
      `${item.code} (${item.name}) — ${type} ${delta >= 0 ? "+" : ""}${delta} → ${updated.quantity}`,
      session.userId
    );

    return json(res, { transaction: txn, itemQuantity: updated.quantity }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
