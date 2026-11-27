/**
 * Medical camp service — camp lifecycle rules (DRAFT→SCHEDULED→LIVE→
 * COMPLETED / CANCELLED, terminal states cannot reopen), public/anonymous
 * list scoping, and print-count projections. Depends on the repository
 * contract, throws application errors, never touches HTTP. Field checks keep
 * the legacy order exactly and every log event keeps its legacy name.
 */
import type { MedicalCamp } from "@prisma/client";
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { nextCampCode } from "@/lib/health-codes";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  CampCounts,
  CampCreateData,
  CampDetailRow,
  CampListFilter,
  CampListRow,
  MedicalCampRepository,
  MedicalCampUpdatePatch,
} from "../repositories/medical-camp.repository.interface";
import type {
  CreateCampBody,
  ListCampsQuery,
  UpdateCampBody,
} from "../schemas/medical-camp.schema";

const log = logger.child("medical-camps");

const CAMP_STATUSES = ["DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"];

/** Allowed forward transitions — COMPLETED and CANCELLED are terminal. */
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["LIVE", "CANCELLED"],
  LIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export interface CampListEnvelope {
  items: CampListRow[];
  total: number;
  page: number;
  pages: number;
}

export class MedicalCampService {
  constructor(private readonly medicalCampRepository: MedicalCampRepository) {}

