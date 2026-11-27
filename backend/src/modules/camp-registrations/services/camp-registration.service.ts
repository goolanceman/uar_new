/**
 * Camp registration service — all business rules for camp registrations.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Field checks keep the legacy order exactly (camp lookup →
 * camp-status gate → beneficiary lookup → duplicate check → capacity check →
 * registeredVia validation → self-service gates → slot parse on POST;
 * existence lookup → status transition → slot/notes on PATCH) and every log
 * event keeps its legacy name.
 */
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { nextCampRegCode } from "@/lib/health-codes";
import { assertTransition } from "@/lib/workflow";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  CampRegistrationDetailRow,
  CampRegistrationListRow,
  CampRegistrationListScope,
  CampRegistrationRepository,
  CampRegistrationSavedRow,
} from "../repositories/camp-registration.repository.interface";
import type {
  CreateCampRegistrationBody,
  ListCampRegistrationsQuery,
  UpdateCampRegistrationBody,
} from "../schemas/camp-registration.schema";

const log = logger.child("camp-registrations");

const REGISTERED_VIA = ["SELF", "DESK", "ASSISTED", "BULK", "QR"];
/** Registration statuses that count against camp capacity */
const BLOCKING_STATUSES = ["CANCELLED", "REJECTED"];

const SETTABLE_STATUSES = ["REGISTERED", "CONFIRMED", "CANCELLED", "REJECTED"];
// Registration machine: confirm/reject while REGISTERED; cancel while anything
// but CANCELLED (the camp-ops UI offers Cancel on every non-cancelled row,
// including rejected ones); CANCELLED is terminal.
const TRANSITIONS: Record<string, string[]> = {
  REGISTERED: ["CONFIRMED", "CANCELLED", "REJECTED"],
  PENDING: ["CONFIRMED", "CANCELLED", "REJECTED"],
  CONFIRMED: ["CANCELLED"],
  REJECTED: ["CANCELLED"],
  CANCELLED: [],
};

export interface CampRegistrationListEnvelope {
  items: CampRegistrationListRow[];
  total: number;
  page: number;
  pages: number;
}

export class CampRegistrationService {
  constructor(private readonly campRegistrationRepository: CampRegistrationRepository) {}

  /** GET /api/camp-registrations?q&campId&status&page&limit
   *  ADMIN | VOLUNTEER all; HOSPITAL only camps its org partners; BENEFICIARY own. */
  async list(
    query: ListCampRegistrationsQuery,
    session: Session
  ): Promise<CampRegistrationListEnvelope> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const filter = { q: query.q, campId: query.campId, status: query.status };
    const scope: CampRegistrationListScope = {};
    if (session.role === "HOSPITAL") {
      const ownOrgId = await this.campRegistrationRepository.findOrgIdByOwner(session.userId);
      if (!ownOrgId) return { items: [], total: 0, page, pages: 1 };
      scope.partnerOrgId = ownOrgId;
    }
    if (session.role === "BENEFICIARY") {
      const own = await this.campRegistrationRepository.findBeneficiaryIdByUserId(session.userId);
      if (!own) return { items: [], total: 0, page, pages: 1 };
      scope.beneficiaryId = own.id;
    }

    const { rows, total } = await this.campRegistrationRepository.list(filter, scope, skip, limit);
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** POST /api/camp-registrations (ADMIN | VOLUNTEER | NURSE desk; BENEFICIARY
   *  self-service) {campId, beneficiaryId, registeredVia?, scheduledSlot?, notes?} */
  async create(body: CreateCampRegistrationBody, session: Session): Promise<CampRegistrationSavedRow> {
    const campId = String(body.campId ?? "").trim();
    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);

    const camp = await this.campRegistrationRepository.findCampById(campId);
    if (!camp) {
      log.warn("camp_registration_camp_not_found", { campId, actor: session.userId });
      throw new NotFoundError("Camp not found");
    }
    if (!["SCHEDULED", "LIVE"].includes(camp.status)) {
      log.warn("camp_registration_blocked_camp_status", {
        campId,
        campStatus: camp.status,
        actor: session.userId,
      });
      throw new ApiError(`Camp is ${camp.status} — registration requires SCHEDULED or LIVE`, 409);
    }

