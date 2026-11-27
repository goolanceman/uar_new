/**
 * Prescription routes — /api/prescriptions, /api/prescriptions/:id,
 * /api/prescriptions/:id/dispense, /api/prescriptions/:id/print, /api/prescriptions/:id/sign
 * Converted 1:1 from src/app/api/prescriptions/* (Next.js route handlers) to Express.
 */
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireAuth,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { nextRxCode } from "@/lib/health-codes";
import { orgProfile, esc, printDocument } from "@/lib/api-org";
import { BRAND_MARK_DATA_URI } from "@/lib/brand-mark";
import { formatDateLong, formatDateTime } from "@/lib/format";

export const router = Router();

const log = logger.child("prescriptions");

const VALID_STATUSES = ["DRAFT", "SIGNED", "PARTIALLY_DISPENSED", "FULLY_DISPENSED", "CANCELLED"];

const RX_INCLUDE = {
  items: true,
  dispenses: { orderBy: { dispensedAt: "desc" } },
  doctor: { select: { id: true, name: true, regNumber: true, speciality: true, kind: true } },
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
} satisfies Prisma.PrescriptionInclude;

function pageParams(url: URL, defLimit = 50) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || defLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function optDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ItemInput {
  medicineName: string;
  genericName?: string | null;
  strength?: string | null;
  dosage?: string | null;
  route?: string | null;
  frequency?: string | null;
  durationDays?: number | null;
  quantity: number;
  instructions?: string | null;
}

/** Validate prescription items — medicineName + quantity (1-999) required. */
export function validateItems(raw: unknown): ItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0)
    throw new ApiError("items must be a non-empty array", 400);
  return raw.map((it, i) => {
    const medicineName = String(it?.medicineName ?? "").trim();
    if (!medicineName) throw new ApiError(`items[${i}].medicineName is required`, 400);
    const quantity = Number(it?.quantity);
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 999)
      throw new ApiError(`items[${i}].quantity must be an integer between 1 and 999`, 400);
    let durationDays: number | null = null;
    if (it?.durationDays !== undefined && it?.durationDays !== null && it?.durationDays !== "") {
      const d = Number(it.durationDays);
      if (!Number.isFinite(d) || !Number.isInteger(d) || d < 1 || d > 365)
        throw new ApiError(`items[${i}].durationDays must be an integer between 1 and 365`, 400);
      durationDays = d;
    }
    return {
      medicineName,
      genericName: optText(it?.genericName),
      strength: optText(it?.strength),
      dosage: optText(it?.dosage),
      route: optText(it?.route),
      frequency: optText(it?.frequency),
      durationDays,
      quantity,
      instructions: optText(it?.instructions),
    };
  });
}

interface LineInput {
  itemId?: string;
  inventoryItemId?: string | null;
  quantity: number;
  batchNo?: string | null;
  expiryDate?: Date | null;
}

async function loadForSession(id: string, sessionRole: string, sessionUserId: string) {
  const rx = await db.prescription.findUnique({ where: { id }, include: RX_INCLUDE });
  if (!rx) throw new ApiError("Prescription not found", 404);
  if (sessionRole === "BENEFICIARY") {
    const own = await db.beneficiary.findUnique({
      where: { userId: sessionUserId },
      select: { id: true },
    });
    if (!own || own.id !== rx.beneficiaryId)
      throw new ApiError("You do not have permission for this action", 403);
  }
  return rx;
}

