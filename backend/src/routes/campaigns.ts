/**
 * Campaigns routes — /api/campaigns, /api/campaigns/:id
 * Converted 1:1 from src/app/api/campaigns/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
  validateSession,
} from "@/lib/session";
import { nextCampaignCode } from "@/lib/codes";
import { CAMPAIGN_STATUSES } from "@/lib/campaigns";

export const router = Router();

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "campaign";
  let candidate = base;
  let n = 2;
  // ensure unique (append -2, -3, …)
  while (await db.campaign.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

// GET /api/campaigns
//   ?category=&status=&q=&featured=1&all=1   — legacy filters
//   ?urgent=1                                — active urgent appeals (priority desc, severity desc, deadline asc)
//   ?sort=trending|recent|ending|progress    — trending = last-14-days completed donation volume
//   ?page=&limit=                            — pass `page` to switch the response to {items,total,page,pages}
// Default response stays a PLAIN ARRAY (web + mobile consumers); computed
// progressPct / daysLeft / donorCount are added to every row.

const URGENCY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Severity rank used to break ties when urgencyPriority is equal. */
const URGENCY_SEVERITY: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

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
): { data: Record<string, unknown>; targetAmount?: number } {
  const data: Record<string, unknown> = {};

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
      data.targetAmount = target;
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

router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const session = await validateSession(req);
    const isAdmin = session?.role === "ADMIN";
    const all = sp.get("all") === "1";

    const category = sp.get("category");
    const status = sp.get("status");
    const q = sp.get("q")?.trim();
    const featured = sp.get("featured") === "1";
    const urgentOnly = sp.get("urgent") === "1";
    const sort = sp.get("sort") ?? "";
    const pageParam = sp.get("page");
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 20));
    const page = Math.max(1, Number(pageParam) || 1);

    const where: Record<string, unknown> = {};
    if (!isAdmin || !all) where.status = { not: "DRAFT" };
    if (status) where.status = status;
    if (category) where.category = category;
    if (featured) where.featured = true;

    const or: Record<string, unknown>[] = [];
    if (urgentOnly) {
      // Only appeals whose deadline has not passed (auto-expire).
      where.urgent = true;
      or.push({ urgentUntil: null }, { urgentUntil: { gt: new Date() } });
    }
    if (q) {
      or.push(
        { title: { contains: q, mode: "insensitive" } },
        { tagline: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } }
      );
    }
    if (or.length > 0) where.OR = or;

    const campaigns = await db.campaign.findMany({ where });

    // Supporter/donor count per campaign (distinct completed donations) — shown
    // on public cards/detail pages the way crowdfunding sites show "N supporters".
    const ids = campaigns.map((c) => c.id);
    const [counts, trend] = await Promise.all([
      ids.length
        ? db.donation.groupBy({
            by: ["campaignId"],
            where: { paymentStatus: "COMPLETED", campaignId: { in: ids } },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ campaignId: string | null; _count: { _all: number } }>),
      // Trending = completed donation volume over the last 14 days.
      ids.length
        ? db.donation.groupBy({
            by: ["campaignId"],
            where: {
              paymentStatus: "COMPLETED",
              campaignId: { in: ids },
              createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
            },
            _sum: { amount: true },
          })
        : Promise.resolve([] as Array<{ campaignId: string | null; _sum: { amount: number | null } }>),
    ]);
    const countMap = new Map(counts.map((c) => [c.campaignId, c._count._all]));
    const trendMap = new Map(trend.map((c) => [c.campaignId, c._sum.amount ?? 0]));

    let rows = campaigns.map((c) => ({
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
      return json(res, {
        items: rows.slice((page - 1) * limit, page * limit),
        total,
        page,
        pages,
      });
    }

    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/campaigns — admin creates a campaign
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const title = String(body?.title ?? "").trim();
    const description = String(body?.description ?? "").trim();
    const category = String(body?.category ?? "GENERAL");
    const targetAmount = Number(body?.targetAmount);

    if (!title || !description)
      throw new ApiError("Title and description are required", 400);
    if (!Number.isFinite(targetAmount) || targetAmount <= 0)
      throw new ApiError("Target amount must be a positive number", 400);

    const slug = body?.slug ? String(body.slug).trim() : await uniqueSlug(title);
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

    const campaign = await db.campaign.create({
      data: {
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
      },
    });

    await logActivity(
      session.name,
      "CAMPAIGN_CREATE",
      "CAMPAIGN",
      `${campaign.title} (₹${campaign.targetAmount})`,
      session.userId
    );

    return json(res, campaign, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/campaigns/:id — by id, falling back to slug
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    let campaign = await db.campaign.findUnique({ where: { id } });
    if (!campaign) {
      campaign = await db.campaign.findUnique({ where: { slug: id } });
    }
    if (!campaign) throw new ApiError("Campaign not found", 404);

    // Same projection as the list: auto-expired appeals read as non-urgent and
    // the computed fields every client gets.
    const donorCount = await db.donation.count({
      where: { paymentStatus: "COMPLETED", campaignId: campaign.id },
    });
    return json(res, {
      ...expireUrgency(campaign),
      donorCount,
      progressPct: progressPctOf(campaign.raisedAmount, campaign.targetAmount),
      daysLeft: daysLeftOf(campaign.endDate),
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/campaigns/:id/urgency — ADMIN/MODERATOR manages the urgent appeal
// (toggle, level, priority, reason, funding deadline and optionally the target).
router.patch("/:id/urgency", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "MODERATOR");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const existing = await db.campaign.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Campaign not found", 404);
    if (body.urgent === undefined) throw new ApiError("The urgent flag is required", 400);

    const { data, targetAmount } = resolveUrgencyPatch(existing, body);
    const campaign = await db.campaign.update({
      where: { id },
      data: { ...data, ...(data.urgent === true ? { urgentSetById: session.userId } : {}), ...(targetAmount !== undefined ? { targetAmount } : {}) },
    });

    await logActivity(
      session.name,
      data.urgent === false ? "CAMPAIGN_URGENCY_CLEAR" : "CAMPAIGN_URGENCY_SET",
      "CAMPAIGN",
      `${campaign.title} → urgent=${campaign.urgent}${campaign.urgencyLevel ? `, level=${campaign.urgencyLevel}` : ""}${campaign.urgentUntil ? `, until=${campaign.urgentUntil.toISOString()}` : ""}`,
      session.userId
    );

    return json(res, campaign);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/campaigns/:id — admin edits a campaign (full whitelist)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.campaign.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Campaign not found", 404);

    const data: Record<string, unknown> = {};
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
      const taken = await db.campaign.findFirst({
        where: { slug, id: { not: id } },
      });
      if (taken) throw new ApiError("That slug is already in use", 409);
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

    const campaign = await db.campaign.update({ where: { id }, data });

    await logActivity(
      session.name,
      "CAMPAIGN_UPDATE",
      "CAMPAIGN",
      `${campaign.title} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json(res, campaign);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/campaigns/:id — admin removes a campaign (donations kept, unlinked)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    const existing = await db.campaign.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Campaign not found", 404);

    await db.donation.updateMany({
      where: { campaignId: id },
      data: { campaignId: null },
    });
    await db.campaign.delete({ where: { id } });

    await logActivity(
      session.name,
      "CAMPAIGN_DELETE",
      "CAMPAIGN",
      existing.title,
      session.userId
    );

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
