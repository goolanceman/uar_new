/**
 * Reports routes — /api/reports, /api/reports/sponsorship-coverage
 * Converted 1:1 from src/app/api/reports/* (Next.js route handlers) to Express.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  ApiError,
  handleError,
  json,
  requireRole,
  validateSession,
} from "@/lib/session";

export const router = Router();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GET /api/reports — three branches on one route:
 *
 * 1. ?type=overview|donations|distributions|causes|animals&from&to
 *    Legacy typed reports (ADMIN/VOLUNTEER).
 *
 * 2. ?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=1   (ADMIN only — reports module)
 *    Consolidated trust-report payload for an arbitrary period with an
 *    optional previous-period comparison. Every number is a live DB
 *    aggregate (no synthetic data).
 *
 * 3. ?fy=YYYY  (or bare)
 *    Public consolidated FY payload consumed by the Impact page and the
 *    admin dashboard. Same shape as round 3 — topDonors filled only for
 *    ADMIN callers. FY = April → March; `fy` is the START year.
 */

/* ══════════════════════════ shared helpers ══════════════════════════ */

function parseDay(raw: string | null, endOfDay = false): Date | null {
  if (!raw) return null;
  const d = endOfDay && raw.length === 10 ? new Date(`${raw}T23:59:59.999Z`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 80G eligibility: completed gifts, but cash > ₹2,000 is NOT deductible. */
function eligible80g(paymentStatus: string, paymentMethod: string, amount: number): boolean {
  return paymentStatus === "COMPLETED" && !(paymentMethod === "CASH" && amount > 2000);
}

/* ════════════════════ healthcare programme aggregates ════════════════════ */

const HEALTHCARE_CAMPAIGN_SLUG = "community-health-wellness";

/**
 * programmes.health — live healthcare-delivery aggregates for [from, to].
 * Every count is filtered by its own model's date field (campDate/createdAt/
 * checkInAt/dispensedAt/spentAt/dueDate/doneAt). Empty tables yield all zeros.
 */
async function buildHealthAggregates(from: Date, to: Date) {
  const range = { gte: from, lte: to };

  const countByStatus = (groups: { status: string; _count: { _all: number } }[], s: string) =>
    groups.find((g) => g.status === s)?._count._all ?? 0;
  const sumOfAll = (groups: { _count: { _all: number } }[]) =>
    groups.reduce((a, g) => a + g._count._all, 0);

  const [
    campGroups,
    registrationCount,
    attendanceGroups,
    encounterGroups,
    prescriptionGroups,
    dispenseAgg,
    labGroups,
    labCritical,
    referralGroups,
    followUpGroups,
    followUpOverdue,
    medicalDonationAgg,
    expenseAgg,
  ] = await Promise.all([
    db.medicalCamp.groupBy({ by: ["status"], where: { campDate: range }, _count: { _all: true } }),
    db.campRegistration.count({ where: { createdAt: range } }),
    // No dedicated createdAt on CampAttendance: no-shows never check in, so fall
    // back to the 1:1 registration's createdAt when checkInAt is null.
    db.campAttendance.groupBy({
      by: ["status"],
      where: {
        OR: [{ checkInAt: range }, { checkInAt: null, registration: { createdAt: range } }],
      },
      _count: { _all: true },
    }),
    db.encounter.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
    db.prescription.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
    db.medicationDispense.aggregate({
      where: { dispensedAt: range },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    db.diagnosticOrder.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
    db.diagnosticOrder.count({ where: { critical: true, createdAt: range } }),
    db.medicalReferral.groupBy({ by: ["status"], where: { createdAt: range }, _count: { _all: true } }),
    db.followUp.groupBy({
      by: ["status"],
      where: {
        OR: [
          { status: "PENDING", dueDate: range },
          { status: "MISSED", dueDate: range },
          { status: "DONE", doneAt: range },
        ],
      },
      _count: { _all: true },
    }),
    db.followUp.count({
      where: { status: "PENDING", dueDate: { ...range, lt: new Date() } },
    }),
    db.donation.aggregate({
      where: {
        paymentStatus: "COMPLETED",
        createdAt: range,
        OR: [{ category: "MEDICAL" }, { campaign: { slug: HEALTHCARE_CAMPAIGN_SLUG } }],
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.campExpense.aggregate({
      where: { spentAt: range },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    camps: {
      total: sumOfAll(campGroups),
      live: countByStatus(campGroups, "LIVE"),
      scheduled: countByStatus(campGroups, "SCHEDULED"),
      completed: countByStatus(campGroups, "COMPLETED"),
      cancelled: countByStatus(campGroups, "CANCELLED"),
    },
    registrations: registrationCount,
    attendance: {
      checkedIn: countByStatus(attendanceGroups, "CHECKED_IN"),
      completed: countByStatus(attendanceGroups, "COMPLETED"),
      noShow: countByStatus(attendanceGroups, "NO_SHOW"),
      cancelled: countByStatus(attendanceGroups, "CANCELLED"),
    },
    consultations: {
      total: sumOfAll(encounterGroups),
      signed: countByStatus(encounterGroups, "SIGNED"),
    },
    prescriptions: {
      total: sumOfAll(prescriptionGroups),
      signed: countByStatus(prescriptionGroups, "SIGNED"),
      partiallyDispensed: countByStatus(prescriptionGroups, "PARTIALLY_DISPENSED"),
      fullyDispensed: countByStatus(prescriptionGroups, "FULLY_DISPENSED"),
      cancelled: countByStatus(prescriptionGroups, "CANCELLED"),
    },
    dispenses: {
      count: dispenseAgg._count._all,
      quantity: dispenseAgg._sum.quantity ?? 0,
    },
    labOrders: {
      total: sumOfAll(labGroups),
      resultAvailable: countByStatus(labGroups, "RESULT_AVAILABLE"),
      verified: countByStatus(labGroups, "VERIFIED"),
      doctorReviewed: countByStatus(labGroups, "DOCTOR_REVIEWED"),
      critical: labCritical,
    },
    referrals: {
      total: sumOfAll(referralGroups),
      pending:
        countByStatus(referralGroups, "CREATED") + countByStatus(referralGroups, "SHARED"),
      completed: countByStatus(referralGroups, "COMPLETED"),
      lostToFollowUp: countByStatus(referralGroups, "LOST_TO_FOLLOWUP"),
    },
    followUps: {
      pending: countByStatus(followUpGroups, "PENDING"),
      overdue: followUpOverdue,
      done: countByStatus(followUpGroups, "DONE"),
      missed: countByStatus(followUpGroups, "MISSED"),
    },
    donations: {
      amount: round2(medicalDonationAgg._sum.amount ?? 0),
      count: medicalDonationAgg._count._all,
    },
    expenses: {
      amount: round2(expenseAgg._sum.amount ?? 0),
      count: expenseAgg._count._all,
    },
  };
}

/** Food programme aggregates (ration kits + FOOD distributions + FOOD_KIT stock). */
async function buildFoodAggregates(from: Date, to: Date) {
  const range = { gte: from, lte: to };
  const [foodDistAgg, foodBenRows, kitTemplateCount, kitBatchCount, kitBatchAgg, kitScannedInRange, kitReady, kitExpired, foodItems] =
    await Promise.all([
      db.distribution.aggregate({
        where: { type: "FOOD", distributedAt: range },
        _sum: { quantity: true, value: true },
        _count: { _all: true },
      }),
      db.distribution.findMany({
        where: { type: "FOOD", distributedAt: range, beneficiaryId: { not: null } },
        select: { beneficiaryId: true },
        distinct: ["beneficiaryId"],
      }),
      db.kitTemplate.count(),
      db.kitBatch.count(),
      db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } }),
      db.kitUnit.count({ where: { status: "SCANNED", scannedAt: range } }),
      db.kitUnit.count({ where: { status: "READY" } }),
      db.kitUnit.count({ where: { status: "EXPIRED" } }),
      db.inventoryItem.findMany({ where: { category: "FOOD_KIT" }, select: { quantity: true, minStock: true } }),
    ]);
  return {
    kits: {
      templates: kitTemplateCount,
      batches: kitBatchCount,
      totalUnits: kitBatchAgg._sum.totalUnits ?? 0,
      scannedUnits: kitBatchAgg._sum.scannedUnits ?? 0,
      scannedInRange: kitScannedInRange,
      readyUnits: kitReady,
      expiredUnits: kitExpired,
    },
    distributions: {
      count: foodDistAgg._count._all,
      quantity: foodDistAgg._sum.quantity ?? 0,
      value: round2(foodDistAgg._sum.value ?? 0),
      beneficiaries: foodBenRows.length,
    },
    inventory: {
      items: foodItems.length,
      stockUnits: foodItems.reduce((a, i) => a + i.quantity, 0),
      lowStock: foodItems.filter((i) => i.quantity <= i.minStock).length,
    },
  };
}

/* ════════════════════ ADMIN range report (branch 2) ════════════════════ */

interface RegisterRow {
  id: string;
  createdAt: Date;
  receiptNumber: string;
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  isAnonymous: boolean;
  pan: string | null;
  amount: number;
  fees: number;
  type: string;
  category: string;
  paymentMethod: string;
  paymentStatus: string;
  receiptStatus: string;
  campaignId: string | null;
  campaignTitle: string | null;
  eligible80g: boolean;
}

type RawDonationRow = Omit<RegisterRow, "eligible80g" | "campaignTitle"> & {
  campaign: { title: string | null } | null;
};

type MonthBucket = { key: string; label: string; amount: number; count: number; receipts: number };

async function buildRangeAggregates(from: Date, to: Date, includeRegister: boolean) {
  const rangeWhere = { createdAt: { gte: from, lte: to } };
  const completedWhere = { paymentStatus: "COMPLETED", ...rangeWhere };
  const receiptedWhere = { paymentStatus: "COMPLETED", receiptNumber: { not: "" }, ...rangeWhere };
  const panWhere = { paymentStatus: "COMPLETED", pan: { not: null }, ...rangeWhere };

  const [
    completedAgg,
    panAgg,
    ineligibleAgg,
    receiptRows,
    distAgg,
    distByType,
    distBeneficiaries,
    padAgg,
    padRows,
    kitBatchAgg,
    kitsScannedInRange,
    causeGroups,
    activePledgeAgg,
    animalGroups,
    animalPledgeCount,
    missionsAgg,
    missionsCompleted,
    corridorEventAgg,
    campaignRows,
    registerRaw,
    volunteerAppGroups,
    beneficiaryGroupsCat,
    beneficiaryGroupsUrg,
    beneficiaryOnboarded,
  ] = await Promise.all([
    db.donation.aggregate({
      where: completedWhere,
      _sum: { amount: true, fees: true },
      _count: { _all: true },
    }),
    db.donation.aggregate({ where: panWhere, _sum: { amount: true }, _count: { _all: true } }),
    db.donation.aggregate({
      where: { paymentMethod: "CASH", amount: { gt: 2000 }, ...rangeWhere },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.donation.findMany({
      where: receiptedWhere,
      select: { amount: true, createdAt: true },
    }),
    db.distribution.aggregate({
      where: { distributedAt: { gte: from, lte: to } },
      _sum: { value: true, quantity: true },
      _count: { _all: true },
    }),
    db.distribution.groupBy({
      by: ["type"],
      where: { distributedAt: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { quantity: true, value: true },
    }),
    db.distribution.findMany({
      where: { distributedAt: { gte: from, lte: to }, beneficiaryId: { not: null } },
      select: { beneficiaryId: true },
      distinct: ["beneficiaryId"],
    }),
    db.padDistribution.aggregate({
      where: { distributionDate: { gte: from, lte: to } },
      _sum: { padsDistributed: true, girlsCount: true },
      _count: { _all: true },
    }),
    db.padDistribution.findMany({
      where: { distributionDate: { gte: from, lte: to } },
      select: { schoolName: true, awarenessSession: true },
    }),
    db.kitBatch.aggregate({ _sum: { totalUnits: true, scannedUnits: true } }),
    db.kitUnit.count({ where: { status: "SCANNED", scannedAt: { gte: from, lte: to } } }),
    db.cause.groupBy({ by: ["status"], _count: { _all: true } }),
    db.pledge.aggregate({ where: { status: "ACTIVE" }, _sum: { amountPerMonth: true }, _count: { _all: true } }),
    db.animal.groupBy({ by: ["status"], _count: { _all: true } }),
    db.animalPledge.count({ where: { status: "ACTIVE" } }),
    db.mission.aggregate({
      where: { createdAt: { gte: from, lte: to } },
      _sum: { vehiclesAlerted: true, timeSavedSec: true },
      _count: { _all: true },
    }),
    db.mission.count({ where: { status: "COMPLETED", createdAt: { gte: from, lte: to } } }),
    db.corridorEvent.aggregate({
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { vehiclesAlerted: true, timeSavedSec: true },
    }),
    db.campaign.findMany({
      where: { status: { not: "DRAFT" } },
      orderBy: { raisedAmount: "desc" },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        raisedAmount: true,
        targetAmount: true,
        beneficiaries: true,
      },
    }),
    includeRegister
      ? db.donation.findMany({
          where: rangeWhere,
          orderBy: { createdAt: "desc" },
          take: 1000,
          select: {
            id: true,
            createdAt: true,
            receiptNumber: true,
            donorName: true,
            donorEmail: true,
            donorPhone: true,
            isAnonymous: true,
            pan: true,
            amount: true,
            fees: true,
            type: true,
            category: true,
            paymentMethod: true,
            paymentStatus: true,
            receiptStatus: true,
            campaignId: true,
            campaign: { select: { title: true } },
          },
        })
      : Promise.resolve([] as RawDonationRow[]),
    db.volunteerApplication.groupBy({ by: ["status"], _count: { _all: true } }),
    db.beneficiary.groupBy({ by: ["category"], _count: { _all: true } }),
    db.beneficiary.groupBy({ by: ["urgencyLevel"], _count: { _all: true } }),
    db.beneficiary.count({ where: { createdAt: { gte: from, lte: to } } }),
  ]);

  const register: RegisterRow[] = (registerRaw as RawDonationRow[]).map((d) => ({
    ...d,
    campaignTitle: d.campaign?.title ?? null,
    eligible80g: eligible80g(d.paymentStatus, d.paymentMethod, d.amount),
  }));

  /* ---- month buckets across the range (cap 24) ---- */
  const buckets: MonthBucket[] = [];
  {
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (cursor <= to && buckets.length < 24) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        key,
        label: `${MONTHS[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear()).slice(2)}`,
        amount: 0,
        count: 0,
        receipts: 0,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    for (const r of receiptRows) {
      const key = `${r.createdAt.getUTCFullYear()}-${String(r.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
      const i = index.get(key);
      if (i !== undefined) {
        buckets[i].receipts += 1;
        buckets[i].amount = round2(buckets[i].amount + r.amount);
        buckets[i].count += 1;
      }
    }
  }

  /* ---- categories ---- */
  const [completedCats, health, food] = await Promise.all([
    db.donation.groupBy({
      by: ["category"],
      where: completedWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    buildHealthAggregates(from, to),
    buildFoodAggregates(from, to),
  ]);
  const categories = completedCats
    .map((g) => ({
      category: g.category,
      amount: round2(g._sum.amount ?? 0),
      count: g._count._all,
    }))
    .sort((a, b) => b.amount - a.amount);

  /* ---- donors: distinct emails in range + new vs repeat ---- */
  const donorEmails = new Set(
    register.map((d) => d.donorEmail.trim().toLowerCase()).filter(Boolean)
  );
  const firstGiftRows = donorEmails.size
    ? await db.donation.groupBy({
        by: ["donorEmail"],
        where: { paymentStatus: "COMPLETED", donorEmail: { in: [...donorEmails] } },
        _min: { createdAt: true },
      })
    : [];
  let donorsNew = 0;
  for (const g of firstGiftRows) {
    const min = g._min.createdAt;
    if (min && min >= from && min <= to) donorsNew += 1;
  }
  const donorsTotal = donorEmails.size;

  /* ---- top donors (anonymised when flagged) ---- */
  const donorMap = new Map<string, { name: string; amount: number; count: number }>();
  for (const d of register) {
    if (d.paymentStatus !== "COMPLETED") continue;
    const key = d.donorEmail.trim().toLowerCase() || d.donorName;
    const entry = donorMap.get(key) ?? {
      name: d.isAnonymous ? "Anonymous" : d.donorName,
      amount: 0,
      count: 0,
    };
    entry.amount += d.amount;
    entry.count += 1;
    donorMap.set(key, entry);
  }
  const topDonors = [...donorMap.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((t) => ({ ...t, amount: round2(t.amount) }));

  /* ---- campaign utilisation + in-range raised per campaign ---- */
  const inRangeByCampaign = new Map<string, number>();
  for (const d of register) {
    if (d.paymentStatus === "COMPLETED" && d.campaignId) {
      inRangeByCampaign.set(
        d.campaignId,
        (inRangeByCampaign.get(d.campaignId) ?? 0) + d.amount
      );
    }
  }
  const campaigns = campaignRows.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    status: c.status,
    raised: round2(c.raisedAmount),
    target: round2(c.targetAmount),
    pct: c.targetAmount > 0 ? Math.min(999, Math.round((c.raisedAmount / c.targetAmount) * 100)) : 0,
    raisedInRange: round2(inRangeByCampaign.get(c.id) ?? 0),
    beneficiaries: c.beneficiaries,
  }));

  /* ---- assemble ---- */
  const fundsRaised = round2(completedAgg._sum.amount ?? 0);
  const receiptedSum = round2(receiptRows.reduce((a, r) => a + r.amount, 0));
  const panReceiptedSum = round2(panAgg._sum.amount ?? 0);
  const disbursedValue = round2(distAgg._sum.value ?? 0);
  const servedViaDistributions = distBeneficiaries.length;
  const padGirls = padAgg._sum.girlsCount ?? 0;
  const donationCount = completedAgg._count._all;
  const receiptCount = receiptRows.length;

  const status = (groups: { status: string; _count: { _all: number } }[], s: string) =>
    groups.find((g) => g.status === s)?._count._all ?? 0;

  return {
    kpis: {
      fundsRaised,
      donationCount,
      avgDonation: donationCount ? round2(fundsRaised / donationCount) : 0,
      receiptsIssued: receiptCount,
      receiptedSum,
      fundsDisbursed: disbursedValue,
      distributionCount: distAgg._count._all,
      distributionQuantity: distAgg._sum.quantity ?? 0,
      beneficiariesServed: servedViaDistributions + padGirls,
      servedViaDistributions,
      padGirls,
      panCoveragePct: receiptedSum > 0 ? round2((panReceiptedSum / receiptedSum) * 100) : 0,
      panReceipts: panAgg._count._all,
      donorCount: donorsTotal,
    },
    monthly: buckets,
    categories,
    register,
    campaigns,
    utilization: {
      disbursedValue,
      disbursedQuantity: distAgg._sum.quantity ?? 0,
      disbursedCount: distAgg._count._all,
      byType: distByType
        .map((g) => ({
          type: g.type,
          count: g._count._all,
          quantity: g._sum.quantity ?? 0,
          value: round2(g._sum.value ?? 0),
        }))
        .sort((a, b) => b.value - a.value || b.count - a.count),
    },
    programmes: {
      kits: {
        totalUnits: kitBatchAgg._sum.totalUnits ?? 0,
        scannedUnits: kitBatchAgg._sum.scannedUnits ?? 0,
        scannedInRange: kitsScannedInRange,
      },
      food,
      pads: {
        drives: padAgg._count._all,
        pads: padAgg._sum.padsDistributed ?? 0,
        girls: padGirls,
        sessions: padRows.filter((p) => p.awarenessSession).length,
        schools: new Set(padRows.map((p) => p.schoolName?.trim()).filter(Boolean)).size,
        avgPerGirl:
          (padAgg._sum.girlsCount ?? 0) > 0
            ? Math.round((padAgg._sum.padsDistributed ?? 0) / (padAgg._sum.girlsCount ?? 1))
            : 0,
      },
      medicine: {
        total: causeGroups.reduce((a, g) => a + g._count._all, 0),
        seeking: status(causeGroups, "SEEKING"),
        partial: status(causeGroups, "PARTIAL"),
        adopted: status(causeGroups, "ADOPTED"),
        paused: status(causeGroups, "PAUSED"),
        activePledges: activePledgeAgg._count._all,
        monthlyPledged: round2(activePledgeAgg._sum.amountPerMonth ?? 0),
      },
      animals: {
        total: animalGroups.reduce((a, g) => a + g._count._all, 0),
        available: status(animalGroups, "AVAILABLE"),
        fostered: status(animalGroups, "FOSTERED"),
        adopted: status(animalGroups, "ADOPTED"),
        critical: status(animalGroups, "CRITICAL"),
        activePledges: animalPledgeCount,
      },
      corridor: {
        missions: missionsAgg._count._all,
        missionsCompleted,
        events: corridorEventAgg._count._all,
        vehiclesAlerted: missionsAgg._sum.vehiclesAlerted ?? 0,
        timeSavedSec: missionsAgg._sum.timeSavedSec ?? 0,
        avgTimeSavedSec:
          missionsAgg._count._all > 0
            ? Math.round((missionsAgg._sum.timeSavedSec ?? 0) / missionsAgg._count._all)
            : 0,
      },
      health,
    },
    people: {
      donors: {
        total: donorsTotal,
        new: donorsNew,
        repeat: Math.max(0, donorsTotal - donorsNew),
      },
      topDonors,
      volunteerApplications: {
        total: volunteerAppGroups.reduce((a, g) => a + g._count._all, 0),
        pending: status(volunteerAppGroups, "PENDING"),
        approved: status(volunteerAppGroups, "APPROVED"),
        rejected: status(volunteerAppGroups, "REJECTED"),
      },
      beneficiaries: {
        total: beneficiaryGroupsCat.reduce((a, g) => a + g._count._all, 0),
        onboardedInRange: beneficiaryOnboarded,
        byCategory: beneficiaryGroupsCat
          .map((g) => ({ category: g.category, count: g._count._all }))
          .sort((a, b) => b.count - a.count),
        byUrgency: ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((u) => ({
          urgency: u,
          count: beneficiaryGroupsUrg.find((g) => g.urgencyLevel === u)?._count._all ?? 0,
        })),
      },
    },
    compliance: {
      receiptCount,
      receiptSum: receiptedSum,
      monthlyReceipts: buckets.map((b) => ({ label: b.label, count: b.receipts, sum: b.amount })),
      ineligible80g: {
        count: ineligibleAgg._count._all,
        sum: round2(ineligibleAgg._sum.amount ?? 0),
      },
      panReceipts: { count: panAgg._count._all, sum: panReceiptedSum },
    },
  };
}

function trimForComparison(a: Awaited<ReturnType<typeof buildRangeAggregates>>) {
  return { ...a, register: [] };
}

async function adminRangeReport(req: Request, res: Response) {
  await requireRole(req, "ADMIN");

  const sp = new URL(req.url, "http://localhost").searchParams;
  const now = new Date();

  // Default period = current financial year (Apr 1 → Mar 31).
  const fyStartYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const from = parseDay(sp.get("from")) ?? new Date(Date.UTC(fyStartYear, 3, 1));
  const to = parseDay(sp.get("to"), true) ?? new Date(Date.UTC(fyStartYear + 1, 2, 31, 23, 59, 59, 999));
  if (from.getTime() > to.getTime()) throw new ApiError("'from' must be before 'to'", 400);

  const wantCompare = sp.get("compare") === "1";
  const spanMs = to.getTime() - from.getTime();

  const current = await buildRangeAggregates(from, to, true);

  let previous: ReturnType<typeof trimForComparison> | null = null;
  let prevFrom: string | null = null;
  let prevTo: string | null = null;
  if (wantCompare) {
    const pTo = new Date(from.getTime() - 1);
    const pFrom = new Date(pTo.getTime() - spanMs);
    previous = trimForComparison(await buildRangeAggregates(pFrom, pTo, false));
    prevFrom = pFrom.toISOString().slice(0, 10);
    prevTo = pTo.toISOString().slice(0, 10);
  }

  return json(res, {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    compare: wantCompare,
    previousRange: wantCompare ? { from: prevFrom, to: prevTo } : null,
    current,
    previous,
  });
}

/* ════════════════════ legacy typed reports (branch 1) ════════════════════ */

async function legacyTypedReport(req: Request, res: Response, sp: URLSearchParams) {
  await requireRole(req, "ADMIN", "VOLUNTEER");

  const type = sp.get("type");
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"), true);

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
    return json(res, { rows, totals: { count: rows.length, sum } });
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
    return json(res, {
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
    return json(res, { rows });
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
    return json(res, { rows });
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

  return json(res, {
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

/* ════════════════════ public FY payload (branch 3) ════════════════════ */

async function publicFyReport(req: Request, res: Response, sp: URLSearchParams) {
  const session = await validateSession(req);
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
    health,
    food,
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
    buildHealthAggregates(fyStart, fyEnd),
    buildFoodAggregates(fyStart, fyEnd),
  ]);

  return json(res, {
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
      food,
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
      health,
    },
    fyTotals: { amount: totalDonations, count: donationCount },
  });
}

/* ═══════════════════════════════ GET ═══════════════════════════════ */

router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const type = sp.get("type");

    if (type) return await legacyTypedReport(req, res, sp);

    // ADMIN-only consolidated range report (reports module).
    if (sp.get("from") || sp.get("to") || sp.get("compare")) {
      return await adminRangeReport(req, res);
    }

    // Public consolidated FY payload (Impact page + admin dashboard).
    return await publicFyReport(req, res, sp);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reports/sponsorship-coverage (ADMIN only)
// Coverage of standing (recurring) beneficiary needs by monthly donor
// sponsorships \u2014 how much of what beneficiaries need every month is actually
// backed by a committed sponsor, donor retention on that commitment, and
// which lapsed sponsors/unsponsored needs deserve attention.
router.get("/sponsorship-coverage", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");

    const [activeNeeds, sponsorships] = await Promise.all([
      db.recurringNeed.findMany({
        where: { status: "ACTIVE" },
        include: {
          beneficiary: { select: { id: true, name: true, city: true, urgencyLevel: true } },
          item: { select: { name: true, unit: true } },
          sponsorships: { where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true } },
        },
      }),
      db.beneficiarySponsorship.findMany({
        include: { donor: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const sponsoredNeeds = activeNeeds.filter((n) => n.sponsorships.length > 0);
    const unsponsoredNeeds = activeNeeds.filter((n) => n.sponsorships.length === 0);
    const coveragePct = activeNeeds.length > 0 ? round2((sponsoredNeeds.length / activeNeeds.length) * 100) : 0;

    const active = sponsorships.filter((s) => s.status === "ACTIVE");
    const paused = sponsorships.filter((s) => s.status === "PAUSED");
    const cancelled = sponsorships.filter((s) => s.status === "CANCELLED");
    const completed = sponsorships.filter((s) => s.status === "COMPLETED");
    const monthlyPledged = round2(active.reduce((s, x) => s + x.amountPerMonth, 0));

    // Donor retention: of everyone who has ever sponsored, how many still have
    // at least one live (ACTIVE/PAUSED) commitment.
    const everSponsored = new Set(sponsorships.map((s) => s.donorId ?? s.donorName));
    const stillLive = new Set(
      sponsorships.filter((s) => s.status === "ACTIVE" || s.status === "PAUSED").map((s) => s.donorId ?? s.donorName)
    );
    const retentionPct = everSponsored.size > 0 ? round2((stillLive.size / everSponsored.size) * 100) : 0;

    const now = Date.now();
    const unsponsoredWorklist = unsponsoredNeeds
      .map((n) => ({
        recurringNeedId: n.id,
        beneficiaryId: n.beneficiary.id,
        beneficiaryName: n.beneficiary.name,
        city: n.beneficiary.city,
        urgencyLevel: n.beneficiary.urgencyLevel,
        itemName: n.item.name,
        unit: n.item.unit,
        qtyPerCycle: n.qtyPerCycle,
        cycle: n.cycle,
        overdue: new Date(n.nextDueAt).getTime() < now,
      }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue));

    const lapsedSponsors = cancelled
      .map((s) => ({
        id: s.id,
        donorName: s.donor?.name ?? s.donorName,
        donorEmail: s.donor?.email ?? null,
        amountPerMonth: s.amountPerMonth,
        startDate: s.startDate,
      }))
      .slice(0, 20);

    return json(res, {
      summary: {
        activeNeeds: activeNeeds.length,
        sponsoredNeeds: sponsoredNeeds.length,
        unsponsoredNeeds: unsponsoredNeeds.length,
        coveragePct,
        activeSponsorships: active.length,
        pausedSponsorships: paused.length,
        cancelledSponsorships: cancelled.length,
        completedSponsorships: completed.length,
        monthlyPledged,
        everSponsored: everSponsored.size,
        stillLive: stillLive.size,
        retentionPct,
      },
      unsponsoredWorklist,
      lapsedSponsors,
    });
  } catch (e) {
    return handleError(e, res);
  }
});
