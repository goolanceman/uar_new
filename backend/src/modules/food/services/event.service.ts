/**
 * Event service — the events desk: public/admin/mine listings, creation,
 * the operations-brain detail projection (requirements vs stock, packing
 * progress, expiry alerts), lifecycle transitions with stock side-effects
 * (cancellation releases reservations; reconciliation returns undistributed
 * issued stock) and programme spend. Requirement maths and stock returns
 * come from the shared domain layer @/lib/food.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { assertEventTransition, calcRequirements, foodWindowDays, FOOD_ACTIVE_REG_STATUSES, returnIssuedAllocation } from "@/lib/food";
import { nextFoodEventCode } from "@/lib/codes";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type { FoodBody } from "../schemas/food.schema";
import type { EventUpdateData, FoodEventRepository, PublicEventRow } from "../repositories/food-event.repository.interface";
import type { FoodInventoryRepository } from "../repositories/food-inventory.repository.interface";
import type { FoodProgrammeRepository } from "../repositories/food-programme.repository.interface";
import type { FoodRequestRepository } from "../repositories/food-request.repository.interface";
import type { FoodRegistrationRepository } from "../repositories/food-registration.repository.interface";

const log = logger.child("food");

const EVENT_TYPES = [
  "COMMUNITY", "HOME_DELIVERY", "DOOR_TO_DOOR", "KITCHEN", "MEAL_SERVING",
  "MONTHLY_KIT", "EMERGENCY", "INSTITUTION", "SCHOOL", "RURAL", "MOBILE",
];

/** Public-safe event projection — exact address & budget never leave admin. */
function publicEvent(e: PublicEventRow) {
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

/** Legacy `new Date(body.x)` over raw JSON values (epoch number | ISO string). */
const toDate = (v: unknown): Date => new Date(v as string | number);

export class EventService {
  constructor(
    private readonly eventRepository: FoodEventRepository,
    private readonly inventoryRepository: FoodInventoryRepository,
    private readonly programmeRepository: FoodProgrammeRepository,
    private readonly requestRepository: FoodRequestRepository,
    private readonly registrationRepository: FoodRegistrationRepository
  ) {}

  /** GET /api/food/events?public=1 — public list (safe fields only). */
  async listPublic(): Promise<unknown> {
    const rows = await this.eventRepository.listPublicEvents();
    return rows.map(publicEvent);
  }

  /** GET /api/food/events?mine=1 — BENEFICIARY: own registrations. */
  async listMine(session: Session): Promise<unknown> {
    const beneficiary = await this.requestRepository.findBeneficiaryByUserId(session.userId);
    if (!beneficiary) return [];
    return this.eventRepository.listMyRegistrations(beneficiary.id);
  }

  /** GET /api/food/events — ADMIN list w/ filters. */
  async listAdmin(sp: URLSearchParams): Promise<unknown> {
    return this.eventRepository.listEvents({
      status: sp.get("status"),
      programmeId: sp.get("programmeId"),
      city: sp.get("city"),
      q: sp.get("q")?.trim(),
    });
  }

  /** POST /api/food/events — ADMIN create. */
  async create(body: FoodBody, session: Session): Promise<unknown> {
    const programmeId = String(body?.programmeId ?? "");
    const programme = await this.programmeRepository.findProgrammeById(programmeId);
    if (!programme) {
      log.warn("food_programme_not_found", { programmeId, actor: session.userId });
      throw new ApiError("Parent food programme is required", 400);
    }

    const title = String(body?.title ?? "").trim();
    const venue = String(body?.venue ?? "").trim();
    if (!title || !venue) throw new ApiError("Title and venue are required", 400);
    if (!body?.eventDate || isNaN(new Date(body.eventDate as string | number).getTime()))
      throw new ApiError("A valid event date is required", 400);

    const eventType = String(body?.eventType ?? "COMMUNITY").toUpperCase();
    if (!EVENT_TYPES.includes(eventType)) throw new ApiError("Invalid event type", 400);

    const campaignId = body?.campaignId ? String(body.campaignId) : null;
    if (campaignId && !(await this.eventRepository.findCampaignById(campaignId)))
      throw new ApiError("Linked campaign was not found", 400);

    const packageTemplateId = body?.packageTemplateId ? String(body.packageTemplateId) : null;
    if (packageTemplateId) {
      const tpl = await this.eventRepository.findKitTemplateById(packageTemplateId);
      if (!tpl) throw new ApiError("Package template was not found", 400);
    }

    const maxCapacity = Number(body?.maxCapacity) > 0 ? Number(body.maxCapacity) : null;
    const plannedUnits = Math.max(0, Number(body?.plannedUnits) || 0);
    if (maxCapacity && plannedUnits > maxCapacity) {
      log.warn("food_event_capacity_exceeded", { plannedUnits, maxCapacity, actor: session.userId });
      throw new ApiError("Planned packages exceed the maximum capacity", 400);
    }

    const row = await this.eventRepository.createEvent({
      code: await nextFoodEventCode(),
      programmeId,
      campaignId: campaignId ?? programme.campaignId,
      title,
      description: body?.description ? String(body.description).trim() : null,
      eventDate: toDate(body.eventDate),
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
      registrationDeadline: body?.registrationDeadline ? toDate(body.registrationDeadline) : null,
      registrationOpen: body?.registrationOpen !== false,
      publicVisible: body?.publicVisible !== false,
      specialInstructions: body?.specialInstructions ? String(body.specialInstructions).trim() : null,
      budget: Number(body?.budget) > 0 ? Number(body.budget) : null,
      createdByName: session.name,
    });

    log.info("food_event_created", {
      eventId: row.id,
      code: row.code,
      title: row.title,
      eventType: row.eventType,
      plannedUnits: row.plannedUnits,
      actor: session.userId,
    });
    await logActivity(session.name, "FOOD_EVENT_CREATE", "FoodEvent", `${row.code} — ${row.title}`, session.userId);
    return row;
  }

  /** GET /api/food/events/:id — lifecycle, requirements vs stock, packing progress. */
  async detail(id: string): Promise<unknown> {
    const event = await this.eventRepository.findEventDetail(id);
    if (!event) throw new ApiError("Food event not found", 404);

    const inventory = await this.inventoryRepository.listFoodKitInventory();

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
    const expiringBatches = await this.inventoryRepository.listExpiringPassedBatches(expiryAlertDays);

    return {
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
    };
  }

  /**
   * PATCH /api/food/events/:id — ADMIN lifecycle transitions + field edits.
   * CANCELLED releases every still-RESERVED allocation back to its batch;
   * RECONCILED returns undistributed issued stock (10 issued, 7 delivered →
   * 3 returned) via the shared lib helper.
   */
  async update(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const event = await this.eventRepository.findEventById(id);
    if (!event) {
      log.warn("food_event_not_found", { eventId: id, actor: session.userId });
      throw new ApiError("Food event not found", 404);
    }

    const data: EventUpdateData = {};
    if (body?.title !== undefined) data.title = String(body.title).trim();
    if (body?.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
    if (body?.eventDate !== undefined && body.eventDate) data.eventDate = toDate(body.eventDate);
    if (body?.startTime !== undefined) data.startTime = body.startTime ? String(body.startTime).trim() : null;
    if (body?.endTime !== undefined) data.endTime = body.endTime ? String(body.endTime).trim() : null;
    if (body?.venue !== undefined) data.venue = String(body.venue).trim();
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.address !== undefined) data.address = body.address ? String(body.address).trim() : null;
    if (body?.coordinatorName !== undefined) data.coordinatorName = body.coordinatorName ? String(body.coordinatorName).trim() : null;
    if (body?.registrationDeadline !== undefined) data.registrationDeadline = body.registrationDeadline ? toDate(body.registrationDeadline) : null;
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

    const updated = await withTransaction(async (tx) => {
      const row = await this.eventRepository.updateEvent(id, data, tx);

      // Cancellation returns still-reserved stock (issued stock is handled at
      // reconciliation — packages may already be in the field).
      if (data.status === "CANCELLED") {
        const reserved = await this.inventoryRepository.listReservedAllocations(id, tx);
        log.debug("food_event_cancellation_releasing_reservations", {
          eventId: id,
          reservations: reserved.length,
          actor: session.userId,
        });
        for (const a of reserved) {
          await this.inventoryRepository.updateAllocationStatus(a.id, "CANCELLED", tx);
          await this.inventoryRepository.decrementBatchReserved(a.batchId, a.quantity, tx);
        }
      }

      // Reconciliation: undistributed issued stock goes back to the batches
      // and master inventory. Delivered units are the real handover record —
      // never assumed.
      if (data.status === "RECONCILED") {
        const deliveredAgg = await this.registrationRepository.aggregateDeliveredUnits(id, tx);
        const issued = await this.inventoryRepository.listIssuedAllocations(id, tx);
        const totalIssued = issued.reduce((s, a) => s + a.quantity, 0);
        log.debug("food_event_reconciliation_returning_stock", {
          eventId: id,
          issued: totalIssued,
          delivered: deliveredAgg._sum.unitsDelivered ?? 0,
          actor: session.userId,
        });
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

    log.info("food_event_updated", {
      eventId: id,
      code: updated.code,
      status: updated.status,
      statusChanged: data.status !== undefined,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FOOD_EVENT_UPDATE",
      "FoodEvent",
      `${updated.code} → ${updated.status}${data.statusReason ? ` (${data.statusReason})` : ""}`,
      session.userId
    );
    return updated;
  }

  /** GET /api/food/events/:id/expenses — ADMIN/VOLUNTEER. */
  async listExpenses(eventId: string): Promise<unknown> {
    return this.eventRepository.listExpenses(eventId);
  }

  /** POST /api/food/events/:id/expenses — ADMIN record programme spend. */
  async createExpense(eventId: string, body: FoodBody, session: Session): Promise<unknown> {
    const event = await this.eventRepository.findEventById(eventId);
    if (!event) {
      log.warn("food_event_not_found", { eventId, actor: session.userId });
      throw new ApiError("Food event not found", 404);
    }

    const head = String(body?.head ?? "").trim();
    const amount = Number(body?.amount);
    if (!head) throw new ApiError("Expense head is required", 400);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("Amount must be greater than zero", 400);

    const row = await this.eventRepository.createExpense({
      eventId,
      head,
      amount,
      notes: body?.notes ? String(body.notes).trim() : null,
      spentByName: session.name,
    });

    log.info("food_expense_created", {
      expenseId: row.id,
      eventId,
      eventCode: event.code,
      head,
      amount,
      actor: session.userId,
    });
    await logActivity(session.name, "FOOD_EXPENSE_CREATE", "FoodEventExpense", `${event.code}: ${head} ₹${amount}`, session.userId);
    return row;
  }
}
