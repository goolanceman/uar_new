/**
 * Screening service — all business rules for screening observations. Depends
 * on the repository contract, throws application errors, never touches HTTP.
 *
 * Screening observations only — these records never constitute a diagnosis.
 */
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/session";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import type {
  ScreeningCreatedRow,
  ScreeningListFilters,
  ScreeningRepository,
} from "../repositories/screening.repository.interface";

const log = logger.child("screenings");

export interface ScreeningListPayload {
  items: ScreeningCreatedRow[];
  total: number;
  page: number;
  pages: number;
}

export class ScreeningService {
  constructor(private readonly screeningRepository: ScreeningRepository) {}

  /** GET /api/screenings — newest first, filtered, paged envelope. */
  async list(filters: ScreeningListFilters, skip: number, page: number, limit: number): Promise<ScreeningListPayload> {
    const { rows, total } = await this.screeningRepository.list(filters, skip, limit);
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * POST /api/screenings — records an observation. Beneficiary/camp/encounter
   * existence checks run in the legacy order; `notes` is accepted in the
   * payload but not persisted (schema-change request filed).
   */
  async create(
    data: {
      beneficiaryId: string;
      result: string;
      type: string;
      campId: string | null;
      encounterId: string | null;
      abnormal: boolean;
    },
    actor: Session
  ): Promise<ScreeningCreatedRow> {
    const beneficiary = await this.screeningRepository.findBeneficiaryRef(data.beneficiaryId);
    if (!beneficiary) {
      log.warn("screening_beneficiary_not_found", {
        beneficiaryId: data.beneficiaryId,
        actor: actor.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    if (data.campId) {
      const camp = await this.screeningRepository.findCampRef(data.campId);
      if (!camp) {
        log.warn("screening_camp_not_found", { campId: data.campId, actor: actor.userId });
        throw new NotFoundError("Camp not found");
      }
    }
    if (data.encounterId) {
      const enc = await this.screeningRepository.findEncounterRef(data.encounterId);
      if (!enc) {
        log.warn("screening_encounter_not_found", {
          encounterId: data.encounterId,
          actor: actor.userId,
        });
        throw new NotFoundError("Encounter not found");
      }
    }

    const screening = await this.screeningRepository.create({
      beneficiaryId: data.beneficiaryId,
      campId: data.campId,
      encounterId: data.encounterId,
      type: data.type,
      result: data.result,
      abnormal: data.abnormal,
      recordedByName: actor.name,
    });

    log.info("screening_recorded", {
      screeningId: screening.id,
      beneficiaryId: data.beneficiaryId,
      ...(data.campId ? { campId: data.campId } : {}),
      type: data.type,
      abnormal: screening.abnormal,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "SCREENING_RECORD",
      "SCREENING",
      `${data.type} screening for ${beneficiary.code} — ${screening.abnormal ? "ABNORMAL" : "normal"}`,
      actor.userId
    );

    return screening;
  }
}
