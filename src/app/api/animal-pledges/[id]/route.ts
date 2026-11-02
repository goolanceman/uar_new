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
const STATUSES = ["ACTIVE", "COMPLETED", "CANCELLED"];

// PATCH /api/animal-pledges/:id (ADMIN) — {status}
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const status = String(body.status ?? "").trim().toUpperCase();
    if (!STATUSES.includes(status))
      throw new ApiError("status must be ACTIVE, COMPLETED or CANCELLED", 400);

    const pledge = await db.animalPledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    const updated = await db.animalPledge.update({
      where: { id },
      data: { status },
    });
    await logActivity(
      session.name,
      "ANIMAL_PLEDGE_UPDATE",
      "AnimalPledge",
      `${id} → ${status}`,
      session.userId
    );
    return json(updated);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/animal-pledges/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const pledge = await db.animalPledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Pledge not found", 404);

    await db.animalPledge.delete({ where: { id } });
    await logActivity(
      session.name,
      "ANIMAL_PLEDGE_DELETE",
      "AnimalPledge",
      id,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
