/**
 * Health professional service — all business rules for the professional
 * directory. Depends on the repository contract, throws application errors,
 * never touches HTTP. Field checks keep the legacy order exactly
 * (name → kind → org gate → email → experienceYears on POST; existence →
 * ownership → verification gates → per-field checks on PATCH) and every log
 * event keeps its legacy name.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  HealthProfessionalDetailRow,
  HealthProfessionalListRow,
  HealthProfessionalRepository,
  HealthProfessionalSavedRow,
} from "../repositories/health-professional.repository.interface";
import type {
  CreateHealthProfessionalBody,
  ListHealthProfessionalsQuery,
  UpdateHealthProfessionalBody,
} from "../schemas/health-professional.schema";

const log = logger.child("health-professionals");

const KINDS = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH", "OTHER"];

const VERIFICATION_STATUSES: readonly string[] = ["PENDING", "VERIFIED", "REJECTED"];
const VERIFICATION_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["VERIFIED", "REJECTED"],
  VERIFIED: [],
  REJECTED: [],
};

export interface HealthProfessionalListEnvelope {
  items: HealthProfessionalListRow[];
  total: number;
  page: number;
  pages: number;
}

export class HealthProfessionalService {
  constructor(private readonly healthProfessionalRepository: HealthProfessionalRepository) {}

  /** GET /api/health-professionals?q&kind&orgId&verificationStatus&active
   *  ADMIN: full directory. HOSPITAL: scoped to its own org. */
  async list(
    query: ListHealthProfessionalsQuery,
    session: Session
  ): Promise<HealthProfessionalListEnvelope> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const filter = {
      q: query.q,
      kind: query.kind,
      orgId: query.orgId,
      verificationStatus: query.verificationStatus,
      active: query.active === "1" ? true : query.active === "0" ? false : undefined,
    };
    if (session.role === "HOSPITAL") {
      const ownOrgId = await this.healthProfessionalRepository.findOrgIdByOwner(session.userId);
      if (!ownOrgId) return { items: [], total: 0, page, pages: 1 };
      filter.orgId = ownOrgId;
    }

    const { rows, total } = await this.healthProfessionalRepository.list(filter, skip, limit);
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** POST /api/health-professionals — ADMIN anywhere, HOSPITAL within its own
   *  org (orgId forced server-side). New professionals start PENDING; verify
   *  via PATCH. */
  async create(body: CreateHealthProfessionalBody, session: Session): Promise<HealthProfessionalSavedRow> {
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);

    const kind = String(body.kind ?? "DOCTOR").trim().toUpperCase();
    if (!KINDS.includes(kind)) throw new ApiError("Invalid kind", 400);

    let orgId = body.orgId ? String(body.orgId) : null;
    if (session.role === "HOSPITAL") {
      const ownOrgId = await this.healthProfessionalRepository.findOrgIdByOwner(session.userId);
      if (!ownOrgId) {
        log.warn("health_professional_no_linked_org", { actor: session.userId });
        throw new ApiError("Your account is not linked to an organisation", 403);
      }
      orgId = ownOrgId;
    } else if (orgId) {
      const org = await this.healthProfessionalRepository.findOrgById(orgId);
      if (!org) {
        log.warn("health_professional_org_not_found", { orgId, actor: session.userId });
        throw new ApiError("Organisation not found", 404);
      }
    }

    const email = body.email ? String(body.email).trim() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ApiError("email is not a valid address", 400);

    let experienceYears: number | null = null;
    if (body.experienceYears !== undefined && body.experienceYears !== null && String(body.experienceYears).trim() !== "") {
      experienceYears = Math.trunc(Number(body.experienceYears));
      if (!Number.isFinite(experienceYears) || experienceYears < 0)
        throw new ApiError("experienceYears must be 0 or more", 400);
    }

    const professional = await this.healthProfessionalRepository.create({
      name,
      kind,
      orgId,
      regNumber: body.regNumber ? String(body.regNumber).trim() : null,
      qualification: body.qualification ? String(body.qualification).trim() : null,
      speciality: body.speciality ? String(body.speciality).trim() : null,
      experienceYears,
      phone: body.phone ? String(body.phone).trim() : null,
      email,
      availability: body.availability ? String(body.availability) : null,
    });

    log.info("health_professional_created", {
      professionalId: professional.id,
      kind: professional.kind,
      ...(professional.orgId ? { orgId: professional.orgId } : {}),
      verificationStatus: professional.verificationStatus,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "HEALTH_PRO_ADD",
      "HealthProfessional",
      `${professional.name} (${kind})`,
      session.userId
    );
    return professional;
  }

  /** GET /api/health-professionals/:id — ADMIN, or the HOSPITAL owning the pro's org. */
  async getDetail(id: string, session: Session): Promise<HealthProfessionalDetailRow> {
    const professional = await this.healthProfessionalRepository.findDetailById(id);
    if (!professional) throw new NotFoundError("Professional not found");
    if (session.role === "HOSPITAL") {
      const ownOrgId = await this.healthProfessionalRepository.findOrgIdByOwner(session.userId);
      if (!ownOrgId || professional.orgId !== ownOrgId)
        throw new ApiError("You do not have permission for this action", 403);
    }
    return professional;
  }

  /** PATCH /api/health-professionals/:id
   *  ADMIN: full profile + verification (verificationStatus + verifiedByName/At).
   *  Owning HOSPITAL: profile fields only — cannot self-verify. */
  async update(
    id: string,
    body: UpdateHealthProfessionalBody,
    session: Session
  ): Promise<HealthProfessionalSavedRow> {
    const existing = await this.healthProfessionalRepository.findById(id);
    if (!existing) {
      log.warn("health_professional_update_not_found", {
        professionalId: id,
        actor: session.userId,
      });
      throw new NotFoundError("Professional not found");
    }

    const isAdmin = session.role === "ADMIN";
    if (!isAdmin) {
      const ownOrgId = await this.healthProfessionalRepository.findOrgIdByOwner(session.userId);
      if (!ownOrgId || existing.orgId !== ownOrgId) {
        log.warn("health_professional_update_forbidden", {
          professionalId: id,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
    }

    if (!isAdmin && body.verificationStatus !== undefined) {
      log.warn("health_professional_verify_forbidden", {
        professionalId: id,
        actor: session.userId,
      });
      throw new ApiError("Only an administrator can verify a professional", 403);
    }

    const data: Prisma.HealthProfessionalUpdateInput = {};

    if (body.verificationStatus !== undefined) {
      const status = String(body.verificationStatus).trim().toUpperCase();
      if (!VERIFICATION_STATUSES.includes(status))
        throw new ApiError("Invalid verificationStatus", 400);
      if (status !== existing.verificationStatus && !(VERIFICATION_TRANSITIONS[existing.verificationStatus] ?? []).includes(status)) {
        log.warn("health_professional_invalid_verification_transition", {
          professionalId: id,
          from: existing.verificationStatus,
          to: status,
          actor: session.userId,
        });
        throw new ApiError(`Cannot move professional verification from ${existing.verificationStatus} to ${status}`, 409);
      }
      data.verificationStatus = status;
      data.verifiedByName = status === "PENDING" ? null : session.name;
      data.verifiedAt = status === "PENDING" ? null : new Date();
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("name cannot be empty", 400);
      data.name = name;
    }
    if (body.kind !== undefined) data.kind = String(body.kind).trim().toUpperCase();
    if (body.orgId !== undefined && isAdmin) {
      if (body.orgId) {
        const org = await this.healthProfessionalRepository.findOrgById(String(body.orgId));
        if (!org) {
          log.warn("health_professional_org_not_found", {
            orgId: String(body.orgId),
            professionalId: id,
            actor: session.userId,
          });
          throw new ApiError("Organisation not found", 404);
        }
        data.org = { connect: { id: String(body.orgId) } };
      } else {
        data.org = { disconnect: true };
      }
    }
    if (body.regNumber !== undefined) data.regNumber = body.regNumber ? String(body.regNumber).trim() : null;
    if (body.qualification !== undefined) data.qualification = body.qualification ? String(body.qualification).trim() : null;
    if (body.speciality !== undefined) data.speciality = body.speciality ? String(body.speciality).trim() : null;
    if (body.experienceYears !== undefined) {
      if (body.experienceYears === null || String(body.experienceYears).trim() === "") {
        data.experienceYears = null;
      } else {
        const years = Math.trunc(Number(body.experienceYears));
        if (!Number.isFinite(years) || years < 0)
          throw new ApiError("experienceYears must be 0 or more", 400);
        data.experienceYears = years;
      }
    }
    if (body.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() : null;
    if (body.email !== undefined) data.email = body.email ? String(body.email).trim() : null;
    if (body.availability !== undefined) data.availability = body.availability ? String(body.availability) : null;
    if (body.active !== undefined) data.active = Boolean(body.active);

    const professional = await this.healthProfessionalRepository.update(id, data);
    log.info("health_professional_updated", {
      professionalId: id,
      fields: Object.keys(data),
      ...(data.verificationStatus !== undefined
        ? { newVerificationStatus: professional.verificationStatus }
        : {}),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      body.verificationStatus !== undefined ? "HEALTH_PRO_VERIFY" : "HEALTH_PRO_UPDATE",
      "HealthProfessional",
      `${professional.name}${body.verificationStatus !== undefined ? ` → ${professional.verificationStatus}` : ""}`,
      session.userId
    );
    return professional;
  }
}
