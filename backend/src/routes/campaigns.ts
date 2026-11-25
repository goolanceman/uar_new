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

// GET /api/campaigns?category&status&q&featured&all=1
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

    const where: Record<string, unknown> = {};
    if (!isAdmin || !all) where.status = { not: "DRAFT" };
    if (status) where.status = status;
    if (category) where.category = category;
    if (featured) where.featured = true;
    if (q) where.title = { contains: q };

    const campaigns = await db.campaign.findMany({
      where,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    });

    // Supporter count per campaign (distinct completed donations) — shown
    // on public cards/detail pages the way crowdfunding sites show "N supporters".
    const counts = await db.donation.groupBy({
      by: ["campaignId"],
      where: {
        paymentStatus: "COMPLETED",
        campaignId: { in: campaigns.map((c) => c.id) },
      },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.campaignId, c._count._all]));
    const withCounts = campaigns.map((c) => ({
      ...c,
      supporterCount: countMap.get(c.id) ?? 0,
    }));

    return json(res, withCounts);
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
        urgent: Boolean(body?.urgent),
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
    if (body?.urgent !== undefined) data.urgent = Boolean(body.urgent);
    if (body?.taxEligible !== undefined) data.taxEligible = Boolean(body.taxEligible);
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
