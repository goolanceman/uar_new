/**
 * Campaign analytics route — /api/campaign-analytics
 * Converted 1:1 from src/app/api/campaign-analytics/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireRole, json, handleError } from "@/lib/session";

export const router = Router();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * GET /api/campaign-analytics (ADMIN)
 *
 * One consolidated payload for the Campaigns analytics tab:
 *  - campaigns: totals by status + featured/urgent + funding summary
 *  - category:  count + raised + target per category (donut)
 *  - status:    count per lifecycle status (bar)
 *  - monthly:   last 12 months of donation inflow attributed to campaigns
 *  - topCampaigns: top 5 by amount raised (progress list)
 *  - reach: beneficiaries + volunteers engaged, summed
 *
 * Everything is computed server-side with Prisma groupBy/aggregate so the
 * client never has to crunch raw rows.
 */
router.get("/", async (_req, res) => {
  try {
    await requireRole(_req, "ADMIN");

    const [
      totals,
      statusGroups,
      categoryGroups,
      featuredCount,
      urgentCount,
      reachAgg,
      topCampaigns,
      monthlyDonations,
    ] = await Promise.all([
      db.campaign.aggregate({
        _count: { _all: true },
        _sum: { raisedAmount: true, targetAmount: true },
      }),
      db.campaign.groupBy({ by: ["status"], _count: { _all: true } }),
      db.campaign.groupBy({
        by: ["category"],
        _count: { _all: true },
        _sum: { raisedAmount: true, targetAmount: true },
      }),
      db.campaign.count({ where: { featured: true } }),
      db.campaign.count({ where: { urgent: true } }),
      db.campaign.aggregate({
        _sum: { beneficiaries: true, volunteersEngaged: true },
      }),
      db.campaign.findMany({
        orderBy: { raisedAmount: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          raisedAmount: true,
          targetAmount: true,
        },
      }),
      db.donation.findMany({
        where: {
          campaignId: { not: null },
          paymentStatus: "COMPLETED",
          createdAt: { gte: new Date(Date.now() - 365 * 86_400_000) },
        },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const statusCount = (status: string) =>
      statusGroups.find((g) => g.status === status)?._count._all ?? 0;

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
      for (const d of monthlyDonations) {
        const key = `${d.createdAt.getUTCFullYear()}-${String(d.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
        const i = index.get(key);
        if (i !== undefined) {
          buckets[i].amount += d.amount;
          buckets[i].count += 1;
        }
      }
    }

    return json(res, {
      campaigns: {
        total: totals._count._all,
        draft: statusCount("DRAFT"),
        active: statusCount("ACTIVE"),
        paused: statusCount("PAUSED"),
        completed: statusCount("COMPLETED"),
        cancelled: statusCount("CANCELLED"),
        featured: featuredCount,
        urgent: urgentCount,
        totalRaised: totals._sum.raisedAmount ?? 0,
        totalTarget: totals._sum.targetAmount ?? 0,
      },
      category: categoryGroups
        .map((g) => ({
          category: g.category,
          count: g._count._all,
          raised: g._sum.raisedAmount ?? 0,
          target: g._sum.targetAmount ?? 0,
        }))
        .sort((a, b) => b.raised - a.raised),
      status: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      monthly: buckets.map((b) => ({ label: b.label, amount: b.amount, count: b.count })),
      topCampaigns: topCampaigns.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        raised: c.raisedAmount,
        target: c.targetAmount,
        pct: c.targetAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100)) : 0,
      })),
      reach: {
        beneficiaries: reachAgg._sum.beneficiaries ?? 0,
        volunteersEngaged: reachAgg._sum.volunteersEngaged ?? 0,
      },
    });
  } catch (e) {
    return handleError(e, res);
  }
});
