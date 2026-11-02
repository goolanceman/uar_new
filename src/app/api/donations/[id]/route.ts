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

// Recompute campaign.raisedAmount from COMPLETED donations
async function recomputeCampaign(campaignId: string | null | undefined) {
  if (!campaignId) return;
  const agg = await db.donation.aggregate({
    _sum: { amount: true },
    where: { campaignId, paymentStatus: "COMPLETED" },
  });
  await db.campaign.update({
    where: { id: campaignId },
    data: { raisedAmount: agg._sum.amount ?? 0 },
  });
}

// PATCH /api/donations/:id — admin adjusts status or amount
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const existing = await db.donation.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Donation not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.paymentStatus !== undefined) data.paymentStatus = String(body.paymentStatus);
    if (body?.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new ApiError("Amount must be greater than zero", 400);
      data.amount = amount;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const donation = await db.donation.update({ where: { id }, data });

    // raisedAmount always reflects COMPLETED totals
    await recomputeCampaign(donation.campaignId);

    await logActivity(
      session.name,
      "DONATION_UPDATE",
      "DONATION",
      `${donation.receiptNumber} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json(donation);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/donations/:id — admin removes a donation
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const existing = await db.donation.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Donation not found", 404);

    await db.donation.delete({ where: { id } });
    await recomputeCampaign(existing.campaignId);

    await logActivity(
      session.name,
      "DONATION_DELETE",
      "DONATION",
      `${existing.receiptNumber} · ₹${existing.amount}`,
      session.userId
    );

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
