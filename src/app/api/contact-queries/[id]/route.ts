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

const ALLOWED = ["RESOLVED", "CLOSED", "PENDING"];

// PATCH /api/contact-queries/:id — admin updates query status
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const status = String(body?.status ?? "");
    if (!ALLOWED.includes(status))
      throw new ApiError("Status must be RESOLVED, CLOSED or PENDING", 400);

    const existing = await db.contactQuery.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Query not found", 404);

    const data: Record<string, unknown> = { status };
    if (status === "RESOLVED") {
      data.resolvedAt = new Date();
      data.resolvedBy = session.name;
    } else {
      data.resolvedAt = null;
      data.resolvedBy = null;
    }

    const query = await db.contactQuery.update({ where: { id }, data });

    await logActivity(
      session.name,
      "CONTACT_QUERY_UPDATE",
      "CONTACT_QUERY",
      `${query.subject} → ${status}`,
      session.userId
    );

    return json(query);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/contact-queries/:id — admin removes a query
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const existing = await db.contactQuery.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Query not found", 404);

    await db.contactQuery.delete({ where: { id } });

    await logActivity(
      session.name,
      "CONTACT_QUERY_DELETE",
      "CONTACT_QUERY",
      `${existing.subject} · ${existing.email}`,
      session.userId
    );

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
