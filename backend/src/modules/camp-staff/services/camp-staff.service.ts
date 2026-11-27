/**
 * Camp staff service — all business rules for camp staff assignments.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Field checks keep the legacy order exactly (camp lookup →
 * HOSPITAL partner gates → role validation → professional/volunteer checks
 * on POST; status validation BEFORE the existence lookup on PATCH) and every
 * log event keeps its legacy name.
 */
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { CAMP_STAFF_STATUSES, CAMP_STAFF_TRANSITIONS } from "@/lib/camp-staff";
import { assertTransition } from "@/lib/workflow";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  CampStaffCreatedRow,
  CampStaffListRow,
  CampStaffRepository,
  CampStaffUpdatedRow,
} from "../repositories/camp-staff.repository.interface";
import type {
  CreateCampStaffBody,
  ListCampStaffQuery,
  UpdateCampStaffBody,
} from "../schemas/camp-staff.schema";

const log = logger.child("camp-staff");

const STAFF_ROLES = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH", "COORDINATOR", "VOLUNTEER"];
// Camp-staff roles that must map to a VERIFIED professional of the same kind
const CLINICAL_ROLES = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH"];

const VALID_STATUSES: readonly string[] = CAMP_STAFF_STATUSES;

export interface CampStaffListEnvelope {
  items: CampStaffListRow[];
  total: number;
  page: number;
  pages: number;
}

export class CampStaffService {
  constructor(private readonly campStaffRepository: CampStaffRepository) {}

