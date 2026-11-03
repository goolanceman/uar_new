import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  requireRole,
  hashPassword,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// Normalize skills/availability (string[] or JSON string) → JSON string
function toJsonList(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return JSON.stringify(value.map(String));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String));
    } catch {
      // plain string → wrap
    }
    return JSON.stringify([value]);
  }
  return null;
}

function tempPassword(): string {
  return `UAR${Math.floor(10000 + Math.random() * 90000)}@`;
}

// GET /api/volunteer-applications?mine=1 | (ADMIN) ?status&q
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const mine = sp.get("mine") === "1";

    if (mine) {
      const session = await getSession();
      if (!session) throw new ApiError("Please sign in to continue", 401);
      const applications = await db.volunteerApplication.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: "desc" },
      });
      return json(applications);
    }

    await requireRole("ADMIN");

    const status = sp.get("status");
    const q = sp.get("q")?.trim();

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { fullName: { contains: q } },
        { email: { contains: q } },
        { city: { contains: q } },
      ];
    }

    const applications = await db.volunteerApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return json(applications);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/volunteer-applications — public form (or logged-in user)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const fullName = String(body?.fullName ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const phone = String(body?.phone ?? "").trim();
    const city = String(body?.city ?? "").trim();
    const occupation = body?.occupation ? String(body.occupation).trim() : null;
    const motivation = String(body?.motivation ?? "").trim();

    if (!fullName || !email || !phone || !city)
      throw new ApiError("Full name, email, phone and city are required", 400);
    if (motivation.length < 20)
      throw new ApiError("Please tell us a bit more — motivation must be at least 20 characters", 400);

    const skills = toJsonList(body?.skills);
    const availability = toJsonList(body?.availability);

    const session = await getSession();
    let userId: string | null = null;
    let tempCreds: { email: string; password: string; fullName: string } | undefined;

    if (session) {
      userId = session.userId;
    } else {
      const existing = await db.user.findFirst({
        where: { email: { equals: email } },
      });
      if (existing) {
        // Link account; never downgrade an ADMIN
        await db.user.update({
          where: { id: existing.id },
          data: {
            ...(existing.role !== "ADMIN" ? { role: "VOLUNTEER" } : {}),
            status: "PENDING",
            isActive: false,
          },
        });
        userId = existing.id;
      } else {
        const password = tempPassword();
        const created = await db.user.create({
          data: {
            name: fullName,
            email,
            phone,
            city,
            password: hashPassword(password),
            role: "VOLUNTEER",
            status: "PENDING",
            isActive: false,
          },
        });
        userId = created.id;
        tempCreds = { email, password, fullName };
      }
    }

    const application = await db.volunteerApplication.create({
      data: {
        userId,
        fullName,
        email,
        phone,
        city,
        occupation,
        skills,
        availability,
        motivation,
        status: "PENDING",
        // Persist temp credentials so admins can reveal them at approval time.
        ...(tempCreds ? { tempCreds: JSON.stringify(tempCreds) } : {}),
      },
    });

    await logActivity(
      fullName,
      "VOLUNTEER_APPLY",
      "VOLUNTEER_APPLICATION",
      `${email} · ${city}`,
      userId ?? undefined
    );

    return json({ application, ...(tempCreds ? { tempCreds } : {}) }, 201);
  } catch (e) {
    return handleError(e);
  }
}
