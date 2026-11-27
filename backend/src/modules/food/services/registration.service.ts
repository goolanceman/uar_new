/**
 * Registration service — event registrations (admin bulk/desk and
 * beneficiary self-service), emergency walk-ins, the admin queue lookup and
 * the registration lifecycle update. Legacy order is preserved exactly:
 * event lookup (404) → role branching → input checks → capacity gate →
 * tx-aware code generation → duplicate/reinstate handling. Package
 * snapshots come from the shared parser in @/lib/food.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { assertTransition } from "@/lib/workflow";
import { FOOD_ACTIVE_REG_STATUSES, FOOD_REGISTRATION_TRANSITIONS, parseTemplateItems } from "@/lib/food";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodEventRepository } from "../repositories/food-event.repository.interface";
import type {
  BeneficiaryRow,
  FoodRegistrationRepository,
  RegistrationClaimData,
} from "../repositories/food-registration.repository.interface";
import type { FoodRequestRepository } from "../repositories/food-request.repository.interface";

const log = logger.child("food");

const REG_REASONS = [
  "NO_SHOW", "PARTIAL_COLLECTION", "WRONG_PACKAGE", "INSUFFICIENT_STOCK",
  "BENEFICIARY_UNREACHABLE", "DELIVERY_FAILED", "BENEFICIARY_DECLINED", "CANCELLED", "OTHER",
];

export class RegistrationService {
  constructor(
    private readonly registrationRepository: FoodRegistrationRepository,
    private readonly eventRepository: FoodEventRepository,
    private readonly requestRepository: FoodRequestRepository
  ) {}

  /**
   * POST /api/food/events/:id/registrations
   *   ADMIN: { beneficiaryIds: string[] } bulk, or { beneficiaryId, unitsAllocated?, householdId?, notes? }
   *   BENEFICIARY: {} (self-registration on their own record)
   */
  async createForEvent(eventId: string, body: FoodBody, session: Session): Promise<unknown> {
    const event = await this.eventRepository.findEventWithTemplate(eventId);
    if (!event) {
      log.warn("food_event_not_found", { eventId, actor: session.userId });
      throw new ApiError("Food event not found", 404);
    }

    let beneficiaryIds: string[] = [];
    let isAdmin = false;

    if (session.role === "ADMIN") {
      isAdmin = true;
      if (Array.isArray(body?.beneficiaryIds)) beneficiaryIds = (body.beneficiaryIds as unknown[]).map(String);
      else if (body?.beneficiaryId) beneficiaryIds = [String(body.beneficiaryId)];
    } else if (session.role === "BENEFICIARY") {
      if (!event.registrationOpen || event.status !== "REGISTRATION_OPEN")
        throw new ApiError("Registration is not open for this distribution", 409);
      const deadlinePassed =
        event.registrationDeadline && new Date(event.registrationDeadline).getTime() < Date.now();
      if (deadlinePassed) throw new ApiError("The registration deadline has passed", 409);
      const own = await this.requestRepository.findBeneficiaryByUserId(session.userId);
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
      const activeCount = await this.registrationRepository.countActiveRegistrations(eventId, FOOD_ACTIVE_REG_STATUSES);
      if (activeCount + beneficiaryIds.length > event.maxCapacity) {
        log.warn("food_registration_capacity_exceeded", {
          eventId,
          maxCapacity: event.maxCapacity,
          activeCount,
          requested: beneficiaryIds.length,
          actor: session.userId,
        });
        throw new ApiError(
          `Capacity is ${event.maxCapacity} and ${activeCount} are already registered — increase capacity first`,
          409
        );
      }
    }

    const created: string[] = [];
    await withTransaction(async (tx) => {
      // tx-aware code generator — the shared nextFoodRegistrationCode() uses
      // the outer db client and can't see rows created earlier in this same
      // transaction, which would collide on the unique code inside the loop.
      let seq = await this.registrationRepository.countRegistrations(tx);
      const nextCode = async (): Promise<string> => {
        let code = `UAR-FREG-${String(++seq).padStart(5, "0")}`;
        while (await this.registrationRepository.findRegistrationCodeOwner(code, tx)) {
          code = `UAR-FREG-${String(++seq).padStart(5, "0")}`;
        }
        return code;
      };

      for (const beneficiaryId of beneficiaryIds) {
        const beneficiary = await this.registrationRepository.findBeneficiaryById(beneficiaryId, tx);
        if (!beneficiary) throw new ApiError(`Beneficiary not found (${beneficiaryId})`, 400);

        const dupe = await this.registrationRepository.findRegistrationForEventBeneficiary(eventId, beneficiaryId, tx);
        if (dupe) {
          if (["CANCELLED", "REJECTED"].includes(dupe.status)) {
            // reinstate a cancelled row instead of failing the whole batch
            await this.registrationRepository.reinstateRegistration(dupe.id, units, tx);
            created.push(dupe.code);
            continue;
          }
          log.warn("food_registration_duplicate", {
            eventId,
            beneficiaryId,
            registrationId: dupe.id,
            status: dupe.status,
            actor: session.userId,
          });
          throw new ApiError(`${beneficiary.name} already has a ${dupe.status} registration for this event`, 409);
        }

        const reg = await this.registrationRepository.createRegistration({
          code: await nextCode(),
          eventId,
          beneficiaryId,
          householdId,
          unitsAllocated: units,
          packageSnapshot: snapshot,
          status: isAdmin ? "REGISTERED" : "APPROVED", // self-service lands pre-approved for own profile
          registeredVia: isAdmin ? (beneficiaryIds.length > 1 ? "BULK" : "DESK") : "SELF",
          notes: body?.notes ? String(body.notes).trim() : null,
          createdByName: session.name,
        }, tx);
        created.push(reg.code);
      }
    });

    log.info("food_registrations_created", {
      eventId,
      eventCode: event.code,
      count: created.length,
      units,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FOOD_REGISTRATION_CREATE",
      "FoodEvent",
      `${event.code}: ${created.length} registration(s)`,
      session.userId
    );
    return { created };
  }

  /**
   * POST /api/food/events/:id/walkin — emergency walk-in at the distribution
   * desk. Creates the persistent UAR beneficiary identity AND the event
   * registration in one transaction, so nobody is ever turned away because
   * "they're not in the system". Walk-ins land pre-approved (APPROVED) so the
   * desk can hand over immediately.
   *
   * Roles: ADMIN anywhere; VOLUNTEER only on events they hold a FOOD_EVENT
   * task for (same rule as /api/food/checkin, minus the status filter).
   */
  async walkin(eventId: string, body: FoodBody, session: Session): Promise<unknown> {
    const name = String(body?.name ?? "").trim();
    if (!name || name.length < 3) throw new ApiError("Walk-in name is required", 400);
    const phoneRaw = body?.phone ? String(body.phone).replace(/[\s-]/g, "") : "";
    // Phone optional for walk-ins (homeless beneficiaries may not have one),
    // but when given it must be a real 10-digit Indian mobile number.
    if (phoneRaw && !/^(\+91)?[6-9]\d{9}$/.test(phoneRaw))
      throw new ApiError("Enter a valid Indian mobile number (or leave it blank)", 400);
    const units = Math.max(1, Number(body?.unitsAllocated) || 1);
    const householdSize = Math.max(1, Number(body?.householdSize) || 1);

    const event = await this.eventRepository.findEventWithTemplate(eventId);
    if (!event) {
      log.warn("food_event_not_found", { eventId, actor: session.userId });
      throw new ApiError("Food event not found", 404);
    }
    if (!["READY", "IN_PROGRESS", "PACKAGES_PREPARED", "STOCK_ALLOCATED"].includes(event.status)) {
      log.warn("food_walkin_event_not_operational", {
        eventId,
        eventCode: event.code,
        status: event.status,
        actor: session.userId,
      });
      throw new ApiError(`Walk-ins are only possible while distribution is operational (event is ${event.status})`, 409);
    }

    if (session.role === "VOLUNTEER") {
      const volunteer = await this.registrationRepository.findVolunteerByUserId(session.userId);
      const assigned = volunteer
        ? await this.registrationRepository.findEventTask(volunteer.id, eventId)
        : null;
      if (!assigned) {
        log.warn("food_walkin_volunteer_not_assigned", { eventId, actor: session.userId });
        throw new ApiError("You are not assigned to this distribution event", 403);
      }
    }

    if (event.maxCapacity) {
      const active = await this.registrationRepository.countActiveRegistrations(eventId, FOOD_ACTIVE_REG_STATUSES);
      if (active + 1 > event.maxCapacity) {
        log.warn("food_walkin_capacity_full", {
          eventId,
          maxCapacity: event.maxCapacity,
          activeCount: active,
          actor: session.userId,
        });
        throw new ApiError(`Event capacity (${event.maxCapacity}) is full`, 409);
      }
    }

    // Duplicate identity guard (§8 — never create duplicate beneficiaries):
    // 1. same phone already registered for THIS event → return that registration;
    // 2. same phone exists as a beneficiary from any earlier programme → reuse
    //    that identity and register it for this event.
    let beneficiary: BeneficiaryRow | null = null;
    if (phoneRaw) {
      const existingReg = await this.registrationRepository.findRegistrationByBeneficiaryPhone(eventId, phoneRaw.slice(-10));
      if (existingReg)
        return {
          existing: true,
          registration: existingReg,
          message: `${existingReg.beneficiary.name} is already registered (${existingReg.code}) — check them in instead.`,
        };
      beneficiary = await this.requestRepository.findBeneficiaryByPhoneContains(phoneRaw.slice(-10));
      if (beneficiary)
        log.debug("food_walkin_beneficiary_reused", {
          beneficiaryId: beneficiary.id,
          beneficiaryCode: beneficiary.code,
          eventId,
          actor: session.userId,
        });
    }

    const result = await withTransaction(async (tx) => {
      if (!beneficiary) {
        beneficiary = await this.requestRepository.createBeneficiary({
          code: await (async () => {
            let n = await this.requestRepository.countBeneficiaries(tx);
            let code = `UAR-BEN-${String(n + 1).padStart(5, "0")}`;
            while (await this.requestRepository.findBeneficiaryCodeOwner(code, tx)) {
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
        }, tx);
      } else if (name && !beneficiary.name) {
        await this.requestRepository.updateBeneficiaryName(beneficiary.id, name, tx);
        beneficiary = { ...beneficiary, name };
      }

      let seq = await this.registrationRepository.countRegistrations(tx);
      let regCode = `UAR-FREG-${String(seq + 1).padStart(5, "0")}`;
      while (await this.registrationRepository.findRegistrationCodeOwner(regCode, tx)) {
        seq += 1;
        regCode = `UAR-FREG-${String(seq + 1).padStart(5, "0")}`;
      }

      const registration = await this.registrationRepository.createRegistration({
        code: regCode,
        eventId,
        beneficiaryId: beneficiary.id,
        householdId: null,
        unitsAllocated: units,
        packageSnapshot: event.packageTemplate
          ? JSON.stringify(parseTemplateItems(event.packageTemplate.items))
          : null,
        status: "APPROVED", // walk-ins land pre-approved — the desk verifies in person
        registeredVia: "ASSISTED",
        notes: `Walk-in registered by ${session.name}`,
        createdByName: session.name,
      }, tx);
      return { beneficiary, registration };
    });

    log.info("food_walkin_registered", {
      eventId,
      eventCode: event.code,
      registrationId: result.registration.id,
      registrationCode: result.registration.code,
      beneficiaryId: result.beneficiary.id,
      beneficiaryCode: result.beneficiary.code,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FOOD_WALKIN_REGISTER",
      "FoodRegistration",
      `${event.code}: ${result.beneficiary.code} → ${result.registration.code}`,
      session.userId
    );
    return {
      beneficiary: { id: result.beneficiary.id, code: result.beneficiary.code, name: result.beneficiary.name },
      registration: result.registration,
    };
  }

  /** GET /api/food/registrations?eventId&status&q — admin queue lookup.
   *  q searches registration code, beneficiary name/code/phone. */
  async list(sp: URLSearchParams): Promise<unknown> {
    return this.registrationRepository.listRegistrations({
      eventId: sp.get("eventId"),
      status: sp.get("status"),
      q: sp.get("q")?.trim(),
    });
  }

  /** GET /api/food/events/:id/registrations — ADMIN/VOLUNTEER registration
   *  list for one event (oldest first, optional status filter). */
  async listForEvent(eventId: string, sp: URLSearchParams): Promise<unknown> {
    return this.registrationRepository.listEventRegistrations(eventId, sp.get("status"));
  }

  /**
   * PATCH /api/food/registrations/:id — ADMIN lifecycle (approve/reject/
   * cancel/no-show/reschedule/confirm). Handover itself happens via
   * /api/food/checkin. Status changes claim the row (updateMany on the
   * expected previous status) to refuse lost races; plain field edits update
   * directly — exactly like the legacy handler.
   */
  async update(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const reg = await this.registrationRepository.findRegistrationWithEventSummary(id);
    if (!reg) {
      log.warn("food_registration_not_found", { registrationId: id, actor: session.userId });
      throw new ApiError("Registration not found", 404);
    }

    const data: RegistrationClaimData = {};
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
      ? await withTransaction(async (tx) => {
          const changed = await this.registrationRepository.claimRegistration(id, reg.status, data, tx);
          if (changed !== 1)
            throw new ApiError("Registration changed while this update was being processed", 409);
          return this.registrationRepository.findRegistrationByIdOrThrow(id, tx);
        })
      : await this.registrationRepository.updateRegistration(id, data as { unitsAllocated?: number; notes?: string | null; householdId?: string | null; status?: string; reason?: string });
    log.info("food_registration_updated", {
      registrationId: id,
      code: reg.code,
      status: updated.status ?? reg.status,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FOOD_REGISTRATION_UPDATE",
      "FoodRegistration",
      `${reg.code} → ${updated.status ?? reg.status}`,
      session.userId
    );
    return updated;
  }
}
