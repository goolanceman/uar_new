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

// PATCH /api/pad-distributions/:id (ADMIN)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.padDistribution.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Pad distribution not found", 404);

    const data: Prisma.PadDistributionUpdateInput = {};
    if (body.schoolName !== undefined)
      data.schoolName = body.schoolName ? String(body.schoolName).trim() : null;
    if (body.area !== undefined) data.area = String(body.area).trim();
    if (body.girlsCount !== undefined)
      data.girlsCount = Math.max(0, Math.trunc(Number(body.girlsCount)) || 0);
    if (body.padsDistributed !== undefined)
      data.padsDistributed = Math.max(
        0,
        Math.trunc(Number(body.padsDistributed)) || 0
      );
    if (body.awarenessSession !== undefined)
      data.awarenessSession = Boolean(body.awarenessSession);
    if (body.sessionAttendees !== undefined)
      data.sessionAttendees =
        body.sessionAttendees === null || body.sessionAttendees === ""
          ? null
          : Math.max(0, Math.trunc(Number(body.sessionAttendees)) || 0);
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes) : null;

    const row = await db.padDistribution.update({ where: { id }, data });
    await logActivity(
      session.name,
      "PAD_DRIVE_UPDATE",
      "PadDistribution",
      id,
      session.userId
    );
    return json(row);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/pad-distributions/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.padDistribution.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Pad distribution not found", 404);

    await db.padDistribution.delete({ where: { id } });
    await logActivity(
      session.name,
      "PAD_DRIVE_DELETE",
      "PadDistribution",
      id,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
