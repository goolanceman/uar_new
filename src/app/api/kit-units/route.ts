import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/kit-units?batchId=&status=&q=&mine=1&limit= (auth) — orderBy code asc
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;
    const batchId = sp.get("batchId") || undefined;
    const status = sp.get("status") || undefined;
    const q = sp.get("q")?.trim() || undefined;
    const limit = Math.min(
      500,
      Math.max(1, Math.trunc(Number(sp.get("limit")) || 200))
    );

    const where: Prisma.KitUnitWhereInput = {};
    if (batchId) where.batchId = batchId;
    if (status) where.status = status;
    if (q) where.code = { contains: q };
    if (sp.get("mine")) where.scannedById = session.userId;

    const units = await db.kitUnit.findMany({
      where,
      orderBy: { code: "asc" },
      take: limit,
      include: {
        batch: { select: { name: true, template: { select: { name: true } } } },
      },
    });
    return json(units);
  } catch (e) {
    return handleError(e);
  }
}
