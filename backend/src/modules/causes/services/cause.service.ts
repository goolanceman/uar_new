/**
 * Cause service — all business rules for causes and pledges. Depends on the
 * repository contract plus the shared cause/workflow/recurring domain libs;
 * never touches HTTP.
 *
 * Field checks run in the exact legacy order (PATCH validates only after the
 * 404 lookup; pledge creation validates before the cause lookup) with the
 * verbatim wire messages.
 */
import { logger } from "@/lib/logger";
import { logActivity, ApiError, type Session } from "@/lib/session";
import {
  cached,
  cacheKeyPart,
  cacheTtl,
  causeDetailKey,
  causesListKey,
  invalidateCauses,
} from "@/lib/cache";
import { recomputeCause, CAUSE_STATUSES, CAUSE_TRANSITIONS } from "@/lib/causes";
import { pledgeSchedule, pledgeInstallments } from "@/lib/recurring";
import { assertTransition } from "@/lib/workflow";
import type {
  CauseListFilter,
  CauseRepository,
  CreatePledgeData,
  PledgeListFilter,
  UpdateCauseData,
} from "../repositories/cause.repository.interface";

const log = logger.child("causes");

const CONDITIONS = ["BP", "DIABETES", "THYROID", "CARDIAC", "ASTHMA", "ARTHRITIS", "OTHER"];

export class CauseService {
  constructor(private readonly causeRepository: CauseRepository) {}

  /** GET /api/causes?condition=&status=&q= (public, cached). */
  async list(filter: CauseListFilter) {
    return cached(
      causesListKey(cacheKeyPart({ condition: filter.condition, status: filter.status, q: filter.q })),
      cacheTtl.causes,
      () => this.causeRepository.list(filter)
    );
  }

  /** GET /api/causes/pledges?mine=1&causeId= (auth). */
  async listPledges(filter: PledgeListFilter, session: Session) {
    const pledges = await this.causeRepository.listPledges({
      donorId: filter.donorId ? session.userId : undefined,
      causeId: filter.causeId,
    });
    // Schedule/payment-tracking fields are additive — the flat pledge rows the
    // web portal and mobile app already parse keep their shape.
    const ids = pledges.map((p) => p.id);
    const payments = await this.causeRepository.listDonationsByPledgeIds(ids);
    return pledges.map((p) => {
      const mine = payments.filter((d) => d.pledgeId === p.id);
      return {
        ...p,
        ...pledgeSchedule(p, mine),
        installments: pledgeInstallments(mine),
      };
    });
  }

