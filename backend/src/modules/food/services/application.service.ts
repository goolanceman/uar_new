/**
 * Application service — public food assistance applications (rate-limited,
 * duplicate-checked, consent required) plus the admin review workflow that
 * links or creates the persistent beneficiary identity and notifies the
 * applicant (@/modules/food/services/food-notify.domain). Legacy validation order — name/phone/
 * details/consent, then urgency/source/preferredContact/pincode, then the
 * duplicate gate, then the beneficiary link — is preserved exactly.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { nextBeneficiaryCode, nextFoodApplicationRef } from "@/domains/codes";
import { notifyRequestOutcome } from "@/modules/food/services/food-notify.domain";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodRequestRepository } from "../repositories/food-request.repository.interface";

const log = logger.child("food");

// Server-side copies of the shared client validators (validators.ts is a
// "use client" module — server routes keep local regexes, per the pattern in
// /api/donations). Keep both in sync.
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

function normalizePhone(v: string): string {
  return v.replace(/[\s\-+]/g, "").replace(/^91(?=\d{10}$)/, "");
}

const URGENCIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CONTACT_METHODS = ["PHONE", "SMS", "WHATSAPP", "EMAIL"];
const SOURCES = ["SELF", "ASSISTED", "REFERRAL", "EMERGENCY"];

export class ApplicationService {
  constructor(private readonly requestRepository: FoodRequestRepository) {}

  /** GET /api/food/applications — ADMIN review queue (all food assistance requests). */
  async list(sp: URLSearchParams): Promise<unknown> {
    const status = sp.get("status");
    return this.requestRepository.listApplications(status);
  }

  /**
   * POST /api/food/applications — PUBLIC food assistance application.
   * Returns a reference number; only the phone number given at submission
   * can check its status. The rate limiter and the session probe run in the
   * controller (request-bound lib calls) BEFORE this method, in legacy order.
   */
  async submit(body: FoodBody, session: Session | null): Promise<unknown> {
    const name = String(body?.name ?? "").trim();
    const phoneRaw = body?.phone ? String(body.phone).trim() : "";
    const details = String(body?.details ?? "").trim();
    if (!name || name.length < 3) throw new ApiError("Please enter the applicant's full name", 400);
    if (!phoneRaw || !PHONE_RE.test(phoneRaw.replace(/[\s-]/g, ""))) throw new ApiError("Please enter a valid Indian mobile number", 400);
    if (!details || details.length < 10)
      throw new ApiError("Please describe the assistance needed (at least a sentence)", 400);
    if (body?.consent !== true)
      throw new ApiError("Consent is required so our team can review and contact you", 400);

    const phone = normalizePhone(phoneRaw);
    const urgency = String(body?.urgency ?? "MEDIUM").toUpperCase();
    if (!URGENCIES.includes(urgency)) throw new ApiError("Invalid urgency level", 400);
    const source = String(body?.source ?? "SELF").toUpperCase();
    if (!SOURCES.includes(source)) throw new ApiError("Invalid application source", 400);
    const preferredContact = body?.preferredContact ? String(body.preferredContact).toUpperCase() : "PHONE";
    if (!CONTACT_METHODS.includes(preferredContact)) throw new ApiError("Invalid contact preference", 400);
    if (body?.pincode && !PIN_RE.test(String(body.pincode).trim()))
      throw new ApiError("PIN code must look like 560001", 400);

    // Duplicate check — same phone with an open application, unless it's an
    // emergency (nobody in crisis should be blocked by a clerical duplicate).
    const duplicate = await this.requestRepository.findOpenRequestByPhone(phone);
    if (duplicate && source !== "EMERGENCY") {
      log.warn("food_application_duplicate_blocked", {
        duplicateRef: duplicate.refCode,
        urgency,
        source,
        actor: session?.userId,
      });
      throw new ApiError(
        `An application from this number is already being reviewed (reference ${duplicate.refCode ?? "—"}). Our team will contact you — for urgent needs choose "Emergency" and mention the crisis.`,
        409
      );
    }

    // Link the caller's beneficiary record when one exists.
    const linked = session
      ? await this.requestRepository.findBeneficiaryByUserId(session.userId)
      : null;

    const row = await this.requestRepository.createRequest({
      refCode: await nextFoodApplicationRef(),
      beneficiaryId: body?.beneficiaryId && session?.role === "ADMIN" ? String(body.beneficiaryId) : linked?.id ?? null,
      userId: session?.userId ?? null,
      name,
      phone,
      category: "FOOD_ASSISTANCE",
      urgency,
      details,
      address: body?.address ? String(body.address).trim() : null,
      city: body?.city ? String(body.city).trim() : null,
      pincode: body?.pincode ? String(body.pincode).trim() : null,
      familyMembers: Number(body?.familyMembers) > 0 ? Number(body.familyMembers) : null,
      childrenCount: Number(body?.childrenCount) > 0 ? Number(body.childrenCount) : null,
      seniorCount: Number(body?.seniorCount) > 0 ? Number(body.seniorCount) : null,
      dietary: body?.dietary ? String(body.dietary).trim() : null,
      preferredContact,
      consent: true,
      source,
    });

    log.info("food_application_submitted", {
      applicationId: row.id,
      refCode: row.refCode,
      urgency,
      source,
      actor: session?.userId,
    });

    // Admin worklist notification (no PII beyond first name in the bell).
    await this.requestRepository.createNotification({
      title: "New food assistance application",
      message: `${name.split(" ")[0]} — ${urgency.toLowerCase()} urgency. Reference ${row.refCode}.`,
      type: "DISTRIBUTION",
      actionUrl: "/admin/food",
    });
    await logActivity(name, "FOOD_APPLICATION_SUBMIT", "BeneficiaryRequest", row.refCode ?? undefined, session?.userId);

    return {
      refCode: row.refCode,
      message: "Application received. Keep your reference number to check the status anytime.",
    };
  }

  /**
   * GET /api/food/applications/status?refCode=UAR-FAR-00001&phone=9876543210
   * Public status check — reference number + phone verification, rate-limited.
   * Returns the minimum needed to reassure the applicant; never the review
   * internals or any other applicant's data. The rate limiter runs in the
   * controller (request-bound lib call) BEFORE this method.
   */
  async statusCheck(sp: URLSearchParams): Promise<unknown> {
    const refCode = (sp.get("refCode") ?? "").trim().toUpperCase();
    const phone = normalizePhone((sp.get("phone") ?? "").trim());
    if (!refCode || !phone) throw new ApiError("Reference number and mobile number are both required", 400);

    const row = await this.requestRepository.findRequestByRefCode(refCode);
    if (!row || normalizePhone(row.phone ?? "") !== phone)
      throw new ApiError("No application matches that reference and mobile number", 404);

    return {
      refCode,
      applicantFirstName: row.name.split(" ")[0],
      status: row.status,
      reviewNote: row.status === "REJECTED" ? row.reviewNote : null,
      submittedAt: row.createdAt,
      lastUpdatedAt: row.updatedAt,
    };
  }

  /**
   * PATCH /api/food/applications/:id — ADMIN review workflow.
   * APPROVED links (or creates) the beneficiary record so the applicant enters
   * the normal assistance pipeline; humans always make the decision.
   */
  async review(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const row = await this.requestRepository.findRequestById(id);
    if (!row || row.category !== "FOOD_ASSISTANCE") {
      log.warn("food_application_not_found", { applicationId: id, actor: session.userId });
      throw new ApiError("Food application not found", 404);
    }
    if (["APPROVED", "REJECTED"].includes(row.status) && !body?.reopen) {
      log.warn("food_application_already_decided", { applicationId: id, status: row.status, actor: session.userId });
      throw new ApiError(`Application is already ${row.status.toLowerCase()} — reopen it to change the decision`, 409);
    }

    const status = String(body?.status ?? "").toUpperCase();
    if (!["IN_REVIEW", "APPROVED", "REJECTED", "FULFILLED"].includes(status))
      throw new ApiError("Invalid review status", 400);
    const reviewNote = body?.reviewNote !== undefined ? String(body.reviewNote).trim() : row.reviewNote;
    if (status === "REJECTED" && !reviewNote)
      throw new ApiError("Explain the decision to the applicant in the review note", 400);

    let beneficiaryId = row.beneficiaryId;
    if (status === "APPROVED" && !beneficiaryId) {
      // Create the persistent UAR beneficiary identity from application facts.
      const beneficiary = await this.requestRepository.createBeneficiary({
        code: await nextBeneficiaryCode(),
        name: row.name,
        phone: row.phone,
        address: row.address,
        city: row.city,
        pincode: row.pincode,
        category: "POOR_FAMILY",
        urgencyLevel: row.urgency,
        familyMembers: row.familyMembers ?? 1,
        needs: row.details.slice(0, 500),
        caseStatus: "INTAKE",
        onboardedByName: session.name,
        intakeDate: new Date(),
      });
      beneficiaryId = beneficiary.id;
    }

    const updated = await this.requestRepository.updateRequest(id, {
      status,
      reviewNote,
      reviewedBy: session.name,
      reviewedAt: new Date(),
      ...(beneficiaryId ? { beneficiaryId } : {}),
    });

    if (row.userId || row.phone) {
      await notifyRequestOutcome({
        refCode: row.refCode ?? "",
        name: row.name,
        phone: row.phone,
        status,
        reviewNote,
      });
    }

    log.info("food_application_reviewed", {
      applicationId: id,
      refCode: row.refCode,
      status,
      beneficiaryId: beneficiaryId ?? null,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FOOD_APPLICATION_REVIEW",
      "BeneficiaryRequest",
      `${row.refCode} → ${status}`,
      session.userId
    );
    return updated;
  }
}
