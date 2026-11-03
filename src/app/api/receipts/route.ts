import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/receipts?from&to&limit — 80G receipt list (completed donations).
// ADMIN: every completed donation · other signed-in roles: only their own
// donations (matched by donorId or donorEmail). Newest first.
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;

    const limitRaw = parseInt(sp.get("limit") ?? "100", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : 100;

    const where: Record<string, unknown> = { paymentStatus: "COMPLETED" };

    if (session.role !== "ADMIN") {
      // Donors (and volunteers viewing their own giving) see only their rows.
      where.OR = [{ donorId: session.userId }, { donorEmail: session.email }];
    }

    const from = sp.get("from");
    const to = sp.get("to");
    const createdAt: Record<string, Date> = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to.length === 10 ? `${to}T23:59:59.999` : to);
      if (!Number.isNaN(d.getTime())) createdAt.lte = d;
    }
    if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;

    const donations = await db.donation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { campaign: { select: { title: true } } },
    });

    const receipts = donations.map((d) => ({
      ...d,
      campaignTitle: d.campaign?.title ?? null,
    }));

    return json(receipts);
  } catch (e) {
    return handleError(e);
  }
}
