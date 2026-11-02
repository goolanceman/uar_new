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

// GET /api/testimonials — public wall
export async function GET() {
  try {
    const testimonials = await db.testimonial.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    return json(testimonials);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/testimonials — admin curates
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json().catch(() => ({}));

    const name = String(body?.name ?? "").trim();
    const role = String(body?.role ?? "").trim();
    const message = String(body?.message ?? "").trim();
    if (!name || !role || !message)
      throw new ApiError("Name, role and message are required", 400);

    let rating = body?.rating !== undefined ? Number(body.rating) : 5;
    if (!Number.isFinite(rating)) rating = 5;
    rating = Math.min(5, Math.max(1, Math.round(rating)));

    const testimonial = await db.testimonial.create({
      data: { name, role, message, rating },
    });

    await logActivity(
      session.name,
      "TESTIMONIAL_CREATE",
      "TESTIMONIAL",
      `${name} (${rating}★)`,
      session.userId
    );

    return json(testimonial, 201);
  } catch (e) {
    return handleError(e);
  }
}
