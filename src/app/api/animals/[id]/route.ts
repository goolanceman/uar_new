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

// PATCH /api/animals/:id (ADMIN | VOLUNTEER)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.animal.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Animal not found", 404);

    const data: Prisma.AnimalUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.species !== undefined)
      data.species = String(body.species).trim().toUpperCase();
    if (body.breed !== undefined)
      data.breed = body.breed ? String(body.breed).trim() : null;
    if (body.ageMonths !== undefined)
      data.ageMonths = Math.trunc(Number(body.ageMonths));
    if (body.gender !== undefined)
      data.gender = String(body.gender).trim().toUpperCase();
    if (body.story !== undefined) data.story = String(body.story);
    if (body.healthStatus !== undefined)
      data.healthStatus = body.healthStatus
        ? String(body.healthStatus).trim()
        : null;
    if (body.vaccinated !== undefined) data.vaccinated = Boolean(body.vaccinated);
    if (body.sterilized !== undefined)
      data.sterilized = Boolean(body.sterilized);
    if (body.location !== undefined) data.location = String(body.location).trim();
    if (body.monthlyFood !== undefined)
      data.monthlyFood = Number(body.monthlyFood) || 0;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!["AVAILABLE", "FOSTERED", "ADOPTED", "CRITICAL"].includes(status))
        throw new ApiError("Invalid status", 400);
      data.status = status;
      // Volunteer who marks an animal adopted records themselves as adopter
      if (status === "ADOPTED" && session.role === "VOLUNTEER") {
        data.adoptedByName = session.name;
      }
    }

    const animal = await db.animal.update({ where: { id }, data });
    await logActivity(
      session.name,
      "ANIMAL_UPDATE",
      "Animal",
      `${animal.name}${body.status !== undefined ? ` → ${animal.status}` : ""}`,
      session.userId
    );
    return json(animal);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/animals/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.animal.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Animal not found", 404);

    await db.animalPledge.deleteMany({ where: { animalId: id } });
    await db.animal.delete({ where: { id } });

    await logActivity(
      session.name,
      "ANIMAL_DELETE",
      "Animal",
      existing.name,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
