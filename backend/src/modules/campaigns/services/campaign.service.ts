/**
 * Campaign service — list/detail projections, admin CRUD and urgent-appeal
 * rules. Depends on the repository contract plus the shared campaign/codes
 * domain libs; never touches HTTP.
 *
 * Field checks run in the exact legacy order (PATCH validates only after the
 * 404 lookup; POST runs the unique-slug query between field checks) with the
 * verbatim wire messages. Every mutation drops the campaign cache exactly
 * like the legacy routes did, after the activity log entry.
 */
import { logger } from "@/infrastructure/logging/logger";
import { logActivity, ApiError, type Session } from "@/infrastructure/auth/session";
import { nextCampaignCode } from "@/domains/codes";
import { CAMPAIGN_STATUSES } from "@/modules/campaigns/services/campaigns.domain";
import {
  cached,
  cacheKeyPart,
  cacheTtl,
  campaignDetailKey,
  campaignListKey,
  invalidateCampaigns,
} from "@/infrastructure/cache";
import type { Prisma } from "@prisma/client";
import type {
  CampaignListFilter,
  CampaignRepository,
  CampaignRow,
} from "../repositories/campaign.repository.interface";
import type { ListCampaignsQuery } from "../schemas/campaign.schema";

const log = logger.child("campaigns");

// ─── Public projections ──────────────────────────────────────────────────────

/** A list row — full campaign + the computed fields every client gets. */
export type CampaignListRow = CampaignRow & {
  supporterCount: number;
  donorCount: number;
  progressPct: number;
  daysLeft: number | null;
};

/** A detail row — full campaign + donorCount (no supporterCount). */
export type CampaignDetailRow = CampaignRow & {
  donorCount: number;
  progressPct: number;
  daysLeft: number | null;
};

/** Legacy callers get the plain array; `?page=` opts into the envelope. */
export type CampaignListPayload =
  | CampaignListRow[]
  | { items: CampaignListRow[]; total: number; page: number; pages: number };

// ─── Urgency rules ───────────────────────────────────────────────────────────

const URGENCY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Severity rank used to break ties when urgencyPriority is equal. */
const URGENCY_SEVERITY: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/** Urgency fields the shared validator produces — spread into create/update data. */
interface UrgencyPatchData {
  urgent?: boolean;
  urgencyLevel?: string | null;
  urgencyPriority?: number;
  urgencyReason?: string | null;
  urgentSince?: Date | null;
  urgentUntil?: Date | null;
  urgentSetById?: string | null;
}

/** An appeal counts as active only while urgentUntil is in the future (auto-expire). */
function urgentActive(c: { urgent: boolean; urgentUntil: Date | null }): boolean {
  return Boolean(c.urgent) && (!c.urgentUntil || c.urgentUntil.getTime() > Date.now());
}

/** Reads project expired appeals as non-urgent without touching the DB row. */
function expireUrgency<T extends { urgent: boolean; urgentUntil: Date | null }>(c: T): T {
  return urgentActive(c) ? c : { ...c, urgent: false };
}

function progressPctOf(raised: number, target: number): number {
  return target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
}

/** Whole days until the deadline (negative = passed); null when there is none. */
function daysLeftOf(endDate: Date | null | undefined): number | null {
  if (!endDate) return null;
  return Math.ceil((endDate.getTime() - Date.now()) / 86_400_000);
}

/** Validates + resolves the urgency fields shared by PATCH /:id/urgency and the
 *  general PATCH /:id (which must not be able to bypass these rules).
 *  body.urgent=true requires a reason + a future deadline; urgent=false clears
 *  every urgency field so stale banners can never linger. */
