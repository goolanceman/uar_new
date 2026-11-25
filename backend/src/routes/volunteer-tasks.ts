/**
 * Volunteer tasks routes — /api/volunteer-tasks, /api/volunteer-tasks/:id
 * Converted 1:1 from src/app/api/volunteer-tasks/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { TASK_STATUSES as STATUSES, TASK_TRANSITIONS } from "@/lib/volunteer-tasks";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

const TYPES = ["DISTRIBUTION", "KIT_SCAN", "INVENTORY", "EVENT", "RESCUE", "AMBULANCE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const REF_TYPES = ["DISTRIBUTION", "CAMPAIGN", "EVENT", "MISSION"];

// GET /api/volunteer-tasks
//   ?mine=1 (auth)          → the session volunteer's tasks, desc scheduledDate
//   else   (ADMIN) ?status&type&volunteerId&refType&refId&q
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;

    if (sp.get("mine")) {
      const session = await requireAuth(req);
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (!volunteer) return json(res, []);
      const tasks = await db.volunteerTask.findMany({
        where: { volunteerId: volunteer.id },
        orderBy: { scheduledDate: "desc" },
      });
      return json(res, tasks);
    }

    await requireRole(req, "ADMIN");
    const status = sp.get("status") || undefined;
    const type = sp.get("type") || undefined;
    const volunteerId = sp.get("volunteerId") || undefined;
    const refType = sp.get("refType") || undefined;
    const refId = sp.get("refId") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.VolunteerTaskWhereInput = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (volunteerId) where.volunteerId = volunteerId;
    if (refType) where.refType = refType;
    if (refId) where.refId = refId;
    if (q)
      where.OR = [
        { title: { contains: q } },
        { location: { contains: q } },
        { description: { contains: q } },
      ];

    const findManyArgs = {
      where,
      orderBy: { scheduledDate: "desc" as const },
      include: { volunteer: { include: { user: { select: { name: true } } } } },
    };

    // Optional pagination (gap A-8, backward-compatible): with no ?page/limit
    // the legacy unpaginated array shape is returned exactly as before.
    const pageRaw = sp.get("page");
    const limitRaw = sp.get("limit");
    if (pageRaw || limitRaw) {
      const page = Math.max(1, Math.trunc(Number(pageRaw) || 1));
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(limitRaw) || 20)));
      const [items, total] = await Promise.all([
        db.volunteerTask.findMany({
          ...findManyArgs,
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.volunteerTask.count({ where }),
      ]);
      return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
    }

    const tasks = await db.volunteerTask.findMany(findManyArgs);
    return json(res, tasks);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/volunteer-tasks (ADMIN) — manual task creation (createdFrom MANUAL).
// Optional refType/refId link the task to a DISTRIBUTION / CAMPAIGN / EVENT /
// MISSION record for cross-module tracking.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const title = String(body.title ?? "").trim();
    if (!title) throw new ApiError("title is required", 400);

    const volunteerId = String(body.volunteerId ?? "");
    if (!volunteerId) throw new ApiError("volunteerId is required", 400);
    const volunteer = await db.volunteer.findUnique({
      where: { id: volunteerId },
      include: { user: { select: { name: true } } },
    });
    if (!volunteer) throw new ApiError("Volunteer not found", 404);

    const scheduledDate = body.scheduledDate
      ? new Date(String(body.scheduledDate))
      : null;
    if (!scheduledDate || Number.isNaN(scheduledDate.getTime()))
      throw new ApiError("scheduledDate is required", 400);

    const type = String(body.type ?? "DISTRIBUTION").trim().toUpperCase();
    if (!TYPES.includes(type)) throw new ApiError("Invalid task type", 400);
    const priority = String(body.priority ?? "MEDIUM").trim().toUpperCase();
    if (!PRIORITIES.includes(priority)) throw new ApiError("Invalid priority", 400);

    let refType: string | null = null;
    let refId: string | null = null;
    if (body.refType) {
      refType = String(body.refType).trim().toUpperCase();
      if (!REF_TYPES.includes(refType)) throw new ApiError("Invalid refType", 400);
      refId = String(body.refId ?? "").trim();
      if (!refId)
        throw new ApiError("refId is required when refType is provided", 400);
    }

    const task = await db.volunteerTask.create({
      data: {
        volunteerId,
        title,
        description: body.description ? String(body.description) : null,
        type,
        priority,
        location: body.location ? String(body.location).trim() : null,
        scheduledDate,
        refType,
        refId,
        createdFrom: "MANUAL",
      },
    });

    await logActivity(
      session.name,
      "TASK_ASSIGN",
      "VolunteerTask",
      `${title} → ${volunteer.user.name}`,
      session.userId
    );
    return json(res, task, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/volunteer-tasks/:id
//   ADMIN: any task · VOLUNTEER: only their own task
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

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
      assertTransition(TASK_TRANSITIONS, task.status, status, "task");
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
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/volunteer-tasks/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
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
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
