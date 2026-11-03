import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  requireAuth,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

async function nextReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  let n = (await db.donation.count()) + 1;
  let receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
  // loop while exists (guards against concurrent creates)
  while (await db.donation.findUnique({ where: { receiptNumber } })) {
    n += 1;
    receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
  }
  return receiptNumber;
}

/** Public-safe projection — never expose contact/financial PII. */
function publicDonation(d: {
  id: string;
  donorName: string;
  isAnonymous: boolean;
  amount: number;
  currency: string;
  type: string;
  category: string;
  message: string | null;
  createdAt: Date;
  campaign?: { title: string; accent: string } | null;
}) {
  return {
    id: d.id,
    donorName: d.isAnonymous ? "Anonymous" : maskName(d.donorName),
    amount: d.amount,
    currency: d.currency,
    type: d.type,
    category: d.category,
    message: d.message,
    createdAt: d.createdAt,
    campaign: d.campaign ?? null,
  };
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const initial = parts[1]?.[0] ? ` ${parts[1][0]}.` : "";
  return `${first}${initial}`;
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
      // Public wall — latest 12 completed, minimal safe fields only
      const donations = await db.donation.findMany({
        where: { paymentStatus: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { campaign: { select: { title: true, accent: true } } },
      });
      return json(donations.map(publicDonation));
    }

    // Signed-in (admin/staff) view — filterable, paginated
    const campaignId = sp.get("campaignId");
    const status = sp.get("status") ?? sp.get("paymentStatus");
    const type = sp.get("type");
    const category = sp.get("category");
    const method = sp.get("method");
    const from = sp.get("from");
    const to = sp.get("to");
    const q = sp.get("q")?.trim();
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const take = Math.min(500, Math.max(1, parseInt(sp.get("limit") ?? "50", 10) || 50));

    const where: Record<string, unknown> = {};
    if (campaignId) where.campaignId = campaignId;
    if (status) where.paymentStatus = status;
    if (type) where.type = type;
    if (category) where.category = category;
    if (method) where.paymentMethod = method;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }
    if (q) {
      where.OR = [
        { donorName: { contains: q } },
        { donorEmail: { contains: q } },
        { receiptNumber: { contains: q } },
        { transactionId: { contains: q } },
      ];
    }

    const [donations, total, sumAgg] = await Promise.all([
      db.donation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
        include: {
          campaign: { select: { title: true, accent: true } },
          donorRef: { select: { id: true, category: true, tags: true } },
        },
      }),
      db.donation.count({ where }),
      db.donation.aggregate({
        where: { ...where, paymentStatus: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);

    return json({
      items: donations,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / take)),
      completedSum: sumAgg._sum.amount ?? 0,
    });
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/donations — public or logged-in donor
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => {});
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
    if (!/^\S+@\S+\.\S+$/.test(donorEmail))
      throw new ApiError("Please enter a valid email address", 400);

    const donorPhone = body?.donorPhone ? String(body.donorPhone).trim() : null;
    if (donorPhone && !PHONE_RE.test(donorPhone.replace(/[\s-]/g, "")))
      throw new ApiError("Please enter a valid Indian mobile number", 400);

    const pan = body?.pan ? String(body.pan).trim().toUpperCase() : null;
    if (pan && !PAN_RE.test(pan))
      throw new ApiError("PAN must look like ABCDE1234F", 400);

    const type = body?.type === "RECURRING" ? "RECURRING" : "ONE_TIME";
    const freqRaw = body?.recurringFrequency ? String(body.recurringFrequency).toUpperCase() : null;
    const recurringFrequency =
      type === "RECURRING"
        ? ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].includes(freqRaw ?? "")
          ? freqRaw
          : "MONTHLY"
        : null;

    const paymentMethod = body?.paymentMethod ? String(body.paymentMethod) : "UPI";
    // Offline/manual payments (cash, cheque, bank transfer) enter as PENDING
    // until staff verify them; online methods complete immediately.
    const offline = ["CASH", "BANK_TRANSFER", "CHEQUE"].includes(paymentMethod);
    const paymentStatus = offline ? "PENDING" : "COMPLETED";

    const receiptNumber = await nextReceiptNumber();
    const now = new Date();

    // 80G: cash donations above ₹2,000 are NOT eligible (Income Tax Act).
    const taxEligible = !(paymentMethod === "CASH" && amount > 2000);

    const donation = await db.$transaction(async (tx) => {
      // Upsert the Donor CRM record by email
      const donorRecord = await tx.donor.upsert({
        where: { email: donorEmail },
        create: {
          name: donorName,
          email: donorEmail,
          phone: donorPhone,
          pan: pan ?? null,
          source: "WEB",
          category: type === "RECURRING" ? "MONTHLY" : "ONE_TIME",
        },
        update: {
          name: donorName,
          phone: donorPhone ?? undefined,
          pan: pan ?? undefined,
        },
      });

      return tx.donation.create({
        data: {
          donorId: session?.userId ?? null,
          donorRefId: donorRecord.id,
          donorName,
          donorEmail,
          donorPhone,
          amount,
          type,
          recurringFrequency,
          nextChargeAt:
            type === "RECURRING" && recurringFrequency
              ? new Date(
                  now.getTime() +
                    (recurringFrequency === "WEEKLY"
                      ? 7
                      : recurringFrequency === "MONTHLY"
                        ? 30
                        : recurringFrequency === "QUARTERLY"
                          ? 90
                          : 365) *
                      86400000
                )
              : null,
          category: body?.category ? String(body.category) : "GENERAL",
          paymentMethod,
          paymentProvider: body?.paymentProvider ? String(body.paymentProvider) : offline ? "MANUAL" : null,
          paymentStatus,
          transactionId: body?.transactionId ? String(body.transactionId) : null,
          gatewayOrderId: body?.gatewayOrderId ? String(body.gatewayOrderId) : null,
          receiptNumber,
          receiptStatus: paymentStatus === "COMPLETED" ? "ISSUED" : "PENDING",
          receiptIssuedAt: paymentStatus === "COMPLETED" ? now : null,
          campaignId,
          message: body?.message ? String(body.message) : null,
          isAnonymous: Boolean(body?.isAnonymous),
          pan,
        },
        include: { campaign: { select: { title: true } } },
      });
    });

    if (campaignId && paymentStatus === "COMPLETED") {
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
      `₹${amount} → ${donation.campaign?.title ?? "General Fund"} (${paymentStatus})`,
      session?.userId
    );

    return json(donation, 201);
  } catch (e) {
    return handleError(e);
  }
}
