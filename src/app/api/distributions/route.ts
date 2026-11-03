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

// GET /api/distributions?type=&q=&limit=&mine=1 (auth)
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;
    const type = sp.get("type") || undefined;
    const q = sp.get("q")?.trim() || undefined;
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(sp.get("limit")) || 50)));

    const where: Prisma.DistributionWhereInput = {};
    if (type) where.type = type;
    if (q)
      where.OR = [
        { location: { contains: q } },
        { notes: { contains: q } },
      ];
    if (sp.get("mine")) {
      const volunteer = await db.volunteer.findUnique({
        where: { userId: session.userId },
      });
      if (!volunteer) return json([]);
      where.volunteerId = volunteer.id;
    }

    const rows = await db.distribution.findMany({
      where,
      orderBy: { distributedAt: "desc" },
      take: limit,
      include: {
        beneficiary: { select: { name: true } },
        volunteer: { include: { user: { select: { name: true } } } },
      },
    });

    // Distribution has campaignId but no Prisma relation — attach campaign info manually
    const campaignIds = Array.from(
      new Set(rows.map((r) => r.campaignId).filter((v): v is string => Boolean(v)))
    );
    const campaigns = campaignIds.length
      ? await db.campaign.findMany({
          where: { id: { in: campaignIds } },
          select: { id: true, title: true, accent: true },
        })
      : [];
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

    return json(
      rows.map((r) => ({
        ...r,
        campaign: r.campaignId ? campaignMap.get(r.campaignId) ?? null : null,
      }))
    );
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

    const distributedAtRaw = body.distributedAt
      ? new Date(String(body.distributedAt))
      : new Date();
    const distributedAt = Number.isNaN(distributedAtRaw.getTime())
      ? new Date()
      : distributedAtRaw;

    // attribute to the session's volunteer profile (ADMIN without profile → null)
    const volunteer = await db.volunteer.findUnique({
      where: { userId: session.userId },
    });

    const row = await db.distribution.create({
      data: {
        type,
        beneficiaryId: body.beneficiaryId ? String(body.beneficiaryId) : null,
        campaignId: body.campaignId ? String(body.campaignId) : null,
        volunteerId: volunteer?.id ?? null,
        items: body.items ? JSON.stringify(body.items) : null,
        quantity,
        value: Number.isFinite(Number(body.value)) ? Number(body.value) : null,
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
