/**
 * Health org service — all business rules for healthcare organisations.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Field checks keep the legacy order exactly (name → type →
 * status → email on POST; existence → ownership gate (which strips
 * status/notes) → status transition → per-field checks on PATCH) and every
 * log event keeps its legacy name.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ORG_STATUSES, ORG_TRANSITIONS } from "@/modules/health-orgs/services/health-orgs.domain";
import { assertTransition } from "@/shared/workflow";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Prisma } from "@prisma/client";
import type {
  HealthOrgAdminListFilter,
  HealthOrgDetailRow,
  HealthOrgDirectoryRow,
  HealthOrgListRow,
  HealthOrgRepository,
} from "../repositories/health-org.repository.interface";
import type {
  CreateHealthOrgBody,
  ListHealthOrgsQuery,
  UpdateHealthOrgBody,
} from "../schemas/health-org.schema";

const log = logger.child("health-orgs");

const ORG_TYPES = [
  "HOSPITAL", "CLINIC", "LAB", "MEDICAL_COLLEGE", "DENTAL", "EYE_CARE",
  "PHARMACY", "BLOOD_BANK", "PRACTITIONER", "CSR",
];

/** Normalise an array | comma string | JSON array string into a JSON array string. */
function stringList(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  let raw: unknown = v;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = s.split(",");
    }
  }
  if (!Array.isArray(raw)) return null;
  const arr = raw.map((x) => String(x).trim()).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : null;
}

export interface HealthOrgListEnvelope {
  /** ADMIN/HOSPITAL get owner + counts; DOCTOR gets the directory select. */
  items: HealthOrgListRow[] | HealthOrgDirectoryRow[];
  total: number;
  page: number;
  pages: number;
}

export class HealthOrgService {
  constructor(private readonly healthOrgRepository: HealthOrgRepository) {}

  /** GET /api/health-orgs — ADMIN sees all (q/status/type filters);
   *  HOSPITAL sees only the org it owns; DOCTOR gets the verified directory. */
  async list(query: ListHealthOrgsQuery, session: Session): Promise<HealthOrgListEnvelope> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    // Doctors pick a receiving org for referrals: verified orgs, directory fields only.
    if (session.role === "DOCTOR") {
      const { rows, total } = await this.healthOrgRepository.listDoctorDirectory(query.q, query.type, skip, limit);
      return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    }

    const filter: HealthOrgAdminListFilter = { q: query.q, status: query.status, type: query.type };
    if (session.role === "HOSPITAL") {
      // An owner sees exactly their org regardless of q/status/type.
      filter.q = undefined;
      filter.status = undefined;
      filter.type = undefined;
      filter.ownerUserId = session.userId;
    }

    const { rows, total } = await this.healthOrgRepository.listAdmin(filter, skip, limit);
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** POST /api/health-orgs (ADMIN) — orgs are created PENDING until verified.
   *  Public self-registration is intentionally NOT exposed on this endpoint. */
  async create(body: CreateHealthOrgBody, session: Session) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("name is required", 400);

    const type = String(body.type ?? "HOSPITAL").trim().toUpperCase();
    if (!ORG_TYPES.includes(type)) throw new ApiError("Invalid org type", 400);
    if (body.status && !ORG_STATUSES.includes(String(body.status).trim().toUpperCase()))
      throw new ApiError("Invalid status", 400);

    const email = body.email ? String(body.email).trim() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ApiError("email is not a valid address", 400);

    const org = await this.healthOrgRepository.createOrg({
      name,
      type,
      city: body.city ? String(body.city).trim() : null,
      address: body.address ? String(body.address).trim() : null,
      phone: body.phone ? String(body.phone).trim() : null,
      email,
      website: body.website ? String(body.website).trim() : null,
      regNumber: body.regNumber ? String(body.regNumber).trim() : null,
      licences: stringList(body.licences),
      services: stringList(body.services),
      facilities: body.facilities ? String(body.facilities).trim() : null,
      operatingHours: body.operatingHours ? String(body.operatingHours).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
    });

    log.info("health_org_created", {
      orgId: org.id,
      type: org.type,
      status: org.status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "HEALTH_ORG_ADD",
      "HealthcareOrg",
      `${org.name} (${org.type})`,
      session.userId
    );
    return org;
  }

  /** GET /api/health-orgs/:id — ADMIN, or the HOSPITAL user that owns the org. */
  async getDetail(id: string, session: Session): Promise<HealthOrgDetailRow> {
    const org = await this.healthOrgRepository.findDetailById(id);
    if (!org) throw new NotFoundError("Organisation not found");
    if (session.role === "HOSPITAL" && org.ownerUserId !== session.userId)
      throw new ApiError("You do not have permission for this action", 403);
    return org;
  }

