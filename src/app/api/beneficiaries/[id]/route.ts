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

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/beneficiaries/:id (ADMIN | VOLUNTEER)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.beneficiary.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Beneficiary not found", 404);

    const data: Prisma.BeneficiaryUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.phone !== undefined)
      data.phone = body.phone ? String(body.phone).trim() : null;
    if (body.email !== undefined)
      data.email = body.email ? String(body.email).trim() : null;
    if (body.city !== undefined)
      data.city = body.city ? String(body.city).trim() : null;
    if (body.address !== undefined)
      data.address = body.address ? String(body.address) : null;
    if (body.category !== undefined)
      data.category = String(body.category).trim().toUpperCase();
    if (body.urgencyLevel !== undefined)
      data.urgencyLevel = String(body.urgencyLevel).trim().toUpperCase();
    if (body.familyMembers !== undefined)
      data.familyMembers = Math.max(1, Math.trunc(Number(body.familyMembers)) || 1);
    if (body.monthlyIncome !== undefined)
      data.monthlyIncome =
        body.monthlyIncome === null || body.monthlyIncome === ""
          ? null
          : Number(body.monthlyIncome);
    if (body.needs !== undefined)
      data.needs = body.needs ? String(body.needs) : null;
    if (body.notes !== undefined)
      data.notes = body.notes ? String(body.notes) : null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const beneficiary = await db.beneficiary.update({ where: { id }, data });
    await logActivity(
      session.name,
      "BENEFICIARY_UPDATE",
      "Beneficiary",
      beneficiary.name,
      session.userId
    );
    return json(beneficiary);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/beneficiaries/:id (ADMIN)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await db.beneficiary.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Beneficiary not found", 404);

    await db.beneficiary.delete({ where: { id } });
    await logActivity(
      session.name,
      "BENEFICIARY_DELETE",
      "Beneficiary",
      existing.name,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