// GET /api/prescriptions — ADMIN | DOCTOR | PHARMACIST (full list);
// BENEFICIARY role sees only prescriptions issued to their own patient record.
// Filters: beneficiaryId, campId, doctorId, status, q (code search).
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const staffRoles = ["ADMIN", "DOCTOR", "PHARMACIST"];
    if (!staffRoles.includes(session.role) && session.role !== "BENEFICIARY")
      throw new ApiError("You do not have permission for this action", 403);

    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({
        where: { userId: session.userId },
        select: { id: true },
      });
      if (!own) return json(res, { items: [], total: 0, page: 1, pages: 1 });
      where.beneficiaryId = own.id;
    } else {
      for (const f of ["beneficiaryId", "campId", "doctorId"]) {
        const v = url.searchParams.get(f);
        if (v) where[f] = v;
      }
    }
    const status = url.searchParams.get("status");
    if (status) {
      if (!VALID_STATUSES.includes(status))
        throw new ApiError(`status must be one of: ${VALID_STATUSES.join(", ")}`, 400);
      where.status = status;
    }
    const q = url.searchParams.get("q");
    if (q) where.code = { contains: q };

    const [total, items] = await Promise.all([
      db.prescription.count({ where }),
      db.prescription.findMany({
        where,
        include: RX_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/prescriptions — DOCTOR only.
// { encounterId?, campId?, beneficiaryId, diagnosis?, followUpDate?,
//   items: [{ medicineName, genericName?, strength?, dosage?, route?,
//             frequency?, durationDays?, quantity, instructions? }] }
// Auto code (UAR-RX-NNNNN), status DRAFT until the doctor signs.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "DOCTOR");
    const body = req.body ?? {};

    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true, name: true },
    });
    if (!beneficiary) {
      log.warn("prescription_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new ApiError("Beneficiary not found", 404);
    }

    const encounterId = optText(body?.encounterId);
    if (encounterId) {
      const enc = await db.encounter.findUnique({ where: { id: encounterId }, select: { id: true } });
      if (!enc) {
        log.warn("prescription_encounter_not_found", {
          encounterId,
          actor: session.userId,
        });
        throw new ApiError("Encounter not found", 404);
      }
    }
    const campId = optText(body?.campId);
    if (campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: campId }, select: { id: true } });
      if (!camp) {
        log.warn("prescription_camp_not_found", { campId, actor: session.userId });
        throw new ApiError("Camp not found", 404);
      }
    }

    const items = validateItems(body?.items);

    const professional = await db.healthProfessional.findUnique({
      where: { userId: session.userId },
      select: { id: true, name: true },
    });
    if (!professional) {
      log.warn("prescription_no_professional_profile", { actor: session.userId });
      throw new ApiError(
        "No health-professional profile is linked to your account — ask an admin to create a DOCTOR profile for you",
        403
      );
    }

    const code = await nextRxCode();
    const prescription = await db.prescription.create({
      data: {
        code,
        encounterId,
        campId,
        beneficiaryId,
        doctorId: professional.id,
        diagnosis: optText(body?.diagnosis),
        followUpDate: optDate(body?.followUpDate),
        status: "DRAFT",
        items: { create: items },
      },
      include: RX_INCLUDE,
    });

    log.info("prescription_created", {
      prescriptionId: prescription.id,
      code: prescription.code,
      beneficiaryId,
      ...(campId ? { campId } : {}),
      itemCount: items.length,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "RX_CREATE",
      "PRESCRIPTION",
      `${code} for ${beneficiary.code} (${items.length} item(s))`,
      session.userId
    );

    return json(res, prescription, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/prescriptions/:id — ADMIN | DOCTOR | PHARMACIST, plus the
// BENEFICIARY account linked to the patient record itself.
router.get("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const allowed = ["ADMIN", "DOCTOR", "PHARMACIST", "BENEFICIARY"];
    if (!allowed.includes(session.role))
      throw new ApiError("You do not have permission for this action", 403);
    const { id } = req.params;
    return json(res, await loadForSession(id, session.role, session.userId));
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/prescriptions/:id
// 1) Cancel path: { status: "CANCELLED", cancelReason } — the owning DOCTOR
//    or ADMIN; rejected once FULLY_DISPENSED.
// 2) Edit path: the owning DOCTOR (or ADMIN) edits a DRAFT prescription —
//    diagnosis / followUpDate and a wholesale replacement of items when the
//    `items` array is provided. SIGNED prescriptions are immutable (409).
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.prescription.findUnique({
      where: { id },
      include: { doctor: { select: { userId: true, name: true } } },
    });
    if (!existing) throw new ApiError("Prescription not found", 404);

    const isOwner = session.role === "DOCTOR" && existing.doctor.userId === session.userId;
    const isAdmin = session.role === "ADMIN";

    // ── cancel ────────────────────────────────────────────────────────────
    if (body?.status === "CANCELLED") {
      if (existing.status === "FULLY_DISPENSED") {
        log.warn("prescription_cancel_blocked_dispensed", {
          prescriptionId: id,
          code: existing.code,
          status: existing.status,
          actor: session.userId,
        });
        throw new ApiError("Fully dispensed prescriptions cannot be cancelled", 409);
      }
      if (existing.status === "CANCELLED") {
        log.warn("prescription_cancel_duplicate", {
          prescriptionId: id,
          code: existing.code,
          actor: session.userId,
        });
        throw new ApiError("Prescription is already cancelled", 409);
      }
      if (!isOwner && !isAdmin) {
        log.warn("prescription_cancel_forbidden", {
          prescriptionId: id,
          code: existing.code,
          actor: session.userId,
        });
        throw new ApiError("Only the prescribing doctor (or an admin) can cancel this prescription", 403);
      }
      const cancelReason = optText(body?.cancelReason);
      if (!cancelReason) throw new ApiError("cancelReason is required to cancel a prescription", 400);

      const rx = await db.prescription.update({
        where: { id },
        data: { status: "CANCELLED", cancelReason },
        include: RX_INCLUDE,
      });
      log.info("prescription_cancelled", {
        prescriptionId: id,
        code: existing.code,
        previousStatus: existing.status,
        actor: session.userId,
      });
      await logActivity(
        session.name,
        "RX_CANCEL",
        "PRESCRIPTION",
        `${existing.code} cancelled — ${cancelReason}`,
        session.userId
      );
      return json(res, rx);
    }

    // ── edit (DRAFT only) ─────────────────────────────────────────────────
    if (existing.status !== "DRAFT") {
      log.warn("prescription_edit_blocked_signed", {
        prescriptionId: id,
        code: existing.code,
        status: existing.status,
        actor: session.userId,
      });
      throw new ApiError("Signed prescriptions are immutable — create a new prescription or cancel this one", 409);
    }
    if (!isOwner && !isAdmin) {
      log.warn("prescription_edit_forbidden", {
        prescriptionId: id,
        code: existing.code,
        actor: session.userId,
      });
      throw new ApiError("Only the prescribing doctor can edit this draft prescription", 403);
    }

    const data: Record<string, unknown> = {};
    if (body?.diagnosis !== undefined) data.diagnosis = optText(body.diagnosis);
    if (body?.followUpDate !== undefined) data.followUpDate = optDate(body.followUpDate);
    if (body?.encounterId !== undefined) {
      const encounterId = optText(body.encounterId);
      if (encounterId) {
        const enc = await db.encounter.findUnique({ where: { id: encounterId }, select: { id: true } });
        if (!enc) {
          log.warn("prescription_encounter_not_found", {
            encounterId,
            prescriptionId: id,
            actor: session.userId,
          });
          throw new ApiError("Encounter not found", 404);
        }
      }
      data.encounterId = encounterId;
    }
    if (body?.items !== undefined) data.items = { deleteMany: {}, create: validateItems(body.items) };

    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const rx = await db.prescription.update({ where: { id }, data, include: RX_INCLUDE });
    log.info("prescription_updated", {
      prescriptionId: id,
      code: existing.code,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "RX_UPDATE",
      "PRESCRIPTION",
      `${existing.code} — fields: ${Object.keys(data).join(", ")}`,
      session.userId
    );
    return json(res, rx);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/prescriptions/:id/dispense — ADMIN | PHARMACIST only.
// Body: { dispenses: [{ itemId, inventoryItemId?, quantity, batchNo?,
//          expiryDate? }], notes? }
// - prescription must be SIGNED or PARTIALLY_DISPENSED (409 otherwise)
// - cumulative dispensed quantity per item may not exceed the prescribed qty (400)
// - when inventoryItemId is given, an ISSUED InventoryTransaction is written
//   and InventoryItem.quantity is decremented atomically (409 when stock is
//   insufficient) — all inside a single transaction so partial dispenses
//   never persist.
// - status recomputes to FULLY_DISPENSED when every item is fully dispensed,
//   PARTIALLY_DISPENSED otherwise.
router.post("/:id/dispense", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "PHARMACIST");
    const { id } = req.params;
    const body = req.body ?? {};

    const rawLines = body?.dispenses;
    if (!Array.isArray(rawLines) || rawLines.length === 0)
      throw new ApiError("dispenses must be a non-empty array", 400);

    const notes = optText(body?.notes);

    const existing = await db.prescription.findUnique({
      where: { id },
      include: {
        items: true,
        dispenses: { select: { itemId: true, quantity: true } },
        doctor: { select: { name: true } },
        beneficiary: { select: { code: true, name: true } },
      },
    });
    if (!existing) {
      log.warn("prescription_dispense_not_found", { prescriptionId: id, actor: session.userId });
      throw new ApiError("Prescription not found", 404);
    }

    if (existing.status !== "SIGNED" && existing.status !== "PARTIALLY_DISPENSED") {
      log.warn("prescription_dispense_blocked_status", {
        prescriptionId: id,
        code: existing.code,
        status: existing.status,
        actor: session.userId,
      });
      throw new ApiError(
        `Prescription must be SIGNED before dispensing (current status: ${existing.status})`,
        409
      );
    }

    // ── validate lines against the prescription + already-dispensed totals ──
    const itemById = new Map(existing.items.map((it) => [it.id, it]));
    const dispensedByItem = new Map<string, number>();
    for (const d of existing.dispenses) {
      if (d.itemId)
        dispensedByItem.set(d.itemId, (dispensedByItem.get(d.itemId) ?? 0) + d.quantity);
    }

    const lines: LineInput[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const itemId = optText(raw?.itemId);
      if (!itemId) throw new ApiError(`dispenses[${i}].itemId is required`, 400);
      const item = itemById.get(itemId);
      if (!item)
        throw new ApiError(`dispenses[${i}].itemId does not belong to this prescription`, 400);
      const quantity = Number(raw?.quantity);
      if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1)
        throw new ApiError(`dispenses[${i}].quantity must be a positive integer`, 400);

      const already = dispensedByItem.get(itemId) ?? 0;
      if (already + quantity > item.quantity)
        throw new ApiError(
          `Dispense exceeds prescribed quantity for ${item.medicineName} (prescribed ${item.quantity}, already dispensed ${already})`,
          400
        );
      dispensedByItem.set(itemId, already + quantity);

      const inventoryItemId = optText(raw?.inventoryItemId);
      if (inventoryItemId) {
        const inv = await db.inventoryItem.findUnique({
          where: { id: inventoryItemId },
          select: { id: true, name: true },
        });
        if (!inv) {
          log.warn("prescription_dispense_inventory_not_found", {
            prescriptionId: id,
            inventoryItemId,
            actor: session.userId,
          });
          throw new ApiError(`Inventory item not found for dispenses[${i}]`, 404);
        }
      }

      lines.push({
        itemId,
        inventoryItemId,
        quantity,
        batchNo: optText(raw?.batchNo),
        expiryDate: optDate(raw?.expiryDate),
      });
    }

    // ── apply everything atomically ────────────────────────────────────────
    const updated = await db.$transaction(async (tx) => {
      for (const line of lines) {
        if (line.inventoryItemId) {
          // Atomic guard: only decrement when the current quantity covers it.
          const upd = await tx.inventoryItem.updateMany({
            where: { id: line.inventoryItemId, quantity: { gte: line.quantity } },
            data: { quantity: { decrement: line.quantity } },
          });
          if (upd.count === 0) {
            const inv = await tx.inventoryItem.findUnique({
              where: { id: line.inventoryItemId },
              select: { name: true },
            });
            log.warn("prescription_dispense_insufficient_stock", {
              prescriptionId: existing.id,
              code: existing.code,
              inventoryItemId: line.inventoryItemId,
              actor: session.userId,
            });
            throw new ApiError(`Insufficient stock for ${inv?.name ?? "inventory item"}`, 409);
          }
          await tx.inventoryTransaction.create({
            data: {
              itemId: line.inventoryItemId,
              campId: existing.campId,
              type: "ISSUED",
              quantity: -line.quantity,
              batchNo: line.batchNo,
              expiryDate: line.expiryDate,
              source: "INTERNAL",
              owner: "UAR",
              refType: "DISPENSE",
              refId: existing.id,
              notes: notes ?? null,
              handledByName: session.name,
            },
          });
        }
        await tx.medicationDispense.create({
          data: {
            prescriptionId: existing.id,
            itemId: line.itemId ?? null,
            beneficiaryId: existing.beneficiaryId,
            campId: existing.campId,
            inventoryItemId: line.inventoryItemId,
            quantity: line.quantity,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            pharmacistName: session.name,
            notes,
          },
        });
      }

      // Recompute dispense status across ALL prescription items.
      const items = await tx.prescriptionItem.findMany({
        where: { prescriptionId: existing.id },
        select: { id: true, quantity: true },
      });
      const totals = await tx.medicationDispense.groupBy({
        by: ["itemId"],
        _sum: { quantity: true },
        where: { prescriptionId: existing.id },
      });
      const dispensedMap = new Map(
        totals.filter((t) => t.itemId).map((t) => [t.itemId as string, t._sum.quantity ?? 0])
      );
      const fullyDispensed = items.every(
        (it) => (dispensedMap.get(it.id) ?? 0) >= it.quantity
      );

      return tx.prescription.update({
        where: { id: existing.id },
        data: {
          status: fullyDispensed ? "FULLY_DISPENSED" : "PARTIALLY_DISPENSED",
        },
        include: RX_INCLUDE,
      });
    });

    log.info("prescription_dispensed", {
      prescriptionId: existing.id,
      code: existing.code,
      lines: lines.length,
      newStatus: updated.status,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "RX_DISPENSE",
      "PRESCRIPTION",
      `${existing.code} — ${lines.length} line(s) dispensed to ${existing.beneficiary.code} by ${session.name} → ${updated.status}`,
      session.userId
    );

    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/prescriptions/:id/sign — the owning DOCTOR (or ADMIN) signs the
// prescription, freezing its items. Requires at least one medicine.
router.post("/:id/sign", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR");
    const { id } = req.params;

    const existing = await db.prescription.findUnique({
      where: { id },
      include: {
        doctor: { select: { userId: true, name: true } },
        items: { select: { id: true } },
      },
    });
    if (!existing) {
      log.warn("prescription_sign_not_found", { prescriptionId: id, actor: session.userId });
      throw new ApiError("Prescription not found", 404);
    }

    const isOwner = session.role === "DOCTOR" && existing.doctor.userId === session.userId;
    if (!isOwner && session.role !== "ADMIN") {
      log.warn("prescription_sign_forbidden", {
        prescriptionId: id,
        code: existing.code,
        actor: session.userId,
      });
      throw new ApiError("Only the prescribing doctor can sign this prescription", 403);
    }

    if (existing.status !== "DRAFT") {
      log.warn("prescription_sign_blocked_status", {
        prescriptionId: id,
        code: existing.code,
        status: existing.status,
        actor: session.userId,
      });
      throw new ApiError(`Only DRAFT prescriptions can be signed (current status: ${existing.status})`, 409);
    }

    if (existing.items.length === 0)
      throw new ApiError("Add at least one medicine before signing", 400);

    const rx = await db.prescription.update({
      where: { id },
      data: {
        status: "SIGNED",
        signedAt: new Date(),
        signedByName: session.name,
      },
      include: RX_INCLUDE,
    });

    log.info("prescription_signed", {
      prescriptionId: id,
      code: existing.code,
      itemCount: existing.items.length,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "RX_SIGN",
      "PRESCRIPTION",
      `${existing.code} signed by ${session.name} (${existing.items.length} item(s))`,
      session.userId
    );

    return json(res, rx);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/prescriptions/:id/print — self-contained, print-ready A4
// prescription document (receipts print pattern: UAR letterhead + auto
// window.print). ADMIN | DOCTOR | PHARMACIST, plus the BENEFICIARY account
// linked to the patient record itself. The Rx code in the footer acts as the
// verification reference (text only — no QR image).
router.get("/:id/print", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const allowed = ["ADMIN", "DOCTOR", "PHARMACIST", "BENEFICIARY"];
    if (!allowed.includes(session.role))
      throw new ApiError("You do not have permission for this action", 403);

    const { id } = req.params;

    const rx = await db.prescription.findUnique({
      where: { id },
      include: {
        items: true,
        doctor: { select: { name: true, regNumber: true, speciality: true, kind: true } },
        beneficiary: { select: { code: true, name: true, age: true, gender: true } },
        camp: { select: { title: true, code: true, venue: true, city: true } },
      },
    });
    if (!rx) throw new ApiError("Prescription not found", 404);

    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({
        where: { userId: session.userId },
        select: { id: true },
      });
      if (!own || own.id !== rx.beneficiaryId)
        throw new ApiError("You do not have permission for this action", 403);
    }

    const org = await orgProfile();

    const patientLine = [
      rx.beneficiary.age != null ? `${rx.beneficiary.age} yrs` : null,
      rx.beneficiary.gender ? esc(rx.beneficiary.gender) : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const rows = rx.items
      .map(
        (it, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td><b>${esc(it.medicineName)}</b>${it.strength ? ` <span class="dim">${esc(it.strength)}</span>` : ""}${it.genericName ? `<div class="sub">Generic: ${esc(it.genericName)}</div>` : ""}</td>
          <td>${esc(it.dosage ?? "—")}${it.route ? `<div class="sub">${esc(it.route)}</div>` : ""}</td>
          <td class="c">${esc(it.frequency ?? "—")}</td>
          <td class="c">${it.durationDays ?? "—"}</td>
          <td class="c"><b>${it.quantity}</b></td>
          <td class="instr">${esc(it.instructions ?? "")}</td>
        </tr>`
      )
      .join("");

    const diagnosisBlock = rx.diagnosis
      ? `<div class="panel dx"><div class="sec-label">Diagnosis</div><div class="dx-text">${esc(rx.diagnosis)}</div></div>`
      : "";

    const followUp = rx.followUpDate
      ? `<div class="fu"><span class="k">Follow-up</span><b>${esc(formatDateLong(rx.followUpDate))}</b></div>`
      : "";

    const cancelledBanner =
      rx.status === "CANCELLED"
        ? `<div class="banner">CANCELLED — ${esc(rx.cancelReason ?? "")}</div>`
        : "";

    const body = `
<style>
  :root { --ink:#0f1f1a; --ink-2:#334155; --ink-3:#64748b; --ink-4:#94a3b8;
    --line:#e2e8f0; --line-soft:#eef2f6; --paper:#fff; --wash:#f8fafc;
    --accent:#059669; --accent-deep:#064e3b; --accent-wash:#ecfdf5; }
  .sheet { width:210mm; min-height:297mm; padding:14mm 15mm 12mm; position:relative;
    overflow:hidden; background:var(--paper); color:var(--ink);
    font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,sans-serif; }
  .accent-bar { height:7px; border-radius:99px;
    background:linear-gradient(90deg,var(--accent-deep),var(--accent) 55%,#34d399); }
  .head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-top:14px; }
  .brand { display:flex; gap:13px; align-items:center; }
  .mono { width:54px; height:54px; border-radius:14px; flex-shrink:0;
    object-fit:contain; box-shadow:0 2px 8px rgba(6,78,59,.28); }
  .brand-name { font:700 20px Georgia,serif; }
  .brand-tag { font-size:10.5px; color:var(--ink-3); margin-top:2px; letter-spacing:.4px; }
  .brand-addr { font-size:10.5px; color:var(--ink-4); margin-top:3px; line-height:1.5; }
  .rx-no { text-align:right; }
  .rx-no .lbl { font-size:9px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:var(--ink-4); }
  .rx-no .val { font:700 17px ui-monospace,'Cascadia Mono','Courier New',monospace; color:var(--accent-deep); letter-spacing:1px; margin-top:2px; }
  .title-row { margin:18px 0 0; padding-bottom:12px; border-bottom:1px solid var(--line);
    display:flex; align-items:flex-end; justify-content:space-between; gap:14px; }
  .doc-title { font:800 28px Georgia,'Times New Roman',serif; letter-spacing:3px; }
  .doc-sub { font-size:11px; color:var(--ink-3); margin-top:4px; }
  .issued { font-size:10.5px; color:var(--ink-3); text-align:right; line-height:1.6; }
  .meta { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--line);
    border-radius:12px; overflow:hidden; margin-top:14px; }
  .meta > div { padding:10px 14px; border-left:1px solid var(--line-soft); }
  .meta > div:first-child { border-left:0; }
  .meta .k { font-size:8.5px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; color:var(--ink-4); }
  .meta .v { font-size:12.5px; font-weight:600; margin-top:3px; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }
  .panel { border:1px solid var(--line); border-radius:12px; padding:12px 15px; background:var(--paper); }
  .panel.tinted { background:var(--wash); }
  .sec-label { font-size:9.5px; font-weight:700; letter-spacing:1.8px; text-transform:uppercase;
    color:var(--accent-deep); margin-bottom:8px; display:flex; align-items:center; gap:7px; }
  .sec-label::after { content:""; flex:1; height:1px; background:var(--line-soft); }
  .big-name { font:700 15.5px Georgia,serif; }
  .kv { font-size:11.5px; color:var(--ink-2); margin-top:4px; line-height:1.7; }
  .kv .k { color:var(--ink-4); }
  .dx-text { font-size:12.5px; color:var(--ink); line-height:1.6; }
  table.items { width:100%; border-collapse:collapse; font-size:11.5px; margin-top:14px;
    border:1px solid var(--line); }
  table.items th { text-align:left; font-size:8.5px; font-weight:700; letter-spacing:1.3px;
    text-transform:uppercase; color:var(--ink-3); background:var(--wash);
    padding:8px 10px; border-bottom:1px solid var(--line); }
  table.items td { padding:9px 10px; color:var(--ink-2); border-bottom:1px solid var(--line-soft);
    vertical-align:top; }
  table.items tr:last-child td { border-bottom:0; }
  table.items .c { text-align:center; }
  table.items .instr { font-size:10.5px; color:var(--ink-3); }
  .sub { font-size:9.5px; color:var(--ink-4); margin-top:1px; }
  .dim { color:var(--ink-4); font-weight:400; font-size:10.5px; }
  .sign-row { display:flex; justify-content:space-between; align-items:flex-end; margin-top:30px; gap:20px; }
  .sig-line { width:220px; border-top:1.5px solid var(--ink-2); padding-top:6px; }
  .sig-name { font:700 14px Georgia,serif; }
  .sig-role { font-size:10px; color:var(--ink-4); margin-top:1px; }
  .fu { font-size:11.5px; color:var(--ink-2); }
  .fu .k { color:var(--ink-4); margin-right:8px; }
  .verify { margin-top:18px; padding:10px 14px; border:1px dashed var(--line);
    border-radius:10px; background:var(--wash); font-size:9.5px; color:var(--ink-3);
    line-height:1.7; text-align:center; }
  .verify b { font-family:ui-monospace,'Courier New',monospace; color:var(--accent-deep);
    letter-spacing:1px; font-size:11px; }
  .banner { margin-top:14px; border:1.5px solid #b91c1c; color:#b91c1c; background:#fef2f2;
    border-radius:10px; padding:10px 14px; font:700 12px 'Segoe UI',Arial,sans-serif;
    letter-spacing:1px; text-align:center; }
  @media print { .sheet { box-shadow:none; } }
</style>
<div class="sheet">
  <div class="accent-bar"></div>
  <div class="head">
    <div class="brand">
      <img class="mono" src="${BRAND_MARK_DATA_URI}" alt="${esc(org.name)}" />
      <div>
        <div class="brand-name">${esc(org.name)}</div>
        <div class="brand-tag">Service · Dignity · Transparency · Technology-for-Good</div>
        <div class="brand-addr">${esc(org.address)}<br/>${esc(org.email)} &nbsp;·&nbsp; ${esc(org.phone)}</div>
      </div>
    </div>
    <div class="rx-no">
      <div class="lbl">Prescription No.</div>
      <div class="val">${esc(rx.code)}</div>
    </div>
  </div>

  <div class="title-row">
    <div>
      <div class="doc-title">PRESCRIPTION</div>
      <div class="doc-sub">${rx.status === "DRAFT" ? "Draft — not yet signed by the doctor" : `Signed by Dr. ${esc(rx.doctor.name)} on ${esc(formatDateTime(rx.signedAt ?? rx.createdAt))}`}</div>
    </div>
    <div class="issued">Issued ${esc(formatDateLong(rx.createdAt))}${rx.camp ? `<br/>Camp: ${esc(rx.camp.title)}` : ""}</div>
  </div>

  ${cancelledBanner}

  <div class="meta">
    <div><div class="k">Patient ID</div><div class="v">${esc(rx.beneficiary.code)}</div></div>
    <div><div class="k">Camp</div><div class="v">${esc(rx.camp?.title ?? "—")}</div></div>
    <div><div class="k">Status</div><div class="v">${esc(rx.status)}</div></div>
  </div>

  <div class="cols">
    <div class="panel">
      <div class="sec-label">Patient</div>
      <div class="big-name">${esc(rx.beneficiary.name)}</div>
      <div class="kv"><span class="k">ID&nbsp;</span>${esc(rx.beneficiary.code)}${patientLine ? ` &nbsp;·&nbsp; ${patientLine}` : ""}</div>
    </div>
    <div class="panel tinted">
      <div class="sec-label">Prescribing Doctor</div>
      <div class="big-name">Dr. ${esc(rx.doctor.name)}</div>
      <div class="kv"><span class="k">Reg No.&nbsp;</span>${esc(rx.doctor.regNumber ?? "—")}${rx.doctor.speciality ? ` &nbsp;·&nbsp; ${esc(rx.doctor.speciality)}` : ""}</div>
    </div>
  </div>

  ${diagnosisBlock}

  <table class="items">
    <tr>
      <th style="width:5%;">#</th>
      <th style="width:30%;">Medicine</th>
      <th style="width:16%;">Dose / Route</th>
      <th style="width:11%;">Frequency</th>
      <th style="width:9%;">Days</th>
      <th style="width:8%;">Qty</th>
      <th style="width:21%;">Instructions</th>
    </tr>
    ${rows}
  </table>

  <div class="sign-row">
    <div class="fu">${followUp}</div>
    <div class="sig-line">
      <div class="sig-name">Dr. ${esc(rx.doctor.name)}</div>
      <div class="sig-role">Reg. No. ${esc(rx.doctor.regNumber ?? "—")} · ${esc(org.name)}</div>
    </div>
  </div>

  <div class="verify">
    Verify this prescription at <b>${esc(org.website)}</b> or any ${esc(org.name)} camp pharmacy using code <b>${esc(rx.code)}</b>.<br/>
    Computer-generated document · Issued ${esc(formatDateLong(new Date()))} · Medicines dispensed only against this code by authorised ${esc(org.name)} pharmacists.
  </div>
</div>
<script>window.onload=function(){window.print()}</script>`;

    return res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(printDocument(`Prescription ${rx.code}`, body));
  } catch (e) {
    return handleError(e, res);
  }
});
