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

// PATCH /api/testimonials/:id — admin edits
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const existing = await db.testimonial.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Testimonial not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.name !== undefined) data.name = String(body.name).trim();
    if (body?.role !== undefined) data.role = String(body.role).trim();
    if (body?.message !== undefined) data.message = String(body.message).trim();
    if (body?.rating !== undefined) {
      let rating = Number(body.rating);
      if (!Number.isFinite(rating)) rating = 5;
      data.rating = Math.min(5, Math.max(1, Math.round(rating)));
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const testimonial = await db.testimonial.update({ where: { id }, data });

    await logActivity(
      session.name,
      "TESTIMONIAL_UPDATE",
      "TESTIMONIAL",
      testimonial.name,
      session.userId
    );

    return json(testimonial);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/testimonials/:id — admin removes
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const existing = await db.testimonial.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Testimonial not found", 404);

    await db.testimonial.delete({ where: { id } });

    await logActivity(
      session.name,
      "TESTIMONIAL_DELETE",
      "TESTIMONIAL",
      existing.name,
      session.userId
    );

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
