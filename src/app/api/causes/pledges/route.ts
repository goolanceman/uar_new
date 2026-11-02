import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/causes/pledges?mine=1&causeId= (auth)
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;

    const where: Prisma.PledgeWhereInput = {};
    if (sp.get("mine")) where.donorId = session.userId;
    const causeId = sp.get("causeId");
    if (causeId) where.causeId = causeId;

    const pledges = await db.pledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        cause: {
          select: {
            code: true,
            patientName: true,
            condition: true,
            monthlyCost: true,
          },
        },
      },
    });
    return json(pledges);
  } catch (e) {
    return handleError(e);
  }
}
