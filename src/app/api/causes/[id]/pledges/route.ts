import { db } from "@/lib/db";
import {
  getSession,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import { recomputeCause } from "@/lib/causes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/causes/:id/pledges — public (guests) OR authenticated donors
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const session = await getSession();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const amountPerMonth = Number(body.amountPerMonth);
    const months = Math.trunc(Number(body.months ?? 6));
    if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0)
      throw new ApiError("amountPerMonth must be greater than 0", 400);
    if (!Number.isFinite(months) || months < 1)
      throw new ApiError("months must be at least 1", 400);

    const cause = await db.cause.findUnique({ where: { id } });
    if (!cause) throw new ApiError("Cause not found", 404);

    const donorName =
      String(body.donorName ?? "").trim() || session?.name || "Anonymous Donor";

    const pledge = await db.pledge.create({
      data: {
        causeId: id,
        donorId: session?.userId ?? null,
        donorName,
        amountPerMonth,
        months,
        status: "ACTIVE",
      },
    });

    const updatedCause = await recomputeCause(id);
    await logActivity(
      session?.name ?? donorName,
      "PLEDGE",
      "Pledge",
      `${cause.code} · ₹${amountPerMonth}/mo × ${months}mo`,
      session?.userId
    );

    return json({ pledge, cause: updatedCause }, 201);
  } catch (e) {
    return handleError(e);
  }
}
