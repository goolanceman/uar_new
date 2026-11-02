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
const STATUSES = ["READY", "IN_PROGRESS", "DEPLETED"];

// PATCH /api/kit-batches/:id (ADMIN) — {name?, instructions?, status?}
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.kitBatch.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Batch not found", 404);

    const data: Prisma.KitBatchUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.instructions !== undefined)
      data.instructions = body.instructions ? String(body.instructions) : null;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status))
        throw new ApiError("status must be READY, IN_PROGRESS or DEPLETED", 400);
      data.status = status;
    }

    const batch = await db.kitBatch.update({ where: { id }, data });
    await logActivity(
      session.name,
      "KIT_BATCH_UPDATE",
      "KitBatch",
      `${batch.name}${body.status !== undefined ? ` → ${batch.status}` : ""}`,
      session.userId
    );
    return json(batch);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/kit-batches/:id (ADMIN) — removes units then the batch
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.kitBatch.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Batch not found", 404);

    await db.kitUnit.deleteMany({ where: { batchId: id } });
    await db.kitBatch.delete({ where: { id } });

    await logActivity(
      session.name,
      "KIT_BATCH_DELETE",
      "KitBatch",
      existing.name,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
