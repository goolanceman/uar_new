/**
 * Pad distribution service — all business rules for pad drives. Depends on
 * the repository contract, throws application errors, never touches HTTP.
 *
 * POST/PATCH coercions replicate the legacy Math.trunc/Number/Boolean clamps
 * (invalid numbers become 0, bad dates fall back to now) — no new rejections.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ApiError } from "@/shared/errors";
import type {
  PadDistributionCreateData,
  PadDistributionListFilter,
  PadDistributionMutationRef,
  PadDistributionRepository,
  PadDistributionRow,
  PadDistributionUpdateData,
  PadDistributionVolunteerRef,
} from "../repositories/pad-distribution.repository.interface";

const log = logger.child("pad-distributions");

export type PadDistributionListPayload = {
  items: Array<Record<string, unknown> & { volunteer: PadDistributionVolunteerRef | null }>;
  total: number;
  count: number;
  sumPads: number;
  sumGirls: number;
  sumAttendees: number;
  sessions: number;
  schools: number;
};

export class PadDistributionService {
  constructor(private readonly padDistributionRepository: PadDistributionRepository) {}

  /**
   * GET /api/pad-distributions — default response is the raw item array
   * (legacy); withTotals=1 wraps it in the totals envelope.
   */
  async list(query: {
    q?: string;
    session?: boolean;
    from?: Date;
    to?: Date;
    volunteerId?: string;
    limit: number;
    offset: number;
    withTotals: boolean;
  }): Promise<Array<Record<string, unknown>> | PadDistributionListPayload> {
    const filter: PadDistributionListFilter = {
      q: query.q,
      session: query.session,
      from: query.from,
      to: query.to,
      volunteerId: query.volunteerId,
    };
    const { rows, total } = await this.padDistributionRepository.list(filter, query.limit, query.offset);

    // PadDistribution has volunteerId but no Prisma relation — attach manually.
    const volunteerIds = Array.from(
      new Set(rows.map((r) => r.volunteerId).filter((v): v is string => Boolean(v)))
    );
    const volunteers = await this.padDistributionRepository.listVolunteerNames(volunteerIds);
    const volunteerMap = new Map(volunteers.map((v) => [v.id, v]));

    const items = rows.map((r) => ({
      ...r,
      volunteer: r.volunteerId ? volunteerMap.get(r.volunteerId) ?? null : null,
    }));

    if (!query.withTotals) return items;

    const [agg, sessionAgg, schoolRows] = await Promise.all([
      this.padDistributionRepository.aggregateTotals(filter),
      this.padDistributionRepository.countAwarenessSessions(filter),
      this.padDistributionRepository.listDistinctSchools(filter),
    ]);

    return {
      items,
      total,
      count: total,
      sumPads: agg.padsDistributed ?? 0,
      sumGirls: agg.girlsCount ?? 0,
      sumAttendees: agg.sessionAttendees ?? 0,
      sessions: sessionAgg,
      schools: schoolRows.filter((s) => s.schoolName).length,
    };
  }

  /** POST /api/pad-distributions (VOLUNTEER | ADMIN). */
  async create(rawBody: Record<string, unknown>, session: Session): Promise<PadDistributionRow> {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const area = String(body.area ?? "").trim();
    if (!area) throw new ApiError("area is required", 400);

    const girlsCount = Math.max(0, Math.trunc(Number(body.girlsCount ?? 0)) || 0);
    const padsDistributed = Math.max(
      0,
      Math.trunc(Number(body.padsDistributed ?? 0)) || 0
    );
    const awarenessSession = Boolean(body.awarenessSession);
    const sessionAttendees =
      body.sessionAttendees !== undefined &&
      body.sessionAttendees !== null &&
      body.sessionAttendees !== ""
        ? Math.max(0, Math.trunc(Number(body.sessionAttendees)) || 0)
        : null;

    const distributionDateRaw = body.distributionDate
      ? new Date(String(body.distributionDate))
      : new Date();
    const distributionDate = Number.isNaN(distributionDateRaw.getTime())
      ? new Date()
      : distributionDateRaw;

    // Explicit volunteerId (admin assignment) wins; else session profile.
    let volunteerId: string | null = null;
    if (body.volunteerId) {
      const assigned = await this.padDistributionRepository.findVolunteerIdById(
        String(body.volunteerId)
      );
      if (!assigned) {
        log.warn("pad_drive_volunteer_not_found", { volunteerId: body.volunteerId, actor: session.userId });
        throw new ApiError("Volunteer not found", 400);
      }
      volunteerId = assigned.id;
    } else {
      const volunteer = await this.padDistributionRepository.findVolunteerIdByUserId(session.userId);
      volunteerId = volunteer?.id ?? null;
    }

    const row = await this.padDistributionRepository.create({
      schoolName: body.schoolName ? String(body.schoolName).trim() : null,
      area,
      girlsCount,
      padsDistributed,
      awarenessSession,
      sessionAttendees,
      notes: body.notes ? String(body.notes) : null,
      volunteerId,
      volunteerName: body.volunteerName ? String(body.volunteerName).trim() : (volunteerId ? null : session.name),
      distributionDate,
    });

    log.info("pad_drive_created", {
      padDistributionId: row.id,
      area,
      padsDistributed,
      girlsCount,
      awarenessSession,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "PAD_DRIVE",
      "PadDistribution",
      `${area} · ${padsDistributed} pads · ${girlsCount} girls`,
      session.userId
    );
    return row;
  }

  /** GET /api/pad-distributions/:id — detail with volunteer name. */
  async detail(id: string) {
    const row = await this.padDistributionRepository.findById(id);
    if (!row) throw new ApiError("Pad distribution not found", 404);

    let volunteer: { id: string; name: string } | null = null;
    if (row.volunteerId) {
      const v = await this.padDistributionRepository.findVolunteerNameById(row.volunteerId);
      if (v) volunteer = { id: v.id, name: v.name };
    }
    return { ...row, volunteer };
  }

  /** ADMIN may edit anything; VOLUNTEER only drives attributed to them. */
  private async assertCanMutate(session: Session, id: string): Promise<PadDistributionMutationRef> {
    const existing = await this.padDistributionRepository.findForMutation(id);
    if (!existing) {
      log.warn("pad_drive_not_found", { padDistributionId: id, actor: session.userId });
      throw new ApiError("Pad distribution not found", 404);
    }
    if (session.role !== "ADMIN") {
      const own = await this.padDistributionRepository.findVolunteerIdByUserId(session.userId);
      if (!own || existing.volunteerId !== own.id) {
        log.warn("pad_drive_not_owner", {
          padDistributionId: id,
          area: existing.area,
          actor: session.userId,
        });
        throw new ApiError("You can only manage pad drives you recorded", 403);
      }
    }
    return existing;
  }

  /** PATCH /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER). */
  async update(id: string, rawBody: Record<string, unknown>, session: Session) {
    const body = (rawBody ?? {}) as Record<string, unknown>;
    await this.assertCanMutate(session, id);

    const data: PadDistributionUpdateData = {};
    if (body.schoolName !== undefined)
      data.schoolName = body.schoolName ? String(body.schoolName).trim() : null;
    if (body.area !== undefined) {
      const area = String(body.area).trim();
      if (!area) throw new ApiError("area cannot be empty", 400);
      data.area = area;
    }
    if (body.girlsCount !== undefined)
      data.girlsCount = Math.max(0, Math.trunc(Number(body.girlsCount)) || 0);
    if (body.padsDistributed !== undefined)
      data.padsDistributed = Math.max(
        0,
        Math.trunc(Number(body.padsDistributed)) || 0
      );
    if (body.awarenessSession !== undefined)
      data.awarenessSession = Boolean(body.awarenessSession);
    if (body.sessionAttendees !== undefined)
      data.sessionAttendees =
        body.sessionAttendees === null || body.sessionAttendees === ""
          ? null
          : Math.max(0, Math.trunc(Number(body.sessionAttendees)) || 0);
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (body.volunteerName !== undefined)
      data.volunteerName = body.volunteerName ? String(body.volunteerName).trim() : null;
    if (body.distributionDate !== undefined) {
      const d = new Date(String(body.distributionDate));
      if (Number.isNaN(d.getTime()))
        throw new ApiError("Invalid distributionDate", 400);
      data.distributionDate = d;
    }
    if (body.volunteerId !== undefined) {
      if (!body.volunteerId) data.volunteerId = null;
      else {
        const v = await this.padDistributionRepository.findVolunteerIdById(
          String(body.volunteerId)
        );
        if (!v) {
          log.warn("pad_drive_volunteer_not_found", { volunteerId: body.volunteerId, padDistributionId: id, actor: session.userId });
          throw new ApiError("Volunteer not found", 400);
        }
        data.volunteerId = v.id;
      }
    }

    const row = await this.padDistributionRepository.update(id, data);
    log.info("pad_drive_updated", {
      padDistributionId: id,
      area: row.area,
      padsDistributed: row.padsDistributed,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "PAD_DRIVE_UPDATE",
      "PadDistribution",
      id,
      session.userId
    );
    return row;
  }

  /** DELETE /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER). */
  async remove(id: string, session: Session) {
    const existing = await this.assertCanMutate(session, id);

    await this.padDistributionRepository.remove(id);
    log.info("pad_drive_deleted", {
      padDistributionId: id,
      area: existing.area,
      padsDistributed: existing.padsDistributed,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "PAD_DRIVE_DELETE",
      "PadDistribution",
      `${existing.area} · ${existing.padsDistributed} pads`,
      session.userId
    );
    return { ok: true };
  }
}
