/**
 * Food routes — /api/food/*
 * Converted 1:1 from src/app/api/food/* (Next.js route handlers) to Express.
 * NOTE: "/applications/status" is declared BEFORE "/applications/:id" so the
 * literal path is never captured as an id.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  validateSession,
  json,
  handleError,
  ApiError,
  logActivity,
} from "@/lib/session";
import {
  nextFoodApplicationRef,
  nextBeneficiaryCode,
  nextFoodEventCode,
  nextFoodProgrammeCode,
  nextHouseholdCode,
  generateUniqueCode,
} from "@/lib/codes";
import {
  fefoReserve,
  issueAllocation,
  cancelAllocation,
  refreshBatchStatuses,
  enforceFoodRateLimit,
  availableOf,
  isAllocatable,
  foodWindowDays,
  assertEventTransition,
  parseTemplateItems,
  calcRequirements,
  returnIssuedAllocation,
  FOOD_EVENT_STATUSES,
  FOOD_PUBLIC_EVENT_STATUSES,
  FOOD_OPERATIONAL_STATUSES,
  FOOD_ACK_METHODS,
  FOOD_REGISTRATION_TRANSITIONS,
  FOOD_PLEDGE_TRANSITIONS,
  FOOD_PROGRAMME_STATUSES,
  FOOD_PROGRAMME_TRANSITIONS,
  FOOD_BATCH_QUALITY_TRANSITIONS,
  FOOD_ACTIVE_REG_STATUSES,
} from "@/lib/food";
import { notifyRequestOutcome } from "@/lib/food-notify";
import { validPin } from "@/lib/validators";
import { assertTransition } from "@/lib/workflow";

const log = logger.child("food");

export const router = Router();

/**
 * POST /api/food/allocations — ADMIN reserves stock for an event.
 * Body: { eventId, lines: [{ itemId, quantity }] }
 * Each line is reserved FEFO across inspected batches inside one transaction;
 * a shortfall aborts the whole reservation (no partial events).
 */
router.post("/allocations", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const eventId = String(body?.eventId ?? "");
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    if (!eventId || !lines.length) throw new ApiError("eventId and at least one line are required", 400);

    const event = await db.foodEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new ApiError("Food event not found", 404);
    if (["COMPLETED", "RECONCILED", "CLOSED", "CANCELLED"].includes(event.status))
      throw new ApiError(`Stock cannot be reserved for a ${event.status.toLowerCase()} event`, 409);

    const reserved: Array<{ itemId: string; batchId: string; quantity: number }> = [];
    await db.$transaction(async (tx) => {
      for (const line of lines) {
        const itemId = String(line?.itemId ?? "");
        const quantity = Number(line?.quantity);
        if (!itemId || !Number.isFinite(quantity) || quantity <= 0)
          throw new ApiError("Every line needs an itemId and a positive quantity", 400);
        const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
        if (!item) throw new ApiError(`Inventory item not found (${itemId})`, 400);
        const made = await fefoReserve(tx, eventId, itemId, Math.ceil(quantity), session.name);
        for (const m of made) reserved.push({ itemId, ...m });
      }
    });

    await logActivity(
      session.name,
      "FOOD_STOCK_RESERVE",
      "FoodEvent",
      `${event.code}: ${reserved.length} batch reservation(s)`,
      session.userId
    );
    return json(res, { reserved }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/food/allocations/:id — ADMIN { action: "issue" | "cancel" }
router.patch("/allocations/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};
    const action = String(body?.action ?? "");

    const allocation = await db.foodStockAllocation.findUnique({
      where: { id },
      include: { event: { select: { code: true } } },
    });
    if (!allocation) throw new ApiError("Allocation not found", 404);

    await db.$transaction(async (tx) => {
      if (action === "issue") await issueAllocation(tx, id, session.name);
      else if (action === "cancel") await cancelAllocation(tx, id);
      else throw new ApiError("action must be issue or cancel", 400);
      await refreshBatchStatuses(tx, [allocation.itemId]);
    });

    await logActivity(
      session.name,
      action === "issue" ? "FOOD_STOCK_ISSUE" : "FOOD_STOCK_RELEASE",
      "FoodStockAllocation",
      `${allocation.event.code}: ${allocation.quantity} unit(s) ${action === "issue" ? "issued" : "released"}`,
      session.userId
    );
    return json(res, await db.foodStockAllocation.findUnique({ where: { id } }));
  } catch (e) {
    return handleError(e, res);
  }
});

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

