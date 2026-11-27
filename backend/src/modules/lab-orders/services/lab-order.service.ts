/**
 * Lab order service — all business rules for the diagnostic order pipeline.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. Enforced linear state machine (transition table lives in
 * @/lib/lab-orders, shared with the lab-tech queue UI). Field checks keep
 * the legacy order exactly (existence → resultFileUrl validation/role gate →
 * status transition → critical flag → empty-patch check) and every log event
 * keeps its legacy name.
 */
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { nextLabCode } from "@/lib/health-codes";
import { LAB_ORDER_NEXT } from "@/lib/lab-orders";
import { ApiError, NotFoundError } from "@/shared/errors";
import type {
  LabOrderExisting,
  LabOrderListFilter,
  LabOrderRepository,
  LabOrderRow,
} from "../repositories/lab-order.repository.interface";
import type {
  CreateLabOrderBody,
  ListLabOrdersQuery,
  UpdateLabOrderBody,
} from "../schemas/lab-order.schema";

const log = logger.child("lab-orders");

/** Legacy optText(): String(v).trim(), empty/absent → null. */
function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** File-manager assets (/api/files/:id/file) or absolute https URLs only. */
const FILE_URL_RE = /^(\/api\/files\/[\w-]+\/file)|^https?:\/\//;

export interface LabOrderListEnvelope {
  items: LabOrderRow[];
  total: number;
  page: number;
  pages: number;
}

export class LabOrderService {
  constructor(private readonly labOrderRepository: LabOrderRepository) {}

  /** GET /api/lab-orders — ADMIN | DOCTOR | LAB_TECH | NURSE (BENEFICIARY sees
   *  own orders only). Filters: beneficiaryId, campId, status, q (code/testName). */
  async list(query: ListLabOrdersQuery, session: Session): Promise<LabOrderListEnvelope> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const filter: LabOrderListFilter = {};
    if (session.role === "BENEFICIARY") {
      const own = await this.labOrderRepository.findBeneficiaryIdByUserId(session.userId);
      if (!own) return { items: [], total: 0, page: 1, pages: 1 };
      filter.beneficiaryId = own.id;
    } else {
      filter.beneficiaryId = query.beneficiaryId;
      filter.campId = query.campId;
      filter.status = query.status;
    }
    if (query.q) filter.q = query.q;

