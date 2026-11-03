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

const SPECIES = ["DOG", "CAT", "COW", "BIRD", "OTHER"];
const GENDERS = ["MALE", "FEMALE", "UNKNOWN"];

// GET /api/animals?species=&status=&q= (public) — includes each animal's pledges
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const species = sp.get("species") || undefined;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.AnimalWhereInput = {};
    if (species) where.species = species;
    if (status) where.status = status;
    if (q)
      where.OR = [
        { name: { contains: q } },
        { location: { contains: q } },
        { breed: { contains: q } },
      ];

    const animals = await db.animal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        pledges: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    return json(animals);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/animals (ADMIN | VOLUNTEER)
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const name = String(body.name ?? "").trim();
    const species = String(body.species ?? "").trim().toUpperCase() || "OTHER";
    const gender = String(body.gender ?? "").trim().toUpperCase() || "MALE";
    const story = String(body.story ?? "").trim();
    const location = String(body.location ?? "").trim();
    const ageMonths = Math.trunc(Number(body.ageMonths ?? 12));

    if (!name) throw new ApiError("name is required", 400);
    if (!story) throw new ApiError("story is required", 400);
    if (!location) throw new ApiError("location is required", 400);
    if (!Number.isFinite(ageMonths) || ageMonths < 0)
      throw new ApiError("ageMonths must be 0 or more", 400);
    if (!SPECIES.includes(species)) throw new ApiError("Invalid species", 400);
    if (!GENDERS.includes(gender)) throw new ApiError("Invalid gender", 400);
    if (body.status) {
      const status = String(body.status).trim().toUpperCase();
      if (!["AVAILABLE", "FOSTERED", "ADOPTED", "CRITICAL"].includes(status))
        throw new ApiError("Invalid status", 400);
    }

    const animal = await db.animal.create({
      data: {
        name,
        species,
        breed: body.breed ? String(body.breed).trim() : null,
        ageMonths,
        gender,
        story,
        healthStatus: body.healthStatus ? String(body.healthStatus).trim() : null,
        vaccinated: Boolean(body.vaccinated),
        sterilized: Boolean(body.sterilized),
        location,
        status:
          body.status ? String(body.status).trim().toUpperCase() : "AVAILABLE",
        monthlyFood: Number(body.monthlyFood ?? 0) || 0,
      },
      include: { pledges: true },
    });

    await logActivity(
      session.name,
      "ANIMAL_ADD",
      "Animal",
      `${animal.name} (${species})`,
      session.userId
    );
    return json(animal, 201);
  } catch (e) {
    return handleError(e);
  }
}
