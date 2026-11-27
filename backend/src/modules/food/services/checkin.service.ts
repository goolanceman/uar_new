/**
 * Check-in service — the distribution desk endpoint.
 *
 * action=lookup   → verify a beneficiary at the venue and check them in.
 * action=checkout → record the actual handover (items, quantities,
 * acknowledgement). Idempotent: a DISTRIBUTED registration can never be
 * handed over twice, and offlineRef makes offline sync replay-safe.
 *
 * Roles: ADMIN anywhere; VOLUNTEER only on events they hold a FOOD_EVENT
 * task for — volunteers can never touch unassigned events (that scoping is
 * enforced here, in legacy order: resolve → disambiguation → role scoping →
 * event/registration state gates → offline replay → action). Registration
 * transitions come from the shared domain layer @/lib/food; the claim-style
 * updateMany transactions (two concurrent scans can never double write) are
 * preserved exactly via withTransaction.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import { assertTransition } from "@/lib/workflow";
import { FOOD_ACK_METHODS, FOOD_OPERATIONAL_STATUSES, FOOD_REGISTRATION_TRANSITIONS } from "@/lib/food";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type { FoodBody } from "../schemas/food.schema";
import type {
  FoodRegistrationRepository,
  RegistrationCandidate,
  RegistrationWithEvent,
} from "../repositories/food-registration.repository.interface";

const log = logger.child("food");

export class CheckinService {
  constructor(private readonly registrationRepository: FoodRegistrationRepository) {}

  /** POST /api/food/checkin — returns the JSON payload for the controller. */
  async handle(body: FoodBody, session: Session): Promise<unknown> {
    const action = String(body?.action ?? "lookup");

    const code = String(body?.code ?? "").trim();
    if (!code) throw new ApiError("Enter a registration code, beneficiary code or phone number", 400);
    const eventId = body?.eventId ? String(body.eventId) : null;
    const offlineRef = body?.offlineRef ? String(body.offlineRef).trim() : null;

    // ── resolve the registration ────────────────────────────────────────────
    let reg: RegistrationWithEvent | RegistrationCandidate | null = null;
    if (code.toUpperCase().startsWith("UAR-FREG")) {
      reg = await this.registrationRepository.findRegistrationByEventCode(code.toUpperCase());
      if (reg && eventId && reg.eventId !== eventId)
        throw new ApiError("This registration belongs to a different distribution event", 409);
    }

    if (!reg) {
      const candidates = await this.registrationRepository.listRegistrationCandidates(code, eventId);
      if (candidates.length === 1) reg = candidates[0];
      else if (candidates.length > 1) {
        log.debug("food_checkin_needs_disambiguation", {
          matches: candidates.length,
          eventId,
          actor: session.userId,
        });
        return {
          needsDisambiguation: true,
          matches: candidates.map((c) => ({
            registrationId: c.id, code: c.code, status: c.status,
            name: c.beneficiary.name, beneficiaryCode: c.beneficiary.code,
            eventTitle: c.event.title,
          })),
        };
      }
    }

    if (!reg) throw new ApiError("No registration found for that code, ID or phone number", 404);
    log.debug("food_checkin_resolved", {
      registrationId: reg.id,
      code: reg.code,
      eventId: reg.eventId,
      status: reg.status,
      actor: session.userId,
    });

    // Non-null alias usable inside the transaction closures below.
    const current = reg;

    // ── role scoping ────────────────────────────────────────────────────────
    if (session.role === "VOLUNTEER") {
      const volunteer = await this.registrationRepository.findVolunteerByUserId(session.userId);
      const assigned = volunteer
        ? await this.registrationRepository.findActiveEventTask(volunteer.id, current.eventId)
        : null;
      if (!assigned) {
        log.warn("food_checkin_volunteer_not_assigned", { registrationId: current.id, eventId: current.eventId, actor: session.userId });
        throw new ApiError("You are not assigned to this distribution event", 403);
      }
    }

    const event = current.event;
    if (!FOOD_OPERATIONAL_STATUSES.includes(event.status)) {
      log.warn("food_checkin_event_not_operational", {
        registrationId: current.id,
        eventId: event.id,
        eventCode: event.code,
        status: event.status,
        actor: session.userId,
      });
      throw new ApiError(`Distribution is not operational right now (event is ${event.status})`, 409);
    }

    if (["CANCELLED", "REJECTED", "NO_SHOW"].includes(current.status)) {
      log.warn("food_checkin_registration_blocked", {
        registrationId: current.id,
        code: current.code,
        status: current.status,
        actor: session.userId,
      });
      throw new ApiError(`This registration is ${current.status.toLowerCase()} — reinstate it from the admin desk first`, 409);
    }

    if (["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"].includes(current.status)) {
      log.warn("food_checkin_duplicate_handover_blocked", {
        registrationId: current.id,
        code: current.code,
        status: current.status,
        eventCode: event.code,
        actor: session.userId,
      });
      throw new ApiError(
        `Food was already handed over to ${current.beneficiaryId ? "this beneficiary" : "them"} for ${event.code} — duplicate handover blocked`,
        409
      );
    }

    // Offline replay: same offlineRef returns the same outcome, no double write.
    if (offlineRef) {
      const replay = await this.registrationRepository.findCheckInByOfflineRef(offlineRef);
      if (replay) {
        log.debug("food_checkin_offline_replay", {
          offlineRef,
          registrationId: replay.registrationId,
          actor: session.userId,
        });
        const existing = await this.registrationRepository.findRegistrationReplay(replay.registrationId);
        return { replayed: true, registration: existing };
      }
    }

    if (action === "lookup") {
      // Idempotent check-in — re-lookup of a CHECKED_IN person is fine.
      const checkedIn = current.status === "CHECKED_IN";
      if (!checkedIn) {
        assertTransition(FOOD_REGISTRATION_TRANSITIONS, current.status, "CHECKED_IN", "food registration", 409);
        // Claim the status first in the transaction, so two concurrent scans
        // cannot create duplicate check-in records for the same registration.
        await withTransaction(async (tx) => {
          const claimed = await this.registrationRepository.claimRegistration(
            current.id,
            current.status,
            { status: "CHECKED_IN" },
            tx
          );
          if (claimed !== 1) {
            log.warn("food_checkin_concurrent_conflict", { registrationId: current.id, code: current.code, actor: session.userId });
            throw new ApiError("Registration changed while check-in was being processed", 409);
          }
          await this.registrationRepository.createCheckIn({
            registrationId: current.id,
            eventId: current.eventId,
            method: body?.method ? String(body.method).toUpperCase() : "QR",
            operatorId: session.userId,
            operatorName: session.name,
            offlineRef,
          }, tx);
        });
      }

      log.info("food_registration_checked_in", {
        registrationId: current.id,
        code: current.code,
        eventId: current.eventId,
        actor: session.userId,
      });
      const fresh = await this.registrationRepository.findRegistrationFresh(current.id);
      return {
        checkedIn: true,
        alreadyCheckedIn: checkedIn,
        registration: fresh,
        packageSnapshot: fresh?.packageSnapshot ? JSON.parse(fresh.packageSnapshot) : null,
      };
    }

    if (action === "checkout") {
      if (current.status !== "CHECKED_IN") {
        log.warn("food_checkout_not_checked_in", { registrationId: current.id, code: current.code, status: current.status, actor: session.userId });
        throw new ApiError("Check the beneficiary in before recording the handover", 409);
      }

      const units = Math.max(0, Number(body?.unitsDelivered ?? current.unitsAllocated));
      if (units > current.unitsAllocated) {
        log.warn("food_checkout_units_exceed_allocation", {
          registrationId: current.id,
          code: current.code,
          units,
          unitsAllocated: current.unitsAllocated,
          actor: session.userId,
        });
        throw new ApiError(`Only ${current.unitsAllocated} unit(s) were allocated for this registration`, 400);
      }

      const ackMethod = String(body?.ackMethod ?? "DIGITAL").toUpperCase();
      if (!FOOD_ACK_METHODS.includes(ackMethod))
        throw new ApiError("Invalid acknowledgement method", 400);

      const partial = units > 0 && units < current.unitsAllocated;
      const none = units === 0;
      const targetStatus = none ? "NOT_COLLECTED" : partial ? "PARTIALLY_DISTRIBUTED" : "DISTRIBUTED";
      assertTransition(FOOD_REGISTRATION_TRANSITIONS, current.status, targetStatus, "food registration", 409);

      const updated = await withTransaction(async (tx) => {
        const changed = await this.registrationRepository.claimRegistration(current.id, "CHECKED_IN", {
          status: targetStatus,
          unitsDelivered: units,
          ackMethod,
          ackByName: body?.ackByName ? String(body.ackByName).trim() : session.name,
          ackRef: body?.ackRef ? String(body.ackRef).trim() : null,
          ackAt: new Date(),
          reason: none ? "BENEFICIARY_DECLINED" : partial ? "PARTIAL_COLLECTION" : null,
        }, tx);
        if (changed !== 1) {
          log.warn("food_checkout_concurrent_conflict", { registrationId: current.id, code: current.code, actor: session.userId });
          throw new ApiError("Registration was already handed over or changed", 409);
        }
        return this.registrationRepository.findRegistrationForHandover(current.id, tx);
      });

      log.info("food_handover_recorded", {
        registrationId: current.id,
        code: current.code,
        units,
        unitsAllocated: current.unitsAllocated,
        status: targetStatus,
        ackMethod,
        actor: session.userId,
      });
      await logActivity(
        session.name,
        "FOOD_HANDOVER",
        "FoodRegistration",
        `${current.code}: ${units}/${current.unitsAllocated} unit(s), ack ${ackMethod}`,
        session.userId
      );
      return { handedOver: true, registration: updated };
    }

    throw new ApiError("action must be lookup or checkout", 400);
  }
}
