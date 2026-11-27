/**
 * Sponsorship service — assignment rules for donor ↔ beneficiary monthly
 * sponsorships plus the preview-only matcher. Depends on the repository
 * contract, throws application errors, never touches HTTP. Field checks keep
 * the legacy order exactly (beneficiary lookup → donor resolution → recurring
 * need checks → amount validation on POST; existence → role/ownership gates →
 * field checks on PATCH) and every log event keeps its legacy name.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import {
  SPONSORSHIP_STATUSES,
  DONOR_ALLOWED_SPONSORSHIP_STATUSES,
} from "@/modules/sponsorships/services/sponsorships.domain";
import { monthlyEquivalent } from "@/domains/distribution-stock";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  MatchDonor,
  MatchNeed,
  SponsorshipListFilter,
  SponsorshipRepository,
  SponsorshipRow,
  SponsorshipUpdatedRow,
} from "../repositories/sponsorship.repository.interface";
import type {
  CreateSponsorshipBody,
  ListSponsorshipsQuery,
  UpdateSponsorshipBody,
} from "../schemas/sponsorship.schema";

const log = logger.child("sponsorships");

const STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

const SP_STATUSES = SPONSORSHIP_STATUSES;

// A donor managing their own sponsorship may only toggle it off/on or cancel —
// never edit the amount, months or re-activate a staff-completed/cancelled one.
const DONOR_ALLOWED_STATUSES = DONOR_ALLOWED_SPONSORSHIP_STATUSES;

const URGENCY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export interface SponsorshipSuggestion {
  recurringNeedId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryCity: string | null;
  urgencyLevel: string;
  itemName: string;
  unit: string;
  qtyPerCycle: number;
  cycle: string;
  suggestedAmountPerMonth: number;
  donorId: string;
  donorName: string;
  donorEmail: string | null;
}

export interface SponsorshipMatchEnvelope {
  enabled: boolean;
  suggestions: SponsorshipSuggestion[];
  unmatchedNeeds: number;
  availableDonors: number;
}

export class SponsorshipService {
  constructor(private readonly sponsorshipRepository: SponsorshipRepository) {}

  private async getSettings(): Promise<Record<string, string>> {
    const rows = await this.sponsorshipRepository.findMatchingSettings();
    const map: Record<string, string> = {
      "matching.enabled": "true",
      "matching.donorCategory": "MONTHLY",
      "matching.minMonthlyAmount": "500",
      "matching.maxActivePerDonor": "3",
    };
    for (const r of rows) map[r.key] = r.value;
    return map;
  }

  /**
   * GET /api/sponsorships?beneficiaryId=&donorId=&status=&mine=1
   * Staff (ADMIN | VOLUNTEER) see any slice via query filters. A logged-in
   * DONOR may only pass mine=1, which scopes to their own Donor record
   * (resolved via Donor.userId) — so donors can see what they're sponsoring.
   */
  async list(query: ListSponsorshipsQuery, session: Session): Promise<SponsorshipRow[]> {
    const where: SponsorshipListFilter = {};

    if (query.mine) {
      const donorId = await this.sponsorshipRepository.findDonorIdByUserId(session.userId);
      where.donorId = donorId ?? "__none__";
    } else {
      if (!["ADMIN", "VOLUNTEER"].includes(session.role))
        throw new ApiError("You do not have permission for this action", 403);

      const beneficiaryId = query.beneficiaryId?.trim();
      if (beneficiaryId) where.beneficiaryId = beneficiaryId;

      const donorId = query.donorId?.trim();
      if (donorId) where.donorId = donorId;

      const status = query.status?.trim().toUpperCase();
      if (status && STATUSES.includes(status)) where.status = status;
    }

    return this.sponsorshipRepository.list(where);
  }

  /**
   * GET /api/sponsorships/match (ADMIN | VOLUNTEER)
   * Suggests donor <-> beneficiary pairings: active recurring needs that have
   * no live sponsorship, matched against donors in the configured recurring
   * category who aren't already at their active-sponsorship cap. Suggestions
   * are preview-only — confirming one is a normal POST /api/sponsorships call.
   */
  async match(): Promise<SponsorshipMatchEnvelope> {
    const settings = await this.getSettings();
    const enabled = settings["matching.enabled"] !== "false";
    const minMonthly = Math.max(0, Number(settings["matching.minMonthlyAmount"]) || 500);
    const maxPerDonor = Math.max(1, Math.trunc(Number(settings["matching.maxActivePerDonor"]) || 3));
    const donorCategory = (settings["matching.donorCategory"] || "MONTHLY").trim();

    if (!enabled) {
      log.debug("sponsorship_match_disabled");
      return { enabled: false, suggestions: [], unmatchedNeeds: 0, availableDonors: 0 };
    }

    const needs = await this.sponsorshipRepository.listMatchableNeeds();

    const donors = await this.sponsorshipRepository.listDonorsWithLoad(donorCategory);
    const pool = donors
      .filter((d) => d._count.sponsorships < maxPerDonor)
      .sort((a, b) => a._count.sponsorships - b._count.sponsorships);

    const load = new Map(pool.map((d) => [d.id, d._count.sponsorships]));
    const sortedNeeds = [...needs].sort((a, b) => {
      const ra = URGENCY_RANK[a.beneficiary.urgencyLevel] ?? 4;
      const rb = URGENCY_RANK[b.beneficiary.urgencyLevel] ?? 4;
      if (ra !== rb) return ra - rb;
      return new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime();
    });

    const suggestions: SponsorshipSuggestion[] = [];

    let cursor = 0;
    for (const need of sortedNeeds) {
      if (pool.length === 0) break;
      // round-robin starting from cursor, skip donors already at cap
      let picked: MatchDonor | null = null;
      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[(cursor + i) % pool.length];
        if ((load.get(candidate.id) ?? 0) < maxPerDonor) {
          picked = candidate;
          cursor = (cursor + i + 1) % pool.length;
          break;
        }
      }
      if (!picked) {
        log.debug("sponsorship_match_pool_exhausted", {
          suggestions: suggestions.length,
          unmatchedNeeds: needs.length,
        });
        break;
      }
      load.set(picked.id, (load.get(picked.id) ?? 0) + 1);

      const monthlyQty = monthlyEquivalent(need.qtyPerCycle, need.cycle);
      const unitPrice = need.item.pricePerUnit ?? 0;
      const suggestedAmount = Math.max(minMonthly, Math.round(monthlyQty * unitPrice));

      suggestions.push({
        recurringNeedId: need.id,
        beneficiaryId: need.beneficiaryId,
        beneficiaryName: need.beneficiary.name,
        beneficiaryCity: need.beneficiary.city,
        urgencyLevel: need.beneficiary.urgencyLevel,
        itemName: need.item.name,
        unit: need.item.unit,
        qtyPerCycle: need.qtyPerCycle,
        cycle: need.cycle,
        suggestedAmountPerMonth: suggestedAmount,
        donorId: picked.id,
        donorName: picked.name,
        donorEmail: picked.email,
      });
    }

    return {
      enabled: true,
      suggestions,
      unmatchedNeeds: needs.length,
      availableDonors: pool.length,
    };
  }

  /**
   * POST /api/sponsorships (ADMIN | VOLUNTEER) — manually assign a donor to
   * sponsor a beneficiary's monthly support (optionally tied to one recurring
   * need, e.g. "cover BP tablets every month").
   */
  async create(body: CreateSponsorshipBody, session: Session): Promise<SponsorshipRow> {
    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await this.sponsorshipRepository.findBeneficiaryById(beneficiaryId);
    if (!beneficiary) {
      log.warn("sponsorship_beneficiary_not_found", { beneficiaryId, actor: session.userId });
      throw new NotFoundError("Beneficiary not found");
    }

    const donorId = body.donorId ? String(body.donorId).trim() : null;
    let donorName = body.donorName ? String(body.donorName).trim() : "";
    if (donorId) {
      const donor = await this.sponsorshipRepository.findDonorById(donorId);
      if (!donor) {
        log.warn("sponsorship_donor_not_found", { donorId, actor: session.userId });
        throw new NotFoundError("Donor not found");
      }
      donorName = donor.name;
    }
    if (!donorName) throw new ApiError("donorId or donorName is required", 400);

    const recurringNeedId = body.recurringNeedId ? String(body.recurringNeedId).trim() : null;
    if (recurringNeedId) {
      const need = await this.sponsorshipRepository.findRecurringNeedById(recurringNeedId);
      if (!need) {
        log.warn("sponsorship_need_not_found", { recurringNeedId, actor: session.userId });
        throw new NotFoundError("Recurring need not found");
      }
      if (need.beneficiaryId !== beneficiaryId) {
        log.warn("sponsorship_need_beneficiary_mismatch", {
          recurringNeedId,
          beneficiaryId,
          actor: session.userId,
        });
        throw new ApiError("Recurring need does not belong to this beneficiary", 400);
      }
    }

    const amountPerMonth = Number(body.amountPerMonth);
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0)
      throw new ApiError("amountPerMonth must be a positive number", 400);

    const months = Math.max(1, Math.trunc(Number(body.months) || 6));

    const row = await this.sponsorshipRepository.create({
      beneficiaryId,
      donorId,
      donorName,
      recurringNeedId,
      amountPerMonth,
      months,
      notes: body.notes ? String(body.notes).trim() : null,
      source: body.source === "AUTO_MATCH" ? "AUTO_MATCH" : "MANUAL",
      assignedByName: session.name,
    });

    log.info("sponsorship_created", {
      sponsorshipId: row.id,
      beneficiaryId,
      donorId,
      amountPerMonth,
      months,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CREATE",
      "BeneficiarySponsorship",
      `${donorName} → ${beneficiary.name} \u20b9${amountPerMonth}/mo`,
      session.userId
    );

    return row;
  }

  /**
   * PATCH /api/sponsorships/:id
   * Staff (ADMIN | VOLUNTEER) may edit anything. A DONOR may only pause/resume
   * or cancel a sponsorship that belongs to their own Donor record.
   */
  async update(id: string, body: UpdateSponsorshipBody, session: Session): Promise<SponsorshipUpdatedRow> {
    const existing = await this.sponsorshipRepository.findById(id);
    if (!existing) {
      log.warn("sponsorship_update_not_found", { sponsorshipId: id, actor: session.userId });
      throw new NotFoundError("Sponsorship not found");
    }

    const isStaff = ["ADMIN", "VOLUNTEER"].includes(session.role);
    if (!isStaff) {
      if (session.role !== "DONOR") {
        log.warn("sponsorship_update_forbidden", {
          sponsorshipId: id,
          reason: "role",
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
      const donorId = await this.sponsorshipRepository.findDonorIdByUserId(session.userId);
      if (!donorId || existing.donorId !== donorId) {
        log.warn("sponsorship_update_forbidden", {
          sponsorshipId: id,
          reason: "not_owner",
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
    }

    const data: {
      status?: string;
      amountPerMonth?: number;
      months?: number;
      notes?: string | null;
    } = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!SP_STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      if (!isStaff && !DONOR_ALLOWED_STATUSES.includes(status)) {
        log.warn("sponsorship_update_forbidden", {
          sponsorshipId: id,
          reason: "donor_status_not_allowed",
          status,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
      data.status = status;
    }
    if (!isStaff && (body.amountPerMonth !== undefined || body.months !== undefined)) {
      log.warn("sponsorship_update_forbidden", {
        sponsorshipId: id,
        reason: "donor_field_change_not_allowed",
        actor: session.userId,
      });
      throw new ApiError("You do not have permission for this action", 403);
    }
    if (body.amountPerMonth !== undefined) {
      const amt = Number(body.amountPerMonth);
      if (!Number.isFinite(amt) || amt <= 0) throw new ApiError("amountPerMonth must be positive", 400);
      data.amountPerMonth = amt;
    }
    if (body.months !== undefined) data.months = Math.max(1, Math.trunc(Number(body.months) || 6));
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const row = await this.sponsorshipRepository.update(id, data);

    log.info("sponsorship_updated", {
      sponsorshipId: id,
      fields: Object.keys(data),
      ...(data.status ? { newStatus: data.status } : {}),
      actor: session.userId,
    });
    await logActivity(session.name, "UPDATE", "BeneficiarySponsorship", JSON.stringify(data), session.userId);
    return row;
  }

  /** DELETE /api/sponsorships/:id (ADMIN only) — remove a sponsorship assignment */
  async remove(id: string, session: Session): Promise<{ ok: boolean }> {
    const existing = await this.sponsorshipRepository.findById(id);
    if (!existing) {
      log.warn("sponsorship_delete_not_found", { sponsorshipId: id, actor: session.userId });
      throw new NotFoundError("Sponsorship not found");
    }

    await this.sponsorshipRepository.delete(id);
    log.info("sponsorship_deleted", { sponsorshipId: id, actor: session.userId });
    await logActivity(session.name, "DELETE", "BeneficiarySponsorship", id, session.userId);
    return { ok: true };
  }
}
