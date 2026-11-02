import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/volunteers?status= (ADMIN) — desc joinedAt
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status") || undefined;

    const where: Prisma.VolunteerWhereInput = {};
    if (status) where.status = status;

    const volunteers = await db.volunteer.findMany({
      where,
      orderBy: { joinedAt: "desc" },
      include: {
        user: { select: { name: true, email: true, phone: true, city: true } },
      },
    });
    return json(volunteers);
  } catch (e) {
    return handleError(e);
  }
}
