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

const TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "EDUCATION_MATERIAL",
  "CASH",
  "OTHER",
];

/** Normalise an items array → JSON string [{name, qty, unit?}] or null. */
function sanitizeItems(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const clean = raw
    .map((i) => {
      const o = (i ?? {}) as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      const qty = Number(o.qty ?? 1);
      const unit = String(o.unit ?? "").trim();
      return {
        name,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        ...(unit ? { unit } : {}),
      };
    })
    .filter((i) => i.name.length > 0);
  return clean.length ? JSON.stringify(clean) : null;
}

/** ADMIN may edit anything; VOLUNTEER only records attributed to them. */
async function assertCanMutate(
  session: { role: string; userId: string; name: string },
  id: string
) {
  const existing = await db.distribution.findUnique({
    where: { id },
    select: { id: true, volunteerId: true, type: true, quantity: true },
  });
  if (!existing) throw new ApiError("Distribution not found", 404);
  if (session.role !== "ADMIN") {
    const own = await db.volunteer.findUnique({
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!own || existing.volunteerId !== own.id)
      throw new ApiError("You can only manage distributions you recorded", 403);
  }
  return existing;
}

// GET /api/distributions/:id (ADMIN, VOLUNTEER) — enriched detail
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const row = await db.distribution.findUnique({
      where: { id },
      include: {
        beneficiary: {
          select: {
            id: true,
            name: true,
            category: true,
            urgencyLevel: true,
            city: true,
            familyMembers: true,
          },
        },
        volunteer: { include: { user: { select: { name: true } } } },
      },
    });
    if (!row) throw new ApiError("Distribution not found", 404);

    const campaign = row.campaignId
      ? await db.campaign.findUnique({
          where: { id: row.campaignId },
          select: {
            id: true,
            title: true,
            accent: true,
            status: true,
            targetAmount: true,
            raisedAmount: true,
          },
        })
      : null;
    return json({ ...row, campaign });
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/distributions/:id (ADMIN, or the recording VOLUNTEER)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await assertCanMutate(session, id);

    const data: Prisma.DistributionUncheckedUpdateInput = {};

    if (body.type !== undefined) {
      const type = String(body.type).trim().toUpperCase();
      if (!TYPES.includes(type)) throw new ApiError("Invalid distribution type", 400);
      data.type = type;
    }
    if (body.beneficiaryId !== undefined)
      data.beneficiaryId = body.beneficiaryId ? String(body.beneficiaryId) : null;
    if (body.campaignId !== undefined)
      data.campaignId = body.campaignId ? String(body.campaignId) : null;
    if (body.volunteerId !== undefined) {
      if (!body.volunteerId) data.volunteerId = null;
      else {
        const v = await db.volunteer.findUnique({
          where: { id: String(body.volunteerId) },
        });
        if (!v) throw new ApiError("Volunteer not found", 400);
        data.volunteerId = v.id;
      }
    }
    if (body.items !== undefined) data.items = sanitizeItems(body.items);
    if (body.quantity !== undefined) {
      const quantity = Math.trunc(Number(body.quantity));
      if (!Number.isFinite(quantity) || quantity < 1)
        throw new ApiError("quantity must be at least 1", 400);
      data.quantity = quantity;
    }
    if (body.value !== undefined) {
      if (body.value === null || body.value === "") data.value = null;
      else {
        const value = Number(body.value);
        if (!Number.isFinite(value) || value < 0)
          throw new ApiError("value must be a number ≥ 0", 400);
        data.value = value;
      }
    }
    if (body.location !== undefined) {
      const location = String(body.location).trim();
      if (!location) throw new ApiError("location cannot be empty", 400);
      data.location = location;
    }
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (body.distributedAt !== undefined) {
      const d = new Date(String(body.distributedAt));
      if (Number.isNaN(d.getTime())) throw new ApiError("Invalid distributedAt date", 400);
      data.distributedAt = d;
    }

    const row = await db.distribution.update({ where: { id }, data });
    await logActivity(
      session.name,
      "DISTRIBUTION_UPDATE",
      "Distribution",
      id,
      session.userId
    );
    return json(row);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/distributions/:id (ADMIN, or the recording VOLUNTEER)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireRole("ADMIN", "VOLUNTEER");
    const { id } = await params;
    const existing = await assertCanMutate(session, id);

    await db.distribution.delete({ where: { id } });
    await logActivity(
      session.name,
      "DISTRIBUTION_DELETE",
      "Distribution",
      `${existing.type} ×${existing.quantity}`,
      session.userId
    );
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
