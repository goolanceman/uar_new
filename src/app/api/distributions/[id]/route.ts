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

// PATCH /api/distributions/:id (ADMIN) — {notes?, quantity?, location?}
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.distribution.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Distribution not found", 404);

    const data: Prisma.DistributionUpdateInput = {};
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes) : null;
    if (body.quantity !== undefined) {
      const quantity = Math.trunc(Number(body.quantity));
      if (!Number.isFinite(quantity) || quantity < 1)
        throw new ApiError("quantity must be at least 1", 400);
      data.quantity = quantity;
    }
    if (body.location !== undefined) data.location = String(body.location).trim();

    const row = await db.distribution.update({ where: { id }, data });
    await logActivity(
      session.name,
      "DISTRIBUTION_UPDATE",
      "Distribution",
      id,
      session.userId
    );
    return json(row);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/distributions/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.distribution.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Distribution not found", 404);

    await db.distribution.delete({ where: { id } });
    await logActivity(
      session.name,
      "DISTRIBUTION_DELETE",
      "Distribution",
      id,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
