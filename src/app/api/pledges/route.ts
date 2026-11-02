import { db } from "@/lib/db";
import { requireRole, handleError, json } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/pledges?status=&q= — admin list of all medicine pledges
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status") ?? undefined;
    const q = sp.get("q") ?? undefined;
    const rows = await db.pledge.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q ? { donorName: { contains: q } } : {}),
      },
      include: {
        cause: { select: { code: true, patientName: true, condition: true, monthlyCost: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}
