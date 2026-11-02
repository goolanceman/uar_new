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

// GET /api/contact-queries?status — admin inbox
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN");

    const sp = new URL(req.url).searchParams;
    const status = sp.get("status");

    const queries = await db.contactQuery.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { createdAt: "desc" },
    });

    return json(queries);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/contact-queries — public contact form
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const subject = String(body?.subject ?? "").trim();
    const message = String(body?.message ?? "").trim();

    if (!name || !email || !subject || !message)
      throw new ApiError("Name, email, subject and message are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const query = await db.contactQuery.create({
      data: {
        name,
        email,
        phone: body?.phone ? String(body.phone).trim() : null,
        subject,
        message,
        status: "PENDING",
      },
    });

    await logActivity(name, "CONTACT", "CONTACT_QUERY", `${subject} · ${email}`);

    return json(query, 201);
  } catch (e) {
    return handleError(e);
  }
}
