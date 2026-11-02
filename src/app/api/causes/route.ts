import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireRole,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const CONDITIONS = ["BP", "DIABETES", "THYROID", "CARDIAC", "ASTHMA", "ARTHRITIS", "OTHER"];

// GET /api/causes?condition=&status=&q= (public)
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const condition = sp.get("condition") || undefined;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;

    const where: Prisma.CauseWhereInput = {};
    if (condition) where.condition = condition;
    if (status) where.status = status;
    if (q)
      where.OR = [
        { patientName: { contains: q } },
        { city: { contains: q } },
        { code: { contains: q } },
      ];

    const causes = await db.cause.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        pledges: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            donorName: true,
            amountPerMonth: true,
            months: true,
            status: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return json(causes);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/causes (ADMIN)
export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const patientName = String(body.patientName ?? "").trim();
    const city = String(body.city ?? "").trim();
    const condition = String(body.condition ?? "").trim().toUpperCase();
    const story = String(body.story ?? "").trim();
    const age = Math.trunc(Number(body.age));
    const monthlyCost = Number(body.monthlyCost);
    const durationMonths = Math.trunc(Number(body.durationMonths ?? 12));

    if (!patientName || !city || !story)
      throw new ApiError("patientName, city and story are required", 400);
    if (!Number.isFinite(age) || age <= 0)
      throw new ApiError("age must be a positive number", 400);
    if (!Number.isFinite(monthlyCost) || monthlyCost <= 0)
      throw new ApiError("monthlyCost must be a positive number", 400);
    if (!Number.isFinite(durationMonths) || durationMonths < 1)
      throw new ApiError("durationMonths must be at least 1", 400);
    if (!CONDITIONS.includes(condition))
      throw new ApiError("Invalid condition", 400);

    // code UAR-MED-0001 — loop while exists
    const count = await db.cause.count();
    let n = count + 1;
    let code = "";
    for (;;) {
      code = `UAR-MED-${String(n).padStart(4, "0")}`;
      const clash = await db.cause.findUnique({ where: { code } });
      if (!clash) break;
      n += 1;
    }

    const cause = await db.cause.create({
      data: {
        code,
        patientName,
        age,
        city,
        condition,
        monthlyCost,
        durationMonths,
        story,
      },
    });

    await logActivity(
      session.name,
      "CAUSE_CREATE",
      "Cause",
      `${cause.code} · ${patientName}`,
      session.userId
    );
    return json(cause, 201);
  } catch (e) {
    return handleError(e);
  }
}
