import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSession,
  requireAuth,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const KINDS = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"];
const FREQUENCIES = ["ONE_TIME", "MONTHLY"];

// POST /api/animals/pledges — public (guests) OR authenticated donors
export async function POST(req: Request) {
  try {
    const session = await getSession();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const kind = String(body.kind ?? "FOOD").trim().toUpperCase();
    const frequency = String(body.frequency ?? "MONTHLY").trim().toUpperCase();
    const amount = Number(body.amount);

    if (!KINDS.includes(kind))
      throw new ApiError("kind must be FOOD, MEDICAL, VACCINATION or SHELTER", 400);
    if (!FREQUENCIES.includes(frequency))
      throw new ApiError("frequency must be ONE_TIME or MONTHLY", 400);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("amount must be greater than 0", 400);

    const animalId = body.animalId ? String(body.animalId) : null;
    if (animalId) {
      const animal = await db.animal.findUnique({ where: { id: animalId } });
      if (!animal) throw new ApiError("Animal not found", 404);
    }

    const donorName =
      String(body.donorName ?? "").trim() || session?.name || "Anonymous Donor";

    const pledge = await db.animalPledge.create({
      data: {
        animalId,
        shelterFund: body.shelterFund ? String(body.shelterFund).trim() : null,
        donorId: session?.userId ?? null,
        donorName,
        kind,
        amount,
        frequency,
        status: "ACTIVE",
      },
    });

    await logActivity(
      session?.name ?? donorName,
      "ANIMAL_PLEDGE",
      "AnimalPledge",
      `${kind} ₹${amount} ${frequency}${animalId ? " (animal-linked)" : " (shelter fund)"}`,
      session?.userId
    );
    return json({ pledge }, 201);
  } catch (e) {
    return handleError(e);
  }
}

// GET /api/animals/pledges?mine=1&animalId= (auth)
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;

    const where: Prisma.AnimalPledgeWhereInput = {};
    if (sp.get("mine")) where.donorId = session.userId;
    const animalId = sp.get("animalId");
    if (animalId) where.animalId = animalId;

    const pledges = await db.animalPledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { animal: { select: { name: true, species: true } } },
    });
    return json(pledges);
  } catch (e) {
    return handleError(e);
  }
}
