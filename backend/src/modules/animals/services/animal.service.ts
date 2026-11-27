/**
 * Animal service — catalogue CRUD, pledges and reaction blessings. Depends
 * on the repository contract, throws application errors, never touches HTTP.
 *
 * Body coercion/validation reproduces the legacy route exactly: same
 * defaults, same check order (first failing field replies — no combined
 * messages), same bare error messages, same side-effect order (the animal
 * code is drawn before parseUrlList can reject the photos list).
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { nextAnimalCode } from "@/lib/codes";
import { parseUrlList } from "@/lib/files";
import { ANIMAL_STATUSES } from "@/lib/animals";
import type { Animal } from "@prisma/client";
import type {
  AnimalListFilter,
  AnimalPledgeWithAnimal,
  AnimalRepository,
  AnimalUpdateData,
  AnimalWithPledges,
} from "../repositories/animal.repository.interface";

const log = logger.child("animals");

const SPECIES = ["DOG", "CAT", "COW", "BIRD", "OTHER"];
const GENDERS = ["MALE", "FEMALE", "UNKNOWN"];
const STATUSES = ANIMAL_STATUSES;
const KINDS = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"];
const FREQUENCIES = ["ONE_TIME", "MONTHLY"];
const EMOJIS = ["❤️", "🙏", "🎉", "🐾", "✨"];

export class AnimalService {
  constructor(private readonly animalRepository: AnimalRepository) {}

  /** GET /api/animals?species=&status=&q= (public) — includes each animal's pledges. */
  async list(filter: AnimalListFilter): Promise<Animal[]> {
    return this.animalRepository.listAnimals(filter);
  }

  /** POST /api/animals (ADMIN | VOLUNTEER). */
  async create(body: Record<string, unknown>, actor: Session): Promise<AnimalWithPledges> {
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

    const animal = await this.animalRepository.createAnimal({
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
      status: body.status ? String(body.status).trim().toUpperCase() : "AVAILABLE",
      monthlyFood: Number(body.monthlyFood ?? 0) || 0,
    });

    log.info("animal_created", {
      animalId: animal.id,
      code: animal.code,
      name: animal.name,
      species: animal.species,
      status: animal.status,
      actor: actor.userId,
    });
    await logActivity(actor.name, "ANIMAL_ADD", "Animal", `${animal.name} (${species})`, actor.userId);
    return animal;
  }

  /** POST /api/animals/pledges — public (guests) OR authenticated donors. */
  async createPledge(body: Record<string, unknown>, session: Session | null): Promise<{ pledge: unknown }> {
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
      const animal = await this.animalRepository.findAnimalById(animalId);
      if (!animal) {
        log.warn("animal_pledge_animal_not_found", { animalId, actor: session?.userId });
        throw new ApiError("Animal not found", 404);
      }
    }

    const donorName = String(body.donorName ?? "").trim() || session?.name || "Anonymous Donor";

    const pledge = await this.animalRepository.createPledge({
      animalId,
      shelterFund: body.shelterFund ? String(body.shelterFund).trim() : null,
      donorId: session?.userId ?? null,
      donorName,
      kind,
      amount,
      frequency,
      status: "ACTIVE",
    });

    log.info("animal_pledge_created", {
      pledgeId: pledge.id,
      kind,
      amount,
      frequency,
      ...(animalId ? { animalId } : {}),
      actor: session?.userId,
    });
    await logActivity(
      session?.name ?? donorName,
      "ANIMAL_PLEDGE",
      "AnimalPledge",
      `${kind} ₹${amount} ${frequency}${animalId ? " (animal-linked)" : " (shelter fund)"}`,
      session?.userId
    );
    return { pledge };
  }

  /** GET /api/animals/pledges?mine=1&animalId= (auth). */
  async listPledges(
    actor: Session,
    filter: { mine: boolean; animalId: string | null }
  ): Promise<AnimalPledgeWithAnimal[]> {
    return this.animalRepository.listPledges({
      donorId: filter.mine ? actor.userId : undefined,
      animalId: filter.animalId ?? undefined,
    });
  }

  /** GET /api/animals/reactions — recent blessings + per-animal emoji counts. */
  async listReactions(animalId: string | null, limit: number) {
    return this.animalRepository.listReactions(animalId ?? undefined, limit);
  }

  /** POST /api/animals/reactions — public (guests) OR authenticated users. */
  async createReaction(body: Record<string, unknown>, session: Session | null): Promise<{ reaction: unknown }> {
    const animalId = String(body.animalId ?? "").trim();
    if (!animalId) throw new ApiError("animalId is required", 400);

    const animal = await this.animalRepository.findAnimalById(animalId);
    if (!animal) {
      log.warn("animal_reaction_animal_not_found", { animalId, actor: session?.userId });
      throw new ApiError("Animal not found", 404);
    }

    const emoji = EMOJIS.includes(String(body.emoji)) ? String(body.emoji) : "❤️";
    const message = body.message ? String(body.message).trim().slice(0, 240) : null;
    const userName = String(body.userName ?? "").trim() || session?.name || "A well-wisher";

    const reaction = await this.animalRepository.createReaction({
      animalId,
      userId: session?.userId ?? null,
      userName,
      emoji,
      message,
    });

    log.info("animal_reaction_created", {
      reactionId: reaction.id,
      animalId,
      animalCode: animal.code,
      actor: session?.userId,
    });
    await logActivity(
      session?.name ?? userName,
      "ANIMAL_REACTION",
      "AnimalReaction",
      `${emoji} to ${animal.name}${message ? ` — "${message}"` : ""}`,
      session?.userId
    );
    return { reaction };
  }

  /** GET /api/animals/:id (ADMIN | VOLUNTEER) — animal + pledges. */
  async get(id: string): Promise<AnimalWithPledges> {
    const animal = await this.animalRepository.findAnimalWithPledges(id);
    if (!animal) throw new ApiError("Animal not found", 404);
    return animal;
  }

  /** PATCH /api/animals/:id (ADMIN | VOLUNTEER). */
  async update(id: string, body: Record<string, unknown>, actor: Session): Promise<AnimalWithPledges> {
    const existing = await this.animalRepository.findAnimalById(id);
    if (!existing) {
      log.warn("animal_update_not_found", { animalId: id, actor: actor.userId });
      throw new ApiError("Animal not found", 404);
    }

    const data: AnimalUpdateData = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("name cannot be empty", 400);
      data.name = name;
    }
    if (body.species !== undefined) data.species = String(body.species).trim().toUpperCase();
    if (body.breed !== undefined) data.breed = body.breed ? String(body.breed).trim() : null;
    if (body.ageMonths !== undefined) {
      const ageMonths = Math.trunc(Number(body.ageMonths));
      if (!Number.isFinite(ageMonths) || ageMonths < 0)
        throw new ApiError("ageMonths must be 0 or more", 400);
      data.ageMonths = ageMonths;
    }
    if (body.gender !== undefined) data.gender = String(body.gender).trim().toUpperCase();
    if (body.story !== undefined) data.story = String(body.story);
    if (body.photos !== undefined) data.photos = parseUrlList(body.photos, "photos");
    if (body.healthStatus !== undefined)
      data.healthStatus = body.healthStatus ? String(body.healthStatus).trim() : null;
    if (body.vaccinated !== undefined) data.vaccinated = Boolean(body.vaccinated);
    if (body.sterilized !== undefined) data.sterilized = Boolean(body.sterilized);
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
      data.adoptedByName = body.adoptedByName ? String(body.adoptedByName).trim() : null;
    if (body.adoptedById !== undefined)
      data.adoptedById = body.adoptedById ? String(body.adoptedById) : null;
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      data.status = status;
      if (status === "ADOPTED") {
        // Explicit adopter fields win; otherwise a volunteer recording the
        // adoption is credited, and an empty adopter clears the record.
        if (body.adoptedByName === undefined) {
          if (actor.role === "VOLUNTEER") data.adoptedByName = actor.name;
          else if (existing.status !== "ADOPTED") data.adoptedByName = existing.adoptedByName ?? null;
        }
      } else {
        // Leaving the adopted state clears the adopter unless explicitly set.
        if (body.adoptedByName === undefined && body.adoptedById === undefined) {
          data.adoptedByName = null;
          data.adoptedById = null;
        }
      }
    }

    const animal = await this.animalRepository.updateAnimal(id, data);
    log.info("animal_updated", {
      animalId: id,
      code: animal.code,
      name: animal.name,
      ...(body.status !== undefined ? { status: animal.status } : {}),
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "ANIMAL_UPDATE",
      "Animal",
      `${animal.name}${body.status !== undefined ? ` → ${animal.status}` : ""}`,
      actor.userId
    );
    return animal;
  }

  /** DELETE /api/animals/:id (ADMIN) — pledges are emptied first (legacy order). */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.animalRepository.findAnimalById(id);
    if (!existing) {
      log.warn("animal_delete_not_found", { animalId: id, actor: actor.userId });
      throw new ApiError("Animal not found", 404);
    }

    await this.animalRepository.deletePledgesOfAnimal(id);
    await this.animalRepository.deleteAnimal(id);
    log.info("animal_deleted", {
      animalId: id,
      code: existing.code,
      name: existing.name,
      actor: actor.userId,
    });
    await logActivity(actor.name, "ANIMAL_DELETE", "Animal", existing.name, actor.userId);
    return { ok: true };
  }
}
