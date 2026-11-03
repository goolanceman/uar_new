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

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

const VALID_TYPES = ["INDIVIDUAL", "ORGANISATION", "CORPORATE"];
const VALID_SOURCES = ["WEB", "OFFLINE", "IMPORT", "REFERRAL", "EVENT"];
const VALID_CATEGORIES = ["MAJOR", "MONTHLY", "ONE_TIME", "CORPORATE", "CSR"];

// GET /api/donors — admin donor CRM with aggregates + pagination
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const sp = new URL(req.url).searchParams;
    const q = sp.get("q")?.trim();
    const type = sp.get("type");
    const category = sp.get("category");
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const take = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "50", 10) || 50));

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (category) where.category = category;
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { organizationName: { contains: q } },
      ];
    }

    const [donors, total] = await Promise.all([
      db.donor.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * take,
        take,
        include: { user: { select: { id: true, role: true, status: true } } },
      }),
      db.donor.count({ where }),
    ]);

    // Lifetime value + counts per donor (single aggregate query)
    const emails = donors.map((d) => d.email);
    const agg = emails.length
      ? await db.donation.groupBy({
          by: ["donorEmail"],
          where: { donorEmail: { in: emails }, paymentStatus: "COMPLETED" },
          _sum: { amount: true },
          _count: { id: true },
          _max: { createdAt: true },
          _min: { createdAt: true },
        })
      : [];
    const aggMap = new Map(agg.map((a) => [a.donorEmail, a]));

    const items = donors.map((d) => {
      const a = aggMap.get(d.email);
      return {
        ...d,
        lifetimeValue: a?._sum.amount ?? 0,
        donationsCount: a?._count.id ?? 0,
        firstDonationAt: a?._min.createdAt ?? null,
        lastDonationAt: a?._max.createdAt ?? null,
      };
    });

    return json({ items, total, page, pages: Math.max(1, Math.ceil(total / take)) });
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/donors — admin creates a donor record
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json().catch(() => ({}));

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!name || !email)
      throw new ApiError("Name and email are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const existing = await db.donor.findUnique({ where: { email } });
    if (existing) throw new ApiError("A donor with this email already exists", 409);

    const phone = body?.phone ? String(body.phone).trim() : null;
    if (phone && !PHONE_RE.test(phone.replace(/[\s-]/g, "")))
      throw new ApiError("Please enter a valid Indian mobile number", 400);

    const pan = body?.pan ? String(body.pan).trim().toUpperCase() : null;
    if (pan && !PAN_RE.test(pan))
      throw new ApiError("PAN must look like ABCDE1234F", 400);

    const pincode = body?.pincode ? String(body.pincode).trim() : null;
    if (pincode && !PIN_RE.test(pincode))
      throw new ApiError("PIN code must be 6 digits", 400);

    if (body?.type && !VALID_TYPES.includes(String(body.type)))
      throw new ApiError("Invalid donor type", 400);
    if (body?.source && !VALID_SOURCES.includes(String(body.source)))
      throw new ApiError("Invalid donor source", 400);
    if (body?.category && !VALID_CATEGORIES.includes(String(body.category)))
      throw new ApiError("Invalid donor category", 400);

    // Link to a user account when one exists with the same email
    const linkedUser = await db.user.findUnique({ where: { email } });

    const donor = await db.donor.create({
      data: {
        type: body?.type ? String(body.type) : "INDIVIDUAL",
        organizationName: body?.organizationName ? String(body.organizationName).trim() : null,
        name,
        email,
        phone,
        altPhone: body?.altPhone ? String(body.altPhone).trim() : null,
        address: body?.address ? String(body.address).trim() : null,
        city: body?.city ? String(body.city).trim() : null,
        state: body?.state ? String(body.state).trim() : null,
        pincode,
        pan,
        language: body?.language ? String(body.language) : null,
        source: body?.source ? String(body.source) : "OFFLINE",
        category: body?.category ? String(body.category) : null,
        wants80g: body?.wants80g === undefined ? true : Boolean(body.wants80g),
        anonymousByDefault: Boolean(body?.anonymousByDefault),
        emailOptIn: body?.emailOptIn === undefined ? true : Boolean(body.emailOptIn),
        smsOptIn: body?.smsOptIn === undefined ? true : Boolean(body.smsOptIn),
        whatsappOptIn: body?.whatsappOptIn === undefined ? true : Boolean(body.whatsappOptIn),
        tags: body?.tags ? JSON.stringify(body.tags) : null,
        notes: body?.notes ? String(body.notes) : null,
        userId: linkedUser?.id ?? null,
      },
    });

    await logActivity(session.name, "DONOR_CREATE", "DONOR", `${donor.name} (${donor.email})`, session.userId);
    return json(donor, 201);
  } catch (e) {
    return handleError(e);
  }
}
