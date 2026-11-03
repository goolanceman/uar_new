import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

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

/** Sanitise the items JSON payload → [{name, qty, unit?}] or null. */
function sanitizeItems(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const clean = raw
    .map((i) => {
      const o = (i ?? {}) as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      const qty = Number(o.qty ?? 1);
      const unit = String(o.unit ?? "").trim();
      return {
        name,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        ...(unit ? { unit } : {}),
      };
    })
    .filter((i) => i.name.length > 0);
  return clean.length ? JSON.stringify(clean) : null;
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
//   ?type=FOOD,MEDICAL &q= &from= &to= &volunteerId= &beneficiaryId= &campaignId=
//   &mine=1 &limit= &offset= &withTotals=1   (auth)
// Default response = raw array (legacy callers). withTotals=1 → envelope.
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;

    let mineVolunteerId: string | undefined;
    if (sp.get("mine")) {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (!volunteer)
        return sp.get("withTotals") === "1"
          ? json({
              items: [],
              total: 0,
              count: 0,
              sumValue: 0,
              sumQuantity: 0,
              beneficiariesServed: 0,
              avgItemsPerDrive: 0,
            })
          : json([]);
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

    if (!withTotals) return json(items);

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

    return json({
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
    return handleError(e);
  }
}

// POST /api/distributions (VOLUNTEER | ADMIN)
export async function POST(req: Request) {
  try {
    const session = await requireRole("VOLUNTEER", "ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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

    const row = await db.distribution.create({
      data: {
        type,
        beneficiaryId: body.beneficiaryId ? String(body.beneficiaryId) : null,
        campaignId: body.campaignId ? String(body.campaignId) : null,
        volunteerId,
        items: sanitizeItems(body.items),
        quantity,
        value,
        photos: body.photos ? JSON.stringify(body.photos) : null,
        location,
        notes: body.notes ? String(body.notes) : null,
        distributedAt,
      },
    });

    await logActivity(
      session.name,
      "DISTRIBUTION",
      "Distribution",
      `${type} ×${quantity} @ ${location}`,
      session.userId
    );
    return json(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
