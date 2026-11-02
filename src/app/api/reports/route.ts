import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// GET /api/reports?type=overview|donations|distributions|causes|animals&from&to
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");

    const sp = new URL(req.url).searchParams;
    const type = sp.get("type") ?? "overview";
    const fromRaw = sp.get("from");
    const toRaw = sp.get("to");

    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw
      ? new Date(toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw)
      : null;

    const createdWhere = (field: "createdAt" | "distributedAt") => {
      const w: Record<string, unknown> = {};
      const range: Record<string, Date> = {};
      if (from && !Number.isNaN(from.getTime())) range.gte = from;
      if (to && !Number.isNaN(to.getTime())) range.lte = to;
      if (Object.keys(range).length > 0) w[field] = range;
      return w;
    };

    if (type === "donations") {
      const rows = await db.donation.findMany({
        where: createdWhere("createdAt"),
        orderBy: { createdAt: "desc" },
        select: {
          receiptNumber: true,
          donorName: true,
          amount: true,
          paymentStatus: true,
          type: true,
          createdAt: true,
        },
      });
      const sum = rows
        .filter((r) => r.paymentStatus === "COMPLETED")
        .reduce((acc, r) => acc + r.amount, 0);
      return json({
        rows,
        totals: { count: rows.length, sum },
      });
    }

    if (type === "distributions") {
      const rowsRaw = await db.distribution.findMany({
        where: createdWhere("distributedAt"),
        select: { type: true, quantity: true, value: true },
      });
      // rows grouped by type
      const map = new Map<string, { type: string; count: number; quantity: number; value: number }>();
      for (const r of rowsRaw) {
        const entry = map.get(r.type) ?? { type: r.type, count: 0, quantity: 0, value: 0 };
        entry.count += 1;
        entry.quantity += r.quantity;
        entry.value += r.value ?? 0;
        map.set(r.type, entry);
      }
      const rows = Array.from(map.values()).sort((a, b) => b.count - a.count);
      return json({
        rows,
        totals: {
          count: rowsRaw.length,
          quantity: rows.reduce((a, r) => a + r.quantity, 0),
          value: rows.reduce((a, r) => a + r.value, 0),
        },
      });
    }

    if (type === "causes") {
      const rows = await db.cause.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          code: true,
          patientName: true,
          condition: true,
          raised: true,
          monthlyCost: true,
          status: true,
        },
      });
      return json({ rows });
    }

    if (type === "animals") {
      const animals = await db.animal.findMany({
        orderBy: { createdAt: "desc" },
        include: { pledges: { select: { amount: true } } },
      });
      const rows = animals.map((a) => ({
        name: a.name,
        species: a.species,
        status: a.status,
        pledgeCount: a.pledges.length,
        pledgedSum: a.pledges.reduce((sum, p) => sum + p.amount, 0),
      }));
      return json({ rows });
    }

    // overview (default)
    const [donations, distributions, campaignTop, byTypeRaw] = await Promise.all([
      db.donation.findMany({
        where: { paymentStatus: "COMPLETED", ...createdWhere("createdAt") },
        select: { amount: true, createdAt: true },
      }),
      db.distribution.findMany({
        where: createdWhere("distributedAt"),
        select: { quantity: true, type: true, distributedAt: true },
      }),
      db.campaign.findMany({
        where: { status: { not: "DRAFT" } },
        orderBy: { raisedAmount: "desc" },
        take: 6,
        select: { title: true, raisedAmount: true, targetAmount: true },
      }),
      db.distribution.groupBy({
        by: ["type"],
        _count: { _all: true },
        _sum: { quantity: true },
      }),
    ]);

    const now = new Date();
    const monthly: { month: string; donations: number; distributions: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      monthly.push({
        month: MONTHS[start.getMonth()],
        donations: donations.filter((d) => d.createdAt >= start && d.createdAt < end).length,
        distributions: distributions.filter((d) => d.distributedAt >= start && d.distributedAt < end).length,
      });
    }

    return json({
      monthly,
      byCampaign: campaignTop.map((c) => ({
        title: c.title,
        raised: c.raisedAmount,
        target: c.targetAmount,
      })),
      byType: byTypeRaw
        .map((g) => ({
          type: g.type,
          count: g._count._all,
          quantity: g._sum.quantity ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    return handleError(e);
  }
}
