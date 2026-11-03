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

// GET /api/beneficiaries?q=&category=&active=0/1 (staff) · ?mine=1 (self case)
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;

    if (sp.get("mine") === "1") {
      // A beneficiary sees only their own case record (no cross-enumeration)
      const s = await requireAuth();
      const mine = await db.beneficiary.findUnique({
        where: { userId: s.userId },
      });
      return json(mine ? [mine] : []);
    }

    await requireRole("ADMIN", "VOLUNTEER");
    const q = sp.get("q")?.trim() || undefined;
    const category = sp.get("category") || undefined;
    const active = sp.get("active");

    const where: Prisma.BeneficiaryWhereInput = {};
    const caseStatus = sp.get("caseStatus");
    if (caseStatus) where.caseStatus = caseStatus.toUpperCase();
    const verification = sp.get("verificationStatus");
    if (verification) where.verificationStatus = verification.toUpperCase();
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
    const state = body.state ? String(body.state).trim() : null;
    const pincodeRaw = body.pincode ? String(body.pincode).trim() : null;
    if (pincodeRaw && !/^[1-9][0-9]{5}$/.test(pincodeRaw))
      throw new ApiError("PIN code must be 6 digits", 400);
    const guardian = body.guardian ? String(body.guardian).trim() : null;
    let age: number | null = null;
    if (body.age !== undefined && body.age !== null && String(body.age).trim() !== "") {
      const a = Number(body.age);
      if (!Number.isFinite(a) || a < 0 || a > 120)
        throw new ApiError("Age must be between 0 and 120", 400);
      age = Math.round(a);
    }
    let gender: string | null = null;
    if (body.gender) {
      const g = String(body.gender).toUpperCase();
      if (!["MALE", "FEMALE", "OTHER"].includes(g))
        throw new ApiError("Invalid gender", 400);
      gender = g;
    }
    const monthlyNeed = Number.isFinite(Number(body.monthlyNeed))
      ? Math.max(0, Number(body.monthlyNeed)) || null
      : null;
    const documents = body.documents ? String(body.documents).trim() : null;
    const caseStatusRaw = body.caseStatus
      ? String(body.caseStatus).trim().toUpperCase()
      : "INTAKE";
    if (!["INTAKE", "VERIFICATION", "ACTIVE", "CLOSED", "REJECTED"].includes(caseStatusRaw))
      throw new ApiError("Invalid case status", 400);
    const verificationStatusRaw = body.verificationStatus
      ? String(body.verificationStatus).trim().toUpperCase()
      : "PENDING";
    if (!["PENDING", "DOCUMENTS_REQUESTED", "VERIFIED", "REJECTED"].includes(verificationStatusRaw))
      throw new ApiError("Invalid verification status", 400);
    const caseWorker = body.caseWorker ? String(body.caseWorker).trim() : null;
    const intakeDate = body.intakeDate ? new Date(String(body.intakeDate)) : null;

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
        state,
        pincode: pincodeRaw,
        guardian,
        age,
        gender,
        monthlyNeed,
        documents,
        caseStatus: caseStatusRaw,
        verificationStatus: verificationStatusRaw,
        caseWorker,
        photoConsent: Boolean(body.photoConsent),
        intakeDate,
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
