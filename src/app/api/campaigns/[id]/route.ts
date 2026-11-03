import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/campaigns/:id — by id, falling back to slug
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;

    let campaign = await db.campaign.findUnique({ where: { id } });
    if (!campaign) {
      campaign = await db.campaign.findUnique({ where: { slug: id } });
    }
    if (!campaign) throw new ApiError("Campaign not found", 404);

    return json(campaign);
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/campaigns/:id — admin edits a campaign (full whitelist)
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

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
      if (!["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"].includes(s))
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

    return json(campaign);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/campaigns/:id — admin removes a campaign (donations kept, unlinked)
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;

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

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
