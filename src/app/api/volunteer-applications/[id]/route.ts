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

const ALLOWED = ["APPROVED", "REJECTED", "PENDING"];

// PATCH /api/volunteer-applications/:id — admin reviews an application
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const status = String(body?.status ?? "");
    if (!ALLOWED.includes(status))
      throw new ApiError("Status must be APPROVED, REJECTED or PENDING", 400);

    const application = await db.volunteerApplication.findUnique({ where: { id } });
    if (!application) throw new ApiError("Application not found", 404);

    const data: Record<string, unknown> = { status };
    if (body?.reviewNote !== undefined)
      data.reviewNote = body.reviewNote ? String(body.reviewNote) : null;

    if (status === "APPROVED") {
      data.reviewedAt = new Date();
      if (application.userId) {
        await db.user.update({
          where: { id: application.userId },
          data: { status: "ACTIVE", isActive: true, role: "VOLUNTEER" },
        });
        await db.volunteer.upsert({
          where: { userId: application.userId },
          create: {
            userId: application.userId,
            skills: application.skills,
            availability: application.availability,
            status: "ACTIVE",
          },
          update: {
            skills: application.skills ?? undefined,
            availability: application.availability ?? undefined,
            status: "ACTIVE",
          },
        });
      }
    } else if (status === "REJECTED") {
      data.reviewedAt = new Date();
    }

    const updated = await db.volunteerApplication.update({
      where: { id },
      data,
    });

    await logActivity(
      session.name,
      `VOLUNTEER_APPLICATION_${status}`,
      "VOLUNTEER_APPLICATION",
      `${application.fullName} (${application.email})`,
      session.userId
    );

    return json({ application: updated });
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/volunteer-applications/:id — admin removes an application
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const application = await db.volunteerApplication.findUnique({ where: { id } });
    if (!application) throw new ApiError("Application not found", 404);

    await db.volunteerApplication.delete({ where: { id } });

    await logActivity(
      session.name,
      "VOLUNTEER_APPLICATION_DELETE",
      "VOLUNTEER_APPLICATION",
      `${application.fullName} (${application.email})`,
      session.userId
    );

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
