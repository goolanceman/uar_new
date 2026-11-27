/**
 * Volunteer attendances route — /api/volunteer-attendances
 * Converted 1:1 from src/app/api/volunteer-attendances/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireRole, ApiError, json, handleError } from "@/lib/session";

export const router = Router();

const log = logger.child("volunteer-attendances");

// GET /api/volunteer-attendances?volunteerId=&from=&to=&limit=
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const sp = new URL(req.url, "http://localhost").searchParams;
    let volunteerId = sp.get("volunteerId");
    // Volunteers only ever see their own register.
    if (session.role === "VOLUNTEER") {
      const own = await db.volunteer.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (!own) return json(res, []);
      volunteerId = own.id;
    }
    const from = sp.get("from");
    const to = sp.get("to");
    const limit = Math.min(500, Math.max(1, parseInt(sp.get("limit") ?? "200", 10) || 200));

    const where: Record<string, unknown> = {};
    if (volunteerId) where.volunteerId = volunteerId;
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }

    const rows = await db.volunteerAttendance.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit,
      include: {
        volunteer: {
          select: {
            id: true,
            assignedArea: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/volunteer-attendances — admin records a volunteer day; an ACTIVE
// volunteer self-checks-in for today ({ taskId?, latitude?, longitude? }).
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = req.body ?? {};

    if (session.role === "VOLUNTEER") {
      const volunteer = await db.volunteer.findUnique({ where: { userId: session.userId } });
      if (!volunteer || volunteer.status !== "ACTIVE") {
        log.warn("volunteer_checkin_blocked_inactive", {
          volunteerId: volunteer?.id,
          actor: session.userId,
        });
        throw new ApiError("Only active volunteers can check in", 403);
      }

      let task: { title: string; location: string | null } | null = null;
      if (body?.taskId) {
        task = await db.volunteerTask.findFirst({
          where: { id: String(body.taskId), volunteerId: volunteer.id },
          select: { title: true, location: true },
        });
        if (!task) {
          log.warn("volunteer_checkin_task_not_found", {
            volunteerId: volunteer.id,
            taskId: String(body.taskId),
            actor: session.userId,
          });
          throw new ApiError("Task not found", 404);
        }
      }

      const now = new Date();
      const day = new Date(now.toISOString().slice(0, 10));
      const lat = Number(body?.latitude);
      const lng = Number(body?.longitude);
      const coords =
        Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)},${lng.toFixed(5)}` : null;
      const location = task?.location || coords;
      const notes = task ? `Self check-in · ${task.title}` : "Self check-in";

      const existing = await db.volunteerAttendance.findUnique({
        where: { volunteerId_date: { volunteerId: volunteer.id, date: day } },
      });
      // Idempotent: a second tap the same day keeps the first check-in time.
      if (existing?.checkIn) {
        log.warn("volunteer_checkin_duplicate", {
          attendanceId: existing.id,
          volunteerId: volunteer.id,
          actor: session.userId,
        });
        return json(res, existing);
      }

      const row = existing
        ? await db.volunteerAttendance.update({
            where: { id: existing.id },
            data: { checkIn: now, location: existing.location ?? location, notes: existing.notes ?? notes },
          })
        : await db.volunteerAttendance.create({
            data: { volunteerId: volunteer.id, date: day, checkIn: now, location, notes },
          });
      log.info("volunteer_checkin_recorded", {
        attendanceId: row.id,
        volunteerId: volunteer.id,
        ...(body?.taskId ? { taskId: String(body.taskId) } : {}),
        actor: session.userId,
      });
      return json(res, row, 201);
    }

    const volunteerId = String(body?.volunteerId ?? "");
    if (!volunteerId) throw new ApiError("volunteerId is required", 400);
    const volunteer = await db.volunteer.findUnique({ where: { id: volunteerId } });
    if (!volunteer) {
      log.warn("volunteer_attendance_volunteer_not_found", {
        volunteerId,
        actor: session.userId,
      });
      throw new ApiError("Volunteer not found", 404);
    }

    const date = body?.date ? new Date(String(body.date)) : new Date();
    if (Number.isNaN(date.getTime())) throw new ApiError("Date is invalid", 400);
    const day = new Date(date.toISOString().slice(0, 10));

    const hoursInput =
      body?.hours !== undefined && body.hours !== null && String(body.hours).trim() !== ""
        ? Number(body.hours)
        : null;
    if (hoursInput !== null && (!Number.isFinite(hoursInput) || hoursInput < 0 || hoursInput > 24))
      throw new ApiError("Hours must be between 0 and 24", 400);

    const checkIn = body?.checkIn ? new Date(String(body.checkIn)) : null;
    const checkOut = body?.checkOut ? new Date(String(body.checkOut)) : null;

    // When the admin didn't type hours, derive them from the check-in/out pair.
    let hours: number | null = hoursInput;
    if (hours === null && checkIn && checkOut && checkOut.getTime() > checkIn.getTime()) {
      hours = Math.round(((checkOut.getTime() - checkIn.getTime()) / 3_600_000) * 100) / 100;
    }

    const row = await db.volunteerAttendance.upsert({
      where: { volunteerId_date: { volunteerId, date: day } },
      create: {
        volunteerId,
        date: day,
        checkIn,
        checkOut,
        hours,
        location: body?.location ? String(body.location).trim() : null,
        notes: body?.notes ? String(body.notes) : null,
      },
      update: {
        checkIn,
        checkOut,
        hours,
        location: body?.location ? String(body.location).trim() : null,
        notes: body?.notes ? String(body.notes) : null,
      },
    });

    log.info("volunteer_attendance_recorded", {
      attendanceId: row.id,
      volunteerId,
      date: day.toISOString().slice(0, 10),
      ...(hours !== null ? { hours } : {}),
      actor: session.userId,
    });

    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