    const beneficiary = await this.campRegistrationRepository.findBeneficiaryById(beneficiaryId);
    if (!beneficiary) {
      log.warn("camp_registration_beneficiary_not_found", {
        beneficiaryId,
        campId,
        actor: session.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    const duplicate = await this.campRegistrationRepository.findRegistrationByCampAndBeneficiary(campId, beneficiaryId);
    if (duplicate) {
      log.warn("camp_registration_duplicate", {
        campId,
        beneficiaryId,
        registrationId: duplicate.id,
        actor: session.userId,
      });
      throw new ApiError("Beneficiary is already registered for this camp", 409);
    }

    // Capacity counts active registrations only (cancelled/rejected free a slot)
    const activeCount = await this.campRegistrationRepository.countActiveByCamp(campId);
    if (activeCount >= camp.capacity) {
      log.warn("camp_registration_capacity_reached", {
        campId,
        capacity: camp.capacity,
        activeCount,
        actor: session.userId,
      });
      throw new ApiError("Camp capacity reached", 409);
    }

    const registeredVia = String(body.registeredVia ?? "DESK").trim().toUpperCase();
    if (!REGISTERED_VIA.includes(registeredVia)) throw new ApiError("Invalid registeredVia", 400);

    // Self-service: a BENEFICIARY session may only register their own record.
    if (session.role === "BENEFICIARY") {
      if (registeredVia !== "SELF") {
        log.warn("camp_registration_self_via_forbidden", {
          campId,
          beneficiaryId,
          registeredVia,
          actor: session.userId,
        });
        throw new ApiError("Beneficiaries may only self-register (registeredVia: SELF)", 403);
      }
      const own = await this.campRegistrationRepository.findOwnBeneficiaryByUserId(session.userId);
      if (!own) throw new ApiError("No beneficiary profile is linked to your account", 403);
      if (own.id !== beneficiaryId) {
        log.warn("camp_registration_self_other_forbidden", {
          campId,
          beneficiaryId,
          actor: session.userId,
        });
        throw new ApiError("You can only register yourself for a camp", 403);
      }
    }

    let scheduledSlot: Date | null = null;
    if (body.scheduledSlot) {
      scheduledSlot = new Date(String(body.scheduledSlot));
      if (Number.isNaN(scheduledSlot.getTime()))
        throw new ApiError("scheduledSlot is not a valid date", 400);
    }

    const code = await nextCampRegCode();
    const registration = await this.campRegistrationRepository.createRegistration({
      campId,
      beneficiaryId,
      code,
      registeredVia,
      scheduledSlot,
      notes: body.notes ? String(body.notes).trim() : null,
      registeredByName: session.name,
    });

    log.info("camp_registration_created", {
      registrationId: registration.id,
      code: registration.code,
      campId,
      beneficiaryId,
      registeredVia,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_REGISTER",
      "CampRegistration",
      `${beneficiary.name} registered for ${camp.title} (${code})`,
      session.userId
    );
    return registration;
  }

  /** GET /api/camp-registrations/:id — ADMIN | VOLUNTEER. */
  async getDetail(id: string): Promise<CampRegistrationDetailRow> {
    const registration = await this.campRegistrationRepository.findDetailById(id);
    if (!registration) throw new NotFoundError("Registration not found");
    return registration;
  }

  /** PATCH /api/camp-registrations/:id (ADMIN | VOLUNTEER)
   *  {status: CONFIRMED|CANCELLED|REJECTED, scheduledSlot?, notes?} */
  async update(id: string, body: UpdateCampRegistrationBody, session: Session): Promise<CampRegistrationSavedRow> {
    const existing = await this.campRegistrationRepository.findExistingWithCamp(id);
    if (!existing) {
      log.warn("camp_registration_update_not_found", { registrationId: id, actor: session.userId });
      throw new NotFoundError("Registration not found");
    }

    const data: { status?: string; scheduledSlot?: Date | null; notes?: string | null } = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!SETTABLE_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      if (existing.status !== status && !TRANSITIONS[existing.status]?.includes(status))
        log.warn("camp_registration_invalid_transition", {
          registrationId: id,
          from: existing.status,
          to: status,
          actor: session.userId,
        });
      assertTransition(TRANSITIONS, existing.status, status, "camp registration");
      data.status = status;
    }
    if (body.scheduledSlot !== undefined) {
      if (body.scheduledSlot === null || String(body.scheduledSlot).trim() === "") {
        data.scheduledSlot = null;
      } else {
        const slot = new Date(String(body.scheduledSlot));
        if (Number.isNaN(slot.getTime()))
          throw new ApiError("scheduledSlot is not a valid date", 400);
        data.scheduledSlot = slot;
      }
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const registration = await this.campRegistrationRepository.updateRegistration(id, data);

    log.info("camp_registration_updated", {
      registrationId: id,
      code: registration.code,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: registration.status } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_REGISTRATION_UPDATE",
      "CampRegistration",
      `${registration.code}${body.status !== undefined ? ` → ${registration.status}` : ""} (${existing.camp.title})`,
      session.userId
    );
    return registration;
  }
}
