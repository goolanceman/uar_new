import { db } from "@/lib/db";
import { requireRole, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/animal-analytics (ADMIN)
 *
 * One consolidated payload for the Animal Welfare analytics tab:
 *  - animals: totals by status + care flags + monthly food commitment
 *  - species: count + monthly food per species (donut + bar)
 *  - status:  count per adoption status (available → fostered → adopted)
 *  - pledges: active count, monthly pledge value, per-kind split and the
 *             shelter-fund pool (pledges with animalId null).
 *
 * Everything is computed server-side with Prisma groupBy/aggregate so the
 * client never has to crunch raw rows.
 */
export async function GET() {
  try {
    await requireRole("ADMIN");

    const [
      animalTotals,
      speciesGroups,
      statusGroups,
      vaccinatedCount,
      sterilizedCount,
      pledgeTotals,
      pledgeKindAll,
      pledgeKindActive,
      monthlyPledgeAgg,
      oneTimePledgeAgg,
      shelterAll,
      shelterActive,
      shelterMonthlyAgg,
      shelterOneTimeAgg,
    ] = await Promise.all([
      db.animal.aggregate({ _count: { _all: true }, _sum: { monthlyFood: true } }),
      db.animal.groupBy({
        by: ["species"],
        _count: { _all: true },
        _sum: { monthlyFood: true },
      }),
      db.animal.groupBy({ by: ["status"], _count: { _all: true } }),
      db.animal.count({ where: { vaccinated: true } }),
      db.animal.count({ where: { sterilized: true } }),
      db.animalPledge.aggregate({ _count: { _all: true } }),
      db.animalPledge.groupBy({
        by: ["kind"],
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.animalPledge.groupBy({
        by: ["kind"],
        where: { status: "ACTIVE" },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.animalPledge.aggregate({
        where: { status: "ACTIVE", frequency: "MONTHLY" },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.animalPledge.aggregate({
        where: { status: "ACTIVE", frequency: "ONE_TIME" },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      db.animalPledge.count({ where: { animalId: null } }),
      db.animalPledge.count({ where: { animalId: null, status: "ACTIVE" } }),
      db.animalPledge.aggregate({
        where: { animalId: null, status: "ACTIVE", frequency: "MONTHLY" },
        _sum: { amount: true },
      }),
      db.animalPledge.aggregate({
        where: { animalId: null, status: "ACTIVE", frequency: "ONE_TIME" },
        _sum: { amount: true },
      }),
    ]);

    const statusCount = (rows: Array<{ status: string; _count: { _all: number } }>, key: string) =>
      rows.find((r) => r.status === key)?._count._all ?? 0;

    const kinds = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"] as const;
    const byKind = kinds.map((kind) => {
      const all = pledgeKindAll.find((k) => k.kind === kind);
      const active = pledgeKindActive.find((k) => k.kind === kind);
      return {
        kind,
        count: all?._count._all ?? 0,
        amount: all?._sum.amount ?? 0,
        activeCount: active?._count._all ?? 0,
        monthlyAmount: active?._sum.amount ?? 0,
      };
    });

    return json({
      animals: {
        total: animalTotals._count._all,
        available: statusCount(statusGroups, "AVAILABLE"),
        fostered: statusCount(statusGroups, "FOSTERED"),
        adopted: statusCount(statusGroups, "ADOPTED"),
        critical: statusCount(statusGroups, "CRITICAL"),
        vaccinated: vaccinatedCount,
        sterilized: sterilizedCount,
        monthlyFoodCommitment: animalTotals._sum.monthlyFood ?? 0,
      },
      species: speciesGroups
        .map((g) => ({
          species: g.species,
          count: g._count._all,
          monthlyFood: g._sum.monthlyFood ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      status: statusGroups.map((g) => ({
        status: g.status,
        count: g._count._all,
      })),
      pledges: {
        total: pledgeTotals._count._all,
        active: monthlyPledgeAgg._count._all + oneTimePledgeAgg._count._all,
        monthlyValue: monthlyPledgeAgg._sum.amount ?? 0,
        monthlyCount: monthlyPledgeAgg._count._all,
        oneTimeValue: oneTimePledgeAgg._sum.amount ?? 0,
        oneTimeCount: oneTimePledgeAgg._count._all,
        byKind,
        shelterFund: {
          count: shelterAll,
          activeCount: shelterActive,
          monthlyValue: shelterMonthlyAgg._sum.amount ?? 0,
          oneTimeValue: shelterOneTimeAgg._sum.amount ?? 0,
        },
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
