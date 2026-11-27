/**
 * Household service — the household registry: search listing, creation with
 * members, member add/remove edits and guarded deletion. Legacy validation
 * order (name → size → pincode → head lookup) and the transaction boundary
 * around the member writes are preserved exactly; PIN validation comes from
 * the shared validator in @/shared/validators.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { validPin } from "@/shared/validators";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import { nextHouseholdCode } from "@/domains/codes";
import type { FoodBody } from "../schemas/food.schema";
import type { FoodHouseholdRepository } from "../repositories/food-household.repository.interface";
import type { FoodRequestRepository } from "../repositories/food-request.repository.interface";

const log = logger.child("food");

type MemberInput = Record<string, unknown>;

export class HouseholdService {
  constructor(
    private readonly householdRepository: FoodHouseholdRepository,
    private readonly requestRepository: FoodRequestRepository
  ) {}

  /** GET /api/food/households?q — ADMIN household registry. */
  async list(sp: URLSearchParams): Promise<unknown> {
    return this.householdRepository.listHouseholds(sp.get("q")?.trim());
  }

  /** POST /api/food/households — ADMIN create household + members. */
  async create(body: FoodBody, session: Session): Promise<unknown> {
    const name = String(body?.name ?? "").trim();
    if (!name) throw new ApiError("Household name is required", 400);
    const size = Number(body?.size);
    if (!Number.isInteger(size) || size < 1) throw new ApiError("Household size must be a positive whole number", 400);
    if (body?.pincode && !validPin(String(body.pincode)))
      throw new ApiError("PIN code must look like 560001", 400);

    const headBeneficiaryId = body?.headBeneficiaryId ? String(body.headBeneficiaryId) : null;
    if (headBeneficiaryId && !(await this.requestRepository.findBeneficiaryById(headBeneficiaryId))) {
      log.warn("food_household_head_not_found", { headBeneficiaryId, actor: session.userId });
      throw new ApiError("Head beneficiary not found", 400);
    }

    const members = Array.isArray(body?.members) ? (body.members as MemberInput[]) : [];
    const row = await withTransaction(async (tx) => {
      const household = await this.householdRepository.createHousehold({
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
      }, tx);
      for (const m of members) {
        const mName = String(m?.name ?? "").trim();
        if (!mName) continue;
        await this.householdRepository.createHouseholdMember({
          householdId: household.id,
          beneficiaryId: m?.beneficiaryId ? String(m.beneficiaryId) : null,
          name: mName,
          age: Number(m?.age) > 0 ? Number(m.age) : null,
          relation: m?.relation ? String(m.relation).toUpperCase() : null,
        }, tx);
      }
      return household;
    });

    log.info("food_household_created", {
      householdId: row.id,
      code: row.code,
      name: row.name,
      size,
      members: members.length,
      actor: session.userId,
    });
    await logActivity(session.name, "HOUSEHOLD_CREATE", "Household", `${row.code} — ${row.name}`, session.userId);
    return row;
  }

  /** PATCH /api/food/households/:id — ADMIN edit / add / remove members. */
  async update(id: string, body: FoodBody, session: Session): Promise<unknown> {
    const household = await this.householdRepository.findHouseholdById(id);
    if (!household) {
      log.warn("food_household_not_found", { householdId: id, actor: session.userId });
      throw new ApiError("Household not found", 404);
    }

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

    const updated = await withTransaction(async (tx) => {
      const row = await this.householdRepository.updateHousehold(id, data, tx);

      if (Array.isArray(body?.addMembers)) {
        for (const m of body.addMembers as MemberInput[]) {
          const mName = String(m?.name ?? "").trim();
          if (!mName) continue;
          await this.householdRepository.createHouseholdMember({
            householdId: id,
            beneficiaryId: m?.beneficiaryId ? String(m.beneficiaryId) : null,
            name: mName,
            age: Number(m?.age) > 0 ? Number(m.age) : null,
            relation: m?.relation ? String(m.relation).toUpperCase() : null,
          }, tx);
        }
      }
      if (Array.isArray(body?.removeMemberIds)) {
        await this.householdRepository.deleteHouseholdMembers((body.removeMemberIds as unknown[]).map(String), id, tx);
      }
      return row;
    });

    log.info("food_household_updated", {
      householdId: id,
      code: updated.code,
      fields: Object.keys(data),
      actor: session.userId,
    });
    await logActivity(session.name, "HOUSEHOLD_UPDATE", "Household", updated.code, session.userId);
    return updated;
  }

  /** DELETE /api/food/households/:id — ADMIN (only when no registrations exist). */
  async remove(id: string, session: Session): Promise<unknown> {
    const household = await this.householdRepository.findHouseholdWithCount(id);
    if (!household) {
      log.warn("food_household_not_found", { householdId: id, actor: session.userId });
      throw new ApiError("Household not found", 404);
    }
    if (household._count.registrations > 0) {
      log.warn("food_household_delete_blocked", {
        householdId: id,
        registrations: household._count.registrations,
        actor: session.userId,
      });
      throw new ApiError("This household has assistance registrations — archive it with a note instead of deleting", 409);
    }

    await this.householdRepository.deleteHousehold(id);
    log.info("food_household_deleted", { householdId: id, code: household.code, actor: session.userId });
    await logActivity(session.name, "HOUSEHOLD_DELETE", "Household", household.code, session.userId);
    return { deleted: true };
  }
}
