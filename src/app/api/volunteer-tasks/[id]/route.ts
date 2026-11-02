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
const STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

// PATCH /api/volunteer-tasks/:id
//   ADMIN: any task · VOLUNTEER: only their own task
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const task = await db.volunteerTask.findUnique({ where: { id } });
    if (!task) throw new ApiError("Task not found", 404);

    if (session.role === "VOLUNTEER") {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (!volunteer || volunteer.id !== task.volunteerId)
        throw new ApiError("You can only update your own tasks", 403);
    }

    const data: Prisma.VolunteerTaskUpdateInput = {};
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes) : null;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      data.status = status;
      data.completedAt = status === "COMPLETED" ? new Date() : null;
    }

    const updated = await db.volunteerTask.update({ where: { id }, data });
    await logActivity(
      session.name,
      "TASK_UPDATE",
      "VolunteerTask",
      `${task.title}${body.status !== undefined ? ` → ${updated.status}` : ""}`,
      session.userId
    );
    return json(updated);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/volunteer-tasks/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const task = await db.volunteerTask.findUnique({ where: { id } });
    if (!task) throw new ApiError("Task not found", 404);

    await db.volunteerTask.delete({ where: { id } });
    await logActivity(
      session.name,
      "TASK_DELETE",
      "VolunteerTask",
      task.title,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
