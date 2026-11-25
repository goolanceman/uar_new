/**
 * Animals routes — /api/animals, /api/animals/pledges, /api/animals/reactions, /api/animals/:id
 * Converted 1:1 from src/app/api/animals/* (Next.js route handlers) to Express.
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
  validateSession,
} from "@/lib/session";
import { nextAnimalCode } from "@/lib/codes";
import { parseUrlList } from "@/lib/files";
import { ANIMAL_STATUSES } from "@/lib/animals";

export const router = Router();

const SPECIES = ["DOG", "CAT", "COW", "BIRD", "OTHER"];
const GENDERS = ["MALE", "FEMALE", "UNKNOWN"];
const STATUSES = ANIMAL_STATUSES;
const KINDS = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"];
const FREQUENCIES = ["ONE_TIME", "MONTHLY"];
const EMOJIS = ["❤️", "🙏", "🎉", "🐾", "✨"];

// GET /api/animals?species=&status=&q= (public) — includes each animal's pledges
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const species = sp.get("species") || undefined;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.AnimalWhereInput = {};
    if (species) where.species = species;
    if (status) where.status = status;
    if (q)
      where.OR = [
        { name: { contains: q } },
        { code: { contains: q } },
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
    return json(res, animals);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/animals (ADMIN | VOLUNTEER)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = (req.body ?? {}) as Record<string, unknown>;

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
        code: await nextAnimalCode(),
        name,
        species,
        breed: body.breed ? String(body.breed).trim() : null,
        photos: parseUrlList(body.photos, "photos"),
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
    return json(res, animal, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/animals/pledges — public (guests) OR authenticated donors
router.post("/pledges", async (req, res) => {
  try {
    const session = await validateSession(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const kind = String(body.kind ?? "FOOD").trim().toUpperCase();
    const frequency = String(body.frequency ?? "MONTHLY").trim().toUpperCase();
    const amount = Number(body.amount);

    if (!KINDS.includes(kind))
      throw new ApiError("kind must be FOOD, MEDICAL, VACCINATION or SHELTER", 400);
    if (!FREQUENCIES.includes(frequency))
      throw new ApiError("frequency must be ONE_TIME or MONTHLY", 400);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("amount must be greater than 0", 400);

    const animalId = body.animalId ? String(body.animalId) : null;
    if (animalId) {
      const animal = await db.animal.findUnique({ where: { id: animalId } });
      if (!animal) throw new ApiError("Animal not found", 404);
    }

    const donorName =
      String(body.donorName ?? "").trim() || session?.name || "Anonymous Donor";

    const pledge = await db.animalPledge.create({
      data: {
        animalId,
        shelterFund: body.shelterFund ? String(body.shelterFund).trim() : null,
        donorId: session?.userId ?? null,
        donorName,
        kind,
        amount,
        frequency,
        status: "ACTIVE",
      },
    });

    await logActivity(
      session?.name ?? donorName,
      "ANIMAL_PLEDGE",
      "AnimalPledge",
      `${kind} ₹${amount} ${frequency}${animalId ? " (animal-linked)" : " (shelter fund)"}`,
      session?.userId
    );
    return json(res, { pledge }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/animals/pledges?mine=1&animalId= (auth)
router.get("/pledges", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;

    const where: Prisma.AnimalPledgeWhereInput = {};
    if (sp.get("mine")) where.donorId = session.userId;
    const animalId = sp.get("animalId");
    if (animalId) where.animalId = animalId;

    const pledges = await db.animalPledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { animal: { select: { name: true, species: true } } },
    });
    return json(res, pledges);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/animals/reactions?animalId=xxx  — public, recent blessings for one animal
// GET /api/animals/reactions                — public, recent blessings across all adopted animals
router.get("/reactions", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const animalId = sp.get("animalId");
    const limit = Math.min(100, Number(sp.get("limit")) || 50);

    const reactions = await db.animalReaction.findMany({
      where: animalId ? { animalId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { animal: { select: { name: true, species: true } } },
    });

    // Per-animal emoji counts (for the whole adopted wall, or for one animal)
    const counts = await db.animalReaction.groupBy({
      by: ["animalId", "emoji"],
      _count: { emoji: true },
      where: animalId ? { animalId } : undefined,
    });

    return json(res, { reactions, counts });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/animals/reactions — public (guests) OR authenticated users leave a blessing/reaction
router.post("/reactions", async (req, res) => {
  try {
    const session = await validateSession(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const animalId = String(body.animalId ?? "").trim();
    if (!animalId) throw new ApiError("animalId is required", 400);

    const animal = await db.animal.findUnique({ where: { id: animalId } });
    if (!animal) throw new ApiError("Animal not found", 404);

    const emoji = EMOJIS.includes(String(body.emoji)) ? String(body.emoji) : "❤️";
    const message = body.message ? String(body.message).trim().slice(0, 240) : null;
    const userName = String(body.userName ?? "").trim() || session?.name || "A well-wisher";

    const reaction = await db.animalReaction.create({
      data: {
        animalId,
        userId: session?.userId ?? null,
        userName,
        emoji,
        message,
      },
    });

    await logActivity(
      session?.name ?? userName,
      "ANIMAL_REACTION",
      "AnimalReaction",
      `${emoji} to ${animal.name}${message ? ` — "${message}"` : ""}`,
      session?.userId
    );

    return json(res, { reaction }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/animals/:id (ADMIN | VOLUNTEER) — animal + pledges
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const animal = await db.animal.findUnique({
      where: { id },
      include: { pledges: { orderBy: { createdAt: "desc" } } },
    });
    if (!animal) throw new ApiError("Animal not found", 404);
    return json(res, animal);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/animals/:id (ADMIN | VOLUNTEER)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

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
    if (body.photos !== undefined)
      data.photos = parseUrlList(body.photos, "photos");
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
    return json(res, animal);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/animals/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
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
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
