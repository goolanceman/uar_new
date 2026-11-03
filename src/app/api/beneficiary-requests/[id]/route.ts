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

type Ctx = { params: Promise<{ id: string }> };

const VALID_STATUSES = ["PENDING", "IN_REVIEW", "APPROVED", "FULFILLED", "REJECTED"];

// PATCH /api/beneficiary-requests/:id — admin reviews a request
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const existing = await db.beneficiaryRequest.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Request not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!VALID_STATUSES.includes(status))
        throw new ApiError("Invalid request status", 400);
      data.status = status;
      data.reviewedBy = session.name;
      data.reviewedAt = new Date();
    }
    if (body?.reviewNote !== undefined)
      data.reviewNote = body.reviewNote ? String(body.reviewNote) : null;
    if (body?.urgency !== undefined) {
      const u = String(body.urgency).toUpperCase();
      if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(u))
        throw new ApiError("Invalid urgency level", 400);
      data.urgency = u;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const row = await db.beneficiaryRequest.update({ where: { id }, data });

    await logActivity(
      session.name,
      "BENEFICIARY_REQUEST_REVIEW",
      "BENEFICIARY_REQUEST",
      `${row.name}: ${row.status}`,
      session.userId
    );

    return json(row);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/beneficiary-requests/:id
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const existing = await db.beneficiaryRequest.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Request not found", 404);
    await db.beneficiaryRequest.delete({ where: { id } });
    await logActivity(
      session.name,
      "BENEFICIARY_REQUEST_DELETE",
      "BENEFICIARY_REQUEST",
      existing.name,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
