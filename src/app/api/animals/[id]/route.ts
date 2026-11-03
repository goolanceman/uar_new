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

const STATUSES = ["AVAILABLE", "FOSTERED", "ADOPTED", "CRITICAL"];

// GET /api/animals/:id (ADMIN | VOLUNTEER) — animal + pledges
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const animal = await db.animal.findUnique({
      where: { id },
      include: { pledges: { orderBy: { createdAt: "desc" } } },
    });
    if (!animal) throw new ApiError("Animal not found", 404);
    return json(animal);
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/animals/:id (ADMIN | VOLUNTEER)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.animal.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Animal not found", 404);

    const data: Prisma.AnimalUpdateInput = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("name cannot be empty", 400);
      data.name = name;
    }
    if (body.species !== undefined)
      data.species = String(body.species).trim().toUpperCase();
    if (body.breed !== undefined)
      data.breed = body.breed ? String(body.breed).trim() : null;
    if (body.ageMonths !== undefined) {
      const ageMonths = Math.trunc(Number(body.ageMonths));
      if (!Number.isFinite(ageMonths) || ageMonths < 0)
        throw new ApiError("ageMonths must be 0 or more", 400);
      data.ageMonths = ageMonths;
    }
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
    if (body.location !== undefined) {
      const location = String(body.location).trim();
      if (!location) throw new ApiError("location cannot be empty", 400);
      data.location = location;
    }
    if (body.monthlyFood !== undefined) {
      const food = Number(body.monthlyFood);
      if (!Number.isFinite(food) || food < 0)
        throw new ApiError("monthlyFood must be 0 or more", 400);
      data.monthlyFood = food;
    }
    if (body.adoptedByName !== undefined)
      data.adoptedByName = body.adoptedByName
        ? String(body.adoptedByName).trim()
        : null;
    if (body.adoptedById !== undefined)
      data.adoptedById = body.adoptedById ? String(body.adoptedById) : null;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      data.status = status;
      if (status === "ADOPTED") {
        // Explicit adopter fields win; otherwise a volunteer recording the
        // adoption is credited, and an empty adopter clears the record.
        if (body.adoptedByName === undefined) {
          if (session.role === "VOLUNTEER") data.adoptedByName = session.name;
          else if (existing.status !== "ADOPTED")
            data.adoptedByName = existing.adoptedByName ?? null;
        }
      } else {
        // Leaving the adopted state clears the adopter unless explicitly set.
        if (body.adoptedByName === undefined && body.adoptedById === undefined) {
          data.adoptedByName = null;
          data.adoptedById = null;
        }
      }
    }

    const animal = await db.animal.update({
      where: { id },
      data,
      include: { pledges: { orderBy: { createdAt: "desc" } } },
    });
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
