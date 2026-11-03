import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  requireRole,
  json,
  handleError,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GET /api/reports — consolidated financial-year impact payload:
 *   ?fy=2025  → FY 2025-26 (April → March); default = current FY.
 * Public: all aggregate data stays public for the Impact page, but
 * topDonors is only filled for authenticated ADMIN callers.
 *
 * Legacy typed reports (ADMIN/VOLUNTEER) remain available:
 *   ?type=overview|donations|distributions|causes|animals&from&to
 */
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const type = sp.get("type");

    /* ---------------- legacy typed reports (auth'd) ---------------- */
    if (type) {
      await requireRole("ADMIN", "VOLUNTEER");

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

      // type === "overview" (legacy shape)
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
    }

    /* ------------- consolidated FY payload (public) ---------------- */
    const session = await getSession();
    const isAdmin = session?.role === "ADMIN";

    // FY param is the START year: 2025 ⇒ FY 2025-26. Default = current FY.
    const now = new Date();
    const currentStart = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const fyRaw = parseInt(sp.get("fy") ?? "", 10);
    const startYear =
      Number.isFinite(fyRaw) && fyRaw >= 2010 && fyRaw <= currentStart + 50
        ? fyRaw
        : currentStart;

    const fyStart = new Date(Date.UTC(startYear, 3, 1)); // Apr 1
    const fyEnd = new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999)); // Mar 31
    const fy = `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

    // Completed donations inside the FY
    const donations = await db.donation.findMany({
      where: {
        paymentStatus: "COMPLETED",
        createdAt: { gte: fyStart, lte: fyEnd },
      },
      select: {
        amount: true,
        donorName: true,
        donorEmail: true,
        isAnonymous: true,
        category: true,
        createdAt: true,
      },
    });

    const totalDonations = round2(donations.reduce((a, d) => a + d.amount, 0));
    const donationCount = donations.length;
    const avgDonation = donationCount ? round2(totalDonations / donationCount) : 0;

    // Distinct donors (identity = donorEmail)
    const fyDonorEmails = new Set(
      donations.map((d) => d.donorEmail.trim().toLowerCase()).filter(Boolean)
    );
    const priorDonorRows = await db.donation.findMany({
      where: { paymentStatus: "COMPLETED", createdAt: { lt: fyStart } },
      select: { donorEmail: true },
    });
    const priorDonorEmails = new Set(
      priorDonorRows.map((d) => d.donorEmail.trim().toLowerCase()).filter(Boolean)
    );
    const newDonorsThisFy = [...fyDonorEmails].filter((e) => !priorDonorEmails.has(e)).length;

    // Monthly buckets Apr → Mar
    const monthly = FY_MONTHS.map((month, m) => {
      const mStart = new Date(Date.UTC(startYear, 3 + m, 1));
      const mEnd = new Date(Date.UTC(startYear, 4 + m, 1));
      const rows = donations.filter((d) => d.createdAt >= mStart && d.createdAt < mEnd);
      return {
        month,
        amount: round2(rows.reduce((a, d) => a + d.amount, 0)),
        count: rows.length,
      };
    });

    // Category split
    const catMap = new Map<string, number>();
    for (const d of donations) {
      catMap.set(d.category, (catMap.get(d.category) ?? 0) + d.amount);
    }
    const categories = [...catMap.entries()]
      .map(([category, amount]) => ({ category, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);

    // Top donors (ADMIN only — identity by email, masked when anonymous)
    let topDonors: { name: string; amount: number; count: number }[] = [];
    if (isAdmin) {
      const donorMap = new Map<string, { name: string; amount: number; count: number }>();
      for (const d of donations) {
        const key = d.donorEmail.trim().toLowerCase();
        const entry = donorMap.get(key) ?? {
          name: d.isAnonymous ? "Anonymous" : d.donorName,
          amount: 0,
          count: 0,
        };
        entry.amount += d.amount;
        entry.count += 1;
        donorMap.set(key, entry);
      }
      topDonors = [...donorMap.values()]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10)
        .map((t) => ({ ...t, amount: round2(t.amount) }));
    }

    // Programme aggregates (all-time operational impact)
    const [
      kitAgg,
      padAgg,
      padSessions,
      padSchools,
      missionCount,
      corridorEventCount,
      corridorAgg,
      animalsAvailable,
      animalsAdopted,
      animalPledges,
      causeTotal,
      causeSeeking,
      causeAdopted,
      pledgeAgg,
    ] = await Promise.all([
      db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } }),
      db.padDistribution.aggregate({ _sum: { padsDistributed: true, girlsCount: true } }),
      db.padDistribution.count({ where: { awarenessSession: true } }),
      db.padDistribution.findMany({ select: { schoolName: true }, distinct: ["schoolName"] }),
      db.mission.count(),
      db.corridorEvent.count(),
      db.mission.aggregate({ _sum: { vehiclesAlerted: true, timeSavedSec: true } }),
      db.animal.count({ where: { status: "AVAILABLE" } }),
      db.animal.count({ where: { status: "ADOPTED" } }),
      db.animalPledge.count({ where: { status: "ACTIVE" } }),
      db.cause.count(),
      db.cause.count({ where: { status: { in: ["SEEKING", "PARTIAL"] } } }),
      db.cause.count({ where: { status: "ADOPTED" } }),
      db.pledge.aggregate({ _sum: { amountPerMonth: true }, where: { status: "ACTIVE" } }),
    ]);

    return json({
      fy,
      kpis: {
        totalDonations,
        donationCount,
        avgDonation,
        donorCount: fyDonorEmails.size,
        newDonorsThisFy,
      },
      monthly,
      categories,
      topDonors,
      programmes: {
        kits: {
          totalUnits: kitAgg._sum.totalUnits ?? 0,
          scannedUnits: kitAgg._sum.scannedUnits ?? 0,
        },
        pads: {
          sessions: padSessions,
          pads: padAgg._sum.padsDistributed ?? 0,
          girls: padAgg._sum.girlsCount ?? 0,
          schools: padSchools.length,
        },
        corridor: {
          missions: missionCount,
          events: corridorEventCount,
          vehiclesAlerted: corridorAgg._sum.vehiclesAlerted ?? 0,
          timeSavedMin: Math.round((corridorAgg._sum.timeSavedSec ?? 0) / 60),
        },
        animals: {
          available: animalsAvailable,
          adopted: animalsAdopted,
          activePledges: animalPledges,
        },
        medicine: {
          total: causeTotal,
          seeking: causeSeeking,
          adopted: causeAdopted,
          monthlyPledged: round2(pledgeAgg._sum.amountPerMonth ?? 0),
        },
      },
      fyTotals: { amount: totalDonations, count: donationCount },
    });
  } catch (e) {
    return handleError(e);
  }
}
