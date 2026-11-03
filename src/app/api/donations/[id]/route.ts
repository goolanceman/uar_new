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

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const VALID_STATUSES = ["PENDING", "COMPLETED", "FAILED", "REFUNDED", "CANCELLED"];
const VALID_METHODS = ["UPI", "RAZORPAY", "CARD", "CASH", "BANK_TRANSFER", "CHEQUE"];
const VALID_TYPES = ["ONE_TIME", "RECURRING"];
const VALID_CATEGORIES = [
  "GENERAL", "MEDICAL", "FOOD_DISTRIBUTION", "SANITARY_PADS",
  "EDUCATION_SUPPORT", "EMERGENCY", "ANIMAL_WELFARE", "MOBILITY", "AWARENESS",
];
const VALID_RECEIPT_STATUS = ["PENDING", "ISSUED", "CANCELLED", "REISSUED"];

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

function parseDate(v: unknown): Date | null {
  if (v === undefined) return undefined as unknown as Date | null; // not provided
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// PATCH /api/donations/:id — admin edits the full record (whitelisted)
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const existing = await db.donation.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Donation not found", 404);

    const data: Record<string, unknown> = {};

    if (body?.donorName !== undefined) {
      const v = String(body.donorName).trim();
      if (!v) throw new ApiError("Donor name cannot be empty", 400);
      data.donorName = v;
    }
    if (body?.donorEmail !== undefined) {
      const v = String(body.donorEmail).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(v))
        throw new ApiError("Please enter a valid email address", 400);
      data.donorEmail = v;
    }
    if (body?.donorPhone !== undefined)
      data.donorPhone = body.donorPhone ? String(body.donorPhone).trim() : null;

    if (body?.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new ApiError("Amount must be greater than zero", 400);
      data.amount = amount;
    }
    if (body?.currency !== undefined) data.currency = String(body.currency) || "INR";
    if (body?.type !== undefined) {
      if (!VALID_TYPES.includes(String(body.type)))
        throw new ApiError("Invalid donation type", 400);
      data.type = String(body.type);
    }
    if (body?.recurringFrequency !== undefined)
      data.recurringFrequency = body.recurringFrequency ? String(body.recurringFrequency) : null;
    if (body?.nextChargeAt !== undefined) data.nextChargeAt = parseDate(body.nextChargeAt);

    if (body?.category !== undefined) {
      if (!VALID_CATEGORIES.includes(String(body.category)))
        throw new ApiError("Invalid category", 400);
      data.category = String(body.category);
    }
    if (body?.paymentMethod !== undefined) {
      if (!VALID_METHODS.includes(String(body.paymentMethod)))
        throw new ApiError("Invalid payment method", 400);
      data.paymentMethod = String(body.paymentMethod);
    }
    if (body?.paymentProvider !== undefined)
      data.paymentProvider = body.paymentProvider ? String(body.paymentProvider) : null;
    if (body?.paymentStatus !== undefined) {
      if (!VALID_STATUSES.includes(String(body.paymentStatus)))
        throw new ApiError("Invalid payment status", 400);
      data.paymentStatus = String(body.paymentStatus);
    }
    if (body?.transactionId !== undefined)
      data.transactionId = body.transactionId ? String(body.transactionId).trim() : null;
    if (body?.gatewayOrderId !== undefined)
      data.gatewayOrderId = body.gatewayOrderId ? String(body.gatewayOrderId).trim() : null;
    if (body?.campaignId !== undefined)
      data.campaignId = body.campaignId ? String(body.campaignId) : null;
    if (body?.message !== undefined)
      data.message = body.message ? String(body.message) : null;
    if (body?.isAnonymous !== undefined) data.isAnonymous = Boolean(body.isAnonymous);
    if (body?.pan !== undefined) {
      const v = body.pan ? String(body.pan).trim().toUpperCase() : null;
      if (v && !PAN_RE.test(v))
        throw new ApiError("PAN must look like ABCDE1234F", 400);
      data.pan = v;
    }

    // Finance fields
    if (body?.fees !== undefined) {
      const fees = Number(body.fees);
      if (!Number.isFinite(fees) || fees < 0)
        throw new ApiError("Fees cannot be negative", 400);
      data.fees = fees;
      data.netAmount = fees >= 0 ? (data.amount !== undefined ? Number(data.amount) : existing.amount) - fees : null;
    }
    if (body?.settlementDate !== undefined) data.settlementDate = parseDate(body.settlementDate);
    if (body?.receiptStatus !== undefined) {
      if (!VALID_RECEIPT_STATUS.includes(String(body.receiptStatus)))
        throw new ApiError("Invalid receipt status", 400);
      data.receiptStatus = String(body.receiptStatus);
      if (data.receiptStatus === "ISSUED") data.receiptIssuedAt = new Date();
    }
    if (body?.internalNotes !== undefined)
      data.internalNotes = body.internalNotes ? String(body.internalNotes) : null;

    // Refund workflow
    if (body?.refundAmount !== undefined) {
      const ra = Number(body.refundAmount);
      if (!Number.isFinite(ra) || ra < 0)
        throw new ApiError("Refund amount cannot be negative", 400);
      data.refundAmount = ra;
      data.refundedAt = ra > 0 ? new Date() : null;
      if (ra > 0 && !body?.paymentStatus) data.paymentStatus = "REFUNDED";
    }
    if (body?.refundReason !== undefined)
      data.refundReason = body.refundReason ? String(body.refundReason) : null;

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const donation = await db.donation.update({ where: { id }, data });

    // Keep the Donor CRM record in sync when identity fields change
    if (data.donorEmail || data.donorName || data.donorPhone || data.pan) {
      await db.donor.upsert({
        where: { email: donation.donorEmail },
        create: {
          name: donation.donorName,
          email: donation.donorEmail,
          phone: donation.donorPhone,
          pan: donation.pan,
          source: "OFFLINE",
        },
        update: {
          name: donation.donorName,
          phone: donation.donorPhone ?? undefined,
          pan: donation.pan ?? undefined,
        },
      });
    }

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

// GET /api/donations/:id — single record with full detail
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await ctx.params;
    const donation = await db.donation.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, title: true, accent: true, slug: true } },
        donorRef: true,
      },
    });
    if (!donation) throw new ApiError("Donation not found", 404);
    return json(donation);
  } catch (e) {
    return handleError(e);
  }
}