  /** PATCH /api/health-orgs/:id (ADMIN) — verification (status + verifiedByName/
   *  verifiedAt) or plain field edits. The owning HOSPITAL edits its own
   *  profile; verification stays with admins. */
  async update(id: string, body: UpdateHealthOrgBody, session: Session) {
    const existing = await this.healthOrgRepository.findById(id);
    if (!existing) {
      log.warn("health_org_update_not_found", { orgId: id, actor: session.userId });
      throw new NotFoundError("Organisation not found");
    }
    // The owning partner edits its own profile; verification stays with admins.
    const patch = { ...body };
    if (session.role === "HOSPITAL") {
      if (existing.ownerUserId !== session.userId) {
        log.warn("health_org_update_forbidden", {
          orgId: id,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
      delete patch.status;
      delete patch.notes;
    }

    const data: Prisma.HealthcareOrgUpdateInput = {};

    if (patch.status !== undefined) {
      const status = String(patch.status).trim().toUpperCase();
      if (!ORG_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      if (status !== existing.status && !ORG_TRANSITIONS[existing.status]?.includes(status))
        log.warn("health_org_invalid_transition", {
          orgId: id,
          from: existing.status,
          to: status,
          actor: session.userId,
        });
      assertTransition(ORG_TRANSITIONS, existing.status, status, "health org");
      data.status = status;
      // Verification events are stamped server-side — never trust the client.
      if (status === "VERIFIED" || status === "REJECTED") {
        data.verifiedByName = session.name;
        data.verifiedAt = new Date();
      } else {
        data.verifiedByName = null;
        data.verifiedAt = null;
      }
    }

    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw new ApiError("name cannot be empty", 400);
      data.name = name;
    }
    if (patch.type !== undefined) data.type = String(patch.type).trim().toUpperCase();
    if (patch.city !== undefined) data.city = patch.city ? String(patch.city).trim() : null;
    if (patch.address !== undefined) data.address = patch.address ? String(patch.address).trim() : null;
    if (patch.phone !== undefined) data.phone = patch.phone ? String(patch.phone).trim() : null;
    if (patch.email !== undefined) data.email = patch.email ? String(patch.email).trim() : null;
    if (patch.website !== undefined) data.website = patch.website ? String(patch.website).trim() : null;
    if (patch.regNumber !== undefined) data.regNumber = patch.regNumber ? String(patch.regNumber).trim() : null;
    if (patch.licences !== undefined) data.licences = stringList(patch.licences);
    if (patch.services !== undefined) data.services = stringList(patch.services);
    if (patch.facilities !== undefined) data.facilities = patch.facilities ? String(patch.facilities).trim() : null;
    if (patch.operatingHours !== undefined) data.operatingHours = patch.operatingHours ? String(patch.operatingHours).trim() : null;
    if (patch.notes !== undefined) data.notes = patch.notes ? String(patch.notes).trim() : null;

    const org = await this.healthOrgRepository.updateOrg(id, data);
    log.info("health_org_updated", {
      orgId: id,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: org.status } : {}),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      patch.status !== undefined ? "HEALTH_ORG_VERIFY" : "HEALTH_ORG_UPDATE",
      "HealthcareOrg",
      `${org.name}${patch.status !== undefined ? ` → ${org.status}` : ""}`,
      session.userId
    );
    return org;
  }

  /** DELETE /api/health-orgs/:id (ADMIN) — only when the org has no camp partnerships. */
  async remove(id: string, session: Session): Promise<{ ok: boolean }> {
    const existing = await this.healthOrgRepository.findWithPartnerCount(id);
    if (!existing) {
      log.warn("health_org_delete_not_found", { orgId: id, actor: session.userId });
      throw new NotFoundError("Organisation not found");
    }
    if (existing._count.campPartners > 0) {
      log.warn("health_org_delete_blocked_partnerships", {
        orgId: id,
        campPartners: existing._count.campPartners,
        actor: session.userId,
      });
      throw new ApiError(
        "This organisation has camp partnerships and cannot be deleted",
        409
      );
    }

    // Release optional references so SQLite FKs stay satisfied
    await this.healthOrgRepository.detachProfessionals(id);
    await this.healthOrgRepository.detachReferrals(id);
    await this.healthOrgRepository.deleteOrg(id);

    log.info("health_org_deleted", {
      orgId: id,
      status: existing.status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "HEALTH_ORG_DELETE",
      "HealthcareOrg",
      existing.name,
      session.userId
    );
    return { ok: true };
  }
}