// GET /api/food/applications — ADMIN review queue (all food assistance requests)
router.get("/applications", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status");
    const rows = await db.beneficiaryRequest.findMany({
      where: { category: "FOOD_ASSISTANCE", ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { beneficiary: { select: { id: true, code: true, name: true } } },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/applications — PUBLIC food assistance application.
// Rate-limited, duplicate-checked, consent required. Returns a reference
// number; only the phone number given at submission can check its status.
router.post("/applications", async (req, res) => {
  try {
    // Express headers are a plain record — the shared limiter expects fetch Headers.
    await enforceFoodRateLimit(new Headers(req.headers as Record<string, string>), "applications", "food.applications.rateLimitPerHour");
    const body = req.body ?? {};
    const session = await validateSession(req);

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
    const duplicate = await db.beneficiaryRequest.findFirst({
      where: {
        category: "FOOD_ASSISTANCE",
        phone: { contains: phone },
        status: { in: ["PENDING", "IN_REVIEW"] },
      },
      select: { refCode: true, createdAt: true },
    });
    if (duplicate && source !== "EMERGENCY")
      throw new ApiError(
        `An application from this number is already being reviewed (reference ${duplicate.refCode ?? "—"}). Our team will contact you — for urgent needs choose "Emergency" and mention the crisis.`,
        409
      );

    // Link the caller's beneficiary record when one exists.
    const linked = session
      ? await db.beneficiary.findUnique({ where: { userId: session.userId } })
      : null;

    const row = await db.beneficiaryRequest.create({
      data: {
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
      },
    });

    // Admin worklist notification (no PII beyond first name in the bell).
    await db.notification.create({
      data: {
        title: "New food assistance application",
        message: `${name.split(" ")[0]} — ${urgency.toLowerCase()} urgency. Reference ${row.refCode}.`,
        type: "DISTRIBUTION",
        actionUrl: "/admin/food",
      },
    });
    await logActivity(name, "FOOD_APPLICATION_SUBMIT", "BeneficiaryRequest", row.refCode ?? undefined, session?.userId);

    return json(res, {
      refCode: row.refCode,
      message: "Application received. Keep your reference number to check the status anytime.",
    }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

/** Server-side copy of the shared client helper (validators.ts is client-only). */
function normalizePhoneStatus(v: string): string {
  return v.replace(/[\s\-+]/g, "").replace(/^91(?=\d{10}$)/, "");
}

/**
 * GET /api/food/applications/status?refCode=UAR-FAR-00001&phone=9876543210
 * Public status check — reference number + phone verification, rate-limited.
 * Returns the minimum needed to reassure the applicant; never the review
 * internals or any other applicant's data.
 */
router.get("/applications/status", async (req, res) => {
  try {
    // Express headers are a plain record — the shared limiter expects fetch Headers.
    await enforceFoodRateLimit(new Headers(req.headers as Record<string, string>), "status", "food.statusCheck.rateLimitPerHour");

    const sp = new URL(req.url, "http://localhost").searchParams;
    const refCode = (sp.get("refCode") ?? "").trim().toUpperCase();
    const phone = normalizePhoneStatus((sp.get("phone") ?? "").trim());
    if (!refCode || !phone) throw new ApiError("Reference number and mobile number are both required", 400);

    const row = await db.beneficiaryRequest.findUnique({
      where: { refCode },
      select: { phone: true, status: true, reviewNote: true, createdAt: true, updatedAt: true, name: true },
    });
    if (!row || normalizePhoneStatus(row.phone ?? "") !== phone)
      throw new ApiError("No application matches that reference and mobile number", 404);

    return json(res, {
      refCode,
      applicantFirstName: row.name.split(" ")[0],
      status: row.status,
      reviewNote: row.status === "REJECTED" ? row.reviewNote : null,
      submittedAt: row.createdAt,
      lastUpdatedAt: row.updatedAt,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/food/applications/:id — ADMIN review workflow.
// APPROVED links (or creates) the beneficiary record so the applicant enters
// the normal assistance pipeline; humans always make the decision.
router.patch("/applications/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const row = await db.beneficiaryRequest.findUnique({ where: { id } });
    if (!row || row.category !== "FOOD_ASSISTANCE")
      throw new ApiError("Food application not found", 404);
    if (["APPROVED", "REJECTED"].includes(row.status) && !body?.reopen)
      throw new ApiError(`Application is already ${row.status.toLowerCase()} — reopen it to change the decision`, 409);

    const status = String(body?.status ?? "").toUpperCase();
    if (!["IN_REVIEW", "APPROVED", "REJECTED", "FULFILLED"].includes(status))
      throw new ApiError("Invalid review status", 400);
    const reviewNote = body?.reviewNote !== undefined ? String(body.reviewNote).trim() : row.reviewNote;
    if (status === "REJECTED" && !reviewNote)
      throw new ApiError("Explain the decision to the applicant in the review note", 400);

    let beneficiaryId = row.beneficiaryId;
    if (status === "APPROVED" && !beneficiaryId) {
      // Create the persistent UAR beneficiary identity from application facts.
      const beneficiary = await db.beneficiary.create({
        data: {
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
        },
      });
      beneficiaryId = beneficiary.id;
    }

    const updated = await db.beneficiaryRequest.update({
      where: { id },
      data: {
        status,
        reviewNote,
        reviewedBy: session.name,
        reviewedAt: new Date(),
        ...(beneficiaryId ? { beneficiaryId } : {}),
      },
      include: { beneficiary: { select: { id: true, code: true, name: true } } },
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

    await logActivity(
      session.name,
      "FOOD_APPLICATION_REVIEW",
      "BeneficiaryRequest",
      `${row.refCode} → ${status}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

const BATCH_SOURCES = ["DONATED", "PURCHASED", "CSR", "PARTNER", "RECOVERED"];
const BATCH_TEMP = ["AMBIENT", "COOL", "FROZEN", "HOT_HOLD"];

// GET /api/food/batches?itemId&q&expiring=days&quality — ADMIN stock desk
router.get("/batches", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const itemId = sp.get("itemId");
    const q = sp.get("q")?.trim();
    const quality = sp.get("quality");
    const expiringDays = sp.get("expiring");

    const where: Record<string, unknown> = {};
    if (itemId) where.itemId = itemId;
    if (quality) where.qualityStatus = quality;
    if (expiringDays) {
      const days = parseInt(expiringDays, 10) || 0;
      where.expiryDate = { lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000) };
      where.status = "ACTIVE";
    }
    if (q) {
      where.OR = [{ batchNo: { contains: q } }, { donorName: { contains: q } }, { supplierName: { contains: q } }];
    }

    const rows = await db.foodBatch.findMany({
      where,
      orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
      take: 500,
      include: { item: { select: { id: true, name: true, unit: true, category: true } } },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/batches — ADMIN goods receipt: every donation/procurement
// becomes a traceable batch. Master item quantity increases only when the
// receipt is recorded (single write path with InventoryTransaction).
router.post("/batches", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const itemId = String(body?.itemId ?? "");
    const batchNo = String(body?.batchNo ?? "").trim();
    const quantity = Number(body?.quantityReceived);
    if (!itemId || !batchNo) throw new ApiError("Inventory item and batch number are required", 400);
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new ApiError("Received quantity must be a positive number", 400);

    const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new ApiError("Inventory item not found", 400);

    const exists = await db.foodBatch.findUnique({
      where: { itemId_batchNo: { itemId, batchNo } },
    });
    if (exists) throw new ApiError(`Batch "${batchNo}" already exists for ${item.name}`, 409);

    const source = String(body?.source ?? "PURCHASED").toUpperCase();
    if (!BATCH_SOURCES.includes(source)) throw new ApiError("Invalid source", 400);
    const temp = body?.tempRequirement ? String(body.tempRequirement).toUpperCase() : null;
    if (temp && !BATCH_TEMP.includes(temp)) throw new ApiError("Invalid temperature requirement", 400);

    const row = await db.$transaction(async (tx) => {
      const batch = await tx.foodBatch.create({
        data: {
          itemId,
          batchNo,
          source,
          donorName: body?.donorName ? String(body.donorName).trim() : null,
          supplierName: body?.supplierName ? String(body.supplierName).trim() : null,
          quantityReceived: quantity,
          mfgDate: body?.mfgDate ? new Date(body.mfgDate) : null,
          expiryDate: body?.expiryDate ? new Date(body.expiryDate) : null,
          storageNotes: body?.storageNotes ? String(body.storageNotes).trim() : null,
          tempRequirement: temp,
          createdByName: session.name,
        },
      });
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { quantity: { increment: quantity } },
      });
      await tx.inventoryTransaction.create({
        data: {
          itemId,
          type: "RECEIVED",
          quantity,
          batchNo,
          expiryDate: batch.expiryDate,
          source,
          refType: "FOOD_BATCH",
          refId: batch.id,
          notes: `Food batch receipt (${source.toLowerCase()}) by ${session.name}`,
          handledByName: session.name,
        },
      });
      return batch;
    });

    await logActivity(session.name, "FOOD_BATCH_RECEIVE", "FoodBatch", `${item.code} / ${batchNo} × ${quantity}`, session.userId);
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/food/batches/:id — ADMIN quality inspection & stock control.
// Rejections/waste move stock out with an InventoryTransaction so the master
// quantity always equals the sum of its batch movements.
router.patch("/batches/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const batch = await db.foodBatch.findUnique({ where: { id }, include: { item: true } });
    if (!batch) throw new ApiError("Food batch not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.storageNotes !== undefined) data.storageNotes = body.storageNotes ? String(body.storageNotes).trim() : null;
    if (body?.tempRequirement !== undefined) data.tempRequirement = body.tempRequirement ? String(body.tempRequirement).toUpperCase() : null;

    if (body?.qualityStatus !== undefined) {
      const quality = String(body.qualityStatus).toUpperCase();
      if (!["PENDING", "PASSED", "QUARANTINED", "REJECTED"].includes(quality))
        throw new ApiError("Invalid quality status", 400);
      assertTransition(FOOD_BATCH_QUALITY_TRANSITIONS, batch.qualityStatus, quality, "food batch quality", 409);
      if (quality === "REJECTED" && !body?.rejectionReason)
        throw new ApiError("A rejection reason is required", 400);
      data.qualityStatus = quality;
      data.inspectedByName = session.name;
      data.inspectedAt = new Date();
      if (body?.rejectionReason !== undefined) data.rejectionReason = body.rejectionReason ? String(body.rejectionReason).trim() : null;
      if (quality === "REJECTED" || quality === "QUARANTINED") {
        data.status = "BLOCKED";
      } else if (quality === "PASSED" && batch.status === "BLOCKED") {
        data.status = availableOf(batch) > 0 ? "ACTIVE" : "DEPLETED";
      }
    }

    if (body?.wasteQty !== undefined) {
      const qty = Number(body.wasteQty);
      if (!Number.isInteger(qty) || qty <= 0) throw new ApiError("Waste quantity must be a positive whole number", 400);
      if (qty > availableOf(batch))
        throw new ApiError(`Only ${availableOf(batch)} unit(s) are free in this batch — ${qty} cannot be written off`, 400);
      if (!body?.wasteReason) throw new ApiError("A waste reason is required", 400);
      data.quantityWasted = { increment: qty };
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.foodBatch.update({ where: { id }, data });

      const wasteQty = body?.wasteQty !== undefined ? Number(body.wasteQty) : 0;
      if (wasteQty > 0) {
        await tx.inventoryItem.update({
          where: { id: batch.itemId },
          data: { quantity: { decrement: wasteQty } },
        });
        await tx.inventoryTransaction.create({
          data: {
            itemId: batch.itemId,
            type: "CONSUMED",
            quantity: -wasteQty,
            batchNo: batch.batchNo,
            expiryDate: batch.expiryDate,
            source: batch.source,
            refType: "FOOD_BATCH",
            refId: batch.id,
            notes: `Waste (${String(body.wasteReason).slice(0, 200)}) by ${session.name}`,
            handledByName: session.name,
          },
        });
      }
      return row;
    });

    await logActivity(
      session.name,
      body?.wasteQty ? "FOOD_BATCH_WASTE" : "FOOD_BATCH_INSPECT",
      "FoodBatch",
      `${batch.batchNo} → ${updated.qualityStatus}${body?.wasteQty ? ` (-${body.wasteQty})` : ""}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

/**
 * POST /api/food/checkin — the distribution desk endpoint.
 *
 * action=lookup  → verify a beneficiary at the venue and check them in.
 *    Resolves by registration code (QR payload UAR-FREG-…), beneficiary code,
 *    or phone (+ optional eventId when scanning from a specific desk).
 * action=checkout → record the actual handover (items, quantities,
 *    acknowledgement). Idempotent: a DISTRIBUTED registration can never be
 *    handed over twice, and offlineRef makes offline sync replay-safe.
 *
 * Roles: ADMIN anywhere; VOLUNTEER only on events they hold a FOOD_EVENT
 * task for — volunteers can never touch unassigned events.
 */
router.post("/checkin", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const body = req.body ?? {};
    const action = String(body?.action ?? "lookup");

    const code = String(body?.code ?? "").trim();
    if (!code) throw new ApiError("Enter a registration code, beneficiary code or phone number", 400);
    const eventId = body?.eventId ? String(body.eventId) : null;
    const offlineRef = body?.offlineRef ? String(body.offlineRef).trim() : null;

    // ── resolve the registration ────────────────────────────────────────────
    let reg: Prisma.FoodRegistrationGetPayload<{ include: { event: true } }> | null = null;
    if (code.toUpperCase().startsWith("UAR-FREG")) {
      reg = await db.foodRegistration.findUnique({
        where: { code: code.toUpperCase() },
        include: { event: true },
      });
      if (reg && eventId && reg.eventId !== eventId)
        throw new ApiError("This registration belongs to a different distribution event", 409);
    }

    if (!reg) {
      const where: Record<string, unknown> = {};
      if (/^UAR-BEN/i.test(code)) where.code = code.toUpperCase();
      else if (/^\d{10}$/.test(code.replace(/\D/g, ""))) where.beneficiary = { phone: { contains: code.replace(/\D/g, "") } };
      else where.beneficiary = { name: { contains: code } };
      if (eventId) where.eventId = eventId;

      const candidates = await db.foodRegistration.findMany({
        where: { ...where, eventId: eventId ?? undefined },
        take: 6,
        orderBy: { createdAt: "desc" },
        include: {
          event: true,
          beneficiary: { select: { code: true, name: true, phone: true } },
        },
      });
      if (candidates.length === 1) reg = candidates[0];
      else if (candidates.length > 1)
        return json(
          res,
          {
            needsDisambiguation: true,
            matches: candidates.map((c) => ({
              registrationId: c.id, code: c.code, status: c.status,
              name: c.beneficiary.name, beneficiaryCode: c.beneficiary.code,
              eventTitle: c.event.title,
            })),
          },
          200
        );
    }

    if (!reg) throw new ApiError("No registration found for that code, ID or phone number", 404);

    // ── role scoping ────────────────────────────────────────────────────────
    if (session.role === "VOLUNTEER") {
      const volunteer = await db.volunteer.findUnique({ where: { userId: session.userId } });
      const assigned = volunteer
        ? await db.volunteerTask.findFirst({
            where: { volunteerId: volunteer.id, refType: "FOOD_EVENT", refId: reg.eventId, status: { not: "CANCELLED" } },
          })
        : null;
      if (!assigned)
        throw new ApiError("You are not assigned to this distribution event", 403);
    }

    const event = reg.event;
    if (!FOOD_OPERATIONAL_STATUSES.includes(event.status))
      throw new ApiError(`Distribution is not operational right now (event is ${event.status})`, 409);

    if (["CANCELLED", "REJECTED", "NO_SHOW"].includes(reg.status))
      throw new ApiError(`This registration is ${reg.status.toLowerCase()} — reinstate it from the admin desk first`, 409);

    if (["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"].includes(reg.status))
      throw new ApiError(
        `Food was already handed over to ${reg.beneficiaryId ? "this beneficiary" : "them"} for ${event.code} — duplicate handover blocked`,
        409
      );

    // Offline replay: same offlineRef returns the same outcome, no double write.
    if (offlineRef) {
      const replay = await db.foodCheckIn.findUnique({ where: { offlineRef } });
      if (replay) {
        const existing = await db.foodRegistration.findUnique({
          where: { id: replay.registrationId },
          include: { beneficiary: { select: { code: true, name: true } } },
        });
        return json(res, { replayed: true, registration: existing }, 200);
      }
    }

    if (action === "lookup") {
      // Idempotent check-in — re-lookup of a CHECKED_IN person is fine.
      const checkedIn = reg.status === "CHECKED_IN";
      if (!checkedIn) {
        assertTransition(FOOD_REGISTRATION_TRANSITIONS, reg.status, "CHECKED_IN", "food registration", 409);
        // Claim the status first in the transaction, so two concurrent scans
        // cannot create duplicate check-in records for the same registration.
        await db.$transaction(async (tx) => {
          const claimed = await tx.foodRegistration.updateMany({
            where: { id: reg.id, status: reg.status },
            data: { status: "CHECKED_IN" },
          });
          if (claimed.count !== 1)
            throw new ApiError("Registration changed while check-in was being processed", 409);
          await tx.foodCheckIn.create({
            data: {
              registrationId: reg.id,
              eventId: reg.eventId,
              method: body?.method ? String(body.method).toUpperCase() : "QR",
              operatorId: session.userId,
              operatorName: session.name,
              offlineRef,
            },
          });
        });
      }

      const fresh = await db.foodRegistration.findUnique({
        where: { id: reg.id },
        include: {
          beneficiary: { select: { code: true, name: true, familyMembers: true, city: true } },
          event: { select: { code: true, title: true, venue: true, packageTemplate: { select: { name: true } } } },
        },
      });
      return json(res, {
        checkedIn: true,
        alreadyCheckedIn: checkedIn,
        registration: fresh,
        packageSnapshot: fresh?.packageSnapshot ? JSON.parse(fresh.packageSnapshot) : null,
      });
    }

    if (action === "checkout") {
      if (reg.status !== "CHECKED_IN")
        throw new ApiError("Check the beneficiary in before recording the handover", 409);

      const units = Math.max(0, Number(body?.unitsDelivered ?? reg.unitsAllocated));
      if (units > reg.unitsAllocated)
        throw new ApiError(`Only ${reg.unitsAllocated} unit(s) were allocated for this registration`, 400);

      const ackMethod = String(body?.ackMethod ?? "DIGITAL").toUpperCase();
      if (!FOOD_ACK_METHODS.includes(ackMethod))
        throw new ApiError("Invalid acknowledgement method", 400);

      const partial = units > 0 && units < reg.unitsAllocated;
      const none = units === 0;
      const targetStatus = none ? "NOT_COLLECTED" : partial ? "PARTIALLY_DISTRIBUTED" : "DISTRIBUTED";
      assertTransition(FOOD_REGISTRATION_TRANSITIONS, reg.status, targetStatus, "food registration", 409);

      const updated = await db.$transaction(async (tx) => {
        const changed = await tx.foodRegistration.updateMany({
          where: { id: reg.id, status: "CHECKED_IN" },
          data: {
            status: targetStatus,
            unitsDelivered: units,
            ackMethod,
            ackByName: body?.ackByName ? String(body.ackByName).trim() : session.name,
            ackRef: body?.ackRef ? String(body.ackRef).trim() : null,
            ackAt: new Date(),
            reason: none ? "BENEFICIARY_DECLINED" : partial ? "PARTIAL_COLLECTION" : null,
          },
        });
        if (changed.count !== 1)
          throw new ApiError("Registration was already handed over or changed", 409);
        return tx.foodRegistration.findUniqueOrThrow({
          where: { id: reg.id },
          include: {
            beneficiary: { select: { code: true, name: true } },
            event: { select: { code: true, title: true } },
          },
        });
      });

      await logActivity(
        session.name,
        "FOOD_HANDOVER",
        "FoodRegistration",
        `${reg.code}: ${units}/${reg.unitsAllocated} unit(s), ack ${ackMethod}`,
        session.userId
      );
      return json(res, { handedOver: true, registration: updated });
    }

    throw new ApiError("action must be lookup or checkout", 400);
  } catch (e) {
    return handleError(e, res);
  }
});

const EVENT_TYPES = [
  "COMMUNITY", "HOME_DELIVERY", "DOOR_TO_DOOR", "KITCHEN", "MEAL_SERVING",
  "MONTHLY_KIT", "EMERGENCY", "INSTITUTION", "SCHOOL", "RURAL", "MOBILE",
];

/** Public-safe event projection — exact address & budget never leave admin. */
export function publicEvent(e: {
  id: string; code: string; title: string; description: string | null;
  eventDate: Date; startTime: string | null; endTime: string | null;
  venue: string; city: string | null; eventType: string; plannedUnits: number;
  maxCapacity: number | null; registrationDeadline: Date | null; registrationOpen: boolean;
  publicVisible: boolean; status: string; specialInstructions: string | null;
  coordinatorName: string | null; coordinatorPhone: string | null;
  programme?: { title: string; slug: string; category: string; eligibilityCriteria: string | null } | null;
  _count?: { registrations: number };
}) {
  return {
    id: e.id, code: e.code, title: e.title, description: e.description,
    eventDate: e.eventDate, startTime: e.startTime, endTime: e.endTime,
    venue: e.venue, city: e.city, eventType: e.eventType,
    plannedUnits: e.plannedUnits, maxCapacity: e.maxCapacity,
    registrationDeadline: e.registrationDeadline, registrationOpen: e.registrationOpen,
    status: e.status, specialInstructions: e.specialInstructions,
    coordinatorName: e.coordinatorName, coordinatorPhone: e.coordinatorPhone,
    programme: e.programme ?? null,
    registeredCount: e._count?.registrations ?? null,
  };
}

// GET /api/food/events            — ADMIN list w/ filters
// GET /api/food/events?public=1   — public list (safe fields only)
// GET /api/food/events?mine=1     — BENEFICIARY: own registrations + open events
router.get("/events", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;

    if (sp.get("public") === "1") {
      const rows = await db.foodEvent.findMany({
        where: {
          publicVisible: true,
          status: { in: FOOD_PUBLIC_EVENT_STATUSES },
        },
        orderBy: { eventDate: "asc" },
        include: {
          programme: { select: { title: true, slug: true, category: true, eligibilityCriteria: true } },
          _count: { select: { registrations: { where: { status: { notIn: ["CANCELLED", "REJECTED"] } } } } },
        },
      });
      return json(res, rows.map(publicEvent));
    }

    const session = await requireRole(req, "ADMIN", "VOLUNTEER", "BENEFICIARY");

    if (sp.get("mine") === "1") {
      const beneficiary = await db.beneficiary.findUnique({ where: { userId: session.userId } });
      if (!beneficiary) return json(res, []);
      const regs = await db.foodRegistration.findMany({
        where: { beneficiaryId: beneficiary.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          event: {
            select: {
              id: true, code: true, title: true, eventDate: true, startTime: true,
              endTime: true, venue: true, city: true, status: true, eventType: true,
              programme: { select: { title: true } },
            },
          },
        },
      });
      return json(res, regs);
    }

    const status = sp.get("status");
    const programmeId = sp.get("programmeId");
    const city = sp.get("city");
    const q = sp.get("q")?.trim();
    const where: Prisma.FoodEventWhereInput = {};
    if (status) where.status = status;
    if (programmeId) where.programmeId = programmeId;
    if (city) where.city = { contains: city };
    if (q) where.OR = [{ title: { contains: q } }, { code: { contains: q } }, { venue: { contains: q } }];

    const rows = await db.foodEvent.findMany({
      where,
      orderBy: { eventDate: "desc" },
      include: {
        programme: { select: { id: true, title: true, category: true } },
        _count: { select: { registrations: true } },
      },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/events — ADMIN create
router.post("/events", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const programmeId = String(body?.programmeId ?? "");
    const programme = await db.foodProgramme.findUnique({ where: { id: programmeId } });
    if (!programme) throw new ApiError("Parent food programme is required", 400);

    const title = String(body?.title ?? "").trim();
    const venue = String(body?.venue ?? "").trim();
    if (!title || !venue) throw new ApiError("Title and venue are required", 400);
    if (!body?.eventDate || isNaN(new Date(body.eventDate).getTime()))
      throw new ApiError("A valid event date is required", 400);

    const eventType = String(body?.eventType ?? "COMMUNITY").toUpperCase();
    if (!EVENT_TYPES.includes(eventType)) throw new ApiError("Invalid event type", 400);

    const campaignId = body?.campaignId ? String(body.campaignId) : null;
    if (campaignId && !(await db.campaign.findUnique({ where: { id: campaignId } })))
      throw new ApiError("Linked campaign was not found", 400);

    const packageTemplateId = body?.packageTemplateId ? String(body.packageTemplateId) : null;
    if (packageTemplateId) {
      const tpl = await db.kitTemplate.findUnique({ where: { id: packageTemplateId } });
      if (!tpl) throw new ApiError("Package template was not found", 400);
    }

    const maxCapacity = Number(body?.maxCapacity) > 0 ? Number(body.maxCapacity) : null;
    const plannedUnits = Math.max(0, Number(body?.plannedUnits) || 0);
    if (maxCapacity && plannedUnits > maxCapacity)
      throw new ApiError("Planned packages exceed the maximum capacity", 400);

    const row = await db.foodEvent.create({
      data: {
        code: await nextFoodEventCode(),
        programmeId,
        campaignId: campaignId ?? programme.campaignId,
        title,
        description: body?.description ? String(body.description).trim() : null,
        eventDate: new Date(body.eventDate),
        startTime: body?.startTime ? String(body.startTime).trim() : null,
        endTime: body?.endTime ? String(body.endTime).trim() : null,
        venue,
        city: body?.city ? String(body.city).trim() : null,
        address: body?.address ? String(body.address).trim() : null,
        eventType,
        packageTemplateId,
        plannedUnits,
        maxCapacity,
        coordinatorName: body?.coordinatorName ? String(body.coordinatorName).trim() : null,
        registrationDeadline: body?.registrationDeadline ? new Date(body.registrationDeadline) : null,
        registrationOpen: body?.registrationOpen !== false,
        publicVisible: body?.publicVisible !== false,
        specialInstructions: body?.specialInstructions ? String(body.specialInstructions).trim() : null,
        budget: Number(body?.budget) > 0 ? Number(body.budget) : null,
        createdByName: session.name,
      },
    });

    await logActivity(session.name, "FOOD_EVENT_CREATE", "FoodEvent", `${row.code} — ${row.title}`, session.userId);
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/food/events/:id — ADMIN event detail: lifecycle, requirements vs
// stock, allocations, registration counts, expenses. The operations brain for
// the events desk.
router.get("/events/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const { id } = req.params;

    const event = await db.foodEvent.findUnique({
      where: { id },
      include: {
        programme: { select: { id: true, code: true, title: true, category: true } },
        campaign: { select: { id: true, title: true } },
        packageTemplate: true,
        registrations: {
          orderBy: { createdAt: "asc" },
          include: {
            beneficiary: { select: { id: true, code: true, name: true, phone: true, city: true, category: true, familyMembers: true } },
            household: { select: { id: true, code: true, name: true, size: true } },
            checkIn: { select: { method: true, checkedInAt: true, operatorName: true } },
          },
        },
        allocations: {
          include: {
            batch: { select: { id: true, batchNo: true, expiryDate: true, qualityStatus: true, source: true } },
            item: { select: { id: true, name: true, unit: true } },
          },
        },
        expenses: { orderBy: { spentAt: "desc" } },
        _count: { select: { registrations: true } },
      },
    });
    if (!event) throw new ApiError("Food event not found", 404);

    const inventory = await db.inventoryItem.findMany({
      where: { category: "FOOD_KIT" },
      select: { id: true, name: true, quantity: true, unit: true },
    });

    const requirements = calcRequirements(
      event.packageTemplate?.items ?? null,
      event.plannedUnits,
      inventory
    );

    // Packing progress from live data — never assumed from approval state.
    const activeRegs = event.registrations.filter((r) => FOOD_ACTIVE_REG_STATUSES.includes(r.status));
    const allocatedUnits = activeRegs.reduce((sum, r) => sum + r.unitsAllocated, 0);
    const issuedUnits = event.allocations
      .filter((a) => a.status === "ISSUED")
      .reduce((sum, a) => sum + a.quantity, 0);
    const reservedUnits = event.allocations
      .filter((a) => a.status === "RESERVED")
      .reduce((sum, a) => sum + a.quantity, 0);
    const distributedUnits = event.registrations.reduce((sum, r) => sum + r.unitsDelivered, 0);

    const expiryAlertDays = await foodWindowDays("food.expiryAlertDays");
    const expiringBatches = await db.foodBatch.findMany({
      where: {
        qualityStatus: "PASSED",
        status: "ACTIVE",
        expiryDate: { lte: new Date(Date.now() + expiryAlertDays * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, batchNo: true, expiryDate: true, itemId: true },
    });

    return json(res, {
      ...event,
      requirements,
      progress: {
        activeRegistrations: activeRegs.length,
        allocatedUnits,
        reservedUnits,
        issuedUnits,
        distributedUnits,
        shortfall: Math.max(0, allocatedUnits - issuedUnits),
        packed: issuedUnits,
      },
      batchAlerts: expiringBatches.filter((b) =>
        event.allocations.some((a) => a.batchId === b.id)
      ),
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/food/events/:id — ADMIN lifecycle transitions + field edits.
// CANCELLED releases every still-RESERVED allocation back to its batch.
router.patch("/events/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const event = await db.foodEvent.findUnique({ where: { id } });
    if (!event) throw new ApiError("Food event not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.title !== undefined) data.title = String(body.title).trim();
    if (body?.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
    if (body?.eventDate !== undefined && body.eventDate) data.eventDate = new Date(body.eventDate);
    if (body?.startTime !== undefined) data.startTime = body.startTime ? String(body.startTime).trim() : null;
    if (body?.endTime !== undefined) data.endTime = body.endTime ? String(body.endTime).trim() : null;
    if (body?.venue !== undefined) data.venue = String(body.venue).trim();
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.address !== undefined) data.address = body.address ? String(body.address).trim() : null;
    if (body?.coordinatorName !== undefined) data.coordinatorName = body.coordinatorName ? String(body.coordinatorName).trim() : null;
    if (body?.registrationDeadline !== undefined) data.registrationDeadline = body.registrationDeadline ? new Date(body.registrationDeadline) : null;
    if (body?.registrationOpen !== undefined) data.registrationOpen = Boolean(body.registrationOpen);
    if (body?.publicVisible !== undefined) data.publicVisible = Boolean(body.publicVisible);
    if (body?.specialInstructions !== undefined) data.specialInstructions = body.specialInstructions ? String(body.specialInstructions).trim() : null;
    if (body?.plannedUnits !== undefined) data.plannedUnits = Math.max(0, Number(body.plannedUnits) || 0);
    if (body?.maxCapacity !== undefined) data.maxCapacity = Number(body.maxCapacity) > 0 ? Number(body.maxCapacity) : null;
    if (body?.budget !== undefined) data.budget = Number(body.budget) > 0 ? Number(body.budget) : null;
    if (body?.packageTemplateId !== undefined) data.packageTemplateId = body.packageTemplateId ? String(body.packageTemplateId) : null;

    if (body?.status !== undefined) {
      const to = String(body.status).toUpperCase();
      assertEventTransition(event.status, to);
      data.status = to;
      data.statusReason = body?.statusReason ? String(body.statusReason).trim() : null;
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.foodEvent.update({ where: { id }, data });

      // Cancellation returns still-reserved stock (issued stock is handled at
      // reconciliation — packages may already be in the field).
      if (data.status === "CANCELLED") {
        const reserved = await tx.foodStockAllocation.findMany({
          where: { eventId: id, status: "RESERVED" },
        });
        for (const a of reserved) {
          await tx.foodStockAllocation.update({
            where: { id: a.id },
            data: { status: "CANCELLED" },
          });
          await tx.foodBatch.update({
            where: { id: a.batchId },
            data: { quantityReserved: { decrement: a.quantity } },
          });
        }
      }

      // Reconciliation: undistributed issued stock goes back to the batches
      // and master inventory (10 issued, 7 delivered → 3 returned). Delivered
      // units are the real handover record — never assumed.
      if (data.status === "RECONCILED") {
        const deliveredAgg = await tx.foodRegistration.aggregate({
          where: { eventId: id, status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
          _sum: { unitsDelivered: true },
        });
        const issued = await tx.foodStockAllocation.findMany({
          where: { eventId: id, status: "ISSUED" },
          orderBy: { createdAt: "asc" },
        });
        const totalIssued = issued.reduce((s, a) => s + a.quantity, 0);
        let undistributed = Math.max(0, totalIssued - (deliveredAgg._sum.unitsDelivered ?? 0));
        for (const a of issued) {
          if (undistributed <= 0) break;
          const back = Math.min(a.quantity, undistributed);
          await returnIssuedAllocation(tx, a.id, back, session.name);
          undistributed -= back;
        }
      }
      return row;
    });

    await logActivity(
      session.name,
      "FOOD_EVENT_UPDATE",
      "FoodEvent",
      `${updated.code} → ${updated.status}${data.statusReason ? ` (${data.statusReason})` : ""}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/food/events/:id/expenses — ADMIN/VOLUNTEER
router.get("/events/:id/expenses", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const rows = await db.foodEventExpense.findMany({
      where: { eventId: id },
      orderBy: { spentAt: "desc" },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/events/:id/expenses — ADMIN record programme spend
router.post("/events/:id/expenses", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const event = await db.foodEvent.findUnique({ where: { id } });
    if (!event) throw new ApiError("Food event not found", 404);

    const head = String(body?.head ?? "").trim();
    const amount = Number(body?.amount);
    if (!head) throw new ApiError("Expense head is required", 400);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("Amount must be greater than zero", 400);

    const row = await db.foodEventExpense.create({
      data: {
        eventId: id,
        head,
        amount,
        notes: body?.notes ? String(body.notes).trim() : null,
        spentByName: session.name,
      },
    });

    await logActivity(session.name, "FOOD_EXPENSE_CREATE", "FoodEventExpense", `${event.code}: ${head} ₹${amount}`, session.userId);
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/food/events/:id/registrations — ADMIN/VOLUNTEER registration list
router.get("/events/:id/registrations", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status");

    const rows = await db.foodRegistration.findMany({
      where: { eventId: id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
      include: {
        beneficiary: { select: { id: true, code: true, name: true, phone: true, city: true, familyMembers: true } },
        household: { select: { id: true, code: true, name: true, size: true } },
        checkIn: { select: { method: true, checkedInAt: true, operatorName: true } },
      },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/events/:id/registrations
//   ADMIN: { beneficiaryIds: string[] } bulk, or { beneficiaryId, unitsAllocated?, householdId?, notes? }
//   BENEFICIARY: {} (self-registration on their own record)
router.post("/events/:id/registrations", async (req, res) => {
  try {
    const session = await validateSession(req);
    if (!session) throw new ApiError("Please sign in to continue", 401);
    const { id } = req.params;
    const body = req.body ?? {};

    const event = await db.foodEvent.findUnique({
      where: { id },
      include: { packageTemplate: true },
    });
    if (!event) throw new ApiError("Food event not found", 404);

    let beneficiaryIds: string[] = [];
    let isAdmin = false;

    if (session.role === "ADMIN") {
      isAdmin = true;
      if (Array.isArray(body?.beneficiaryIds)) beneficiaryIds = body.beneficiaryIds.map(String);
      else if (body?.beneficiaryId) beneficiaryIds = [String(body.beneficiaryId)];
    } else if (session.role === "BENEFICIARY") {
      if (!event.registrationOpen || event.status !== "REGISTRATION_OPEN")
        throw new ApiError("Registration is not open for this distribution", 409);
      const deadlinePassed =
        event.registrationDeadline && new Date(event.registrationDeadline).getTime() < Date.now();
      if (deadlinePassed) throw new ApiError("The registration deadline has passed", 409);
      const own = await db.beneficiary.findUnique({ where: { userId: session.userId } });
      if (!own) throw new ApiError("No beneficiary profile is linked to your account", 400);
      beneficiaryIds = [own.id];
    } else {
      throw new ApiError("You do not have permission for this action", 403);
    }

    if (!beneficiaryIds.length) throw new ApiError("Select at least one beneficiary", 400);

    const units = Math.max(1, Number(body?.unitsAllocated) || 1);
    const householdId = body?.householdId ? String(body.householdId) : null;
    const snapshot = event.packageTemplate
      ? JSON.stringify(parseTemplateItems(event.packageTemplate.items))
      : null;

    // Capacity check against live, non-cancelled registrations.
    if (event.maxCapacity) {
      const activeCount = await db.foodRegistration.count({
        where: { eventId: id, status: { in: FOOD_ACTIVE_REG_STATUSES } },
      });
      if (activeCount + beneficiaryIds.length > event.maxCapacity)
        throw new ApiError(
          `Capacity is ${event.maxCapacity} and ${activeCount} are already registered — increase capacity first`,
          409
        );
    }

    const created: string[] = [];
    await db.$transaction(async (tx) => {
      // tx-aware code generator — the shared nextFoodRegistrationCode() uses
      // the outer db client and can't see rows created earlier in this same
      // transaction, which would collide on the unique code inside the loop.
      let seq = await tx.foodRegistration.count();
      const nextCode = async (): Promise<string> => {
        let code = `UAR-FREG-${String(++seq).padStart(5, "0")}`;
        while (await tx.foodRegistration.findUnique({ where: { code } })) {
          code = `UAR-FREG-${String(++seq).padStart(5, "0")}`;
        }
        return code;
      };

      for (const beneficiaryId of beneficiaryIds) {
        const beneficiary = await tx.beneficiary.findUnique({ where: { id: beneficiaryId } });
        if (!beneficiary) throw new ApiError(`Beneficiary not found (${beneficiaryId})`, 400);

        const dupe = await tx.foodRegistration.findUnique({
          where: { eventId_beneficiaryId: { eventId: id, beneficiaryId } },
        });
        if (dupe) {
          if (["CANCELLED", "REJECTED"].includes(dupe.status)) {
            // reinstate a cancelled row instead of failing the whole batch
            await tx.foodRegistration.update({
              where: { id: dupe.id },
              data: { status: "REGISTERED", reason: null, unitsAllocated: units },
            });
            created.push(dupe.code);
            continue;
          }
          throw new ApiError(`${beneficiary.name} already has a ${dupe.status} registration for this event`, 409);
        }

        const reg = await tx.foodRegistration.create({
          data: {
            code: await nextCode(),
            eventId: id,
            beneficiaryId,
            householdId,
            unitsAllocated: units,
            packageSnapshot: snapshot,
            status: isAdmin ? "REGISTERED" : "APPROVED", // self-service lands pre-approved for own profile
            registeredVia: isAdmin ? (beneficiaryIds.length > 1 ? "BULK" : "DESK") : "SELF",
            notes: body?.notes ? String(body.notes).trim() : null,
            createdByName: session!.name,
          },
        });
        created.push(reg.code);
      }
    });

    await logActivity(
      session.name,
      "FOOD_REGISTRATION_CREATE",
      "FoodEvent",
      `${event.code}: ${created.length} registration(s)`,
      session.userId
    );
    return json(res, { created }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// Roles are stored in VolunteerTask.description (free-text column, but the
// distribution desk enforces this set on write).
const VOLUNTEER_ROLES = ["PACKING", "QUEUE", "SERVING", "DELIVERY", "COORDINATION"];

const taskInclude = {
  volunteer: {
    select: {
      id: true,
      code: true,
      user: { select: { name: true, phone: true, email: true } },
    },
  },
} as const;

// GET /api/food/events/:id/volunteers              (ADMIN | VOLUNTEER)
//   → VolunteerTask rows linked to this event (refType FOOD_EVENT),
//     each with the volunteer's code + user name/phone/email.
// GET /api/food/events/:id/volunteers?available=1  (ADMIN)
//   → ACTIVE volunteers not yet assigned to this event (assign dropdown).
router.get("/events/:id/volunteers", async (req, res) => {
  try {
    const { id } = req.params;
    const sp = new URL(req.url, "http://localhost").searchParams;

    if (sp.get("available") === "1") {
      await requireRole(req, "ADMIN");
      const assigned = await db.volunteerTask.findMany({
        where: { refType: "FOOD_EVENT", refId: id, status: { not: "CANCELLED" } },
        select: { volunteerId: true },
      });
      const rows = await db.volunteer.findMany({
        where: { status: "ACTIVE", id: { notIn: assigned.map((a) => a.volunteerId) } },
        orderBy: { code: "asc" },
        select: { id: true, code: true, user: { select: { name: true, phone: true } } },
      });
      return json(
        res,
        rows.map((v) => ({ id: v.id, code: v.code, name: v.user.name, phone: v.user.phone }))
      );
    }

    await requireRole(req, "ADMIN", "VOLUNTEER");
    const event = await db.foodEvent.findUnique({ where: { id } });
    if (!event) throw new ApiError("Food event not found", 404);

    const tasks = await db.volunteerTask.findMany({
      where: { refType: "FOOD_EVENT", refId: id },
      orderBy: { scheduledDate: "desc" },
      include: taskInclude,
    });
    return json(res, tasks);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/events/:id/volunteers (ADMIN) — { volunteerId, role, notes? }
// Creates a MANUAL VolunteerTask that links the volunteer to this event, which
// is what /api/food/checkin uses to scope volunteers to events.
router.post("/events/:id/volunteers", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    const event = await db.foodEvent.findUnique({ where: { id } });
    if (!event) throw new ApiError("Food event not found", 404);

    const volunteerId = String(body?.volunteerId ?? "");
    const volunteer = await db.volunteer.findUnique({
      where: { id: volunteerId },
      include: { user: { select: { name: true } } },
    });
    if (!volunteer) throw new ApiError("Volunteer not found", 404);
    if (volunteer.status !== "ACTIVE")
      throw new ApiError("Only ACTIVE volunteers can be assigned to an event", 400);

    const role = String(body?.role ?? "").trim().toUpperCase();
    if (!VOLUNTEER_ROLES.includes(role))
      throw new ApiError(`Role must be one of: ${VOLUNTEER_ROLES.join(", ")}`, 400);

    const dupe = await db.volunteerTask.findFirst({
      where: { volunteerId, refType: "FOOD_EVENT", refId: id, status: { not: "CANCELLED" } },
    });
    if (dupe) throw new ApiError(`${volunteer.user.name} is already assigned to this event`, 409);

    const task = await db.volunteerTask.create({
      data: {
        volunteerId,
        title: `Food event: ${event.title}`,
        description: role,
        type: "DISTRIBUTION",
        location: event.venue,
        scheduledDate: event.eventDate,
        refType: "FOOD_EVENT",
        refId: id,
        status: "ASSIGNED",
        createdFrom: "MANUAL",
        notes: body?.notes ? String(body.notes).trim() : null,
      },
      include: taskInclude,
    });

    await logActivity(
      session.name,
      "FOOD_VOLUNTEER_ASSIGN",
      "VolunteerTask",
      `${event.code}: ${volunteer.user.name} → ${role}`,
      session.userId
    );
    return json(res, task, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/food/events/:id/volunteers?taskId= (ADMIN) — soft-cancel the
// assignment, only when the task actually belongs to this event.
router.delete("/events/:id/volunteers", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const taskId = new URL(req.url, "http://localhost").searchParams.get("taskId");
    if (!taskId) throw new ApiError("taskId query parameter is required", 400);

    const task = await db.volunteerTask.findUnique({
      where: { id: taskId },
      include: { volunteer: { select: { code: true, user: { select: { name: true } } } } },
    });
    if (!task || task.refType !== "FOOD_EVENT" || task.refId !== id)
      throw new ApiError("Assignment not found for this event", 404);

    if (task.status !== "CANCELLED") {
      await db.volunteerTask.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
      await logActivity(
        session.name,
        "FOOD_VOLUNTEER_REMOVE",
        "VolunteerTask",
        `${task.title}: ${task.volunteer.user.name} removed`,
        session.userId
      );
    }
    return json(res, { ok: true, id: taskId, status: "CANCELLED" });
  } catch (e) {
    return handleError(e, res);
  }
});

/**
 * POST /api/food/events/:id/walkin — emergency walk-in at the distribution
 * desk. Creates the persistent UAR beneficiary identity AND the event
 * registration in one transaction, so nobody is ever turned away because
 * "they're not in the system". A checked-in-and-ready status lets the desk
 * hand over immediately.
 *
 * Roles: ADMIN anywhere; VOLUNTEER only on events they hold a FOOD_EVENT
 * task for (same rule as /api/food/checkin).
 */
router.post("/events/:id/walkin", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = req.body ?? {};

    const name = String(body?.name ?? "").trim();
    if (!name || name.length < 3) throw new ApiError("Walk-in name is required", 400);
    const phoneRaw = body?.phone ? String(body.phone).replace(/[\s-]/g, "") : "";
    // Phone optional for walk-ins (homeless beneficiaries may not have one),
    // but when given it must be a real 10-digit Indian mobile number.
    if (phoneRaw && !/^(\+91)?[6-9]\d{9}$/.test(phoneRaw))
      throw new ApiError("Enter a valid Indian mobile number (or leave it blank)", 400);
    const units = Math.max(1, Number(body?.unitsAllocated) || 1);
    const householdSize = Math.max(1, Number(body?.householdSize) || 1);

    const event = await db.foodEvent.findUnique({
      where: { id },
      include: { packageTemplate: true },
    });
    if (!event) throw new ApiError("Food event not found", 404);
    if (!["READY", "IN_PROGRESS", "PACKAGES_PREPARED", "STOCK_ALLOCATED"].includes(event.status))
      throw new ApiError(`Walk-ins are only possible while distribution is operational (event is ${event.status})`, 409);

    if (session.role === "VOLUNTEER") {
      const volunteer = await db.volunteer.findUnique({ where: { userId: session.userId } });
      const assigned = volunteer
        ? await db.volunteerTask.findFirst({
            where: { volunteerId: volunteer.id, refType: "FOOD_EVENT", refId: id },
          })
        : null;
      if (!assigned) throw new ApiError("You are not assigned to this distribution event", 403);
    }

    if (event.maxCapacity) {
      const active = await db.foodRegistration.count({
        where: { eventId: id, status: { in: FOOD_ACTIVE_REG_STATUSES } },
      });
      if (active + 1 > event.maxCapacity)
        throw new ApiError(`Event capacity (${event.maxCapacity}) is full`, 409);
    }

    // Duplicate identity guard (§8 — never create duplicate beneficiaries):
    // 1. same phone already registered for THIS event → return that registration;
    // 2. same phone exists as a beneficiary from any earlier programme → reuse
    //    that identity and register it for this event.
    let beneficiary = null as Awaited<ReturnType<typeof db.beneficiary.findFirst>> | null;
    if (phoneRaw) {
      const existingReg = await db.foodRegistration.findFirst({
        where: { eventId: id, beneficiary: { phone: { contains: phoneRaw.slice(-10) } } },
        include: { beneficiary: { select: { code: true, name: true } } },
      });
      if (existingReg)
        return json(
          res,
          {
            existing: true,
            registration: existingReg,
            message: `${existingReg.beneficiary.name} is already registered (${existingReg.code}) — check them in instead.`,
          },
          200
        );
      beneficiary = await db.beneficiary.findFirst({
        where: { phone: { contains: phoneRaw.slice(-10) } },
        orderBy: { createdAt: "asc" },
      });
    }

    const result = await db.$transaction(async (tx) => {
      if (!beneficiary) {
        beneficiary = await tx.beneficiary.create({
          data: {
            code: await (async () => {
              let n = await tx.beneficiary.count();
              let code = `UAR-BEN-${String(n + 1).padStart(5, "0")}`;
              while (await tx.beneficiary.findUnique({ where: { code } })) {
                n += 1;
                code = `UAR-BEN-${String(n + 1).padStart(5, "0")}`;
              }
              return code;
            })(),
            name,
            phone: phoneRaw || null,
            city: event.city,
            category: "POOR_FAMILY",
            urgencyLevel: "MEDIUM",
            familyMembers: householdSize,
            needs: `Walk-in at ${event.code} — ${event.title}`,
            caseStatus: "INTAKE",
            onboardedByName: session.name,
            intakeDate: new Date(),
          },
        });
      } else if (name && !beneficiary.name) {
        await tx.beneficiary.update({ where: { id: beneficiary.id }, data: { name } });
        beneficiary = { ...beneficiary, name };
      }

      let seq = await tx.foodRegistration.count();
      let regCode = `UAR-FREG-${String(seq + 1).padStart(5, "0")}`;
      while (await tx.foodRegistration.findUnique({ where: { code: regCode } })) {
        seq += 1;
        regCode = `UAR-FREG-${String(seq + 1).padStart(5, "0")}`;
      }

      const registration = await tx.foodRegistration.create({
        data: {
          code: regCode,
          eventId: id,
          beneficiaryId: beneficiary.id,
          unitsAllocated: units,
          packageSnapshot: event.packageTemplate
            ? JSON.stringify(parseTemplateItems(event.packageTemplate.items))
            : null,
          status: "APPROVED", // walk-ins land pre-approved — the desk verifies in person
          registeredVia: "ASSISTED",
          notes: `Walk-in registered by ${session.name}`,
          createdByName: session.name,
        },
      });
      return { beneficiary, registration };
    });

    await logActivity(
      session.name,
      "FOOD_WALKIN_REGISTER",
      "FoodRegistration",
      `${event.code}: ${result.beneficiary.code} → ${result.registration.code}`,
      session.userId
    );
    return json(
      res,
      {
        beneficiary: { id: result.beneficiary.id, code: result.beneficiary.code, name: result.beneficiary.name },
        registration: result.registration,
      },
      201
    );
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/food/households?q — ADMIN household registry
router.get("/households", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const q = sp.get("q")?.trim();
    const where: Record<string, unknown> = q
      ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { primaryPhone: { contains: q } }, { city: { contains: q } }] }
      : {};

    const rows = await db.household.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        headBeneficiary: { select: { id: true, code: true, name: true } },
        members: true,
        _count: { select: { registrations: true } },
      },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/households — ADMIN create household + members
router.post("/households", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const name = String(body?.name ?? "").trim();
    if (!name) throw new ApiError("Household name is required", 400);
    const size = Number(body?.size);
    if (!Number.isInteger(size) || size < 1) throw new ApiError("Household size must be a positive whole number", 400);
    if (body?.pincode && !validPin(String(body.pincode)))
      throw new ApiError("PIN code must look like 560001", 400);

    const headBeneficiaryId = body?.headBeneficiaryId ? String(body.headBeneficiaryId) : null;
    if (headBeneficiaryId && !(await db.beneficiary.findUnique({ where: { id: headBeneficiaryId } })))
      throw new ApiError("Head beneficiary not found", 400);

    const members = Array.isArray(body?.members) ? body.members : [];
    const row = await db.$transaction(async (tx) => {
      const household = await tx.household.create({
        data: {
          code: await nextHouseholdCode(),
          name,
          headBeneficiaryId,
          primaryPhone: body?.primaryPhone ? String(body.primaryPhone).trim() : null,
          address: body?.address ? String(body.address).trim() : null,
          city: body?.city ? String(body.city).trim() : null,
          pincode: body?.pincode ? String(body.pincode).trim() : null,
          size,
          childrenCount: Math.max(0, Number(body?.childrenCount) || 0),
          seniorCount: Math.max(0, Number(body?.seniorCount) || 0),
          incomeRange: body?.incomeRange ? String(body.incomeRange).trim() : null,
          notes: body?.notes ? String(body.notes).trim() : null,
          createdByName: session.name,
        },
      });
      for (const m of members) {
        const mName = String(m?.name ?? "").trim();
        if (!mName) continue;
        await tx.householdMember.create({
          data: {
            householdId: household.id,
            beneficiaryId: m?.beneficiaryId ? String(m.beneficiaryId) : null,
            name: mName,
            age: Number(m?.age) > 0 ? Number(m.age) : null,
            relation: m?.relation ? String(m.relation).toUpperCase() : null,
          },
        });
      }
      return household;
    });

    await logActivity(session.name, "HOUSEHOLD_CREATE", "Household", `${row.code} — ${row.name}`, session.userId);
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/food/households/:id — ADMIN edit / add / remove members
router.patch("/households/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const household = await db.household.findUnique({ where: { id } });
    if (!household) throw new ApiError("Household not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.name !== undefined) data.name = String(body.name).trim();
    if (body?.primaryPhone !== undefined) data.primaryPhone = body.primaryPhone ? String(body.primaryPhone).trim() : null;
    if (body?.address !== undefined) data.address = body.address ? String(body.address).trim() : null;
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.pincode !== undefined) data.pincode = body.pincode ? String(body.pincode).trim() : null;
    if (body?.size !== undefined) {
      const size = Number(body.size);
      if (!Number.isInteger(size) || size < 1) throw new ApiError("Household size must be a positive whole number", 400);
      data.size = size;
    }
    if (body?.childrenCount !== undefined) data.childrenCount = Math.max(0, Number(body.childrenCount) || 0);
    if (body?.seniorCount !== undefined) data.seniorCount = Math.max(0, Number(body.seniorCount) || 0);
    if (body?.incomeRange !== undefined) data.incomeRange = body.incomeRange ? String(body.incomeRange).trim() : null;
    if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;
    if (body?.headBeneficiaryId !== undefined) data.headBeneficiaryId = body.headBeneficiaryId ? String(body.headBeneficiaryId) : null;

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.household.update({ where: { id }, data });

      if (Array.isArray(body?.addMembers)) {
        for (const m of body.addMembers) {
          const mName = String(m?.name ?? "").trim();
          if (!mName) continue;
          await tx.householdMember.create({
            data: {
              householdId: id,
              beneficiaryId: m?.beneficiaryId ? String(m.beneficiaryId) : null,
              name: mName,
              age: Number(m?.age) > 0 ? Number(m.age) : null,
              relation: m?.relation ? String(m.relation).toUpperCase() : null,
            },
          });
        }
      }
      if (Array.isArray(body?.removeMemberIds)) {
        await tx.householdMember.deleteMany({ where: { id: { in: body.removeMemberIds.map(String) }, householdId: id } });
      }
      return row;
    });

    await logActivity(session.name, "HOUSEHOLD_UPDATE", "Household", updated.code, session.userId);
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/food/households/:id — ADMIN (only when no registrations exist)
router.delete("/households/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const household = await db.household.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });
    if (!household) throw new ApiError("Household not found", 404);
    if (household._count.registrations > 0)
      throw new ApiError("This household has assistance registrations — archive it with a note instead of deleting", 409);

    await db.household.delete({ where: { id } });
    await logActivity(session.name, "HOUSEHOLD_DELETE", "Household", household.code, session.userId);
    return json(res, { deleted: true });
  } catch (e) {
    return handleError(e, res);
  }
});

/**
 * AI Food Security insights — ADMIN-only, advisory-only.
 * Follows the health-ai governance contract: every run writes a PENDING
 * AIInteraction with minimised digests; the assistant never approves
 * beneficiaries, moves stock, spends money or publishes anything. When the
 * AI provider is unavailable the endpoint fails 503 and writes nothing.
 *
 * modes:
 *  plan      — package/stock/volunteer/cost suggestion for one upcoming event
 *  forecast  — demand estimate from historical distribution data
 *  analytics — natural-language answer over authorised food aggregates
 *  waste     — expiring/excess stock redistribution suggestions
 */

function digest(label: string, content: unknown): string {
  return `${label}: ${String(content ?? "").length} chars`;
}

async function askAI(system: string, user: string): Promise<string> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text =
    (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("empty AI response");
  return text.trim();
}

async function storeInteraction(action: string, promptDigest: string, output: string, entityId?: string) {
  await db.aIInteraction.create({
    data: {
      action,
      entityType: "FoodEvent",
      entityId: entityId ?? null,
      promptDigest,
      outputDigest: digest("output", output),
      status: "PENDING",
    },
  });
}

async function eventContext(eventId: string) {
  const event = await db.foodEvent.findUnique({
    where: { id: eventId },
    include: {
      programme: { select: { title: true, category: true } },
      packageTemplate: { select: { name: true, items: true } },
      registrations: { select: { status: true, unitsAllocated: true } },
      allocations: { select: { status: true, quantity: true } },
      expenses: { select: { head: true, amount: true } },
    },
  });
  if (!event) throw new ApiError("Food event not found", 404);
  const inventory = await db.inventoryItem.findMany({ where: { category: "FOOD_KIT" } });
  return { event, inventory };
}

// POST /api/food/insights { mode, eventId?, question? }
router.post("/insights", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};
    const mode = String(body?.mode ?? "analytics");

    const GUARD =
      "You are the UAR Food Security assistant. You advise staff; you NEVER approve beneficiaries, change inventory, move money or publish content. Use only the supplied data, state assumptions, and be concise. Do not reveal any beneficiary personal details.";

    if (mode === "plan") {
      const eventId = String(body?.eventId ?? "");
      const { event, inventory } = await eventContext(eventId);
      const activeRegs = event.registrations.filter((r) => !["CANCELLED", "REJECTED"].includes(r.status));
      const data = {
        event: { code: event.code, title: event.title, type: event.eventType, plannedUnits: event.plannedUnits, status: event.status },
        programme: event.programme,
        template: event.packageTemplate?.name ?? null,
        templateItems: event.packageTemplate?.items ?? null,
        registrations: { active: activeRegs.length, allocatedUnits: activeRegs.reduce((s, r) => s + r.unitsAllocated, 0) },
        stock: inventory.map((i) => ({ name: i.name, unit: i.unit, quantity: i.quantity, minStock: i.minStock, expiryDate: i.expiryDate })),
        expenses: event.expenses,
        budget: event.budget,
      };
      const output = await askAI(
        GUARD,
        `Plan this food distribution event. Data:\n${JSON.stringify(data)}\n\nSuggest: packages to prepare, ingredient/stock requirements vs availability (flag shortfalls), volunteer numbers by role, estimated cost, and risks. State every assumption.`
      );
      await storeInteraction("FOOD_PLAN", digest("event", event.code), output, eventId);
      return json(res, { output });
    }

    if (mode === "forecast") {
      const [byMonth, byCity, topItems, pendingApps] = await Promise.all([
        db.foodRegistration.groupBy({
          by: ["status"],
          _count: { _all: true },
          _sum: { unitsDelivered: true },
        }),
        db.foodEvent.groupBy({ by: ["city"], _count: { _all: true }, where: { city: { not: null } } }),
        db.inventoryItem.findMany({ where: { category: "FOOD_KIT" }, select: { name: true, quantity: true, minStock: true } }),
        db.beneficiaryRequest.count({ where: { category: "FOOD_ASSISTANCE", status: { in: ["PENDING", "IN_REVIEW"] } } }),
      ]);
      const recentEvents = await db.foodEvent.findMany({
        orderBy: { eventDate: "desc" },
        take: 20,
        select: { eventDate: true, eventType: true, plannedUnits: true, city: true, status: true, _count: { select: { registrations: true } } },
      });
      const data = { byMonth, byCity, stock: topItems, pendingApps, recentEvents };
      const output = await askAI(
        GUARD,
        `Forecast food demand for the next 4-8 weeks. Data:\n${JSON.stringify(data)}\n\nGive: expected demand ranges by area, stock items likely to run short, and seasonality notes. State confidence and assumptions. This is advisory only.`
      );
      await storeInteraction("FOOD_FORECAST", digest("aggregates", data), output);
      return json(res, { output });
    }

    if (mode === "analytics") {
      const question = String(body?.question ?? "").trim();
      if (!question || question.length < 5) throw new ApiError("Ask a question first", 400);

      const [families, individuals, kits, meals, noShows, eventsByStatus, topDonors, expensesByHead, appsByCity] =
        await Promise.all([
          db.foodRegistration.findMany({ where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] }, householdId: { not: null } }, distinct: ["householdId"], select: { householdId: true } }),
          db.foodRegistration.findMany({ where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } }, distinct: ["beneficiaryId"], select: { beneficiaryId: true } }),
          db.foodRegistration.aggregate({ where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } }, _sum: { unitsDelivered: true } }),
          db.foodEvent.findMany({ where: { eventType: { in: ["MEAL_SERVING", "KITCHEN"] } }, select: { id: true } }),
          db.foodRegistration.count({ where: { status: "NO_SHOW" } }),
          db.foodEvent.groupBy({ by: ["status"], _count: { _all: true } }),
          db.donation.findMany({ where: { category: "FOOD_DISTRIBUTION", paymentStatus: "COMPLETED" }, orderBy: { amount: "desc" }, take: 10, select: { donorName: true, amount: true, isAnonymous: true } }),
          db.foodEventExpense.groupBy({ by: ["head"], _sum: { amount: true } }),
          db.beneficiaryRequest.findMany({ where: { category: "FOOD_ASSISTANCE" }, select: { city: true, status: true } }),
        ]);
      const mealEventIds = new Set(meals.map((e) => e.id));
      const mealSums = await db.foodRegistration.aggregate({
        where: { eventId: { in: Array.from(mealEventIds) }, status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
        _sum: { unitsDelivered: true },
      });
      const data = {
        familiesSupported: families.length,
        individualsReached: individuals.length,
        kitsDistributed: kits._sum.unitsDelivered ?? 0,
        mealsServed: mealSums._sum.unitsDelivered ?? 0,
        noShows,
        eventsByStatus,
        topFoodDonors: topDonors.map((d) => ({ name: d.isAnonymous ? "Anonymous" : d.donorName, amount: d.amount })),
        expensesByHead,
        applicationsByCity: appsByCity,
      };
      const output = await askAI(
        GUARD,
        `Answer this question using ONLY the data below. Include the reporting period (all time) and define metrics you use.\n\nQuestion: ${question}\n\nData:\n${JSON.stringify(data)}`
      );
      await storeInteraction("FOOD_ANALYTICS", digest("question", question), output);
      return json(res, { output });
    }

    if (mode === "waste") {
      const batches = await db.foodBatch.findMany({
        where: { status: "ACTIVE" },
        include: { item: { select: { name: true, unit: true } } },
      });
      const riskWindowDays = await foodWindowDays("food.aiRiskWindowDays");
      const atRisk = batches
        .filter((b) => availableOf(b) > 0 && b.expiryDate && b.expiryDate.getTime() < Date.now() + riskWindowDays * 86400000)
        .map((b) => ({ item: b.item.name, batchNo: b.batchNo, free: availableOf(b), unit: b.item.unit, expiryDate: b.expiryDate, qualityStatus: b.qualityStatus }));
      const cancelled = await db.foodEvent.findMany({
        where: { status: { in: ["CANCELLED", "POSTPONED", "SUSPENDED"] } },
        select: { code: true, title: true, eventDate: true },
        take: 10,
      });
      const output = await askAI(
        GUARD,
        `Suggest how to prevent food waste. At-risk stock (expiring within ${riskWindowDays} days, free quantity):\n${JSON.stringify(atRisk)}\n\nCancelled/postponed events:\n${JSON.stringify(cancelled)}\n\nRecommend which upcoming distributions or programmes each batch could be redirected to, in priority order. NEVER suggest distributing expired, quarantined or rejected stock — exclude anything not PASSED and unexpired.`
      );
      await storeInteraction("FOOD_WASTE", digest("atRisk", atRisk), output);
      return json(res, { output });
    }

    throw new ApiError("mode must be plan, forecast, analytics or waste", 400);
  } catch (e) {
    if (e instanceof ApiError) return handleError(e, res);
    // AI provider unavailable — fail loudly, log nothing sensitive.
    log.warn("ai_unavailable", { error: e instanceof Error ? e.message : String(e) });
    return json(res, { error: "AI assistant is unavailable right now — please try again later" }, 503);
  }
});

const PLEDGE_PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const PLEDGE_PIN_RE = /^[1-9][0-9]{5}$/;

async function nextPledgeCode(): Promise<string> {
  return db.foodDonationPledge.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-FDP",
      seed: n + 1,
      exists: (c) => db.foodDonationPledge.findUnique({ where: { code: c } }).then(Boolean),
    })
  );
}

// GET /api/food/pledges           — ADMIN pickups desk
// GET /api/food/pledges?mine=1    — signed-in donor's own pledges
router.get("/pledges", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    if (sp.get("mine") === "1") {
      const s = await requireRole(req, "DONOR", "ADMIN", "VOLUNTEER");
      const rows = await db.foodDonationPledge.findMany({
        where: { userId: s.userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return json(res, rows);
    }
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const status = sp.get("status");
    const rows = await db.foodDonationPledge.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/pledges — PUBLIC food/grocery donation pledge with pickup.
router.post("/pledges", async (req, res) => {
  try {
    // Express headers are a plain record — the shared limiter expects fetch Headers.
    await enforceFoodRateLimit(new Headers(req.headers as Record<string, string>), "pledges", "food.pledges.rateLimitPerHour");

    const body = req.body ?? {};
    const session = await validateSession(req);

    const donorName = String(body?.donorName ?? "").trim();
    const phoneRaw = String(body?.phone ?? "").trim();
    const items = String(body?.items ?? "").trim();
    const pickupAddress = String(body?.pickupAddress ?? "").trim();
    if (!donorName || !items || !pickupAddress)
      throw new ApiError("Name, what you're donating and the pickup address are required", 400);
    if (!phoneRaw || !PLEDGE_PHONE_RE.test(phoneRaw.replace(/[\s-]/g, "")))
      throw new ApiError("Please enter a valid Indian mobile number", 400);
    if (body?.pincode && !PLEDGE_PIN_RE.test(String(body.pincode).trim()))
      throw new ApiError("PIN code must look like 560001", 400);

    const phone = phoneRaw.replace(/[\s-]/g, "");

    // Double-submit guard (beyond the rate limiter): the same phone posting a
    // PENDING pledge with an identical items text in the last 60 seconds is a
    // double-tap/duplicate submit — reject it instead of creating a row.
    const duplicate = await db.foodDonationPledge.findFirst({
      where: {
        phone,
        status: "PENDING",
        items,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      select: { code: true },
    });
    if (duplicate) throw new ApiError("You just submitted this pledge", 409);

    const row = await db.foodDonationPledge.create({
      data: {
        code: await nextPledgeCode(),
        userId: session?.userId ?? null,
        donorName,
        phone,
        email: body?.email ? String(body.email).trim() : null,
        orgName: body?.orgName ? String(body.orgName).trim() : null,
        items,
        pickupAddress,
        city: body?.city ? String(body.city).trim() : null,
        pincode: body?.pincode ? String(body.pincode).trim() : null,
        availability: body?.availability ? String(body.availability).trim() : null,
        storageNotes: body?.storageNotes ? String(body.storageNotes).trim() : null,
        createdByName: session?.name ?? donorName,
      },
    });

    await db.notification.create({
      data: {
        title: "New food donation pledge",
        message: `${donorName.split(" ")[0]} pledged groceries/supplies — reference ${row.code}. Schedule a pickup.`,
        type: "DISTRIBUTION",
        actionUrl: "/admin/food",
      },
    });
    await logActivity(donorName, "FOOD_PLEDGE_CREATE", "FoodDonationPledge", row.code, session?.userId);

    return json(res, { code: row.code, message: "Thank you! Our logistics team will call to schedule the pickup." }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

async function transitionPledge(
  id: string,
  from: string,
  to: string,
  extraData: Prisma.FoodDonationPledgeUpdateManyMutationInput = {}
) {
  const changed = await db.foodDonationPledge.updateMany({
    where: { id, status: from },
    data: { ...extraData, status: to },
  });
  if (changed.count !== 1)
    throw new ApiError("Donation pledge changed while this action was being processed", 409);
  return db.foodDonationPledge.findUniqueOrThrow({ where: { id } });
}

/**
 * PATCH /api/food/pledges/:id — the pickups desk workflow.
 *  schedule  → { status: SCHEDULED, scheduledFor, assignedToName }
 *  collect   → { status: COLLECTED }            (picked up, in transit)
 *  receive   → { status: RECEIVED, itemId, batchNo, quantityReceived,
 *                expiryDate?, source? }          → creates the FoodBatch +
 *                master stock + InventoryTransaction (same write path as a
 *                manual goods receipt — no duplicate business logic).
 *  reject/cancel → reason required.
 */
router.patch("/pledges/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const pledge = await db.foodDonationPledge.findUnique({ where: { id } });
    if (!pledge) throw new ApiError("Donation pledge not found", 404);

    const action = String(body?.action ?? "").toUpperCase();

    if (action === "SCHEDULE") {
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, "SCHEDULED", "food donation pledge");
      const scheduledFor = body?.scheduledFor ? new Date(body.scheduledFor) : null;
      if (!scheduledFor || isNaN(scheduledFor.getTime()))
        throw new ApiError("A pickup date/time is required", 400);
      const updated = await transitionPledge(id, pledge.status, "SCHEDULED", {
        scheduledFor,
        assignedToName: body?.assignedToName ? String(body.assignedToName).trim() : session.name,
      });
      await logActivity(session.name, "FOOD_PLEDGE_SCHEDULE", "FoodDonationPledge", `${pledge.code} → pickup ${scheduledFor.toISOString()}`, session.userId);
      return json(res, updated);
    }

    if (action === "COLLECT") {
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, "COLLECTED", "food donation pledge");
      const updated = await transitionPledge(id, pledge.status, "COLLECTED");
      await logActivity(session.name, "FOOD_PLEDGE_COLLECT", "FoodDonationPledge", pledge.code, session.userId);
      return json(res, updated);
    }

    if (action === "RECEIVE") {
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, "RECEIVED", "food donation pledge");
      const itemId = String(body?.itemId ?? "");
      const batchNo = String(body?.batchNo ?? "").trim();
      const quantity = Number(body?.quantityReceived);
      if (!itemId || !batchNo)
        throw new ApiError("Choose the inventory item and enter a batch number", 400);
      if (!Number.isFinite(quantity) || quantity <= 0)
        throw new ApiError("Received quantity must be a positive number", 400);

      const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item) throw new ApiError("Inventory item not found", 400);
      const exists = await db.foodBatch.findUnique({ where: { itemId_batchNo: { itemId, batchNo } } });
      if (exists) throw new ApiError(`Batch "${batchNo}" already exists for ${item.name}`, 409);

      const source = String(body?.source ?? "DONATED").toUpperCase();
      const updated = await db.$transaction(async (tx) => {
        const claimed = await tx.foodDonationPledge.updateMany({
          where: { id, status: pledge.status },
          data: {
            status: "RECEIVED",
            receivedBatchNo: batchNo,
            notes: body?.notes ? String(body.notes).trim() : pledge.notes,
          },
        });
        if (claimed.count !== 1)
          throw new ApiError("Donation pledge changed while this receipt was being processed", 409);

        const batch = await tx.foodBatch.create({
          data: {
            itemId,
            batchNo,
            source: ["DONATED", "RECOVERED", "CSR", "PARTNER"].includes(source) ? source : "DONATED",
            donorName: pledge.orgName ?? pledge.donorName,
            quantityReceived: quantity,
            expiryDate: body?.expiryDate ? new Date(body.expiryDate) : null,
            storageNotes: pledge.storageNotes,
            createdByName: session.name,
          },
        });
        await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: { increment: quantity } } });
        await tx.inventoryTransaction.create({
          data: {
            itemId,
            type: "RECEIVED",
            quantity,
            batchNo,
            expiryDate: batch.expiryDate,
            source: batch.source,
            refType: "FOOD_PLEDGE",
            refId: pledge.id,
            notes: `Received from food donation pledge ${pledge.code} by ${session.name}`,
            handledByName: session.name,
          },
        });
        return tx.foodDonationPledge.findUniqueOrThrow({ where: { id } });
      });
      await logActivity(session.name, "FOOD_PLEDGE_RECEIVE", "FoodDonationPledge", `${pledge.code} → batch ${batchNo} (${quantity})`, session.userId);
      return json(res, updated);
    }

    if (action === "REJECT" || action === "CANCEL") {
      const reason = String(body?.reason ?? "").trim();
      if (!reason) throw new ApiError("A reason is required", 400);
      const status = action === "REJECT" ? "REJECTED" : "CANCELLED";
      assertTransition(FOOD_PLEDGE_TRANSITIONS, pledge.status, status, "food donation pledge");
      const updated = await transitionPledge(id, pledge.status, status, { rejectionReason: reason });
      await logActivity(session.name, `FOOD_PLEDGE_${status}`, "FoodDonationPledge", `${pledge.code}: ${reason.slice(0, 120)}`, session.userId);
      return json(res, updated);
    }

    throw new ApiError("action must be schedule, collect, receive, reject or cancel", 400);
  } catch (e) {
    return handleError(e, res);
  }
});

const PROGRAMME_CATEGORIES = [
  "GROCERY_KIT", "COOKED_MEAL", "MONTHLY_RATION", "CHILD_NUTRITION", "SENIOR_SUPPORT",
  "EMERGENCY", "COMMUNITY_KITCHEN", "FESTIVAL", "RURAL", "SURPLUS_RECOVERY",
];
const PROGRAMME_FREQUENCIES = ["ONE_TIME", "WEEKLY", "MONTHLY", "QUARTERLY"];
const PROGRAMME_STATUSES: readonly string[] = FOOD_PROGRAMME_STATUSES;

/** Public-safe programme projection — internal budget/notes stay admin-only. */
function publicProgramme(p: {
  id: string; code: string; title: string; slug: string; description: string;
  category: string; targetGroup: string | null; geographicCoverage: string | null;
  frequency: string; assistanceCategories: string | null; eligibilityCriteria: string | null;
  status: string; coordinatorName: string | null; coordinatorPhone: string | null;
  endDate: Date | null;
}) {
  return {
    id: p.id, code: p.code, title: p.title, slug: p.slug, description: p.description,
    category: p.category, targetGroup: p.targetGroup, geographicCoverage: p.geographicCoverage,
    frequency: p.frequency, assistanceCategories: p.assistanceCategories,
    eligibilityCriteria: p.eligibilityCriteria, status: p.status,
    coordinatorName: p.coordinatorName, coordinatorPhone: p.coordinatorPhone,
    endDate: p.endDate,
  };
}

// GET /api/food/programmes            — admin list (all statuses)
// GET /api/food/programmes?public=1   — public list (PUBLISHED/ACTIVE, visible, safe fields)
router.get("/programmes", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    if (sp.get("public") === "1") {
      const rows = await db.foodProgramme.findMany({
        where: { publicVisible: true, status: { in: ["PUBLISHED", "ACTIVE"] } },
        orderBy: [{ startDate: "desc" }],
      });
      return json(res, rows.map(publicProgramme));
    }
    await requireRole(req, "ADMIN");
    const status = sp.get("status");
    const rows = await db.foodProgramme.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { id: true, title: true } },
        _count: { select: { events: true } },
      },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/food/programmes — ADMIN create
router.post("/programmes", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const title = String(body?.title ?? "").trim();
    const description = String(body?.description ?? "").trim();
    if (!title || !description) throw new ApiError("Title and description are required", 400);

    const category = String(body?.category ?? "GROCERY_KIT").toUpperCase();
    if (!PROGRAMME_CATEGORIES.includes(category)) throw new ApiError("Invalid programme category", 400);
    const frequency = String(body?.frequency ?? "ONE_TIME").toUpperCase();
    if (!PROGRAMME_FREQUENCIES.includes(frequency)) throw new ApiError("Invalid frequency", 400);
    const status = String(body?.status ?? "DRAFT").toUpperCase();
    if (!PROGRAMME_STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
    if (status !== "DRAFT") throw new ApiError("New food programmes must start in DRAFT", 400);

    const slugBase = String(body?.slug ?? title).trim()
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "programme";
    const slug = `${slugBase}-${Date.now().toString(36).slice(-4)}`;

    const campaignId = body?.campaignId ? String(body.campaignId) : null;
    if (campaignId && !(await db.campaign.findUnique({ where: { id: campaignId } })))
      throw new ApiError("Linked campaign was not found", 400);

    const row = await db.foodProgramme.create({
      data: {
        code: await nextFoodProgrammeCode(),
        title, slug, description,
        category,
        targetGroup: body?.targetGroup ? String(body.targetGroup).trim() : null,
        geographicCoverage: body?.geographicCoverage ? String(body.geographicCoverage).trim() : null,
        startDate: body?.startDate ? new Date(body.startDate) : new Date(),
        endDate: body?.endDate ? new Date(body.endDate) : null,
        budget: Number(body?.budget) > 0 ? Number(body.budget) : null,
        fundraisingTarget: Number(body?.fundraisingTarget) > 0 ? Number(body.fundraisingTarget) : null,
        frequency,
        assistanceCategories: Array.isArray(body?.assistanceCategories) && body.assistanceCategories.length
          ? JSON.stringify(body.assistanceCategories.map(String)) : null,
        eligibilityCriteria: body?.eligibilityCriteria ? String(body.eligibilityCriteria).trim() : null,
        coordinatorName: body?.coordinatorName ? String(body.coordinatorName).trim() : null,
        coordinatorPhone: body?.coordinatorPhone ? String(body.coordinatorPhone).trim() : null,
        campaignId,
        publicVisible: body?.publicVisible !== false,
        status,
        createdByName: session.name,
      },
    });

    await logActivity(session.name, "FOOD_PROGRAMME_CREATE", "FoodProgramme", `${row.code} — ${row.title}`, session.userId);
    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/food/programmes/:id — ADMIN programme detail with event rollups
router.get("/programmes/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const { id } = req.params;
    const row = await db.foodProgramme.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, title: true } },
        events: {
          orderBy: { eventDate: "desc" },
          include: { _count: { select: { registrations: true } } },
        },
      },
    });
    if (!row) throw new ApiError("Food programme not found", 404);
    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/food/programmes/:id — ADMIN edit / lifecycle
router.patch("/programmes/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const row = await db.foodProgramme.findUnique({ where: { id } });
    if (!row) throw new ApiError("Food programme not found", 404);

    const data: Record<string, unknown> = {};
    if (body?.title !== undefined) data.title = String(body.title).trim();
    if (body?.description !== undefined) data.description = String(body.description).trim();
    if (body?.targetGroup !== undefined) data.targetGroup = body.targetGroup ? String(body.targetGroup).trim() : null;
    if (body?.geographicCoverage !== undefined) data.geographicCoverage = body.geographicCoverage ? String(body.geographicCoverage).trim() : null;
    if (body?.startDate !== undefined && body.startDate) data.startDate = new Date(body.startDate);
    if (body?.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body?.budget !== undefined) data.budget = Number(body.budget) > 0 ? Number(body.budget) : null;
    if (body?.fundraisingTarget !== undefined) data.fundraisingTarget = Number(body.fundraisingTarget) > 0 ? Number(body.fundraisingTarget) : null;
    if (body?.frequency !== undefined) data.frequency = String(body.frequency).toUpperCase();
    if (body?.eligibilityCriteria !== undefined) data.eligibilityCriteria = body.eligibilityCriteria ? String(body.eligibilityCriteria).trim() : null;
    if (body?.coordinatorName !== undefined) data.coordinatorName = body.coordinatorName ? String(body.coordinatorName).trim() : null;
    if (body?.coordinatorPhone !== undefined) data.coordinatorPhone = body.coordinatorPhone ? String(body.coordinatorPhone).trim() : null;
    if (body?.publicVisible !== undefined) data.publicVisible = Boolean(body.publicVisible);
    if (body?.campaignId !== undefined) data.campaignId = body.campaignId ? String(body.campaignId) : null;
    if (body?.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!PROGRAMME_STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
      assertTransition(FOOD_PROGRAMME_TRANSITIONS, row.status, status, "food programme");
      data.status = status;
    }

    const updated = await db.foodProgramme.update({ where: { id }, data });
    await logActivity(session.name, "FOOD_PROGRAMME_UPDATE", "FoodProgramme", `${updated.code} → ${updated.status}`, session.userId);
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

/**
 * GET /api/food/public — public, privacy-safe food security aggregate.
 * Every figure is computed from real platform data at request time —
 * nothing is hardcoded, no beneficiary-level information leaves the server.
 */
router.get("/public", async (_req, res) => {
  try {
    const [distributedAgg, uniqueBeneficiaries, uniqueHouseholds, completedEvents, openEvents, activeProgrammes, volunteerCount, donationAgg, mealEvents] =
      await Promise.all([
        db.foodRegistration.aggregate({
          where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
          _sum: { unitsDelivered: true },
        }),
        db.foodRegistration.findMany({
          where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
          distinct: ["beneficiaryId"],
          select: { beneficiaryId: true },
        }),
        db.foodRegistration.findMany({
          where: {
            status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] },
            householdId: { not: null },
          },
          distinct: ["householdId"],
          select: { householdId: true },
        }),
        db.foodEvent.count({ where: { status: { in: ["COMPLETED", "RECONCILED", "CLOSED"] } } }),
        db.foodEvent.count({ where: { status: "REGISTRATION_OPEN", publicVisible: true } }),
        db.foodProgramme.count({ where: { status: { in: ["PUBLISHED", "ACTIVE"] }, publicVisible: true } }),
        db.volunteerTask.findMany({
          where: { refType: "FOOD_EVENT" },
          distinct: ["volunteerId"],
          select: { volunteerId: true },
        }),
        db.donation.aggregate({
          where: { category: "FOOD_DISTRIBUTION", paymentStatus: "COMPLETED" },
          _sum: { amount: true },
        }),
        db.foodEvent.findMany({
          where: { status: { in: ["COMPLETED", "RECONCILED", "CLOSED"] }, eventType: { in: ["MEAL_SERVING", "KITCHEN"] } },
          select: { id: true },
        }),
      ]);

    // Meals served: handovers at meal-serving events; all other handovers are kits.
    const mealEventIds = new Set(mealEvents.map((e) => e.id));
    const mealRegs = await db.foodRegistration.aggregate({
      where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] }, eventId: { in: Array.from(mealEventIds) } },
      _sum: { unitsDelivered: true },
    });

    // Legacy FOOD distributions (earlier UAR module) are counted separately so
    // the two accounting systems never double-count each other.
    const legacyHandovers = await db.distribution.aggregate({
      where: { type: "FOOD" },
      _count: { _all: true },
    });

    const [eventCities, lastDistributed] = await Promise.all([
      db.foodEvent.findMany({
        where: { status: { in: FOOD_PUBLIC_EVENT_STATUSES }, city: { not: null } },
        distinct: ["city"],
        select: { city: true },
      }),
      db.foodRegistration.findFirst({
        where: { status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
    ]);

    return json(res, {
      stats: {
        familiesSupported: uniqueHouseholds.length,
        individualsReached: uniqueBeneficiaries.length,
        kitsDistributed: distributedAgg._sum.unitsDelivered ?? 0,
        mealsServed: mealRegs._sum.unitsDelivered ?? 0,
        legacyFoodHandovers: legacyHandovers._count._all,
        distributionLocations: eventCities.length,
        eventsCompleted: completedEvents,
        eventsOpen: openEvents,
        activeProgrammes,
        activeVolunteers: volunteerCount.length,
        totalDonations: donationAgg._sum.amount ?? 0,
      },
      reportingPeriod: "All time, since programme launch",
      lastUpdated: lastDistributed?.updatedAt ?? new Date(0),
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/food/registrations?eventId&status&q — ADMIN/VOLUNTEER queue lookup.
// q searches registration code, beneficiary name/code/phone.
router.get("/registrations", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "VOLUNTEER");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const eventId = sp.get("eventId");
    const status = sp.get("status");
    const q = sp.get("q")?.trim();

    const where: Record<string, unknown> = {};
    if (eventId) where.eventId = eventId;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { code: { contains: q } },
        { beneficiary: { is: { name: { contains: q } } } },
        { beneficiary: { is: { code: { contains: q } } } },
        { beneficiary: { is: { phone: { contains: q } } } },
      ];
    }

    const rows = await db.foodRegistration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        beneficiary: { select: { id: true, code: true, name: true, phone: true, city: true } },
        event: { select: { id: true, code: true, title: true, eventDate: true, status: true } },
        checkIn: { select: { method: true, checkedInAt: true, operatorName: true } },
      },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

const REG_REASONS = [
  "NO_SHOW", "PARTIAL_COLLECTION", "WRONG_PACKAGE", "INSUFFICIENT_STOCK",
  "BENEFICIARY_UNREACHABLE", "DELIVERY_FAILED", "BENEFICIARY_DECLINED", "CANCELLED", "OTHER",
];

// PATCH /api/food/registrations/:id — ADMIN lifecycle (approve/reject/cancel/
// no-show/reschedule/confirm). Handover itself happens via /api/food/checkin.
router.patch("/registrations/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const reg = await db.foodRegistration.findUnique({
      where: { id },
      include: { event: { select: { code: true, title: true } } },
    });
    if (!reg) throw new ApiError("Registration not found", 404);

    const data: Record<string, unknown> = {};
    let statusChanged = false;
    if (body?.unitsAllocated !== undefined) {
      const units = Number(body.unitsAllocated);
      if (!Number.isInteger(units) || units < 1) throw new ApiError("unitsAllocated must be a positive whole number", 400);
      data.unitsAllocated = units;
    }
    if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;
    if (body?.householdId !== undefined) data.householdId = body.householdId ? String(body.householdId) : null;

    if (body?.status !== undefined) {
      const to = String(body.status).toUpperCase();
      const allowed = ["REGISTERED", "APPROVED", "CONFIRMED", "CANCELLED", "RESCHEDULED", "NO_SHOW", "NOT_COLLECTED", "REJECTED"];
      if (!allowed.includes(to)) throw new ApiError(`Invalid registration status "${to}"`, 400);
      assertTransition(FOOD_REGISTRATION_TRANSITIONS, reg.status, to, "food registration");
      data.status = to;
      statusChanged = to !== reg.status;
      if (body?.reason !== undefined) {
        const reason = String(body.reason).toUpperCase();
        if (!REG_REASONS.includes(reason)) throw new ApiError("Invalid reason", 400);
        data.reason = reason;
      } else if (["NO_SHOW", "CANCELLED", "REJECTED", "RESCHEDULED"].includes(to)) {
        data.reason = "OTHER";
      }
    }

    const updated = statusChanged
      ? await db.$transaction(async (tx) => {
          const changed = await tx.foodRegistration.updateMany({
            where: { id, status: reg.status },
            data,
          });
          if (changed.count !== 1)
            throw new ApiError("Registration changed while this update was being processed", 409);
          return tx.foodRegistration.findUniqueOrThrow({ where: { id } });
        })
      : await db.foodRegistration.update({ where: { id }, data });
    await logActivity(
      session.name,
      "FOOD_REGISTRATION_UPDATE",
      "FoodRegistration",
      `${reg.code} → ${updated.status ?? reg.status}`,
      session.userId
    );
    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});
