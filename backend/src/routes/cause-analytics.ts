/**
 * Cause analytics route — /api/cause-analytics
 * Converted 1:1 from src/app/api/cause-analytics/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireRole, json, handleError } from "@/lib/session";

export const router = Router();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * GET /api/cause-analytics (ADMIN)
 *
 * One consolidated payload for the Adopt-a-Medicine analytics tab:
 *  - causes: totals by status + funding summary (raised vs full cost)
 *  - condition: count + monthly cost per condition (donut)
 *  - status:    count per lifecycle status (bar)
 *  - monthly:   last 12 months of new pledge value committed
 *  - pledges:   active count, monthly value, all-time count
 *  - topCities: top 5 cities by number of causes
 *  - topCauses: top 5 by amount raised (progress list)
 *
 * Everything is computed server-side with Prisma groupBy/aggregate so the
 * client never has to crunch raw rows.
 */
router.get("/", async (_req, res) => {
  try {
    await requireRole(_req, "ADMIN");

    const [
      causeTotals,
      statusGroups,
      conditionGroups,
      allCauses,
      pledgeTotals,
      activePledgeAgg,
      pledgesInRange,
      topCauses,
      cityGroups,
    ] = await Promise.all([
      db.cause.aggregate({ _count: { _all: true }, _sum: { raised: true } }),
      db.cause.groupBy({ by: ["status"], _count: { _all: true } }),
      db.cause.groupBy({
        by: ["condition"],
        _count: { _all: true },
        _sum: { monthlyCost: true },
      }),
      db.cause.findMany({ select: { monthlyCost: true, durationMonths: true } }),
      db.pledge.aggregate({ _count: { _all: true } }),
      db.pledge.aggregate({
        where: { status: "ACTIVE" },
        _count: { _all: true },
        _sum: { amountPerMonth: true },
      }),
      db.pledge.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
        select: { amountPerMonth: true, createdAt: true },
      }),
      db.cause.findMany({
        orderBy: { raised: "desc" },
        take: 5,
        select: {
          id: true,
          code: true,
          patientName: true,
          status: true,
          raised: true,
          monthlyCost: true,
          durationMonths: true,
        },
      }),
      db.cause.groupBy({ by: ["city"], _count: { _all: true } }),
    ]);

    const statusCount = (status: string) =>
      statusGroups.find((g) => g.status === status)?._count._all ?? 0;

    const totalNeeded = allCauses.reduce(
      (s, c) => s + (c.monthlyCost || 0) * (c.durationMonths || 0),
      0
    );

    /* ---- last 12 calendar months, oldest → newest ---- */
    const now = new Date();
    const buckets: { key: string; label: string; amount: number; count: number }[] = [];
    {
      const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      for (let i = 0; i < 12; i++) {
        const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
        buckets.push({
          key,
          label: `${MONTHS[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear()).slice(2)}`,
          amount: 0,
          count: 0,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      const index = new Map(buckets.map((b, i) => [b.key, i]));
      for (const p of pledgesInRange) {
        const key = `${p.createdAt.getUTCFullYear()}-${String(p.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
        const i = index.get(key);
        if (i !== undefined) {
          buckets[i].amount += p.amountPerMonth;
          buckets[i].count += 1;
        }
      }
    }

    return json(res, {
      causes: {
        total: causeTotals._count._all,
        seeking: statusCount("SEEKING"),
        partial: statusCount("PARTIAL"),
        adopted: statusCount("ADOPTED"),
        paused: statusCount("PAUSED"),
        totalRaised: causeTotals._sum.raised ?? 0,
        totalNeeded,
      },
      condition: conditionGroups
        .map((g) => ({
          condition: g.condition,
          count: g._count._all,
          monthlyCost: g._sum.monthlyCost ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      status: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      monthly: buckets.map((b) => ({ label: b.label, amount: b.amount, count: b.count })),
      pledges: {
        total: pledgeTotals._count._all,
        active: activePledgeAgg._count._all,
        monthlyValue: activePledgeAgg._sum.amountPerMonth ?? 0,
      },
      topCities: cityGroups
        .map((g) => ({ city: g.city, count: g._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      topCauses: topCauses.map((c) => {
        const total = (c.monthlyCost || 0) * (c.durationMonths || 0);
        return {
          id: c.id,
          code: c.code,
          patientName: c.patientName,
          status: c.status,
          raised: c.raised,
          total,
          pct: total > 0 ? Math.min(100, Math.round((c.raised / total) * 100)) : 0,
        };
      }),
    });
  } catch (e) {
    return handleError(e, res);
  }
});
