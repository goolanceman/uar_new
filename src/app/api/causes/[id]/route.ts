import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { recomputeCause } from "@/lib/causes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/causes/:id (public)
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const cause = await db.cause.findUnique({
      where: { id },
      include: { pledges: { orderBy: { createdAt: "desc" } } },
    });
    if (!cause) throw new ApiError("Cause not found", 404);
    return json(cause);
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/causes/:id (ADMIN)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.cause.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Cause not found", 404);

    const data: Prisma.CauseUpdateInput = {};
    if (body.patientName !== undefined)
      data.patientName = String(body.patientName).trim();
    if (body.age !== undefined) data.age = Math.trunc(Number(body.age));
    if (body.city !== undefined) data.city = String(body.city).trim();
    if (body.condition !== undefined)
      data.condition = String(body.condition).trim().toUpperCase();
    if (body.monthlyCost !== undefined) data.monthlyCost = Number(body.monthlyCost);
    if (body.durationMonths !== undefined)
      data.durationMonths = Math.trunc(Number(body.durationMonths));
    if (body.story !== undefined) data.story = String(body.story);
    const statusProvided = body.status !== undefined;
    if (statusProvided) {
      const s = String(body.status).trim().toUpperCase();
      if (!["SEEKING", "PARTIAL", "ADOPTED", "PAUSED"].includes(s))
        throw new ApiError("status must be SEEKING, PARTIAL, ADOPTED or PAUSED", 400);
      data.status = s;
    }

    await db.cause.update({ where: { id }, data });

    // If admin did not force a status, recompute it from the ACTIVE pledges.
    const cause = statusProvided
      ? await db.cause.findUnique({
          where: { id },
          include: { pledges: { orderBy: { createdAt: "desc" } } },
        })
      : await recomputeCause(id);

    await logActivity(
      session.name,
      "CAUSE_UPDATE",
      "Cause",
      `${existing.code}${statusProvided ? ` → ${String(body.status).toUpperCase()}` : ""}`,
      session.userId
    );
    return json(cause);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/causes/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.cause.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Cause not found", 404);

    await db.pledge.deleteMany({ where: { causeId: id } });
    await db.cause.delete({ where: { id } });

    await logActivity(
      session.name,
      "CAUSE_DELETE",
      "Cause",
      existing.code,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
