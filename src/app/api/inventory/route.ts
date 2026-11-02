import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/inventory?category=&q=&low=1 (auth) — orderBy name
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const category = sp.get("category") || undefined;
    const q = sp.get("q")?.trim() || undefined;
    const lowOnly = Boolean(sp.get("low"));

    const where: Prisma.InventoryItemWhereInput = {};
    if (category) where.category = category;
    if (q) where.name = { contains: q };

    const items = await db.inventoryItem.findMany({
      where,
      orderBy: { name: "asc" },
    });

    // SQLite cannot reference another column in `where` — filter in memory
    const rows = lowOnly
      ? items.filter((i) => i.quantity <= i.minStock)
      : items;
    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/inventory (ADMIN | VOLUNTEER)
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);
    const category = String(body.category ?? "").trim().toUpperCase() || "OTHER";
    const quantity = Math.max(0, Math.trunc(Number(body.quantity ?? 0)) || 0);

    const item = await db.inventoryItem.create({
      data: {
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
      },
    });

    await logActivity(
      session.name,
      "STOCK_ADD",
      "InventoryItem",
      `${name} (${category}) ×${quantity}`,
      session.userId
    );
    return json(item, 201);
  } catch (e) {
    return handleError(e);
  }
}
