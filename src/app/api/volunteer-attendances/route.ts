import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRole, ApiError, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/volunteer-attendances?volunteerId=&from=&to=&limit=
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");
    const sp = new URL(req.url).searchParams;
    const volunteerId = sp.get("volunteerId");
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

    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/volunteer-attendances — admin records a volunteer day
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json().catch(() => ({}));

    const volunteerId = String(body?.volunteerId ?? "");
    if (!volunteerId) throw new ApiError("volunteerId is required", 400);
    const volunteer = await db.volunteer.findUnique({ where: { id: volunteerId } });
    if (!volunteer) throw new ApiError("Volunteer not found", 404);

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

    return json(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
