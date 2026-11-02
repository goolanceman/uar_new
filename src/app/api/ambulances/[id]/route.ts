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

// PATCH /api/ambulances/:id (ADMIN)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.ambulance.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Ambulance not found", 404);

    const data: Prisma.AmbulanceUpdateInput = {};
    if (body.type !== undefined) {
      const type = String(body.type).trim().toUpperCase();
      if (!["BLS", "ALS", "PTV", "NEONATAL"].includes(type))
        throw new ApiError("Invalid type", 400);
      data.type = type;
    }
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!["AVAILABLE", "ON_MISSION", "MAINTENANCE"].includes(status))
        throw new ApiError("Invalid status", 400);
      data.status = status;
    }
    if (body.base !== undefined) data.base = String(body.base).trim();
    if (body.driverName !== undefined)
      data.driverName = String(body.driverName).trim();
    if (body.driverPhone !== undefined)
      data.driverPhone = body.driverPhone ? String(body.driverPhone).trim() : null;
    if (body.crew !== undefined)
      data.crew = body.crew ? String(body.crew).trim() : null;
    if (body.equipment !== undefined)
      data.equipment = body.equipment ? String(body.equipment).trim() : null;

    const ambulance = await db.ambulance.update({ where: { id }, data });
    await logActivity(
      session.name,
      "AMBULANCE_UPDATE",
      "Ambulance",
      `${ambulance.code}${body.status !== undefined ? ` → ${ambulance.status}` : ""}`,
      session.userId
    );
    return json(ambulance);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/ambulances/:id (ADMIN) — blocked while ON_MISSION
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.ambulance.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Ambulance not found", 404);
    if (existing.status === "ON_MISSION")
      throw new ApiError("Ambulance is on a mission", 409);

    await db.ambulance.delete({ where: { id } });
    await logActivity(
      session.name,
      "AMBULANCE_DELETE",
      "Ambulance",
      existing.code,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
