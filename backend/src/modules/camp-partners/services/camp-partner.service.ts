/**
 * Camp partner service — invitation and response workflow for camp
 * organisations. Depends on the repository contract, throws application
 * errors, never touches HTTP. Field checks keep the legacy order exactly
 * (camp/org lookups BEFORE the role check; ownership gate BEFORE the status
 * checks) and every log event keeps its legacy name.
 */
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { PARTNER_RESPONSE_STATUSES, PARTNER_TRANSITIONS } from "@/lib/camp-partners";
import { assertTransition } from "@/lib/workflow";
import { ApiError, ConflictError, NotFoundError } from "@/shared/errors";
import type {
  CampPartnerRepository,
  CampPartnerWithFullRefs,
  CampPartnerWithRefs,
} from "../repositories/camp-partner.repository.interface";
import type { ListCampPartnersQuery } from "../schemas/camp-partner.schema";

const log = logger.child("camp-partners");

const PARTNER_ROLES = ["HOST", "SUPPORT", "SPONSOR"];

const RESPONSE_STATUSES = PARTNER_RESPONSE_STATUSES;

export interface CampPartnerListEnvelope {
  items: CampPartnerWithRefs[];
  total: number;
  page: number;
  pages: number;
}

export class CampPartnerService {
  constructor(private readonly campPartnerRepository: CampPartnerRepository) {}

  /** GET /api/camp-partners?campId&status — ADMIN all; HOSPITAL its own invitations. */
  async list(query: ListCampPartnersQuery, session: Session): Promise<CampPartnerListEnvelope> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const filter: { campId?: string; status?: string; orgId?: string } = {};
    if (query.campId) filter.campId = query.campId;
    if (query.status) filter.status = query.status;
    if (session.role === "HOSPITAL") {
      const ownOrgId = await this.campPartnerRepository.findOrgIdByOwner(session.userId);
      if (!ownOrgId) return { items: [], total: 0, page, pages: 1 };
      filter.orgId = ownOrgId;
    }

    const { rows, total } = await this.campPartnerRepository.list(filter, skip, limit);
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** POST /api/camp-partners (ADMIN) {campId, orgId, role} — invite an org (INVITED). */
  async invite(session: Session, body: Record<string, unknown>): Promise<CampPartnerWithRefs> {
    const campId = String(body.campId ?? "").trim();
    const orgId = String(body.orgId ?? "").trim();
    if (!campId) throw new ApiError("campId is required", 400);
    if (!orgId) throw new ApiError("orgId is required", 400);

    const camp = await this.campPartnerRepository.findCampById(campId);
    if (!camp) {
      log.warn("camp_partner_camp_not_found", { campId, actor: session.userId });
      throw new NotFoundError("Camp not found");
    }
    const org = await this.campPartnerRepository.findOrgById(orgId);
    if (!org) {
      log.warn("camp_partner_org_not_found", { orgId, campId, actor: session.userId });
      throw new NotFoundError("Organisation not found");
    }

    const role = String(body.role ?? "SUPPORT").trim().toUpperCase();
    if (!PARTNER_ROLES.includes(role)) throw new ApiError("Invalid role", 400);

    const duplicate = await this.campPartnerRepository.findPartnerByCampAndOrg(campId, orgId);
    if (duplicate) {
      log.warn("camp_partner_duplicate", {
        campId,
        orgId,
        partnerId: duplicate.id,
        actor: session.userId,
      });
      throw new ConflictError("This organisation is already a partner of this camp");
    }

    const partner = await this.campPartnerRepository.createPartner({ campId, orgId, role });

    log.info("camp_partner_invited", {
      partnerId: partner.id,
      campId,
      orgId,
      role,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_PARTNER_ADD",
      "CampPartner",
      `${org.name} invited as ${role} for ${camp.title}`,
      session.userId
    );
    return partner;
  }

  /** PATCH /api/camp-partners/:id — ADMIN, or the HOSPITAL owning the invited org.
   *  {status: ACCEPTED|DECLINED, notes?} — respondedAt is stamped server-side. */
  async respond(
    id: string,
    session: Session,
    body: Record<string, unknown>
  ): Promise<CampPartnerWithRefs> {
    const partner = await this.campPartnerRepository.findPartnerWithRefsById(id);
    if (!partner) {
      log.warn("camp_partner_update_not_found", { partnerId: id, actor: session.userId });
      throw new NotFoundError("Camp partner record not found");
    }

    if (session.role === "HOSPITAL" && partner.org.ownerUserId !== session.userId) {
      log.warn("camp_partner_update_forbidden", {
        partnerId: id,
        orgId: partner.orgId,
        actor: session.userId,
      });
      throw new ApiError("You do not have permission for this action", 403);
    }

    const data: { status?: string; notes?: string | null; respondedAt?: Date; role?: string } = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!RESPONSE_STATUSES.includes(status))
        throw new ApiError("status must be ACCEPTED or DECLINED", 400);
      if (partner.status !== status && !PARTNER_TRANSITIONS[partner.status]?.includes(status))
        log.warn("camp_partner_invalid_transition", {
          partnerId: id,
          from: partner.status,
          to: status,
          actor: session.userId,
        });
      assertTransition(PARTNER_TRANSITIONS, partner.status, status, "camp partner");
      data.status = status;
      data.respondedAt = new Date();
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;
    if (session.role === "ADMIN" && body.role !== undefined) {
      const role = String(body.role).trim().toUpperCase();
      if (!["HOST", "SUPPORT", "SPONSOR"].includes(role))
        throw new ApiError("Invalid role", 400);
      data.role = role;
    }

    const updated = await this.campPartnerRepository.updatePartner(id, data);

    log.info("camp_partner_updated", {
      partnerId: id,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: updated.status } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_PARTNER_RESPOND",
      "CampPartner",
      `${updated.org.name} ${updated.status.toLowerCase()} invitation for ${updated.camp.title}`,
      session.userId
    );
    return updated;
  }
}
