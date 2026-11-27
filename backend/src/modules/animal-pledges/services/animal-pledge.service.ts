/**
 * Animal pledge service — admin edit/remove rules for animal welfare pledges.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP.
 *
 * The legacy PATCH validated body fields AFTER the pledge lookup (404 wins
 * over 400), so per-field coercion and its exact error messages live here
 * instead of in route-level Zod schemas.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { ANIMAL_PLEDGE_STATUSES } from "@/lib/animals";
import type {
  AnimalPledgeRepository,
  AnimalPledgeRow,
  AnimalPledgeUpdateData,
} from "../repositories/animal-pledge.repository.interface";

const log = logger.child("animal-pledges");

const STATUSES = ANIMAL_PLEDGE_STATUSES;
const KINDS = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"];
const FREQUENCIES = ["ONE_TIME", "MONTHLY"];

export class AnimalPledgeService {
  constructor(private readonly animalPledgeRepository: AnimalPledgeRepository) {}

  /**
   * PATCH /api/animal-pledges/:id — accepts {status} alone (original
   * contract) or any of donorName, amount, kind, frequency, shelterFund,
   * animalId for full admin edits. Field checks run in the legacy order.
   */
  async update(
    id: string,
    body: Record<string, unknown>,
    actor: Session
  ): Promise<AnimalPledgeRow> {
    const pledge = await this.animalPledgeRepository.findPledgeById(id);
    if (!pledge) {
      log.warn("animal_pledge_update_not_found", { pledgeId: id, actor: actor.userId });
      throw new ApiError("Pledge not found", 404);
    }

    const data: AnimalPledgeUpdateData = {};
    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!STATUSES.includes(status))
        throw new ApiError("status must be ACTIVE, COMPLETED or CANCELLED", 400);
      data.status = status;
    }
    if (body.donorName !== undefined) {
      const donorName = String(body.donorName).trim();
      if (!donorName) throw new ApiError("donorName cannot be empty", 400);
      data.donorName = donorName;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new ApiError("amount must be greater than 0", 400);
      data.amount = amount;
    }
    if (body.kind !== undefined) {
      const kind = String(body.kind).trim().toUpperCase();
      if (!KINDS.includes(kind))
        throw new ApiError("kind must be FOOD, MEDICAL, VACCINATION or SHELTER", 400);
      data.kind = kind;
    }
    if (body.frequency !== undefined) {
      const frequency = String(body.frequency).trim().toUpperCase();
      if (!FREQUENCIES.includes(frequency))
        throw new ApiError("frequency must be ONE_TIME or MONTHLY", 400);
      data.frequency = frequency;
    }
    if (body.shelterFund !== undefined)
      data.shelterFund = body.shelterFund ? String(body.shelterFund).trim() : null;
    if (body.animalId !== undefined) {
      if (body.animalId) {
        const animal = await this.animalPledgeRepository.findAnimalById(
          String(body.animalId)
        );
        if (!animal) {
          log.warn("animal_pledge_animal_not_found", {
            pledgeId: id,
            animalId: body.animalId,
            actor: actor.userId,
          });
          throw new ApiError("Animal not found", 404);
        }
        data.animalId = String(body.animalId);
      } else {
        data.animalId = null;
      }
    }

    const updated = await this.animalPledgeRepository.updatePledge(id, data);
    log.info("animal_pledge_updated", {
      pledgeId: id,
      donorName: updated.donorName,
      kind: updated.kind,
      ...(data.status ? { status: String(data.status) } : {}),
      fields: Object.keys(data),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "ANIMAL_PLEDGE_UPDATE",
      "AnimalPledge",
      `${pledge.donorName} · ${pledge.kind} ₹${pledge.amount}${data.status ? ` → ${String(data.status)}` : ""}`,
      actor.userId
    );
    return updated;
  }

  /** DELETE /api/animal-pledges/:id */
  async remove(id: string, actor: Session): Promise<{ ok: boolean }> {
    const pledge = await this.animalPledgeRepository.findPledgeById(id);
    if (!pledge) {
      log.warn("animal_pledge_delete_not_found", { pledgeId: id, actor: actor.userId });
      throw new ApiError("Pledge not found", 404);
    }

    await this.animalPledgeRepository.deletePledge(id);
    log.info("animal_pledge_deleted", {
      pledgeId: id,
      donorName: pledge.donorName,
      kind: pledge.kind,
      amount: pledge.amount,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "ANIMAL_PLEDGE_DELETE",
      "AnimalPledge",
      `${pledge.donorName} · ${pledge.kind} ₹${pledge.amount}`,
      actor.userId
    );
    return { ok: true };
  }
}
