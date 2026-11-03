import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const byStatus = await db.donation.groupBy({ by: ["paymentStatus"], _count: { _all: true }, _sum: { amount: true } });
  console.log("donations byStatus:", JSON.stringify(byStatus));
  const agg = await db.donation.aggregate({
    _count: { _all: true },
    _sum: { amount: true },
  });
  console.log("donations all:", JSON.stringify(agg));
  const pan = await db.donation.aggregate({
    where: { pan: { not: null } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  console.log("donations withPAN:", JSON.stringify(pan));
  const panCompleted = await db.donation.aggregate({
    where: { pan: { not: null }, paymentStatus: "COMPLETED" },
    _sum: { amount: true }, _count: { _all: true },
  });
  console.log("donations withPAN+COMPLETED:", JSON.stringify(panCompleted));
  const completed = await db.donation.aggregate({ where: { paymentStatus: "COMPLETED" }, _sum: { amount: true }, _count: { _all: true } });
  console.log("donations COMPLETED:", JSON.stringify(completed));
  const receipts = await db.donation.aggregate({ where: { receiptNumber: { contains: "UAR-RCPT" } }, _count: { _all: true }, _sum: { amount: true } });
  console.log("receipt-issued count:", JSON.stringify(receipts));
  const minMax = await db.donation.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } });
  console.log("donation date range:", JSON.stringify(minMax));
  const dist = await db.distribution.groupBy({ by: ["type"], _count: { _all: true }, _sum: { quantity: true, value: true } });
  console.log("distributions byType:", JSON.stringify(dist));
  const campaigns = await db.campaign.findMany({ select: { title: true, raisedAmount: true, targetAmount: true, status: true, category: true }, orderBy: { raisedAmount: "desc" } });
  console.log("campaigns:", JSON.stringify(campaigns, null, 0).slice(0, 1200));
  const beneficiaries = await db.beneficiary.groupBy({ by: ["category"], _count: { _all: true } });
  console.log("beneficiaries byCategory:", JSON.stringify(beneficiaries));
  const urgency = await db.beneficiary.groupBy({ by: ["urgencyLevel"], _count: { _all: true } });
  console.log("beneficiaries byUrgency:", JSON.stringify(urgency));
  const apps = await db.volunteerApplication.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("volunteer applications:", JSON.stringify(apps));
  const donors = await db.donor.count();
  console.log("donor CRM rows:", donors);
  const kits = await db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } });
  console.log("kits:", JSON.stringify(kits));
  const pads = await db.padDistribution.aggregate({ _count: { _all: true }, _sum: { padsDistributed: true, girlsCount: true } });
  console.log("pads:", JSON.stringify(pads));
  const causes = await db.cause.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("causes:", JSON.stringify(causes));
  const pledges = await db.pledge.aggregate({ where: { status: "ACTIVE" }, _sum: { amountPerMonth: true }, _count: { _all: true } });
  console.log("active pledges:", JSON.stringify(pledges));
  const animals = await db.animal.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("animals:", JSON.stringify(animals));
  const ap = await db.animalPledge.aggregate({ where: { status: "ACTIVE" }, _count: { _all: true } });
  console.log("active animalPledges:", JSON.stringify(ap));
  const missions = await db.mission.aggregate({ _count: { _all: true }, _sum: { vehiclesAlerted: true, timeSavedSec: true } });
  const missionsCompleted = await db.mission.count({ where: { status: "COMPLETED" } });
  console.log("missions:", JSON.stringify(missions), "completed:", missionsCompleted);
  const corridorEvents = await db.corridorEvent.count();
  console.log("corridorEvents:", corridorEvents);
}
main().finally(() => db.$disconnect());
