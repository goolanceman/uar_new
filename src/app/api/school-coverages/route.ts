import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/school-coverages?q=&active=1
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");
    const sp = new URL(req.url).searchParams;
    const q = sp.get("q")?.trim();
    const activeOnly = sp.get("active") === "1";

    const where: Record<string, unknown> = {};
    if (activeOnly) where.isActive = true;
    if (q) where.schoolName = { contains: q };

    const rows = await db.schoolCoverage.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { schoolName: "asc" }],
      take: 300,
    });
    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/school-coverages — register/upsert a school in the outreach registry
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const body = await req.json().catch(() => ({}));

    const schoolName = String(body?.schoolName ?? "").trim();
    if (!schoolName) throw new ApiError("School name is required", 400);

    const totalGirls = Number(body?.totalGirls ?? 0);
    if (!Number.isFinite(totalGirls) || totalGirls < 0)
      throw new ApiError("Total girls must be zero or more", 400);

    const existing = await db.schoolCoverage.findFirst({ where: { schoolName } });

    const data = {
      schoolName,
      address: body?.address ? String(body.address).trim() : null,
      city: body?.city ? String(body.city).trim() : null,
      contactPerson: body?.contactPerson ? String(body.contactPerson).trim() : null,
      contactPhone: body?.contactPhone ? String(body.contactPhone).trim() : null,
      totalGirls: Math.round(totalGirls),
      lastVisited: body?.lastVisited ? new Date(String(body.lastVisited)) : null,
      isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
    };

    const row = existing
      ? await db.schoolCoverage.update({
          where: { id: existing.id },
          data: { ...data, visitsCount: existing.visitsCount + 1 },
        })
      : await db.schoolCoverage.create({ data: { ...data, visitsCount: body?.lastVisited ? 1 : 0 } });

    await logActivity(
      session.name,
      existing ? "SCHOOL_UPDATE" : "SCHOOL_CREATE",
      "SCHOOL",
      schoolName,
      session.userId
    );
    return json(row, existing ? 200 : 201);
  } catch (e) {
    return handleError(e);
  }
}
