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

// PATCH /api/masters/:id (ADMIN) — {label?, active?, sortOrder?, value?}
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.master.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Master entry not found", 404);

    const data: Prisma.MasterUpdateInput = {};
    if (body.label !== undefined) data.label = String(body.label).trim();
    if (body.sortOrder !== undefined)
      data.sortOrder = Number(body.sortOrder) || 0;
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.value !== undefined) {
      const value = String(body.value).trim();
      if (!value) throw new ApiError("value cannot be empty", 400);
      if (value !== existing.value) {
        const clash = await db.master.findUnique({
          where: { category_value: { category: existing.category, value } },
        });
        if (clash)
          throw new ApiError(
            "A master entry with this value already exists in the category",
            409
          );
      }
      data.value = value;
    }

    const row = await db.master.update({ where: { id }, data });
    await logActivity(
      session.name,
      "MASTER_UPDATE",
      "Master",
      `${row.category}/${row.value}`,
      session.userId
    );
    return json(row);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/masters/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const row = await db.master.findUnique({ where: { id } });
    if (!row) throw new ApiError("Master entry not found", 404);

    await db.master.delete({ where: { id } });
    await logActivity(
      session.name,
      "MASTER_DELETE",
      "Master",
      `${row.category}/${row.value}`,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
