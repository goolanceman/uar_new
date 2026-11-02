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

const CATEGORIES = [
  "WIDOW",
  "ORPHAN",
  "STUDENT",
  "ELDERLY",
  "DISABLED",
  "SINGLE_MOTHER",
  "POOR_FAMILY",
  "PATIENT",
  "DAILY_WAGE",
  "OTHER",
];
const URGENCY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// GET /api/beneficiaries?q=&category=&active=0/1 (auth)
export async function GET(req: Request) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const q = sp.get("q")?.trim() || undefined;
    const category = sp.get("category") || undefined;
    const active = sp.get("active");

    const where: Prisma.BeneficiaryWhereInput = {};
    if (q)
      where.OR = [
        { name: { contains: q } },
        { phone: { contains: q } },
        { city: { contains: q } },
      ];
    if (category) where.category = category;
    if (active === "0" || active === "1") where.isActive = active === "1";

    const rows = await db.beneficiary.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/beneficiaries (ADMIN | VOLUNTEER)
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "").trim().toUpperCase() || "OTHER";
    const urgencyLevel =
      String(body.urgencyLevel ?? "").trim().toUpperCase() || "MEDIUM";
    if (!name) throw new ApiError("name is required", 400);
    if (!CATEGORIES.includes(category)) throw new ApiError("Invalid category", 400);
    if (!URGENCY.includes(urgencyLevel))
      throw new ApiError("Invalid urgencyLevel", 400);

    const familyMembers = Number.isFinite(Number(body.familyMembers))
      ? Math.max(1, Math.trunc(Number(body.familyMembers)))
      : 1;
    const monthlyIncome =
      body.monthlyIncome !== undefined &&
      body.monthlyIncome !== null &&
      body.monthlyIncome !== "" &&
      Number.isFinite(Number(body.monthlyIncome))
        ? Number(body.monthlyIncome)
        : null;

    const beneficiary = await db.beneficiary.create({
      data: {
        name,
        phone: body.phone ? String(body.phone).trim() : null,
        city: body.city ? String(body.city).trim() : null,
        category,
        urgencyLevel,
        familyMembers,
        monthlyIncome,
        needs: body.needs ? String(body.needs) : null,
        notes: body.notes ? String(body.notes) : null,
        address: body.address ? String(body.address) : null,
        onboardedByName: session.name,
      },
    });

    await logActivity(
      session.name,
      "BENEFICIARY_ADD",
      "Beneficiary",
      `${name} (${category})`,
      session.userId
    );
    return json(beneficiary, 201);
  } catch (e) {
    return handleError(e);
  }
}