  /**
   * GET /api/medical-camps?q&status&city&campaignId&upcoming=1&withCounts=1&page&limit
   * PUBLIC for anonymous visitors: only SCHEDULED/LIVE/COMPLETED camps, with
   * internal fields (notes, budget, createdByName) stripped. Authenticated
   * users (staff/roles) get the full record set.
   */
  async list(query: ListCampsQuery, session: Session | null): Promise<CampListEnvelope> {
    const requestedStatus = query.status
      ? CAMP_STATUSES.includes(query.status)
        ? query.status
        : query.status.toUpperCase()
      : undefined;

    const filter: CampListFilter = {
      status: requestedStatus,
      anonymous: !session,
      city: query.city,
      campaignId: query.campaignId,
      upcoming: query.upcoming,
      q: query.q,
    };

    const { rows, total } = await this.medicalCampRepository.listWithCount(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
      query.upcoming
    );

    let items: CampListRow[] = rows;
    if (query.withCounts && rows.length) {
      const ids = rows.map((c) => c.id);
      const { checkedIn, completed } = await this.medicalCampRepository.attendanceCounts(ids);
      const checkedInMap = new Map(checkedIn.map((r) => [r.campId, r.total]));
      const completedMap = new Map(completed.map((r) => [r.campId, r.total]));
      items = rows.map((c) => ({
        ...c,
        counts: {
          registrations: c._count.registrations,
          checkedIn: checkedInMap.get(c.id) ?? 0,
          completed: completedMap.get(c.id) ?? 0,
        },
      }));
    }

    // Strip internal fields from public (anonymous) responses.
    if (!session) {
      items = items.map((c) => {
        const { notes: _notes, budget: _budget, createdByName: _createdBy, ...pub } = c as CampListRow & {
          notes?: unknown;
          budget?: unknown;
          createdByName?: unknown;
        };
        void _notes;
        void _budget;
        void _createdBy;
        return pub as CampListRow;
      });
    }

    return {
      items,
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** POST /api/medical-camps (ADMIN) — auto code, createdByName from session */
  async create(body: CreateCampBody, session: Session): Promise<MedicalCamp> {
    const title = String(body.title ?? "").trim();
    if (!title) throw new ApiError("title is required", 400);
    const venue = String(body.venue ?? "").trim();
    if (!venue) throw new ApiError("venue is required", 400);

    const campDate = body.campDate ? new Date(String(body.campDate)) : null;
    if (!campDate || Number.isNaN(campDate.getTime()))
      throw new ApiError("campDate is required and must be a valid date", 400);

    let capacity = 200;
    if (body.capacity !== undefined && String(body.capacity).trim() !== "") {
      capacity = Math.trunc(Number(body.capacity));
      if (!Number.isFinite(capacity) || capacity < 1)
        throw new ApiError("capacity must be a positive number", 400);
    }

    if (body.campaignId) {
      const campaign = await this.medicalCampRepository.findCampaignById(String(body.campaignId));
      if (!campaign) {
        log.warn("medical_camp_campaign_not_found", {
          campaignId: String(body.campaignId),
          actor: session.userId,
        });
        throw new NotFoundError("Campaign not found");
      }
    }

    const code = await nextCampCode();
    const data: CampCreateData = {
      code,
      title,
      description: body.description ? String(body.description).trim() : null,
      campaignId: body.campaignId ? String(body.campaignId) : null,
      campDate,
      startTime: body.startTime ? String(body.startTime).trim() : null,
      endTime: body.endTime ? String(body.endTime).trim() : null,
      venue,
      city: body.city ? String(body.city).trim() : null,
      capacity,
      expectedCount: body.expectedCount ? Math.trunc(Number(body.expectedCount)) : null,
      services: stringList(body.services),
      coordinatorName: body.coordinatorName ? String(body.coordinatorName).trim() : null,
      budget: body.budget !== undefined && body.budget !== null && String(body.budget).trim() !== ""
        ? Number(body.budget)
        : null,
      notes: body.notes ? String(body.notes).trim() : null,
      createdByName: session.name,
    };
    const camp = await this.medicalCampRepository.create(data);

    log.info("medical_camp_created", {
      campId: camp.id,
      code: camp.code,
      city: camp.city,
      status: camp.status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_CREATE",
      "MedicalCamp",
      `${camp.code} — ${camp.title}`,
      session.userId
    );
    return camp;
  }

  /** GET /api/medical-camps/:id — any authenticated user; partners, staff and counts */
  async get(id: string): Promise<CampDetailRow & { counts: CampCounts }> {
    const camp = await this.medicalCampRepository.findDetailById(id);
    if (!camp) throw new NotFoundError("Camp not found");

    const counts = await this.medicalCampRepository.countsForCamp(id);

    return { ...camp, counts };
  }

  /**
   * PATCH /api/medical-camps/:id (ADMIN) — field edits + validated lifecycle
   * DRAFT→SCHEDULED→LIVE→COMPLETED / CANCELLED (terminal states cannot reopen).
   */
  async update(id: string, body: UpdateCampBody, session: Session): Promise<MedicalCamp> {
    const existing = await this.medicalCampRepository.findById(id);
    if (!existing) {
      log.warn("medical_camp_update_not_found", { campId: id, actor: session.userId });
      throw new NotFoundError("Camp not found");
    }

    const data: MedicalCampUpdatePatch = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!CAMP_STATUSES.includes(status))
        throw new ApiError("Invalid status", 400);
      if (status !== existing.status) {
        const allowed = TRANSITIONS[existing.status] ?? [];
        if (!allowed.includes(status)) {
          log.warn("medical_camp_invalid_transition", {
            campId: id,
            from: existing.status,
            to: status,
            actor: session.userId,
          });
          throw new ApiError(
            `Cannot move camp from ${existing.status} to ${status}`,
            409
          );
        }
        data.status = status;
      }
    }

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw new ApiError("title cannot be empty", 400);
      data.title = title;
    }
    if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
    if (body.campDate !== undefined) {
      const campDate = new Date(String(body.campDate));
      if (Number.isNaN(campDate.getTime()))
        throw new ApiError("campDate is not a valid date", 400);
      data.campDate = campDate;
    }
    if (body.startTime !== undefined) data.startTime = body.startTime ? String(body.startTime).trim() : null;
    if (body.endTime !== undefined) data.endTime = body.endTime ? String(body.endTime).trim() : null;
    if (body.venue !== undefined) {
      const venue = String(body.venue).trim();
      if (!venue) throw new ApiError("venue cannot be empty", 400);
      data.venue = venue;
    }
    if (body.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body.capacity !== undefined) {
      const capacity = Math.trunc(Number(body.capacity));
      if (!Number.isFinite(capacity) || capacity < 1)
        throw new ApiError("capacity must be a positive number", 400);
      data.capacity = capacity;
    }
    if (body.expectedCount !== undefined)
      data.expectedCount = body.expectedCount === null ? null : Math.trunc(Number(body.expectedCount));
    if (body.services !== undefined) data.services = stringList(body.services);
    if (body.coordinatorName !== undefined) data.coordinatorName = body.coordinatorName ? String(body.coordinatorName).trim() : null;
    if (body.budget !== undefined)
      data.budget = body.budget === null || String(body.budget).trim() === "" ? null : Number(body.budget);
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const camp = await this.medicalCampRepository.update(id, data);
    log.info("medical_camp_updated", {
      campId: id,
      code: camp.code,
      fields: Object.keys(data),
      ...(body.status !== undefined ? { newStatus: camp.status } : {}),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "CAMP_UPDATE",
      "MedicalCamp",
      `${camp.code}${body.status !== undefined ? ` → ${camp.status}` : ""}`,
      session.userId
    );
    return camp;
  }

  /** DELETE /api/medical-camps/:id (ADMIN) — only DRAFT camps with no registrations */
  async remove(id: string, session: Session): Promise<{ ok: boolean }> {
    const existing = await this.medicalCampRepository.findWithRegistrationCount(id);
    if (!existing) {
      log.warn("medical_camp_delete_not_found", { campId: id, actor: session.userId });
      throw new NotFoundError("Camp not found");
    }
    if (existing.status !== "DRAFT") {
      log.warn("medical_camp_delete_blocked_status", {
        campId: id,
        status: existing.status,
        actor: session.userId,
      });
      throw new ApiError("Only camps in DRAFT status can be deleted", 409);
    }
    if (existing._count.registrations > 0) {
      log.warn("medical_camp_delete_blocked_registrations", {
        campId: id,
        registrations: existing._count.registrations,
        actor: session.userId,
      });
      throw new ApiError("This camp has registrations and cannot be deleted", 409);
    }

    await this.medicalCampRepository.delete(id); // partners + staff cascade

    log.info("medical_camp_deleted", {
      campId: id,
      code: existing.code,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMP_DELETE",
      "MedicalCamp",
      `${existing.code} — ${existing.title}`,
      session.userId
    );
    return { ok: true };
  }
}

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