function resolveUrgencyPatch(
  existing: {
    urgent: boolean;
    urgencyLevel: string | null;
    urgencyPriority: number;
    urgencyReason: string | null;
    urgentUntil: Date | null;
  },
  body: Record<string, unknown>
): { data: UrgencyPatchData; targetAmount?: number } {
  const data: UrgencyPatchData = {};

  if (body.urgent === false) {
    data.urgent = false;
    data.urgencyLevel = null;
    data.urgencyPriority = 0;
    data.urgencyReason = null;
    data.urgentSince = null;
    data.urgentUntil = null;
    data.urgentSetById = null;
    if (body.targetAmount !== undefined && body.targetAmount !== null) {
      const target = Number(body.targetAmount);
      if (!Number.isFinite(target) || target <= 0)
        throw new ApiError("Target amount must be a positive number", 400);
      return { data, targetAmount: target };
    }
    return { data };
  }

  const level =
    body.urgencyLevel !== undefined ? String(body.urgencyLevel) : (existing.urgencyLevel ?? "HIGH");
  if (!URGENCY_LEVELS.includes(level as (typeof URGENCY_LEVELS)[number]))
    throw new ApiError("urgencyLevel must be one of LOW, MEDIUM, HIGH, CRITICAL", 400);
  const reason =
    body.urgencyReason !== undefined ? String(body.urgencyReason).trim() : (existing.urgencyReason ?? "");
  let until: Date | null;
  if (body.urgentUntil !== undefined) {
    until = body.urgentUntil ? new Date(String(body.urgentUntil)) : null;
  } else {
    until = existing.urgentUntil;
  }
  const priority =
    body.urgencyPriority !== undefined ? Number(body.urgencyPriority) : (existing.urgencyPriority ?? 0);
  if (!Number.isInteger(priority) || priority < 0)
    throw new ApiError("urgencyPriority must be a whole number ≥ 0", 400);

  if (body.urgent === true) {
    // Activating (or re-confirming) an appeal — full validation applies.
    if (!reason) throw new ApiError("A reason is required when marking a campaign urgent", 400);
    if (!until || Number.isNaN(until.getTime()))
      throw new ApiError("An urgent deadline (urgentUntil) is required when activating an urgent appeal", 400);
    if (until.getTime() <= Date.now())
      throw new ApiError("The urgent deadline must be in the future", 400);
    data.urgent = true;
    data.urgencyLevel = level;
    data.urgencyPriority = priority;
    data.urgencyReason = reason;
    data.urgentUntil = until;
    data.urgentSince = new Date();
  } else {
    // Field-level tweak while the flag itself is untouched.
    if (body.urgencyLevel !== undefined) data.urgencyLevel = level;
    if (body.urgencyPriority !== undefined) data.urgencyPriority = priority;
    if (body.urgencyReason !== undefined) {
      if (!reason && existing.urgent) throw new ApiError("A reason is required while the urgent appeal is active", 400);
      data.urgencyReason = reason;
    }
    if (body.urgentUntil !== undefined) {
      if (until && Number.isNaN(until.getTime())) throw new ApiError("The urgent deadline is invalid", 400);
      if (until && until.getTime() <= Date.now())
        throw new ApiError("The urgent deadline must be in the future", 400);
      data.urgentUntil = until;
    }
  }

  if (body.targetAmount !== undefined && body.targetAmount !== null) {
    const target = Number(body.targetAmount);
    if (!Number.isFinite(target) || target <= 0)
      throw new ApiError("Target amount must be a positive number", 400);
    return { data, targetAmount: target };
  }
  return { data };
}

export class CampaignService {
  constructor(private readonly campaignRepository: CampaignRepository) {}

  /** GET /api/campaigns — public/admin list (cached). */
  async list(query: ListCampaignsQuery, session: Session | null): Promise<CampaignListPayload> {
    const isAdmin = session?.role === "ADMIN";
    const { all, category, status, q, featured, urgent: urgentOnly, sort, pageParam, page, limit } = query;

    // Admin "all" includes drafts, so it is a different cache entry from the
    // public list. Search and filters are part of the key.
    const listKey = campaignListKey(
      cacheKeyPart({
        admin: isAdmin && all ? 1 : 0,
        category,
        status,
        q,
        featured: featured ? 1 : 0,
        urgent: urgentOnly ? 1 : 0,
        sort,
        page: pageParam !== null ? page : 0,
        limit: pageParam !== null ? limit : 0,
      })
    );

    return cached(listKey, cacheTtl.campaign, () =>
      this.loadCampaignList({
        isAdmin,
        all,
        category,
        status,
        q,
        featured,
        urgentOnly,
        sort,
        pageParam,
        limit,
        page,
      })
    );
  }

