/**
 * Vitals service — all business rules for vital observations. Depends on the
 * repository contract, throws application errors, never touches HTTP.
 *
 * Integer rounding (INT_FIELDS) and the BMI computation happen here, exactly
 * as in the legacy handler (round after the range check, BMI = kg/m² 1
 * decimal when height + weight are given).
 */
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/session";
import { NotFoundError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import type {
  VitalObservationCreateData,
  VitalObservationRepository,
  VitalObservationRow,
  VitalsListFilters,
  VitalsMeasuredValues,
} from "../repositories/vitals.repository.interface";
import { INT_FIELDS, RANGES } from "../schemas/vitals.schema";

const log = logger.child("vitals");

export interface VitalsListPayload {
  items: VitalObservationRow[];
  total: number;
  page: number;
  pages: number;
}

export class VitalsService {
  constructor(private readonly vitalsRepository: VitalObservationRepository) {}

  /** GET /api/vitals — newest first, filtered, paged envelope. */
  async list(filters: VitalsListFilters, skip: number, page: number, limit: number): Promise<VitalsListPayload> {
    const { rows, total } = await this.vitalsRepository.list(filters, skip, limit);
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * POST /api/vitals — records an observation. Beneficiary/camp/encounter
   * existence checks run in the legacy order; measured values arrive already
   * range-checked from the schema layer.
   */
  async create(
    data: {
      beneficiaryId: string;
      campId: string | null;
      encounterId: string | null;
    } & VitalsMeasuredValues,
    actor: Session
  ): Promise<VitalObservationRow> {
    const beneficiary = await this.vitalsRepository.findBeneficiaryRef(data.beneficiaryId);
    if (!beneficiary) {
      log.warn("vitals_beneficiary_not_found", {
        beneficiaryId: data.beneficiaryId,
        actor: actor.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    if (data.campId) {
      const camp = await this.vitalsRepository.findCampRef(data.campId);
      if (!camp) {
        log.warn("vitals_camp_not_found", { campId: data.campId, actor: actor.userId });
        throw new NotFoundError("Camp not found");
      }
    }
    if (data.encounterId) {
      const enc = await this.vitalsRepository.findEncounterRef(data.encounterId);
      if (!enc) {
        log.warn("vitals_encounter_not_found", {
          encounterId: data.encounterId,
          actor: actor.userId,
        });
        throw new NotFoundError("Encounter not found");
      }
    }

    // Legacy field assembly: measured values in RANGES key order, integers
    // rounded, then BMI when height + weight are present.
    const record: Omit<VitalObservationCreateData, "recordedByName"> = {
      beneficiaryId: data.beneficiaryId,
      campId: data.campId,
      encounterId: data.encounterId,
    };
    for (const field of Object.keys(RANGES) as Array<keyof VitalsMeasuredValues>) {
      const value = data[field];
      if (value === undefined) continue;
      record[field] = INT_FIELDS.has(field) ? Math.round(value) : value;
    }

    const heightCm = record.heightCm;
    const weightKg = record.weightKg;
    if (heightCm && weightKg) {
      const bmi = weightKg / Math.pow(heightCm / 100, 2);
      record.bmi = Math.round(bmi * 10) / 10;
    }

    const vital = await this.vitalsRepository.create({
      ...record,
      recordedByName: actor.name,
    });

    log.info("vitals_recorded", {
      vitalId: vital.id,
      beneficiaryId: data.beneficiaryId,
      ...(data.campId ? { campId: data.campId } : {}),
      fields: Object.keys(RANGES).filter(
        (f) => record[f as keyof VitalsMeasuredValues] !== undefined
      ),
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "VITALS_RECORD",
      "VITALS",
      `Vitals recorded for ${beneficiary.code}`,
      actor.userId
    );

    return vital;
  }
}
