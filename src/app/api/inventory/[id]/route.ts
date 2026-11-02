import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/inventory/:id (ADMIN | VOLUNTEER)
//   {addQuantity}          → increment quantity (never below 0)
//   ...or set plain fields {name?, category?, quantity?, minStock?, unit?, location?, pricePerUnit?, description?}
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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
    return json(item);
  } catch (e) {
    return handleError(e);
  }
}

function addQuantityLog(v: unknown): string {
  const n = Math.trunc(Number(v) || 0);
  return n >= 0 ? `+${n}` : `${n}`;
}

// DELETE /api/inventory/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
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
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
