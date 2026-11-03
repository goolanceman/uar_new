import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/volunteers/:id — admin updates the volunteer profile
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const existing = await db.volunteer.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Volunteer not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.skills !== undefined)
      data.skills = body.skills ? String(body.skills) : null;
    if (body?.availability !== undefined)
      data.availability = body.availability ? String(body.availability) : null;
    if (body?.assignedArea !== undefined)
      data.assignedArea = body.assignedArea ? String(body.assignedArea).trim() : null;
    if (body?.emergencyContact !== undefined)
      data.emergencyContact = body.emergencyContact ? String(body.emergencyContact).trim() : null;
    if (body?.idProof !== undefined)
      data.idProof = body.idProof ? String(body.idProof).trim() : null;
    if (body?.status !== undefined) {
      const status = String(body.status);
      if (!["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"].includes(status))
        throw new ApiError("Invalid volunteer status", 400);
      data.status = status;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const volunteer = await db.volunteer.update({ where: { id }, data });

    // Mirror account-level status on the linked user row (single source of truth
    // for sign-in gates): SUSPENDED volunteer ⇒ suspended user, ACTIVE ⇒ active.
    if (typeof data.status === "string") {
      const statusMap: Record<string, { status: string; isActive: boolean }> = {
        ACTIVE: { status: "ACTIVE", isActive: true },
        INACTIVE: { status: "ACTIVE", isActive: false },
        SUSPENDED: { status: "SUSPENDED", isActive: false },
        PENDING: { status: "ACTIVE", isActive: false },
      };
      const mirror = statusMap[data.status];
      if (mirror) {
        await db.user.update({ where: { id: existing.userId }, data: mirror });
      }
    }

    await logActivity(
      session.name,
      "VOLUNTEER_UPDATE",
      "VOLUNTEER",
      `${volunteer.id} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json(volunteer);
  } catch (e) {
    return handleError(e);
  }
}

// GET /api/volunteers/:id — profile with tasks + attendance summary
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;
    const volunteer = await db.volunteer.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, city: true, status: true } },
        tasks: { orderBy: { scheduledDate: "desc" }, take: 50 },
        attendances: { orderBy: { date: "desc" }, take: 60 },
      },
    });
    if (!volunteer) throw new ApiError("Volunteer not found", 404);

    const hours = volunteer.attendances.reduce((s, a) => s + (a.hours ?? 0), 0);
    return json({
      ...volunteer,
      stats: {
        tasksAssigned: volunteer.tasks.length,
        tasksCompleted: volunteer.tasks.filter((t) => t.status === "COMPLETED").length,
        daysPresent: volunteer.attendances.length,
        totalHours: Math.round(hours * 10) / 10,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
