import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRole, ApiError, json, handleError } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/beneficiaries/:id/notes — case-note timeline
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await ctx.params;
    const notes = await db.beneficiaryNote.findMany({
      where: { beneficiaryId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return json(notes);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/beneficiaries/:id/notes — add a case note
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const note = String(body?.note ?? "").trim();
    if (!note) throw new ApiError("Note cannot be empty", 400);

    const beneficiary = await db.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const row = await db.beneficiaryNote.create({
      data: {
        beneficiaryId: id,
        authorName: session.name,
        note,
      },
    });
    return json(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