  /** POST /api/causes (ADMIN). */
  async create(rawBody: Record<string, unknown>, session: Session) {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const patientName = String(body.patientName ?? "").trim();
    const city = String(body.city ?? "").trim();
    const condition = String(body.condition ?? "").trim().toUpperCase();
    const story = String(body.story ?? "").trim();
    const age = Math.trunc(Number(body.age));
    const monthlyCost = Number(body.monthlyCost);
    const durationMonths = Math.trunc(Number(body.durationMonths ?? 12));

    if (!patientName || !city || !story)
      throw new ApiError("patientName, city and story are required", 400);
    if (!Number.isFinite(age) || age <= 0)
      throw new ApiError("age must be a positive number", 400);
    if (!Number.isFinite(monthlyCost) || monthlyCost <= 0)
      throw new ApiError("monthlyCost must be a positive number", 400);
    if (!Number.isFinite(durationMonths) || durationMonths < 1)
      throw new ApiError("durationMonths must be at least 1", 400);
    if (!CONDITIONS.includes(condition))
      throw new ApiError("Invalid condition", 400);

    // code UAR-MED-0001 — loop while exists
    const count = await this.causeRepository.count();
    let n = count + 1;
    let code = "";
    for (;;) {
      code = `UAR-MED-${String(n).padStart(4, "0")}`;
      const clash = await this.causeRepository.findByCode(code);
      if (!clash) break;
      n += 1;
    }

    const cause = await this.causeRepository.create({
      code,
      patientName,
      age,
      city,
      condition,
      monthlyCost,
      durationMonths,
      story,
    });

    log.info("cause_created", {
      causeId: cause.id,
      code: cause.code,
      condition,
      monthlyCost,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAUSE_CREATE",
      "Cause",
      `${cause.code} · ${patientName}`,
      session.userId
    );
    await invalidateCauses();
    return cause;
  }

  /** GET /api/causes/:id (public, cached). */
  async detail(id: string) {
    const cause = await cached(causeDetailKey(id), cacheTtl.causes, () =>
      this.causeRepository.findDetailById(id)
    );
    if (!cause) throw new ApiError("Cause not found", 404);
    return cause;
  }

  /** PATCH /api/causes/:id (ADMIN). */
  async update(id: string, rawBody: Record<string, unknown>, session: Session) {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const existing = await this.causeRepository.findById(id);
    if (!existing) {
      log.warn("cause_update_not_found", { causeId: id, actor: session.userId });
      throw new ApiError("Cause not found", 404);
    }

    const data: UpdateCauseData = {};
    if (body.patientName !== undefined)
      data.patientName = String(body.patientName).trim();
    if (body.age !== undefined) data.age = Math.trunc(Number(body.age));
    if (body.city !== undefined) data.city = String(body.city).trim();
    if (body.condition !== undefined)
      data.condition = String(body.condition).trim().toUpperCase();
    if (body.monthlyCost !== undefined) data.monthlyCost = Number(body.monthlyCost);
    if (body.durationMonths !== undefined)
      data.durationMonths = Math.trunc(Number(body.durationMonths));
    if (body.story !== undefined) data.story = String(body.story);
    const statusProvided = body.status !== undefined;
    if (statusProvided) {
      const s = String(body.status).trim().toUpperCase();
      if (!CAUSE_STATUSES.includes(s))
        throw new ApiError("status must be SEEKING, PARTIAL, ADOPTED or PAUSED", 400);
      assertTransition(CAUSE_TRANSITIONS, existing.status, s, "cause", 400);
      data.status = s;
    }

    await this.causeRepository.update(id, data);
    log.info("cause_updated", {
      causeId: id,
      code: existing.code,
      fields: Object.keys(data),
      ...(data.status ? { newStatus: data.status } : {}),
      actor: session.userId,
    });

    // If admin did not force a status, recompute it from the ACTIVE pledges.
    const cause = statusProvided
      ? await this.causeRepository.findDetailById(id)
      : await recomputeCause(id);

    await logActivity(
      session.name,
      "CAUSE_UPDATE",
      "Cause",
      `${existing.code}${statusProvided ? ` → ${String(body.status).toUpperCase()}` : ""}`,
      session.userId
    );
    await invalidateCauses();
    return cause;
  }

  /** DELETE /api/causes/:id (ADMIN) — removes the cause and its pledges. */
  async remove(id: string, session: Session) {
    const existing = await this.causeRepository.findById(id);
    if (!existing) {
      log.warn("cause_delete_not_found", { causeId: id, actor: session.userId });
      throw new ApiError("Cause not found", 404);
    }

    await this.causeRepository.deletePledges(id);
    await this.causeRepository.remove(id);
    log.info("cause_deleted", {
      causeId: id,
      code: existing.code,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAUSE_DELETE",
      "Cause",
      existing.code,
      session.userId
    );
    await invalidateCauses();
    return { ok: true };
  }

  /** POST /api/causes/:id/pledges — public (guests) OR authenticated donors. */
  async createPledge(id: string, rawBody: Record<string, unknown>, session: Session | null) {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const amountPerMonth = Number(body.amountPerMonth);
    const months = Math.trunc(Number(body.months ?? 6));
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0)
      throw new ApiError("amountPerMonth must be greater than 0", 400);
    if (!Number.isFinite(months) || months < 1)
      throw new ApiError("months must be at least 1", 400);

    const cause = await this.causeRepository.findById(id);
    if (!cause) {
      log.warn("cause_pledge_not_found", { causeId: id, actor: session?.userId ?? null });
      throw new ApiError("Cause not found", 404);
    }

    const donorName =
      String(body.donorName ?? "").trim() || session?.name || "Anonymous Donor";

    // The web portal and the app both send a start date for the mandate —
    // default to now when absent (legacy callers).
    let startDate = new Date();
    if (body.startDate) {
      const parsed = new Date(String(body.startDate));
      if (Number.isNaN(parsed.getTime()))
        throw new ApiError("startDate is not a valid date", 400);
      startDate = parsed;
    }

    const pledgeData: CreatePledgeData = {
      causeId: id,
      donorId: session?.userId ?? null,
      donorName,
      amountPerMonth,
      months,
      startDate,
      status: "ACTIVE",
    };
    const pledge = await this.causeRepository.createPledge(pledgeData);

    const updatedCause = await recomputeCause(id);
    log.info("cause_pledge_created", {
      pledgeId: pledge.id,
      causeCode: cause.code,
      amountPerMonth,
      months,
      actor: session?.userId ?? null,
    });
    await logActivity(
      session?.name ?? donorName,
      "PLEDGE",
      "Pledge",
      `${cause.code} · ₹${amountPerMonth}/mo × ${months}mo`,
      session?.userId
    );

    await invalidateCauses();
    return { pledge, cause: updatedCause };
  }
}
