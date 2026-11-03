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

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

// GET /api/donors/:id — donor 360 (profile + donations + pledges + certificates)
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRole("ADMIN");
    const { id } = await ctx.params;

    const donor = await db.donor.findUnique({
      where: { id },
      include: { user: { select: { id: true, role: true, status: true, city: true } } },
    });
    if (!donor) throw new ApiError("Donor not found", 404);

    const [donations, pledges, animalPledges, certificates] = await Promise.all([
      db.donation.findMany({
        where: { donorEmail: donor.email },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { campaign: { select: { title: true, accent: true } } },
      }),
      db.pledge.findMany({
        where: { donorId: donor.userId ?? undefined },
        orderBy: { createdAt: "desc" },
        include: { cause: { select: { code: true, patientName: true } } },
      }),
      db.animalPledge.findMany({
        where: { donorId: donor.userId ?? undefined },
        orderBy: { createdAt: "desc" },
        include: { animal: { select: { name: true, species: true } } },
      }),
      db.certificate.findMany({
        where: { recipientEmail: donor.email },
        orderBy: { issuedAt: "desc" },
        take: 50,
      }),
    ]);

    const completed = donations.filter((d) => d.paymentStatus === "COMPLETED");
    const lifetimeValue = completed.reduce((s, d) => s + d.amount, 0);
    const thisYear = new Date().getFullYear();
    const fyValue = completed
      .filter((d) => d.createdAt.getFullYear() === thisYear)
      .reduce((s, d) => s + d.amount, 0);

    return json({
      ...donor,
      donations,
      pledges,
      animalPledges,
      certificates,
      stats: {
        lifetimeValue,
        fyValue,
        donationsCount: donations.length,
        receiptsIssued: completed.filter((d) => d.receiptStatus === "ISSUED").length,
        activePledges: pledges.filter((p) => p.status === "ACTIVE").length,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/donors/:id — admin edits donor profile
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const existing = await db.donor.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Donor not found", 404);

    const data: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const v = String(body.name).trim();
      if (!v) throw new ApiError("Name cannot be empty", 400);
      data.name = v;
    }
    if (body?.type !== undefined) {
      if (!["INDIVIDUAL", "ORGANISATION", "CORPORATE"].includes(String(body.type)))
        throw new ApiError("Invalid donor type", 400);
      data.type = String(body.type);
    }
    if (body?.organizationName !== undefined)
      data.organizationName = body.organizationName ? String(body.organizationName).trim() : null;
    if (body?.phone !== undefined) {
      const v = body.phone ? String(body.phone).trim() : null;
      if (v && !PHONE_RE.test(v.replace(/[\s-]/g, "")))
        throw new ApiError("Please enter a valid Indian mobile number", 400);
      data.phone = v;
    }
    if (body?.altPhone !== undefined)
      data.altPhone = body.altPhone ? String(body.altPhone).trim() : null;
    if (body?.address !== undefined)
      data.address = body.address ? String(body.address).trim() : null;
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.state !== undefined) data.state = body.state ? String(body.state).trim() : null;
    if (body?.pincode !== undefined) {
      const v = body.pincode ? String(body.pincode).trim() : null;
      if (v && !PIN_RE.test(v)) throw new ApiError("PIN code must be 6 digits", 400);
      data.pincode = v;
    }
    if (body?.pan !== undefined) {
      const v = body.pan ? String(body.pan).trim().toUpperCase() : null;
      if (v && !PAN_RE.test(v)) throw new ApiError("PAN must look like ABCDE1234F", 400);
      data.pan = v;
    }
    if (body?.language !== undefined) data.language = body.language ? String(body.language) : null;
    if (body?.source !== undefined) data.source = body.source ? String(body.source) : null;
    if (body?.category !== undefined) data.category = body.category ? String(body.category) : null;
    if (body?.wants80g !== undefined) data.wants80g = Boolean(body.wants80g);
    if (body?.anonymousByDefault !== undefined)
      data.anonymousByDefault = Boolean(body.anonymousByDefault);
    if (body?.emailOptIn !== undefined) data.emailOptIn = Boolean(body.emailOptIn);
    if (body?.smsOptIn !== undefined) data.smsOptIn = Boolean(body.smsOptIn);
    if (body?.whatsappOptIn !== undefined) data.whatsappOptIn = Boolean(body.whatsappOptIn);
    if (body?.tags !== undefined)
      data.tags = body.tags ? JSON.stringify(body.tags) : null;
    if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const donor = await db.donor.update({ where: { id }, data });

    await logActivity(
      session.name,
      "DONOR_UPDATE",
      "DONOR",
      `${donor.name} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json(donor);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/donors/:id — remove CRM record (donations untouched)
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;

    const existing = await db.donor.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Donor not found", 404);

    await db.donation.updateMany({
      where: { donorRefId: id },
      data: { donorRefId: null },
    });
    await db.donor.delete({ where: { id } });

    await logActivity(
      session.name,
      "DONOR_DELETE",
      "DONOR",
      `${existing.name} (${existing.email})`,
      session.userId
    );

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
