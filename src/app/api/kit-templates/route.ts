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

// GET /api/kit-templates (auth) — incl. _count batches
export async function GET() {
  try {
    await requireAuth();
    const templates = await db.kitTemplate.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { batches: true } } },
    });
    return json(templates);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/kit-templates (ADMIN) — {name, description?, items:[{name,qty,unit}], costPerUnit}
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0)
      throw new ApiError("items must be a non-empty array", 400);

    const costPerUnit = Number(body.costPerUnit ?? 0) || 0;

    const template = await db.kitTemplate.create({
      data: {
        name,
        description: body.description ? String(body.description) : null,
        items: JSON.stringify(items),
        costPerUnit,
      },
    });

    await logActivity(
      session.name,
      "KIT_TEMPLATE_ADD",
      "KitTemplate",
      `${name} (${items.length} items)`,
      session.userId
    );
    return json(template, 201);
  } catch (e) {
    return handleError(e);
  }
}
