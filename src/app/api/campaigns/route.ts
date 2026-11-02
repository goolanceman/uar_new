import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "campaign";
  let candidate = base;
  let n = 2;
  // ensure unique (append -2, -3, …)
  while (await db.campaign.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

// GET /api/campaigns?category&status&q&featured&all=1
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const session = await getSession();
    const isAdmin = session?.role === "ADMIN";
    const all = sp.get("all") === "1";

    const category = sp.get("category");
    const status = sp.get("status");
    const q = sp.get("q")?.trim();
    const featured = sp.get("featured") === "1";

    const where: Record<string, unknown> = {};
    if (!isAdmin || !all) where.status = { not: "DRAFT" };
    if (status) where.status = status;
    if (category) where.category = category;
    if (featured) where.featured = true;
    if (q) where.title = { contains: q };

    const campaigns = await db.campaign.findMany({
      where,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    });

    return json(campaigns);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/campaigns — admin creates a campaign
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json().catch(() => ({}));

    const title = String(body?.title ?? "").trim();
    const description = String(body?.description ?? "").trim();
    const category = String(body?.category ?? "GENERAL");
    const targetAmount = Number(body?.targetAmount);

    if (!title || !description)
      throw new ApiError("Title and description are required", 400);
    if (!Number.isFinite(targetAmount) || targetAmount <= 0)
      throw new ApiError("Target amount must be a positive number", 400);

    const campaign = await db.campaign.create({
      data: {
        title,
        slug: await uniqueSlug(title),
        tagline: body?.tagline ? String(body.tagline).trim() : "",
        description,
        category,
        targetAmount,
        icon: body?.icon ? String(body.icon) : "heart",
        accent: body?.accent ? String(body.accent) : "emerald",
        helpline: body?.helpline ? String(body.helpline).trim() : null,
        featured: Boolean(body?.featured),
        status: body?.status ? String(body.status) : "ACTIVE",
        startDate: new Date(),
        createdBy: session.userId,
      },
    });

    await logActivity(
      session.name,
      "CAMPAIGN_CREATE",
      "CAMPAIGN",
      `${campaign.title} (₹${campaign.targetAmount})`,
      session.userId
    );

    return json(campaign, 201);
  } catch (e) {
    return handleError(e);
  }
}
