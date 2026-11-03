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

// PATCH /api/kit-templates/:id (ADMIN)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.kitTemplate.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Template not found", 404);

    const data: Prisma.KitTemplateUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.kind !== undefined) {
      const KINDS = ["RATION","FOOD","EDUCATION","MEDICAL","HYGIENE","CLOTHING","EMERGENCY","CUSTOM"];
      const k = String(body.kind).toUpperCase();
      if (!KINDS.includes(k)) throw new ApiError("Invalid kit kind", 400);
      data.kind = k;
    }
    if (body.codePrefix !== undefined)
      data.codePrefix = body.codePrefix ? String(body.codePrefix).trim().toUpperCase() : null;
    if (body.image !== undefined) data.image = body.image ? String(body.image).trim() : null;
    if (body.status !== undefined) {
      const st = String(body.status).toUpperCase();
      if (!["ACTIVE","RETIRED"].includes(st)) throw new ApiError("Invalid status", 400);
      data.status = st;
    }
    if (body.description !== undefined)
      data.description = body.description ? String(body.description) : null;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || body.items.length === 0)
        throw new ApiError("items must be a non-empty array", 400);
      data.items = JSON.stringify(body.items);
    }
    if (body.costPerUnit !== undefined)
      data.costPerUnit = Number(body.costPerUnit) || 0;

    const template = await db.kitTemplate.update({ where: { id }, data });
    await logActivity(
      session.name,
      "KIT_TEMPLATE_UPDATE",
      "KitTemplate",
      template.name,
      session.userId
    );
    return json(template);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/kit-templates/:id (ADMIN) — blocked when batches exist
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.kitTemplate.findUnique({
      where: { id },
      include: { _count: { select: { batches: true } } },
    });
    if (!existing) throw new ApiError("Template not found", 404);
    if (existing._count.batches > 0)
      throw new ApiError("Template has batches", 409);

    await db.kitTemplate.delete({ where: { id } });
    await logActivity(
      session.name,
      "KIT_TEMPLATE_DELETE",
      "KitTemplate",
      existing.name,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
