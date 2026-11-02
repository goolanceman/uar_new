import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  requireAuth,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

async function nextReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  let n = (await db.donation.count()) + 1;
  let receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
  // loop while exists
  while (await db.donation.findUnique({ where: { receiptNumber } })) {
    n += 1;
    receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
  }
  return receiptNumber;
}

// GET /api/donations — mine=1 | public feed | admin filtered list
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const mine = sp.get("mine") === "1";
    const isPublic = sp.get("public") === "1";
    const session = await getSession();

    if (mine) {
      const s = await requireAuth();
      const limit = sp.get("limit") ? parseInt(sp.get("limit")!, 10) : undefined;
      const donations = await db.donation.findMany({
        where: { donorId: s.userId },
        orderBy: { createdAt: "desc" },
        ...(limit && limit > 0 ? { take: limit } : {}),
        include: { campaign: { select: { title: true, accent: true } } },
      });
      return json(donations);
    }

    if (isPublic || !session) {
      // Public wall — latest 8 completed, anonymous-masked
      const donations = await db.donation.findMany({
        where: { paymentStatus: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { campaign: { select: { title: true, accent: true } } },
      });
      return json(
        donations.map((d) => ({
          ...d,
          donorName: d.isAnonymous ? "Anonymous" : d.donorName,
        }))
      );
    }

    // Signed-in (admin) view — filterable
    const campaignId = sp.get("campaignId");
    const status = sp.get("status") ?? sp.get("paymentStatus");
    const q = sp.get("q")?.trim();
    const limit = sp.get("limit") ? parseInt(sp.get("limit")!, 10) : 50;

    const where: Record<string, unknown> = {};
    if (campaignId) where.campaignId = campaignId;
    if (status) where.paymentStatus = status;
    if (q) where.donorName = { contains: q };

    const donations = await db.donation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(limit > 0 ? { take: limit } : {}),
      include: { campaign: { select: { title: true, accent: true } } },
    });

    return json(donations);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/donations — public or logged-in donor
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const session = await getSession();

    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("Amount must be greater than zero", 400);

    const campaignId = body?.campaignId ? String(body.campaignId) : null;
    if (campaignId) {
      const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) throw new ApiError("Selected campaign was not found", 400);
    }

    const donorName = (body?.donorName ? String(body.donorName).trim() : session?.name ?? "").trim();
    const donorEmail = (body?.donorEmail ? String(body.donorEmail).trim() : session?.email ?? "").trim().toLowerCase();
    if (!donorName || !donorEmail)
      throw new ApiError("Donor name and email are required", 400);

    const pan = body?.pan ? String(body.pan).trim().toUpperCase() : null;

    const receiptNumber = await nextReceiptNumber();

    const donation = await db.donation.create({
      data: {
        donorId: session?.userId ?? null,
        donorName,
        donorEmail,
        donorPhone: body?.donorPhone ? String(body.donorPhone).trim() : null,
        amount,
        type: body?.type === "RECURRING" ? "RECURRING" : "ONE_TIME",
        category: body?.category ? String(body.category) : "GENERAL",
        paymentMethod: body?.paymentMethod ? String(body.paymentMethod) : "UPI",
        paymentStatus: "COMPLETED",
        receiptNumber,
        campaignId,
        message: body?.message ? String(body.message) : null,
        isAnonymous: Boolean(body?.isAnonymous),
      },
      include: { campaign: { select: { title: true } } },
    });

    if (campaignId) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { raisedAmount: { increment: amount } },
      });
    }

    // Persist PAN on the donor profile for 80G receipts
    if (pan && session) {
      await db.user.update({
        where: { id: session.userId },
        data: { pan },
      });
    }

    await logActivity(
      donorName,
      "DONATION",
      "DONATION",
      `₹${amount} → ${donation.campaign?.title ?? "General Fund"}`,
      session?.userId
    );

    return json(donation, 201);
  } catch (e) {
    return handleError(e);
  }
}
