/**
 * Interest service — the interest list with per-interest room counts plus the
 * admin CRUD. The legacy routes logged interest_created / interest_updated /
 * interest_deleted with the session actor — those domain events (and the
 * "interests" logger child) move here.
 */
import { logger } from "@/infrastructure/logging/logger";
import { paged } from "@/domains/community/serializers";
import type { Session } from "@/infrastructure/auth/session";
import type { InterestRepository } from "../repositories/interest.repository.interface";

const log = logger.child("interests");

export class InterestService {
  constructor(private readonly interestRepository: InterestRepository) {}

  /** GET /api/interests?page=&limit= — interests + totalRoomOfInterest. */
  async list(page: number, limit: number, skip: number) {
    const { items, total } = await this.interestRepository.list(skip, limit);
    return paged(items, page, limit, total);
  }

  /** POST /api/interests {title} — admin (duplicate title → 409 in the lib). */
  async create(title: string, actor: Session) {
    const row = await this.interestRepository.add(title);
    log.info("interest_created", { interestId: row.id, title, actor: actor.userId });
    return row;
  }

  /** PATCH /api/interests/:id {title} — admin (missing id → 404 in the lib). */
  async update(interestId: number, title: string, actor: Session) {
    const updated = await this.interestRepository.update(interestId, title);
    log.info("interest_updated", { interestId: updated.id, title, actor: actor.userId });
    return updated;
  }

  /** DELETE /api/interests/:id — admin; also strips the id from the
   * users.interestIds / communityPost / communityReel / communityRoom CSVs. */
  async remove(interestId: number, actor: Session) {
    const row = await this.interestRepository.delete(interestId);
    log.info("interest_deleted", { interestId: row.id, actor: actor.userId });
    return row;
  }
}