  /** GET /api/camp-staff?campId= — authenticated (camp roster). */
  async list(query: ListCampStaffQuery): Promise<CampStaffListEnvelope> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const { rows, total } = await this.campStaffRepository.list(
      { campId: query.campId, status: query.status },
      skip,
      limit
    );
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** POST /api/camp-staff (ADMIN | HOSPITAL) {campId, professionalId?, volunteerId?, role} */
  async create(body: CreateCampStaffBody, session: Session): Promise<CampStaffCreatedRow> {
    const campId = String(body.campId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    const camp = await this.campStaffRepository.findCampById(campId);
    if (!camp) {
      log.warn("camp_staff_camp_not_found", { campId, actor: session.userId });
      throw new NotFoundError("Camp not found");
    }

    // A hospital partner rosters only its own staff on camps it has accepted.
    if (session.role === "HOSPITAL") {
      const orgId = await this.campStaffRepository.findOrgIdByOwner(session.userId);
      if (!orgId) {
        log.warn("camp_staff_no_linked_org", { campId, actor: session.userId });
        throw new ApiError("No healthcare organisation is linked to your account", 403);
      }
      const partner = await this.campStaffRepository.findAcceptedPartner(campId, orgId);
      if (!partner) {
        log.warn("camp_staff_partner_not_accepted", {
          campId,
          orgId,
          actor: session.userId,
        });
        throw new ApiError("Accept the camp invitation before assigning staff", 403);
      }
      if (body.volunteerId) {
        log.warn("camp_staff_partner_volunteer_forbidden", {
          campId,
          orgId,
          actor: session.userId,
        });
        throw new ApiError("Partners can assign only their own staff", 403);
      }
      const own = body.professionalId
        ? await this.campStaffRepository.findProfessionalInOrg(String(body.professionalId), orgId)
        : null;
      if (!own) {
        log.warn("camp_staff_partner_not_own_staff", {
          campId,
          orgId,
          ...(body.professionalId ? { professionalId: String(body.professionalId) } : {}),
          actor: session.userId,
        });
        throw new ApiError("Partners can assign only their own staff", 403);
      }
    }

    const role = String(body.role ?? "DOCTOR").trim().toUpperCase();
    if (!STAFF_ROLES.includes(role)) throw new ApiError("Invalid role", 400);

    const professionalId = body.professionalId ? String(body.professionalId).trim() : null;
    const volunteerId = body.volunteerId ? String(body.volunteerId).trim() : null;

    if (!professionalId && !volunteerId)
      throw new ApiError("professionalId or volunteerId is required", 400);

    if (professionalId) {
      const professional = await this.campStaffRepository.findProfessionalById(professionalId);
      if (!professional) {
        log.warn("camp_staff_professional_not_found", {
          campId,
          professionalId,
          actor: session.userId,
        });
        throw new NotFoundError("Professional not found");
      }
      if (CLINICAL_ROLES.includes(role)) {
        if (professional.kind !== role) {
          log.warn("camp_staff_kind_mismatch", {
            campId,
            professionalId,
            role,
            professionalKind: professional.kind,
            actor: session.userId,
          });
          throw new ApiError(`This staff member is a ${professional.kind}, not a ${role}`, 400);
        }
        if (professional.verificationStatus !== "VERIFIED") {
          log.warn("camp_staff_unverified", {
            campId,
            professionalId,
            role,
            verificationStatus: professional.verificationStatus,
            actor: session.userId,
          });
          throw new ApiError(
            "Only verified professionals can be assigned to clinical roles",
            400
          );
        }
      }
    }
    if (volunteerId) {
      const volunteer = await this.campStaffRepository.findVolunteerById(volunteerId);
      if (!volunteer) {
        log.warn("camp_staff_volunteer_not_found", {
          campId,
          volunteerId,
          actor: session.userId,
        });
        throw new NotFoundError("Volunteer not found");
      }
    }

    const staff = await this.campStaffRepository.createStaff({
      campId,
      professionalId,
      volunteerId,
      role,
      notes: body.notes ? String(body.notes).trim() : null,
    });

    log.info("camp_staff_assigned", {
      staffId: staff.id,
      campId,
      role,
      ...(professionalId ? { professionalId } : {}),
      ...(volunteerId ? { volunteerId } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_STAFF_ADD",
      "CampStaff",
      `${staff.professional?.name ?? "Volunteer"} assigned as ${role} for ${camp.title}`,
      session.userId
    );
    return staff;
  }

  /** DELETE /api/camp-staff?id= (ADMIN) — remove from roster. */
  async remove(query: { id?: string }, session: Session): Promise<{ ok: boolean }> {
    const id = query.id;
    if (!id) throw new ApiError("id query parameter is required", 400);

    const staff = await this.campStaffRepository.findStaffWithProfessional(id);
    if (!staff) {
      log.warn("camp_staff_delete_not_found", { staffId: id, actor: session.userId });
      throw new NotFoundError("Camp staff record not found");
    }

    await this.campStaffRepository.deleteStaff(id);

    log.info("camp_staff_removed", {
      staffId: id,
      campId: staff.campId,
      role: staff.role,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_STAFF_REMOVE",
      "CampStaff",
      `${staff.professional?.name ?? staff.role} removed from camp roster`,
      session.userId
    );
    return { ok: true };
  }

  /** PATCH /api/camp-staff/:id — ADMIN advances an assignment through camp day. */
  async updateStatus(id: string, body: UpdateCampStaffBody, session: Session): Promise<CampStaffUpdatedRow> {
    const status = String(body.status ?? "").trim().toUpperCase();
    if (!VALID_STATUSES.includes(status))
      throw new ApiError("Invalid camp staff status", 400);

    const existing = await this.campStaffRepository.findStaffWithRefs(id);
    if (!existing) {
      log.warn("camp_staff_update_not_found", { staffId: id, actor: session.userId });
      throw new NotFoundError("Camp staff record not found");
    }
    if (existing.status !== status && !CAMP_STAFF_TRANSITIONS[existing.status]?.includes(status))
      log.warn("camp_staff_invalid_transition", {
        staffId: id,
        from: existing.status,
        to: status,
        actor: session.userId,
      });
    assertTransition(CAMP_STAFF_TRANSITIONS, existing.status, status, "camp staff assignment");

    const changed = await this.campStaffRepository.updateStatusGuarded(id, existing.status, status);
    if (changed !== 1) {
      log.warn("camp_staff_update_conflict", {
        staffId: id,
        expectedStatus: existing.status,
        actor: session.userId,
      });
      throw new ApiError("Camp staff assignment changed while this action was being processed", 409);
    }

    const updated = await this.campStaffRepository.findStaffWithProfessionalInclude(id);
    log.info("camp_staff_status_changed", {
      staffId: id,
      from: existing.status,
      to: status,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "CAMP_STAFF_STATUS",
      "CampStaff",
      `${existing.professional?.name ?? "Staff member"} · ${existing.camp.title} → ${status}`,
      session.userId
    );
    return updated;
  }
}
