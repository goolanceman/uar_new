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

/** ADMIN may edit anything; VOLUNTEER only drives attributed to them. */
async function assertCanMutate(
  session: { role: string; userId: string },
  id: string
) {
  const existing = await db.padDistribution.findUnique({
    where: { id },
    select: { id: true, volunteerId: true, area: true, padsDistributed: true },
  });
  if (!existing) throw new ApiError("Pad distribution not found", 404);
  if (session.role !== "ADMIN") {
    const own = await db.volunteer.findUnique({
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!own || existing.volunteerId !== own.id)
      throw new ApiError("You can only manage pad drives you recorded", 403);
  }
  return existing;
}

// GET /api/pad-distributions/:id (auth) — detail with volunteer name
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const row = await db.padDistribution.findUnique({ where: { id } });
    if (!row) throw new ApiError("Pad distribution not found", 404);

    let volunteer: { id: string; name: string } | null = null;
    if (row.volunteerId) {
      const v = await db.volunteer.findUnique({
        where: { id: row.volunteerId },
        select: { id: true, user: { select: { name: true } } },
      });
      if (v) volunteer = { id: v.id, name: v.user.name };
    }
    return json({ ...row, volunteer });
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await assertCanMutate(session, id);

    const data: Prisma.PadDistributionUncheckedUpdateInput = {};
    if (body.schoolName !== undefined)
      data.schoolName = body.schoolName ? String(body.schoolName).trim() : null;
    if (body.area !== undefined) {
      const area = String(body.area).trim();
      if (!area) throw new ApiError("area cannot be empty", 400);
      data.area = area;
    }
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
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (body.volunteerName !== undefined)
      data.volunteerName = body.volunteerName ? String(body.volunteerName).trim() : null;
    if (body.distributionDate !== undefined) {
      const d = new Date(String(body.distributionDate));
      if (Number.isNaN(d.getTime()))
        throw new ApiError("Invalid distributionDate", 400);
      data.distributionDate = d;
    }
    if (body.volunteerId !== undefined) {
      if (!body.volunteerId) data.volunteerId = null;
      else {
        const v = await db.volunteer.findUnique({
          where: { id: String(body.volunteerId) },
        });
        if (!v) throw new ApiError("Volunteer not found", 400);
        data.volunteerId = v.id;
      }
    }

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

// DELETE /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const existing = await assertCanMutate(session, id);

    await db.padDistribution.delete({ where: { id } });
    await logActivity(
      session.name,
      "PAD_DRIVE_DELETE",
      "PadDistribution",
      `${existing.area} · ${existing.padsDistributed} pads`,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
