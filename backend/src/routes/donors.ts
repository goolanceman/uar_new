/**
 * Donor CRM routes — /api/donors, /api/donors/:id
 * Converted 1:1 from src/app/api/donors/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { nextDonorCode } from "@/lib/codes";

export const router = Router();

const log = logger.child("donors");

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

const VALID_TYPES = ["INDIVIDUAL", "ORGANISATION", "CORPORATE"];
const VALID_SOURCES = ["WEB", "OFFLINE", "IMPORT", "REFERRAL", "EVENT"];
const VALID_CATEGORIES = ["MAJOR", "MONTHLY", "ONE_TIME", "CORPORATE", "CSR"];

// GET /api/donors — admin donor CRM with aggregates + pagination
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const sp = new URL(req.url, "http://localhost").searchParams;
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
        { code: { contains: q } },
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

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / take)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/donors — admin creates a donor record
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!name || !email)
      throw new ApiError("Name and email are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const existing = await db.donor.findUnique({ where: { email } });
    if (existing) {
      log.warn("donor_email_conflict", {
        email,
        existingId: existing.id,
        actor: session.userId,
      });
      throw new ApiError("A donor with this email already exists", 409);
    }

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
        code: await nextDonorCode(),
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

    log.info("donor_created", {
      donorId: donor.id,
      code: donor.code,
      linkedUserId: linkedUser?.id ?? null,
      actor: session.userId,
    });

    await logActivity(session.name, "DONOR_CREATE", "DONOR", `${donor.name} (${donor.email})`, session.userId);
    return json(res, donor, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/donors/:id — donor 360 (profile + donations + pledges + certificates)
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const { id } = req.params;

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

    return json(res, {
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
    return handleError(e, res);
  }
});

// PATCH /api/donors/:id — admin edits donor profile
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.donor.findUnique({ where: { id } });
    if (!existing) {
      log.warn("donor_update_not_found", { donorId: id, actor: session.userId });
      throw new ApiError("Donor not found", 404);
    }

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
    log.info("donor_updated", {
      donorId: id,
      code: donor.code,
      fields: Object.keys(data),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "DONOR_UPDATE",
      "DONOR",
      `${donor.name} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    return json(res, donor);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/donors/:id — remove CRM record (donations untouched)
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    const existing = await db.donor.findUnique({ where: { id } });
    if (!existing) {
      log.warn("donor_delete_not_found", { donorId: id, actor: session.userId });
      throw new ApiError("Donor not found", 404);
    }

    await db.donation.updateMany({
      where: { donorRefId: id },
      data: { donorRefId: null },
    });
    await db.donor.delete({ where: { id } });
    log.info("donor_deleted", {
      donorId: id,
      code: existing.code,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "DONOR_DELETE",
      "DONOR",
      `${existing.name} (${existing.email})`,
      session.userId
    );

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