  private async loadCampaignList(opts: {
    isAdmin: boolean;
    all: boolean;
    category: string | null;
    status: string | null;
    q: string | undefined;
    featured: boolean;
    urgentOnly: boolean;
    sort: string;
    pageParam: string | null;
    limit: number;
    page: number;
  }): Promise<CampaignListPayload> {
    const { isAdmin, all, category, status, q, featured, urgentOnly, sort, pageParam, limit, page } = opts;
    const filter: CampaignListFilter = { isAdmin, all, category, status, q, featured, urgentOnly };
    const campaigns = await this.campaignRepository.list(filter);

    // Supporter/donor count per campaign (distinct completed donations) — shown
    // on public cards/detail pages the way crowdfunding sites show "N supporters".
    const ids = campaigns.map((c) => c.id);
    const [counts, trend] = await Promise.all([
      this.campaignRepository.supporterCounts(ids),
      // Trending = completed donation volume over the last 14 days.
      this.campaignRepository.trendVolume(ids, new Date(Date.now() - 14 * 86_400_000)),
    ]);
    const countMap = new Map(counts.map((c) => [c.campaignId, c._count._all]));
    const trendMap = new Map(trend.map((c) => [c.campaignId, c._sum.amount ?? 0]));

    const rows: CampaignListRow[] = campaigns.map((c) => ({
      ...expireUrgency(c),
      supporterCount: countMap.get(c.id) ?? 0,
      donorCount: countMap.get(c.id) ?? 0,
      progressPct: progressPctOf(c.raisedAmount, c.targetAmount),
      daysLeft: daysLeftOf(c.endDate),
    }));

    switch (sort) {
      case "trending":
        rows.sort(
          (a, b) =>
            (trendMap.get(b.id) ?? 0) - (trendMap.get(a.id) ?? 0) || b.raisedAmount - a.raisedAmount
        );
        break;
      case "recent":
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        break;
      case "ending": {
        rows.sort((a, b) => {
          if (a.endDate === null && b.endDate === null) return 0;
          if (a.endDate === null) return 1; // open-ended last
          if (b.endDate === null) return -1;
          return a.endDate.getTime() - b.endDate.getTime();
        });
        break;
      }
      case "progress":
        rows.sort(
          (a, b) => b.progressPct - a.progressPct || b.raisedAmount - a.raisedAmount
        );
        break;
      case "":
      case undefined:
        // Urgent appeals bubble to the top of the default (unsorted) list.
        rows.sort(
          (a, b) =>
            Number(b.urgent) - Number(a.urgent) ||
            Number(b.featured) - Number(a.featured) ||
            b.createdAt.getTime() - a.createdAt.getTime()
        );
        break;
    }

    if (urgentOnly) {
      rows.sort(
        (a, b) =>
          b.urgencyPriority - a.urgencyPriority ||
          (URGENCY_SEVERITY[b.urgencyLevel ?? "LOW"] ?? 0) -
            (URGENCY_SEVERITY[a.urgencyLevel ?? "LOW"] ?? 0) ||
          (a.urgentUntil?.getTime() ?? Infinity) - (b.urgentUntil?.getTime() ?? Infinity)
      );
    }

    // Legacy callers get the plain array; `?page=` opts into the envelope.
    if (pageParam !== null) {
      const total = rows.length;
      const pages = Math.max(1, Math.ceil(total / limit));
      return {
        items: rows.slice((page - 1) * limit, page * limit),
        total,
        page,
        pages,
      };
    }

    return rows;
  }