    const { rows, total } = await this.labOrderRepository.list(filter, skip, limit);
    return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** POST /api/lab-orders — DOCTOR | ADMIN.
   *  { beneficiaryId, campId?, encounterId?, testName } → code UAR-LAB-NNNNN,
   *  status ORDERED, orderedByName. */
  async create(body: CreateLabOrderBody, session: Session): Promise<LabOrderRow> {
    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await this.labOrderRepository.findBeneficiaryRef(beneficiaryId);
    if (!beneficiary) {
      log.warn("lab_order_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new NotFoundError("Beneficiary not found");
    }

    const testName = optText(body?.testName);
    if (!testName) throw new ApiError("testName is required", 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await this.labOrderRepository.findCampRef(campId);
      if (!camp) {
        log.warn("lab_order_camp_not_found", { campId, actor: session.userId });
        throw new NotFoundError("Camp not found");
      }
    }
    const encounterId = optText(body?.encounterId);
    if (encounterId) {
      const enc = await this.labOrderRepository.findEncounterRef(encounterId);
      if (!enc) {
        log.warn("lab_order_encounter_not_found", {
          encounterId,
          actor: session.userId,
        });
        throw new NotFoundError("Encounter not found");
      }
    }

    const code = await nextLabCode();
    const order = await this.labOrderRepository.createOrder({
      code,
      beneficiaryId,
      campId,
      encounterId,
      testName,
      orderedByName: session.name,
    });

    log.info("lab_order_created", {
      orderId: order.id,
      code: order.code,
      beneficiaryId,
      ...(campId ? { campId } : {}),
      ...(encounterId ? { encounterId } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "LAB_ORDER_CREATE",
      "LAB_ORDER",
      `${code} — ${testName} for ${beneficiary.code}`,
      session.userId
    );

    return order;
  }

  /** GET /api/lab-orders/:id — ADMIN | DOCTOR | LAB_TECH | NURSE. */
  async getDetail(id: string): Promise<LabOrderRow> {
    const order = await this.labOrderRepository.findByIdWithInclude(id);
    if (!order) throw new NotFoundError("Lab order not found");
    return order;
  }

  /** PATCH /api/lab-orders/:id — enforced transitions:
   *    ORDERED→SAMPLE_COLLECTED (collectedAt) →RECEIVED→PROCESSING
   *    →RESULT_AVAILABLE (resultText / resultFileUrl)   [LAB_TECH | ADMIN]
   *    RESULT_AVAILABLE→VERIFIED (verifiedByName/verifiedAt)  [LAB_TECH | ADMIN]
   *    VERIFIED→DOCTOR_REVIEWED (reviewedAt)                  [DOCTOR | ADMIN]
   *  `critical` may be set by DOCTOR | ADMIN alongside a transition or alone. */
  async update(id: string, body: UpdateLabOrderBody, session: Session): Promise<LabOrderRow> {
    const existing: LabOrderExisting | null = await this.labOrderRepository.findById(id);
    if (!existing) {
      log.warn("lab_order_update_not_found", { orderId: id, actor: session.userId });
      throw new NotFoundError("Lab order not found");
    }

    const isAdmin = session.role === "ADMIN";
    const isLabTech = session.role === "LAB_TECH";
    const isDoctor = session.role === "DOCTOR";

    const data: Record<string, unknown> = {};

    // resultFileUrl is validated whenever provided (transition or standalone
    // correction): file-manager assets (/api/files/:id/file) or https only.
    if (body?.resultFileUrl !== undefined) {
      const resultFileUrl = optText(body?.resultFileUrl);
      if (resultFileUrl && !FILE_URL_RE.test(resultFileUrl))
        throw new ApiError("resultFileUrl must be a /api/files/:id/file URL or an https URL", 400);
      if (!isLabTech && !isAdmin) {
        log.warn("lab_order_result_file_forbidden", {
          orderId: id,
          actor: session.userId,
        });
        throw new ApiError("Only lab staff (or an admin) can attach result files", 403);
      }
      if (resultFileUrl !== null) data.resultFileUrl = resultFileUrl;
    }

    // ── status transition ──────────────────────────────────────────────────
    if (body?.status !== undefined && String(body.status) !== existing.status) {
      const target = String(body.status);
      const expected = LAB_ORDER_NEXT[existing.status];
      if (!expected) {
        log.warn("lab_order_transition_terminal", {
          orderId: id,
          code: existing.code,
          status: existing.status,
          actor: session.userId,
        });
        throw new ApiError(
          `Lab order ${existing.code} is already ${existing.status} — no further transitions`,
          409
        );
      }
      if (target !== expected) {
        log.warn("lab_order_invalid_transition", {
          orderId: id,
          code: existing.code,
          from: existing.status,
          to: target,
          expected,
          actor: session.userId,
        });
        throw new ApiError(
          `Invalid transition ${existing.status} → ${target}. Expected ${existing.status} → ${expected}`,
          409
        );
      }
      if (target === "DOCTOR_REVIEWED") {
        if (!isDoctor && !isAdmin) {
          log.warn("lab_order_review_forbidden", {
            orderId: id,
            code: existing.code,
            to: target,
            actor: session.userId,
          });
          throw new ApiError("Only a doctor (or an admin) can mark a result DOCTOR_REVIEWED", 403);
        }
        data.reviewedAt = new Date();
      } else {
        if (!isLabTech && !isAdmin) {
          log.warn("lab_order_transition_forbidden", {
            orderId: id,
            code: existing.code,
            to: target,
            actor: session.userId,
          });
          throw new ApiError(`Only lab staff (or an admin) can move an order to ${target}`, 403);
        }
        if (target === "SAMPLE_COLLECTED") data.collectedAt = new Date();
        if (target === "VERIFIED") {
          data.verifiedAt = new Date();
          data.verifiedByName = session.name;
        }
        if (target === "RESULT_AVAILABLE") {
          const resultText = optText(body?.resultText);
          if (!resultText && !data.resultFileUrl && !existing.resultText && !existing.resultFileUrl)
            throw new ApiError("Provide resultText or resultFileUrl when moving to RESULT_AVAILABLE", 400);
          if (resultText !== null) data.resultText = resultText;
        }
      }
      data.status = target;
    }

    // ── critical flag (DOCTOR | ADMIN) ─────────────────────────────────────
    if (body?.critical !== undefined) {
      if (!isDoctor && !isAdmin) {
        log.warn("lab_order_critical_forbidden", {
          orderId: id,
          code: existing.code,
          actor: session.userId,
        });
        throw new ApiError("Only a doctor (or an admin) can flag a result critical", 403);
      }
      data.critical = Boolean(body.critical);
    }

    if (Object.keys(data).length === 0)
      throw new ApiError(
        existing.status === "VERIFIED"
          ? "Nothing to update — send { status: \"DOCTOR_REVIEWED\" } to complete doctor review"
          : "Nothing to update",
        400
      );

    const order = await this.labOrderRepository.updateOrder(id, data);

    log.info("lab_order_updated", {
      orderId: id,
      code: existing.code,
      ...(data.status !== undefined
        ? { from: existing.status, to: String(data.status) }
        : { fields: Object.keys(data) }),
      ...(data.critical !== undefined ? { critical: data.critical } : {}),
      actor: session.userId,
    });

    const changed = data.status !== undefined;
    await logActivity(
      session.name,
      changed ? `LAB_ORDER_${String(data.status)}` : "LAB_ORDER_UPDATE",
      "LAB_ORDER",
      `${existing.code} (${existing.testName}) — ${changed ? `${existing.status} → ${String(data.status)}` : "critical flag updated"}`,
      session.userId
    );

    return order;
  }
}
