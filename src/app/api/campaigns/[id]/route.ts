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

// PATCH /api/campaigns/:id — admin edits a campaign
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const existing = await db.campaign.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Campaign not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.title !== undefined) data.title = String(body.title).trim();
    if (body?.tagline !== undefined) data.tagline = body.tagline ? String(body.tagline) : null;
    if (body?.description !== undefined) data.description = String(body.description);
    if (body?.category !== undefined) data.category = String(body.category);
    if (body?.targetAmount !== undefined) {
      const target = Number(body.targetAmount);
      if (!Number.isFinite(target) || target <= 0)
        throw new ApiError("Target amount must be a positive number", 400);
      data.targetAmount = target;
    }
    if (body?.icon !== undefined) data.icon = String(body.icon);
    if (body?.accent !== undefined) data.accent = String(body.accent);
    if (body?.helpline !== undefined) data.helpline = body.helpline ? String(body.helpline) : null;
    if (body?.featured !== undefined) data.featured = Boolean(body.featured);
    if (body?.status !== undefined) data.status = String(body.status);

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
