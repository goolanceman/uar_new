/**
 * Donor service — all business rules for the donor CRM. Depends on the
 * repository contract, throws application errors, never touches HTTP.
 *
 * The create/update field checks run in the exact legacy order because the
 * email-conflict lookup is interleaved between them and every wire message
 * (and audit-log field order) must stay verbatim.
 */
import { logger } from "@/infrastructure/logging/logger";
import { nextDonorCode } from "@/domains/codes";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ApiError } from "@/shared/errors";
import { PAN_REGEX, PHONE_REGEX, PIN_REGEX } from "@/shared/schemas/common";
import type {
  CreateDonorData,
  DonorListFilter,
  DonorRepository,
  UpdateDonorData,
} from "../repositories/donor.repository.interface";

const log = logger.child("donors");

const VALID_TYPES = ["INDIVIDUAL", "ORGANISATION", "CORPORATE"];
const VALID_SOURCES = ["WEB", "OFFLINE", "IMPORT", "REFERRAL", "EVENT"];
const VALID_CATEGORIES = ["MAJOR", "MONTHLY", "ONE_TIME", "CORPORATE", "CSR"];

export class DonorService {
  constructor(private readonly donorRepository: DonorRepository) {}

  /** GET /api/donors — CRM list with lifetime value + donation counts. */
  async list(filter: DonorListFilter, page: number, limit: number) {
    const { rows, total } = await this.donorRepository.list(filter, (page - 1) * limit, limit);

    // Lifetime value + counts per donor (single aggregate query)
    const emails = rows.map((d) => d.email);
    const agg = emails.length ? await this.donorRepository.aggregateByEmails(emails) : [];
    const aggMap = new Map(agg.map((a) => [a.donorEmail, a]));

    const items = rows.map((d) => {
      const a = aggMap.get(d.email);
      return {
        ...d,
        lifetimeValue: a?._sum.amount ?? 0,
        donationsCount: a?._count.id ?? 0,
        firstDonationAt: a?._min.createdAt ?? null,
        lastDonationAt: a?._max.createdAt ?? null,
      };
    });

    return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** POST /api/donors — admin creates a donor record. */
  async create(data: Record<string, unknown>, actor: Session) {
    const name = String(data?.name ?? "").trim();
    const email = String(data?.email ?? "").trim().toLowerCase();
    if (!name || !email) throw new ApiError("Name and email are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const existing = await this.donorRepository.findByEmail(email);
    if (existing) {
      log.warn("donor_email_conflict", {
        email,
        existingId: existing.id,
        actor: actor.userId,
      });
      throw new ApiError("A donor with this email already exists", 409);
    }

    const phone = data?.phone ? String(data.phone).trim() : null;
    if (phone && !PHONE_REGEX.test(phone.replace(/[\s-]/g, "")))
      throw new ApiError("Please enter a valid Indian mobile number", 400);

    const pan = data?.pan ? String(data.pan).trim().toUpperCase() : null;
    if (pan && !PAN_REGEX.test(pan))
      throw new ApiError("PAN must look like ABCDE1234F", 400);

    const pincode = data?.pincode ? String(data.pincode).trim() : null;
    if (pincode && !PIN_REGEX.test(pincode))
      throw new ApiError("PIN code must be 6 digits", 400);

    if (data?.type && !VALID_TYPES.includes(String(data.type)))
      throw new ApiError("Invalid donor type", 400);
    if (data?.source && !VALID_SOURCES.includes(String(data.source)))
      throw new ApiError("Invalid donor source", 400);
    if (data?.category && !VALID_CATEGORIES.includes(String(data.category)))
      throw new ApiError("Invalid donor category", 400);

    // Link to a user account when one exists with the same email
    const linkedUser = await this.donorRepository.findUserIdByEmail(email);

    const donor = await this.donorRepository.create({
      code: await nextDonorCode(),
      type: data?.type ? String(data.type) : "INDIVIDUAL",
      organizationName: data?.organizationName ? String(data.organizationName).trim() : null,
      name,
      email,
      phone,
      altPhone: data?.altPhone ? String(data.altPhone).trim() : null,
      address: data?.address ? String(data.address).trim() : null,
      city: data?.city ? String(data.city).trim() : null,
      state: data?.state ? String(data.state).trim() : null,
      pincode,
      pan,
      language: data?.language ? String(data.language) : null,
      source: data?.source ? String(data.source) : "OFFLINE",
      category: data?.category ? String(data.category) : null,
      wants80g: data?.wants80g === undefined ? true : Boolean(data.wants80g),
      anonymousByDefault: Boolean(data?.anonymousByDefault),
      emailOptIn: data?.emailOptIn === undefined ? true : Boolean(data.emailOptIn),
      smsOptIn: data?.smsOptIn === undefined ? true : Boolean(data.smsOptIn),
      whatsappOptIn: data?.whatsappOptIn === undefined ? true : Boolean(data.whatsappOptIn),
      tags: data?.tags ? JSON.stringify(data.tags) : null,
      notes: data?.notes ? String(data.notes) : null,
      userId: linkedUser?.id ?? null,
    });

    log.info("donor_created", {
      donorId: donor.id,
      code: donor.code,
      linkedUserId: linkedUser?.id ?? null,
      actor: actor.userId,
    });

    await logActivity(actor.name, "DONOR_CREATE", "DONOR", `${donor.name} (${donor.email})`, actor.userId);
    return donor;
  }

  /** GET /api/donors/:id — donor 360 (profile + donations + pledges + certificates). */
  async detail(id: string) {
    const donor = await this.donorRepository.findById(id);
    if (!donor) throw new ApiError("Donor not found", 404);

    const [donations, pledges, animalPledges, certificates] = await Promise.all([
      this.donorRepository.listDonationsByEmail(donor.email),
      this.donorRepository.listPledgesByUserId(donor.userId ?? undefined),
      this.donorRepository.listAnimalPledgesByUserId(donor.userId ?? undefined),
      this.donorRepository.listCertificatesByEmail(donor.email),
    ]);

    const completed = donations.filter((d) => d.paymentStatus === "COMPLETED");
    const lifetimeValue = completed.reduce((s, d) => s + d.amount, 0);
    const thisYear = new Date().getFullYear();
    const fyValue = completed
      .filter((d) => d.createdAt.getFullYear() === thisYear)
      .reduce((s, d) => s + d.amount, 0);

    return {
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
    };
  }

  /** PATCH /api/donors/:id — admin edits donor profile. */
  async update(id: string, rawBody: Record<string, unknown>, actor: Session) {
    const existing = await this.donorRepository.findSimpleById(id);
    if (!existing) {
      log.warn("donor_update_not_found", { donorId: id, actor: actor.userId });
      throw new ApiError("Donor not found", 404);
    }

    const data: UpdateDonorData = {};

    if (rawBody?.name !== undefined) {
      const v = String(rawBody.name).trim();
      if (!v) throw new ApiError("Name cannot be empty", 400);
      data.name = v;
    }
    if (rawBody?.type !== undefined) {
      if (!["INDIVIDUAL", "ORGANISATION", "CORPORATE"].includes(String(rawBody.type)))
        throw new ApiError("Invalid donor type", 400);
      data.type = String(rawBody.type);
    }
    if (rawBody?.organizationName !== undefined)
      data.organizationName = rawBody.organizationName ? String(rawBody.organizationName).trim() : null;
    if (rawBody?.phone !== undefined) {
      const v = rawBody.phone ? String(rawBody.phone).trim() : null;
      if (v && !PHONE_REGEX.test(v.replace(/[\s-]/g, "")))
        throw new ApiError("Please enter a valid Indian mobile number", 400);
      data.phone = v;
    }
    if (rawBody?.altPhone !== undefined)
      data.altPhone = rawBody.altPhone ? String(rawBody.altPhone).trim() : null;
    if (rawBody?.address !== undefined)
      data.address = rawBody.address ? String(rawBody.address).trim() : null;
    if (rawBody?.city !== undefined) data.city = rawBody.city ? String(rawBody.city).trim() : null;
    if (rawBody?.state !== undefined) data.state = rawBody.state ? String(rawBody.state).trim() : null;
    if (rawBody?.pincode !== undefined) {
      const v = rawBody.pincode ? String(rawBody.pincode).trim() : null;
      if (v && !PIN_REGEX.test(v)) throw new ApiError("PIN code must be 6 digits", 400);
      data.pincode = v;
    }
    if (rawBody?.pan !== undefined) {
      const v = rawBody.pan ? String(rawBody.pan).trim().toUpperCase() : null;
      if (v && !PAN_REGEX.test(v)) throw new ApiError("PAN must look like ABCDE1234F", 400);
      data.pan = v;
    }
    if (rawBody?.language !== undefined) data.language = rawBody.language ? String(rawBody.language) : null;
    if (rawBody?.source !== undefined) data.source = rawBody.source ? String(rawBody.source) : null;
    if (rawBody?.category !== undefined) data.category = rawBody.category ? String(rawBody.category) : null;
    if (rawBody?.wants80g !== undefined) data.wants80g = Boolean(rawBody.wants80g);
    if (rawBody?.anonymousByDefault !== undefined)
      data.anonymousByDefault = Boolean(rawBody.anonymousByDefault);
    if (rawBody?.emailOptIn !== undefined) data.emailOptIn = Boolean(rawBody.emailOptIn);
    if (rawBody?.smsOptIn !== undefined) data.smsOptIn = Boolean(rawBody.smsOptIn);
    if (rawBody?.whatsappOptIn !== undefined) data.whatsappOptIn = Boolean(rawBody.whatsappOptIn);
    if (rawBody?.tags !== undefined)
      data.tags = rawBody.tags ? JSON.stringify(rawBody.tags) : null;
    if (rawBody?.notes !== undefined) data.notes = rawBody.notes ? String(rawBody.notes) : null;

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const donor = await this.donorRepository.update(id, data);
    log.info("donor_updated", {
      donorId: id,
      code: donor.code,
      fields: Object.keys(data),
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "DONOR_UPDATE",
      "DONOR",
      `${donor.name} → ${Object.keys(data).join(", ")}`,
      actor.userId
    );

    return donor;
  }

  /** DELETE /api/donors/:id — remove CRM record (donations untouched). */
  async remove(id: string, actor: Session) {
    const existing = await this.donorRepository.findSimpleById(id);
    if (!existing) {
      log.warn("donor_delete_not_found", { donorId: id, actor: actor.userId });
      throw new ApiError("Donor not found", 404);
    }

    await this.donorRepository.clearDonationLinks(id);
    await this.donorRepository.remove(id);
    log.info("donor_deleted", {
      donorId: id,
      code: existing.code,
      actor: actor.userId,
    });

    await logActivity(
      actor.name,
      "DONOR_DELETE",
      "DONOR",
      `${existing.name} (${existing.email})`,
      actor.userId
    );

    return { ok: true };
  }
}