  /** POST /api/campaigns — admin creates a campaign. */
  async create(rawBody: Record<string, unknown>, session: Session): Promise<CampaignRow> {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const title = String(body?.title ?? "").trim();
    const description = String(body?.description ?? "").trim();
    const category = String(body?.category ?? "GENERAL");
    const targetAmount = Number(body?.targetAmount);

    if (!title || !description)
      throw new ApiError("Title and description are required", 400);
    if (!Number.isFinite(targetAmount) || targetAmount <= 0)
      throw new ApiError("Target amount must be a positive number", 400);

    const slug = body?.slug ? String(body.slug).trim() : await this.uniqueSlug(title);
    const startDate = body?.startDate ? new Date(String(body.startDate)) : new Date();
    if (Number.isNaN(startDate.getTime()))
      throw new ApiError("Start date is invalid", 400);
    const endDate = body?.endDate ? new Date(String(body.endDate)) : null;
    if (endDate && Number.isNaN(endDate.getTime()))
      throw new ApiError("End date is invalid", 400);
    if (endDate && endDate < startDate)
      throw new ApiError("End date must be after the start date", 400);
    const minDonation = body?.minDonation ? Number(body.minDonation) : null;
    if (minDonation !== null && (!Number.isFinite(minDonation) || minDonation <= 0))
      throw new ApiError("Minimum donation must be a positive number", 400);

    // Urgency goes through the same validator as the PATCH routes — an urgent
    // appeal cannot be created without its reason + future deadline.
    const urgency = resolveUrgencyPatch(
      { urgent: false, urgencyLevel: null, urgencyPriority: 0, urgencyReason: null, urgentUntil: null },
      { urgent: Boolean(body?.urgent), urgencyLevel: body?.urgencyLevel, urgencyReason: body?.urgencyReason, urgentUntil: body?.urgentUntil, urgencyPriority: body?.urgencyPriority, targetAmount: undefined }
    );

    const campaign = await this.campaignRepository.create({
      code: await nextCampaignCode(),
      title,
      slug,
      tagline: body?.tagline ? String(body.tagline).trim() : "",
      description,
      category,
      targetAmount,
      startDate,
      endDate,
      location: body?.location ? String(body.location).trim() : null,
      icon: body?.icon ? String(body.icon) : "heart",
      accent: body?.accent ? String(body.accent) : "emerald",
      helpline: body?.helpline ? String(body.helpline).trim() : null,
      featured: Boolean(body?.featured),
      taxEligible: body?.taxEligible === undefined ? true : Boolean(body.taxEligible),
      minDonation,
      videoUrl: body?.videoUrl ? String(body.videoUrl).trim() : null,
      gallery: body?.gallery ? JSON.stringify(body.gallery) : null,
      coverImage: body?.coverImage ? String(body.coverImage).trim() : null,
      budgetBreakdown: body?.budgetBreakdown ? JSON.stringify(body.budgetBreakdown) : null,
      coordinatorName: body?.coordinatorName ? String(body.coordinatorName).trim() : null,
      coordinatorPhone: body?.coordinatorPhone ? String(body.coordinatorPhone).trim() : null,
      seoTitle: body?.seoTitle ? String(body.seoTitle).trim() : null,
      seoDescription: body?.seoDescription ? String(body.seoDescription).trim() : null,
      status: body?.status ? String(body.status) : "ACTIVE",
      createdBy: session.userId,
      ...urgency.data,
      ...(urgency.targetAmount !== undefined ? { targetAmount: urgency.targetAmount } : {}),
    });

    log.info("campaign_created", {
      campaignId: campaign.id,
      code: campaign.code,
      title: campaign.title,
      targetAmount: campaign.targetAmount,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMPAIGN_CREATE",
      "CAMPAIGN",
      `${campaign.title} (₹${campaign.targetAmount})`,
      session.userId
    );
    await invalidateCampaigns();

    return campaign;
  }

  /** GET /api/campaigns/:id — by id, falling back to slug (cached). */
  async detail(id: string): Promise<CampaignDetailRow> {
    // Detail is cached by the path param (id or slug). A miss on a deleted
    // id is not cached, so a typo never occupies a slot until TTL.
    const payload = await cached(campaignDetailKey(id), cacheTtl.campaign, async (): Promise<CampaignDetailRow | null> => {
      let campaign = await this.campaignRepository.findById(id);
      if (!campaign) {
        campaign = await this.campaignRepository.findBySlug(id);
      }
      if (!campaign) return null;

      // Same projection as the list: auto-expired appeals read as non-urgent and
      // the computed fields every client gets.
      const donorCount = await this.campaignRepository.countCompletedDonations(campaign.id);
      return {
        ...expireUrgency(campaign),
        donorCount,
        progressPct: progressPctOf(campaign.raisedAmount, campaign.targetAmount),
        daysLeft: daysLeftOf(campaign.endDate),
      };
    });
    if (!payload) throw new ApiError("Campaign not found", 404);
    return payload;
  }

  /** PATCH /api/campaigns/:id/urgency — ADMIN/MODERATOR manages the urgent appeal
   *  (toggle, level, priority, reason, funding deadline and optionally the target). */
  async updateUrgency(id: string, rawBody: Record<string, unknown>, session: Session): Promise<CampaignRow> {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const existing = await this.campaignRepository.findById(id);
    if (!existing) {
      log.warn("campaign_urgency_not_found", { campaignId: id, actor: session.userId });
      throw new ApiError("Campaign not found", 404);
    }
    if (body.urgent === undefined) throw new ApiError("The urgent flag is required", 400);

    const { data, targetAmount } = resolveUrgencyPatch(existing, body);
    const campaign = await this.campaignRepository.update(id, {
      ...data,
      ...(data.urgent === true ? { urgentSetById: session.userId } : {}),
      ...(targetAmount !== undefined ? { targetAmount } : {}),
    });

    log.info("campaign_urgency_updated", {
      campaignId: id,
      code: campaign.code,
      urgent: campaign.urgent,
      urgencyLevel: campaign.urgencyLevel,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      data.urgent === false ? "CAMPAIGN_URGENCY_CLEAR" : "CAMPAIGN_URGENCY_SET",
      "CAMPAIGN",
      `${campaign.title} → urgent=${campaign.urgent}${campaign.urgencyLevel ? `, level=${campaign.urgencyLevel}` : ""}${campaign.urgentUntil ? `, until=${campaign.urgentUntil.toISOString()}` : ""}`,
      session.userId
    );
    await invalidateCampaigns();

    return campaign;
  }

  /** PATCH /api/campaigns/:id — admin edits a campaign (full whitelist). */
  async update(id: string, rawBody: Record<string, unknown>, session: Session): Promise<CampaignRow> {
    const body = (rawBody ?? {}) as Record<string, unknown>;

    const existing = await this.campaignRepository.findById(id);
    if (!existing) {
      log.warn("campaign_update_not_found", { campaignId: id, actor: session.userId });
      throw new ApiError("Campaign not found", 404);
    }

    const data: Prisma.CampaignUncheckedUpdateInput = {};
    if (body?.title !== undefined) {
      const v = String(body.title).trim();
      if (!v) throw new ApiError("Title cannot be empty", 400);
      data.title = v;
    }
    if (body?.slug !== undefined && body.slug) {
      const slug = String(body.slug)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) throw new ApiError("Slug is invalid", 400);
      const taken = await this.campaignRepository.findSlugConflict(slug, id);
      if (taken) {
        log.warn("campaign_slug_conflict", {
          slug,
          campaignId: id,
          actor: session.userId,
        });
        throw new ApiError("That slug is already in use", 409);
      }
      data.slug = slug;
    }
    if (body?.tagline !== undefined) data.tagline = body.tagline ? String(body.tagline) : "";
    if (body?.description !== undefined) {
      const v = String(body.description);
      if (!v.trim()) throw new ApiError("Description cannot be empty", 400);
      data.description = v;
    }
    if (body?.category !== undefined) data.category = String(body.category);
    if (body?.targetAmount !== undefined) {
      const target = Number(body.targetAmount);
      if (!Number.isFinite(target) || target <= 0)
        throw new ApiError("Target amount must be a positive number", 400);
      data.targetAmount = target;
    }
    if (body?.startDate !== undefined && body.startDate) {
      const d = new Date(String(body.startDate));
      if (Number.isNaN(d.getTime())) throw new ApiError("Start date is invalid", 400);
      data.startDate = d;
    }
    if (body?.endDate !== undefined) {
      const d = body.endDate ? new Date(String(body.endDate)) : null;
      if (d && Number.isNaN(d.getTime())) throw new ApiError("End date is invalid", 400);
      data.endDate = d;
    }
    if (body?.location !== undefined)
      data.location = body.location ? String(body.location).trim() : null;
    if (body?.icon !== undefined) data.icon = String(body.icon);
    if (body?.accent !== undefined) data.accent = String(body.accent);
    if (body?.helpline !== undefined) data.helpline = body.helpline ? String(body.helpline) : null;
    if (body?.featured !== undefined) data.featured = Boolean(body.featured);
    if (body?.taxEligible !== undefined) data.taxEligible = Boolean(body.taxEligible);

    // Urgency fields route through the shared validator — the general edit
    // endpoint cannot bypass the activation rules or clear fields ad hoc.
    if (
      body?.urgent !== undefined ||
      body?.urgencyLevel !== undefined ||
      body?.urgencyPriority !== undefined ||
      body?.urgencyReason !== undefined ||
      body?.urgentUntil !== undefined
    ) {
      const { data: urgencyData } = resolveUrgencyPatch(existing, body as Record<string, unknown>);
      Object.assign(data, urgencyData);
      if (data.urgent === true) data.urgentSetById = session.userId;
    }
    if (body?.minDonation !== undefined)
      data.minDonation = body.minDonation ? Number(body.minDonation) : null;
    if (body?.videoUrl !== undefined)
      data.videoUrl = body.videoUrl ? String(body.videoUrl).trim() : null;
    if (body?.gallery !== undefined)
      data.gallery = body.gallery ? JSON.stringify(body.gallery) : null;
    if (body?.coverImage !== undefined)
      data.coverImage = body.coverImage ? String(body.coverImage).trim() : null;
    if (body?.budgetBreakdown !== undefined)
      data.budgetBreakdown = body.budgetBreakdown ? JSON.stringify(body.budgetBreakdown) : null;
    if (body?.coordinatorName !== undefined)
      data.coordinatorName = body.coordinatorName ? String(body.coordinatorName).trim() : null;
    if (body?.coordinatorPhone !== undefined)
      data.coordinatorPhone = body.coordinatorPhone ? String(body.coordinatorPhone).trim() : null;
    if (body?.seoTitle !== undefined)
      data.seoTitle = body.seoTitle ? String(body.seoTitle).trim() : null;
    if (body?.seoDescription !== undefined)
      data.seoDescription = body.seoDescription ? String(body.seoDescription).trim() : null;
    if (body?.status !== undefined) {
      const s = String(body.status);
      if (!CAMPAIGN_STATUSES.includes(s))
        throw new ApiError("Invalid campaign status", 400);
      data.status = s;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const campaign = await this.campaignRepository.update(id, data);
    log.info("campaign_updated", {
      campaignId: id,
      code: campaign.code,
      fields: Object.keys(data),
      ...(data.status ? { newStatus: campaign.status } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMPAIGN_UPDATE",
      "CAMPAIGN",
      `${campaign.title} → ${Object.keys(data).join(", ")}`,
      session.userId
    );
    await invalidateCampaigns();

    return campaign;
  }

  /** DELETE /api/campaigns/:id — admin removes a campaign (donations kept, unlinked). */
  async remove(id: string, session: Session): Promise<{ ok: boolean }> {
    const existing = await this.campaignRepository.findById(id);
    if (!existing) {
      log.warn("campaign_delete_not_found", { campaignId: id, actor: session.userId });
      throw new ApiError("Campaign not found", 404);
    }

    await this.campaignRepository.unlinkDonations(id);
    await this.campaignRepository.remove(id);
    log.info("campaign_deleted", {
      campaignId: id,
      code: existing.code,
      title: existing.title,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "CAMPAIGN_DELETE",
      "CAMPAIGN",
      existing.title,
      session.userId
    );
    await invalidateCampaigns();

    return { ok: true };
  }

  /** Unique-slug loop from the legacy route — appends -2, -3, … until free. */
  private async uniqueSlug(title: string): Promise<string> {
    const base = this.slugify(title) || "campaign";
    let candidate = base;
    let n = 2;
    // ensure unique (append -2, -3, …)
    while (await this.campaignRepository.findBySlug(candidate)) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    return candidate;
  }

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}
