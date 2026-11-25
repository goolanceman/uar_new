/**
 * Inventory routes — /api/inventory, /api/inventory/:id
 * Converted 1:1 from src/app/api/inventory/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { nextInventoryItemCode } from "@/lib/codes";

export const router = Router();

// GET /api/inventory?category=&q=&low=1 (auth) — orderBy name
router.get("/", async (req, res) => {
  try {
    await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const category = sp.get("category") || undefined;
    const q = sp.get("q")?.trim() || undefined;
    const lowOnly = Boolean(sp.get("low"));

    const where: Prisma.InventoryItemWhereInput = {};
    if (category) where.category = category;
    if (q) where.OR = [{ name: { contains: q } }, { code: { contains: q } }];

    const items = await db.inventoryItem.findMany({
      where,
      orderBy: { name: "asc" },
    });

    // SQLite cannot reference another column in `where` — filter in memory
    const rows = lowOnly
      ? items.filter((i) => i.quantity <= i.minStock)
      : items;
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/inventory (ADMIN | VOLUNTEER)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);
    const category = String(body.category ?? "").trim().toUpperCase() || "OTHER";
    const quantity = Math.max(0, Math.trunc(Number(body.quantity ?? 0)) || 0);

    const item = await db.inventoryItem.create({
      data: {
        code: await nextInventoryItemCode(),
        name,
        category,
        quantity,
        unit: body.unit ? String(body.unit).trim() : "piece",
        minStock: Math.max(0, Math.trunc(Number(body.minStock ?? 10)) || 0),
        location: body.location ? String(body.location).trim() : null,
        pricePerUnit:
          body.pricePerUnit !== undefined &&
          body.pricePerUnit !== null &&
          body.pricePerUnit !== "" &&
          Number.isFinite(Number(body.pricePerUnit))
            ? Number(body.pricePerUnit)
            : null,
        description: body.description ? String(body.description) : null,
        expiryDate: body.expiryDate ? new Date(String(body.expiryDate)) : null,
      },
    });

    await logActivity(
      session.name,
      "STOCK_ADD",
      "InventoryItem",
      `${name} (${category}) ×${quantity}`,
      session.userId
    );
    return json(res, item, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/inventory/:id — item + purchase history (ADMIN | VOLUNTEER)
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const item = await db.inventoryItem.findUnique({
      where: { id },
      include: {
        purchases: { orderBy: { purchaseDate: "desc" }, take: 50 },
        distributions: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!item) throw new ApiError("Inventory item not found", 404);
    const usedTotal = await db.inventoryDistribution.aggregate({
      where: { itemId: id },
      _sum: { quantity: true },
    });
    return json(res, { ...item, usedTotal: usedTotal._sum.quantity ?? 0 });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/inventory/:id (ADMIN | VOLUNTEER)
//   {addQuantity}          → increment quantity (never below 0)
//   ...or set plain fields {name?, category?, quantity?, minStock?, unit?, location?, pricePerUnit?, description?}
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const existing = await db.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Inventory item not found", 404);

    const data: Prisma.InventoryItemUpdateInput = {};

    if (body.addQuantity !== undefined) {
      const add = Math.trunc(Number(body.addQuantity) || 0);
      data.quantity = Math.max(0, existing.quantity + add);
    } else if (body.quantity !== undefined) {
      data.quantity = Math.max(0, Math.trunc(Number(body.quantity)) || 0);
    }

    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.category !== undefined)
      data.category = String(body.category).trim().toUpperCase();
    if (body.minStock !== undefined)
      data.minStock = Math.max(0, Math.trunc(Number(body.minStock)) || 0);
    if (body.unit !== undefined) data.unit = String(body.unit).trim();
    if (body.location !== undefined)
      data.location = body.location ? String(body.location).trim() : null;
    if (body.pricePerUnit !== undefined)
      data.pricePerUnit =
        body.pricePerUnit === null || body.pricePerUnit === ""
          ? null
          : Number(body.pricePerUnit);
    if (body.description !== undefined)
      data.description = body.description ? String(body.description) : null;
    if (body.expiryDate !== undefined)
      data.expiryDate = body.expiryDate ? new Date(String(body.expiryDate)) : null;

    // Stock-in with supplier details → record an InventoryPurchase row
    if (body.addQuantity !== undefined && (body.supplier || body.invoiceNumber || body.purchasePrice)) {
      const add = Math.trunc(Number(body.addQuantity) || 0);
      await db.inventoryPurchase.create({
        data: {
          itemId: id,
          quantity: add,
          pricePerUnit:
            body.purchasePrice !== undefined && body.purchasePrice !== "" && Number.isFinite(Number(body.purchasePrice))
              ? Number(body.purchasePrice)
              : null,
          supplier: body.supplier ? String(body.supplier).trim() : null,
          invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber).trim() : null,
          purchaseDate: body.purchaseDate ? new Date(String(body.purchaseDate)) : new Date(),
        },
      });
    }

    const item = await db.inventoryItem.update({ where: { id }, data });
    await logActivity(
      session.name,
      "STOCK_UPDATE",
      "InventoryItem",
      body.addQuantity !== undefined
        ? `${item.name} ${addQuantityLog(body.addQuantity)} → ${item.quantity}`
        : item.name,
      session.userId
    );
    return json(res, item);
  } catch (e) {
    return handleError(e, res);
  }
});

function addQuantityLog(v: unknown): string {
  const n = Math.trunc(Number(v) || 0);
  return n >= 0 ? `+${n}` : `${n}`;
}

// DELETE /api/inventory/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Inventory item not found", 404);

    await db.inventoryPurchase.deleteMany({ where: { itemId: id } });
    await db.inventoryDistribution.deleteMany({ where: { itemId: id } });
    await db.inventoryItem.delete({ where: { id } });

    await logActivity(
      session.name,
      "STOCK_DELETE",
      "InventoryItem",
      existing.name,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
