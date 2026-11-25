/**
 * Distributions routes — /api/distributions, /api/distributions/:id
 * Converted 1:1 from src/app/api/distributions/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import {
  addCycle,
  consumeItemsStock,
  consumeKitBatch,
  restoreItemsStock,
  restoreKitBatch,
  type DistItemInput,
} from "@/lib/distribution-stock";
import { buildUnifiedLedger } from "@/lib/distribution-ledger";

export const router = Router();

const TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "EDUCATION_MATERIAL",
  "CASH",
  "OTHER",
];

/** Sanitise the items JSON payload → [{itemId?, name, qty, unit?}] array (parsed, not stringified). */
function sanitizeItemsArray(raw: unknown): DistItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i) => {
      const o = (i ?? {}) as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      const qty = Number(o.qty ?? 1);
      const unit = String(o.unit ?? "").trim();
      const itemId = o.itemId ? String(o.itemId).trim() : undefined;
      return {
        ...(itemId ? { itemId } : {}),
        name,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        ...(unit ? { unit } : {}),
      };
    })
    .filter((i) => i.name.length > 0);
}


/** End-of-day for date-only `to` values so ranges are inclusive. */
function parseFrom(sp: URLSearchParams): Date | undefined {
  const raw = sp.get("from")?.trim();
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseTo(sp: URLSearchParams): Date | undefined {
  const raw = sp.get("to")?.trim();
  if (!raw) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999` : raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function buildWhere(
  sp: URLSearchParams,
  mineVolunteerId?: string
): Prisma.DistributionWhereInput {
  const where: Prisma.DistributionWhereInput = {};

  const type = sp.get("type")?.trim();
  if (type && type.toUpperCase() !== "ALL") {
    const list = Array.from(
      new Set(
        type
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter((t) => TYPES.includes(t))
      )
    );
    if (list.length === 1) where.type = list[0];
    else if (list.length > 1) where.type = { in: list };
  }

  const q = sp.get("q")?.trim();
  if (q)
    where.OR = [
      { location: { contains: q } },
      { notes: { contains: q } },
      { items: { contains: q } },
      { beneficiary: { is: { name: { contains: q } } } },
      { beneficiary: { is: { city: { contains: q } } } },
    ];

  const from = parseFrom(sp);
  const to = parseTo(sp);
  if (from || to)
    where.distributedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };

  const volunteerId = sp.get("volunteerId")?.trim();
  if (volunteerId) where.volunteerId = volunteerId;

  const beneficiaryId = sp.get("beneficiaryId")?.trim();
  if (beneficiaryId) where.beneficiaryId = beneficiaryId;

  const campaignId = sp.get("campaignId")?.trim();
  if (campaignId) where.campaignId = campaignId;

  const kitBatchId = sp.get("kitBatchId")?.trim();
  if (kitBatchId) where.kitBatchId = kitBatchId;

  const itemId = sp.get("itemId")?.trim();
  if (itemId) where.items = { contains: itemId };

  if (sp.get("mine") && mineVolunteerId) where.volunteerId = mineVolunteerId;

  return where;
}

const INCLUDE = {
  beneficiary: {
    select: {
      id: true,
      name: true,
      category: true,
      urgencyLevel: true,
      city: true,
      familyMembers: true,
    },
  },
  volunteer: { include: { user: { select: { name: true } } } },
} satisfies Prisma.DistributionInclude;

// GET /api/distributions
//   ?unified=1  → merged ledger across all four distribution systems:
//     legacy Distribution + food-programme handovers + medication dispenses
//     + pad drives. Supports &source= &type= &q= &limit= &offset=.
//     Response: { items: UnifiedRow[], total: number }  (auth)
//   ?type=FOOD,MEDICAL &q= &from= &to= &volunteerId= &beneficiaryId= &campaignId=
//   &mine=1 &limit= &offset= &withTotals=1   (auth)
// Default response = raw array (legacy callers). withTotals=1 → envelope.
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;

    // Unified ledger mode — merge all distribution sources into one feed.
    if (sp.get("unified") === "1") return json(res, await buildUnifiedLedger(sp));

    let mineVolunteerId: string | undefined;
    if (sp.get("mine")) {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (!volunteer)
        return sp.get("withTotals") === "1"
          ? json(res, {
              items: [],
              total: 0,
              count: 0,
              sumValue: 0,
              sumQuantity: 0,
              beneficiariesServed: 0,
              avgItemsPerDrive: 0,
            })
          : json(res, []);
      mineVolunteerId = volunteer.id;
    }

    const where = buildWhere(sp, mineVolunteerId);
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 50)));
    const offset = Math.max(0, Math.trunc(Number(sp.get("offset")) || 0));
    const withTotals = sp.get("withTotals") === "1";

    const [rows, total] = await Promise.all([
      db.distribution.findMany({
        where,
        orderBy: { distributedAt: "desc" },
        take: limit,
        skip: offset,
        include: INCLUDE,
      }),
      db.distribution.count({ where }),
    ]);

    // Distribution has campaignId but no Prisma relation — attach manually.
    const campaignIds = Array.from(
      new Set(rows.map((r) => r.campaignId).filter((v): v is string => Boolean(v)))
    );
    const campaigns = campaignIds.length
      ? await db.campaign.findMany({
          where: { id: { in: campaignIds } },
          select: {
            id: true,
            title: true,
            accent: true,
            status: true,
            targetAmount: true,
            raisedAmount: true,
          },
        })
      : [];
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

    const items = rows.map((r) => ({
      ...r,
      campaign: r.campaignId ? campaignMap.get(r.campaignId) ?? null : null,
    }));

    if (!withTotals) return json(res, items);

    const [agg, served, itemRows] = await Promise.all([
      db.distribution.aggregate({
        where,
        _sum: { value: true, quantity: true },
      }),
      db.distribution.findMany({
        where,
        distinct: ["beneficiaryId"],
        select: { beneficiaryId: true },
      }),
      db.distribution.findMany({ where, select: { items: true } }),
    ]);
    let itemLines = 0;
    let drivesWithItems = 0;
    for (const r of itemRows) {
      try {
        const parsed = r.items ? (JSON.parse(r.items) as unknown[]) : [];
        if (Array.isArray(parsed) && parsed.length) {
          itemLines += parsed.length;
          drivesWithItems += 1;
        }
      } catch {
        // unparseable legacy JSON — skip
      }
    }

    return json(res, {
      items,
      total,
      count: total,
      sumValue: agg._sum.value ?? 0,
      sumQuantity: agg._sum.quantity ?? 0,
      beneficiariesServed: served.filter((b) => b.beneficiaryId).length,
      avgItemsPerDrive:
        drivesWithItems > 0
          ? Math.round((itemLines / drivesWithItems) * 10) / 10
          : 0,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/distributions (VOLUNTEER | ADMIN)
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "VOLUNTEER", "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const type = String(body.type ?? "").trim().toUpperCase();
    if (!TYPES.includes(type)) throw new ApiError("Invalid distribution type", 400);
    const quantity = Math.trunc(Number(body.quantity ?? 1));
    if (!Number.isFinite(quantity) || quantity < 1)
      throw new ApiError("quantity must be at least 1", 400);
    const location = String(body.location ?? "").trim();
    if (!location) throw new ApiError("location is required", 400);

    const valueNum = Number(body.value);
    const value =
      body.value !== undefined && body.value !== null && body.value !== ""
        ? Number.isFinite(valueNum)
          ? valueNum
          : null
        : null;
    if (value !== null && value < 0) throw new ApiError("value cannot be negative", 400);

    const distributedAtRaw = body.distributedAt
      ? new Date(String(body.distributedAt))
      : new Date();
    const distributedAt = Number.isNaN(distributedAtRaw.getTime())
      ? new Date()
      : distributedAtRaw;

    // Explicit volunteerId wins (admin assignment); otherwise attribute to the
    // session's own volunteer profile (ADMIN without profile → null).
    let volunteerId: string | null = null;
    if (body.volunteerId) {
      const assigned = await db.volunteer.findUnique({
        where: { id: String(body.volunteerId) },
      });
      if (!assigned) throw new ApiError("Volunteer not found", 400);
      volunteerId = assigned.id;
    } else {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      volunteerId = volunteer?.id ?? null;
    }

    const itemsArray = sanitizeItemsArray(body.items);
    const itemsJson = itemsArray.length ? JSON.stringify(itemsArray) : null;

    const kitBatchId = body.kitBatchId ? String(body.kitBatchId) : null;
    const kitQuantity = kitBatchId ? Math.trunc(Number(body.kitQuantity ?? 0)) : null;
    if (kitBatchId && (!Number.isFinite(kitQuantity) || (kitQuantity as number) < 1))
      throw new ApiError("kitQuantity must be at least 1 when a kit batch is selected", 400);

    const recurringNeedId = body.recurringNeedId ? String(body.recurringNeedId) : null;
    let recurringNeed: { id: string; beneficiaryId: string; cycle: string } | null = null;
    if (recurringNeedId) {
      const need = await db.recurringNeed.findUnique({ where: { id: recurringNeedId } });
      if (!need) throw new ApiError("Recurring need not found", 400);
      recurringNeed = need;
    }

    const row = await db.$transaction(async (tx) => {
      const created = await tx.distribution.create({
        data: {
          type,
          beneficiaryId:
            body.beneficiaryId ? String(body.beneficiaryId) : recurringNeed?.beneficiaryId ?? null,
          campaignId: body.campaignId ? String(body.campaignId) : null,
          volunteerId,
          items: itemsJson,
          quantity,
          value,
          photos: body.photos ? JSON.stringify(body.photos) : null,
          location,
          notes: body.notes ? String(body.notes) : null,
          distributedAt,
          kitBatchId: kitBatchId ?? undefined,
          kitQuantity: kitQuantity ?? undefined,
          recurringNeedId: recurringNeedId ?? undefined,
        },
      });

      await consumeItemsStock(tx, created.id, itemsArray);
      if (kitBatchId && kitQuantity)
        await consumeKitBatch(tx, created.id, kitBatchId, kitQuantity, location);

      if (recurringNeed) {
        await tx.recurringNeed.update({
          where: { id: recurringNeed.id },
          data: {
            lastFulfilledAt: distributedAt,
            nextDueAt: addCycle(distributedAt, recurringNeed.cycle),
          },
        });
      }

      return created;
    });

    await logActivity(
      session.name,
      "DISTRIBUTION",
      "Distribution",
      `${type} ×${quantity} @ ${location}`,
      session.userId
    );
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

/** ADMIN may edit anything; VOLUNTEER only records attributed to them. */
async function assertCanMutate(
  session: { role: string; userId: string; name: string },
  id: string
) {
  const existing = await db.distribution.findUnique({
    where: { id },
    select: { id: true, volunteerId: true, type: true, quantity: true },
  });
  if (!existing) throw new ApiError("Distribution not found", 404);
  if (session.role !== "ADMIN") {
    const own = await db.volunteer.findUnique({
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!own || existing.volunteerId !== own.id)
      throw new ApiError("You can only manage distributions you recorded", 403);
  }
  return existing;
}

// GET /api/distributions/:id (ADMIN, VOLUNTEER) — enriched detail
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const row = await db.distribution.findUnique({
      where: { id },
      include: {
        beneficiary: {
          select: {
            id: true,
            name: true,
            category: true,
            urgencyLevel: true,
            city: true,
            familyMembers: true,
          },
        },
        volunteer: { include: { user: { select: { name: true } } } },
        inventoryDistributions: { include: { item: true } },
        kitBatch: { include: { template: true } },
      },
    });
    if (!row) throw new ApiError("Distribution not found", 404);

    const campaign = row.campaignId
      ? await db.campaign.findUnique({
          where: { id: row.campaignId },
          select: {
            id: true,
            title: true,
            accent: true,
            status: true,
            targetAmount: true,
            raisedAmount: true,
          },
        })
      : null;
    return json(res, { ...row, campaign });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/distributions/:id (ADMIN, or the recording VOLUNTEER)
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    await assertCanMutate(session, id);

    const data: Prisma.DistributionUncheckedUpdateInput = {};

    if (body.type !== undefined) {
      const type = String(body.type).trim().toUpperCase();
      if (!TYPES.includes(type)) throw new ApiError("Invalid distribution type", 400);
      data.type = type;
    }
    if (body.beneficiaryId !== undefined)
      data.beneficiaryId = body.beneficiaryId ? String(body.beneficiaryId) : null;
    if (body.campaignId !== undefined)
      data.campaignId = body.campaignId ? String(body.campaignId) : null;
    if (body.volunteerId !== undefined) {
      if (!body.volunteerId) data.volunteerId = null;
      else {
        const v = await db.volunteer.findUnique({
          where: { id: String(body.volunteerId) },
        });
        if (!v) throw new ApiError("Volunteer not found", 400);
        data.volunteerId = v.id;
      }
    }
    if (body.quantity !== undefined) {
      const quantity = Math.trunc(Number(body.quantity));
      if (!Number.isFinite(quantity) || quantity < 1)
        throw new ApiError("quantity must be at least 1", 400);
      data.quantity = quantity;
    }
    if (body.value !== undefined) {
      if (body.value === null || body.value === "") data.value = null;
      else {
        const value = Number(body.value);
        if (!Number.isFinite(value) || value < 0)
          throw new ApiError("value must be a number ≥ 0", 400);
        data.value = value;
      }
    }
    if (body.location !== undefined) {
      const location = String(body.location).trim();
      if (!location) throw new ApiError("location cannot be empty", 400);
      data.location = location;
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (body.distributedAt !== undefined) {
      const d = new Date(String(body.distributedAt));
      if (Number.isNaN(d.getTime())) throw new ApiError("Invalid distributedAt date", 400);
      data.distributedAt = d;
    }

    // Items / kit batch re-selection → reverse the previous stock effect and
    // re-apply against the new lines, all inside one transaction.
    const itemsProvided = body.items !== undefined;
    const itemsArray = itemsProvided ? sanitizeItemsArray(body.items) : [];
    const kitBatchProvided = body.kitBatchId !== undefined;
    const nextKitBatchId = kitBatchProvided
      ? body.kitBatchId
        ? String(body.kitBatchId)
        : null
      : undefined;
    const nextKitQuantity = kitBatchProvided
      ? Math.trunc(Number(body.kitQuantity ?? 0)) || null
      : undefined;
    if (kitBatchProvided && nextKitBatchId && (!nextKitQuantity || nextKitQuantity < 1))
      throw new ApiError("kitQuantity must be at least 1 when a kit batch is selected", 400);

    if (itemsProvided) data.items = itemsArray.length ? JSON.stringify(itemsArray) : null;
    if (kitBatchProvided) {
      data.kitBatchId = nextKitBatchId;
      data.kitQuantity = nextKitBatchId ? nextKitQuantity : null;
    }

    const row = await db.$transaction(async (tx) => {
      if (itemsProvided) await restoreItemsStock(tx, id);
      if (kitBatchProvided) await restoreKitBatch(tx, id);

      const updated = await tx.distribution.update({ where: { id }, data });

      if (itemsProvided) await consumeItemsStock(tx, id, itemsArray);
      if (kitBatchProvided && nextKitBatchId && nextKitQuantity)
        await consumeKitBatch(tx, id, nextKitBatchId, nextKitQuantity, updated.location);

      return updated;
    });

    await logActivity(
      session.name,
      "DISTRIBUTION_UPDATE",
      "Distribution",
      id,
      session.userId
    );
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/distributions/:id (ADMIN, or the recording VOLUNTEER)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const existing = await assertCanMutate(session, id);

    await db.$transaction(async (tx) => {
      await restoreItemsStock(tx, id);
      await restoreKitBatch(tx, id);
      await tx.distribution.delete({ where: { id } });
    });

    await logActivity(
      session.name,
      "DISTRIBUTION_DELETE",
      "Distribution",
      `${existing.type} ×${existing.quantity}`,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
