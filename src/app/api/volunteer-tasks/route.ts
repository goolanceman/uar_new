import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const TYPES = ["DISTRIBUTION", "KIT_SCAN", "INVENTORY", "EVENT", "RESCUE", "AMBULANCE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

// GET /api/volunteer-tasks
//   ?mine=1 (auth)          → the session volunteer's tasks, desc scheduledDate
//   else   (ADMIN) ?status&type&q
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    if (sp.get("mine")) {
      const session = await requireAuth();
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (!volunteer) return json([]);
      const tasks = await db.volunteerTask.findMany({
        where: { volunteerId: volunteer.id },
        orderBy: { scheduledDate: "desc" },
      });
      return json(tasks);
    }

    await requireRole("ADMIN");
    const status = sp.get("status") || undefined;
    const type = sp.get("type") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.VolunteerTaskWhereInput = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (q)
      where.OR = [{ title: { contains: q } }, { location: { contains: q } }];

    const tasks = await db.volunteerTask.findMany({
      where,
      orderBy: { scheduledDate: "desc" },
      include: { volunteer: { include: { user: { select: { name: true } } } } },
    });
    return json(tasks);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/volunteer-tasks (ADMIN)
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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

    const task = await db.volunteerTask.create({
      data: {
        volunteerId,
        title,
        description: body.description ? String(body.description) : null,
        type,
        priority,
        location: body.location ? String(body.location).trim() : null,
        scheduledDate,
      },
    });

    await logActivity(
      session.name,
      "TASK_ASSIGN",
      "VolunteerTask",
      `${title} → ${volunteer.user.name}`,
      session.userId
    );
    return json(task, 201);
  } catch (e) {
    return handleError(e);
  }
}
