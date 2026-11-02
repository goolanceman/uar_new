import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { recomputeCause } from "@/lib/causes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"];

// PATCH /api/pledges/:id — ADMIN or the pledge's own donor → {pledge}
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const pledge = await db.pledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    const isOwner = Boolean(pledge.donorId) && pledge.donorId === session.userId;
    if (session.role !== "ADMIN" && !isOwner)
      throw new ApiError("You can only manage your own pledges", 403);

    const status = String(body.status ?? "").trim().toUpperCase();
    if (!STATUSES.includes(status))
      throw new ApiError("status must be ACTIVE, COMPLETED or CANCELLED", 400);

    const updated = await db.pledge.update({
      where: { id },
      data: { status },
    });
    await recomputeCause(updated.causeId);
    await logActivity(
      session.name,
      "PLEDGE_UPDATE",
      "Pledge",
      `${id} → ${status}`,
      session.userId
    );

    return json(updated);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/pledges/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const pledge = await db.pledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    await db.pledge.delete({ where: { id } });
    await recomputeCause(pledge.causeId);
    await logActivity(
      session.name,
      "PLEDGE_DELETE",
      "Pledge",
      id,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
