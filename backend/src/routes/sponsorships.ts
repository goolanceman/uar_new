/**
 * Sponsorships routes — /api/sponsorships, /api/sponsorships/match, /api/sponsorships/:id
 * Converted 1:1 from src/app/api/sponsorships/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { requireRole, requireAuth, json, handleError, ApiError, logActivity } from "@/lib/session";
import {
  SPONSORSHIP_STATUSES,
  DONOR_ALLOWED_SPONSORSHIP_STATUSES,
} from "@/lib/sponsorships";
import { monthlyEquivalent } from "@/lib/distribution-stock";

export const router = Router();

const STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

const INCLUDE = {
  beneficiary: { select: { id: true, name: true, city: true, category: true, urgencyLevel: true, caseStatus: true } },
  donor: { select: { id: true, name: true, email: true, phone: true, category: true } },
  recurringNeed: { include: { item: { select: { id: true, name: true, unit: true } } } },
} satisfies Prisma.BeneficiarySponsorshipInclude;

const SP_STATUSES = SPONSORSHIP_STATUSES;
// A donor managing their own sponsorship may only toggle it off/on or cancel —
// never edit the amount, months or re-activate a staff-completed/cancelled one.
const DONOR_ALLOWED_STATUSES = DONOR_ALLOWED_SPONSORSHIP_STATUSES;

const URGENCY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({
    where: { key: { startsWith: "matching." } },
    select: { key: true, value: true },
  });
  const map: Record<string, string> = {
    "matching.enabled": "true",
    "matching.donorCategory": "MONTHLY",
    "matching.minMonthlyAmount": "500",
    "matching.maxActivePerDonor": "3",
  };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

// GET /api/sponsorships?beneficiaryId=&donorId=&status=&mine=1
// Staff (ADMIN | VOLUNTEER) see any slice via query filters. A logged-in
// DONOR may only pass mine=1, which scopes to their own Donor record
// (resolved via Donor.userId) — so donors can see what they're sponsoring.
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
    const where: Prisma.BeneficiarySponsorshipWhereInput = {};

    if (sp.get("mine")) {
      const donor = await db.donor.findUnique({ where: { userId: session.userId } });
      where.donorId = donor?.id ?? "__none__";
    } else {
      if (!["ADMIN", "VOLUNTEER"].includes(session.role))
        throw new ApiError("You do not have permission for this action", 403);

      const beneficiaryId = sp.get("beneficiaryId")?.trim();
      if (beneficiaryId) where.beneficiaryId = beneficiaryId;

      const donorId = sp.get("donorId")?.trim();
      if (donorId) where.donorId = donorId;

      const status = sp.get("status")?.trim().toUpperCase();
      if (status && STATUSES.includes(status)) where.status = status;
    }

    const rows = await db.beneficiarySponsorship.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/sponsorships/match (ADMIN | VOLUNTEER)
// Suggests donor <-> beneficiary pairings: active recurring needs that have
// no live sponsorship, matched against donors in the configured recurring
// category who aren't already at their active-sponsorship cap. Suggestions
// are preview-only — confirming one is a normal POST /api/sponsorships call.
// NOTE: declared before the "/:id" pattern.
router.get("/match", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const settings = await getSettings();
    const enabled = settings["matching.enabled"] !== "false";
    const minMonthly = Math.max(0, Number(settings["matching.minMonthlyAmount"]) || 500);
    const maxPerDonor = Math.max(1, Math.trunc(Number(settings["matching.maxActivePerDonor"]) || 3));
    const donorCategory = (settings["matching.donorCategory"] || "MONTHLY").trim();

    if (!enabled) {
      return json(res, { enabled: false, suggestions: [], unmatchedNeeds: 0, availableDonors: 0 });
    }

    // Needs that are active and have no ACTIVE/PAUSED sponsorship yet.
    const needs = await db.recurringNeed.findMany({
      where: {
        status: "ACTIVE",
        sponsorships: { none: { status: { in: ["ACTIVE", "PAUSED"] } } },
      },
      include: {
        beneficiary: { select: { id: true, name: true, city: true, urgencyLevel: true } },
        item: { select: { id: true, name: true, unit: true, pricePerUnit: true } },
      },
      orderBy: { nextDueAt: "asc" },
    });

    // Candidate donors: configured category, with their current active-sponsorship load.
    const donors = await db.donor.findMany({
      where: { category: donorCategory },
      select: {
        id: true,
        name: true,
        email: true,
        category: true,
        _count: { select: { sponsorships: { where: { status: { in: ["ACTIVE", "PAUSED"] } } } } },
      },
    });
    const pool = donors
      .filter((d) => d._count.sponsorships < maxPerDonor)
      .sort((a, b) => a._count.sponsorships - b._count.sponsorships);

    const load = new Map(pool.map((d) => [d.id, d._count.sponsorships]));
    const sortedNeeds = [...needs].sort((a, b) => {
      const ra = URGENCY_RANK[a.beneficiary.urgencyLevel] ?? 4;
      const rb = URGENCY_RANK[b.beneficiary.urgencyLevel] ?? 4;
      if (ra !== rb) return ra - rb;
      return new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime();
    });

    const suggestions: Array<{
      recurringNeedId: string;
      beneficiaryId: string;
      beneficiaryName: string;
      beneficiaryCity: string | null;
      urgencyLevel: string;
      itemName: string;
      unit: string;
      qtyPerCycle: number;
      cycle: string;
      suggestedAmountPerMonth: number;
      donorId: string;
      donorName: string;
      donorEmail: string;
    }> = [];

    let cursor = 0;
    for (const need of sortedNeeds) {
      if (pool.length === 0) break;
      // round-robin starting from cursor, skip donors already at cap
      let picked: (typeof pool)[number] | null = null;
      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[(cursor + i) % pool.length];
        if ((load.get(candidate.id) ?? 0) < maxPerDonor) {
          picked = candidate;
          cursor = (cursor + i + 1) % pool.length;
          break;
        }
      }
      if (!picked) break;
      load.set(picked.id, (load.get(picked.id) ?? 0) + 1);

      const monthlyQty = monthlyEquivalent(need.qtyPerCycle, need.cycle);
      const unitPrice = need.item.pricePerUnit ?? 0;
      const suggestedAmount = Math.max(minMonthly, Math.round(monthlyQty * unitPrice));

      suggestions.push({
        recurringNeedId: need.id,
        beneficiaryId: need.beneficiaryId,
        beneficiaryName: need.beneficiary.name,
        beneficiaryCity: need.beneficiary.city,
        urgencyLevel: need.beneficiary.urgencyLevel,
        itemName: need.item.name,
        unit: need.item.unit,
        qtyPerCycle: need.qtyPerCycle,
        cycle: need.cycle,
        suggestedAmountPerMonth: suggestedAmount,
        donorId: picked.id,
        donorName: picked.name,
        donorEmail: picked.email,
      });
    }

    return json(res, {
      enabled: true,
      suggestions,
      unmatchedNeeds: needs.length,
      availableDonors: pool.length,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/sponsorships (ADMIN | VOLUNTEER) — manually assign a donor to
// sponsor a beneficiary's monthly support (optionally tied to one recurring
// need, e.g. "cover BP tablets every month").
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const beneficiaryId = String(body.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const donorId = body.donorId ? String(body.donorId).trim() : null;
    let donorName = body.donorName ? String(body.donorName).trim() : "";
    if (donorId) {
      const donor = await db.donor.findUnique({ where: { id: donorId } });
      if (!donor) throw new ApiError("Donor not found", 404);
      donorName = donor.name;
    }
    if (!donorName) throw new ApiError("donorId or donorName is required", 400);

    const recurringNeedId = body.recurringNeedId ? String(body.recurringNeedId).trim() : null;
    if (recurringNeedId) {
      const need = await db.recurringNeed.findUnique({ where: { id: recurringNeedId } });
      if (!need) throw new ApiError("Recurring need not found", 404);
      if (need.beneficiaryId !== beneficiaryId)
        throw new ApiError("Recurring need does not belong to this beneficiary", 400);
    }

    const amountPerMonth = Number(body.amountPerMonth);
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0)
      throw new ApiError("amountPerMonth must be a positive number", 400);

    const months = Math.max(1, Math.trunc(Number(body.months) || 6));

    const row = await db.beneficiarySponsorship.create({
      data: {
        beneficiaryId,
        donorId,
        donorName,
        recurringNeedId,
        amountPerMonth,
        months,
        notes: body.notes ? String(body.notes).trim() : null,
        source: body.source === "AUTO_MATCH" ? "AUTO_MATCH" : "MANUAL",
        assignedByName: session.name,
      },
      include: INCLUDE,
    });

    await logActivity(
      session.name,
      "CREATE",
      "BeneficiarySponsorship",
      `${donorName} → ${beneficiary.name} \u20b9${amountPerMonth}/mo`,
      session.userId
    );

    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/sponsorships/:id
// Staff (ADMIN | VOLUNTEER) may edit anything. A DONOR may only pause/resume
// or cancel a sponsorship that belongs to their own Donor record.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { id } = req.params;
    const existing = await db.beneficiarySponsorship.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Sponsorship not found", 404);

    const isStaff = ["ADMIN", "VOLUNTEER"].includes(session.role);
    if (!isStaff) {
      if (session.role !== "DONOR") throw new ApiError("You do not have permission for this action", 403);
      const donor = await db.donor.findUnique({ where: { userId: session.userId } });
      if (!donor || existing.donorId !== donor.id)
        throw new ApiError("You do not have permission for this action", 403);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    if (body.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!SP_STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      if (!isStaff && !DONOR_ALLOWED_STATUSES.includes(status))
        throw new ApiError("You do not have permission for this action", 403);
      data.status = status;
    }
    if (!isStaff && (body.amountPerMonth !== undefined || body.months !== undefined))
      throw new ApiError("You do not have permission for this action", 403);
    if (body.amountPerMonth !== undefined) {
      const amt = Number(body.amountPerMonth);
      if (!Number.isFinite(amt) || amt <= 0) throw new ApiError("amountPerMonth must be positive", 400);
      data.amountPerMonth = amt;
    }
    if (body.months !== undefined) data.months = Math.max(1, Math.trunc(Number(body.months) || 6));
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const row = await db.beneficiarySponsorship.update({
      where: { id },
      data,
      include: {
        beneficiary: { select: { id: true, name: true } },
        donor: { select: { id: true, name: true } },
        recurringNeed: { include: { item: { select: { id: true, name: true, unit: true } } } },
      },
    });

    await logActivity(session.name, "UPDATE", "BeneficiarySponsorship", JSON.stringify(data), session.userId);
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/sponsorships/:id (ADMIN only) — remove a sponsorship assignment
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.beneficiarySponsorship.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Sponsorship not found", 404);

    await db.beneficiarySponsorship.delete({ where: { id } });
    await logActivity(session.name, "DELETE", "BeneficiarySponsorship", id, session.userId);
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
