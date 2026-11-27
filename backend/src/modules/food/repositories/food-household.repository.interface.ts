/**
 * Food household repository contract — Household + HouseholdMember
 * persistence for the household registry. The service layer depends on this
 * interface, never on Prisma directly. Transactional methods accept the
 * caller's `client` (withTransaction boundary) — repositories never obtain
 * clients themselves.
 */
import type { Household, HouseholdMember } from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type HouseholdRow = Household;
export type HouseholdMemberRow = HouseholdMember;

/** GET /households — registry include (head + members + registration count). */
export type HouseholdListRow = Household & {
  headBeneficiary: { id: string; code: string; name: string } | null;
  members: HouseholdMember[];
  _count: { registrations: number };
};

/** Delete guard include (registration count). */
export type HouseholdWithCount = Household & { _count: { registrations: number } };

export interface HouseholdCreateData {
  code: string;
  name: string;
  headBeneficiaryId: string | null;
  primaryPhone: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  size: number;
  childrenCount: number;
  seniorCount: number;
  incomeRange: string | null;
  notes: string | null;
  createdByName: string;
}

export interface HouseholdMemberCreateData {
  householdId: string;
  beneficiaryId: string | null;
  name: string;
  age: number | null;
  relation: string | null;
}

/** PATCH field patch — keys exist only when the legacy handler set them. */
export interface HouseholdUpdateData {
  name?: string;
  primaryPhone?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  size?: number;
  childrenCount?: number;
  seniorCount?: number;
  incomeRange?: string | null;
  notes?: string | null;
  headBeneficiaryId?: string | null;
}

export interface FoodHouseholdRepository {
  listHouseholds(q?: string | null): Promise<HouseholdListRow[]>;
  findHouseholdById(id: string): Promise<HouseholdRow | null>;
  findHouseholdWithCount(id: string): Promise<HouseholdWithCount | null>;
  /** code is unique — constraint failures render as conflicts. */
  createHousehold(data: HouseholdCreateData, client: DbClient): Promise<HouseholdRow>;
  createHouseholdMember(data: HouseholdMemberCreateData, client: DbClient): Promise<HouseholdMemberRow>;
  updateHousehold(id: string, data: HouseholdUpdateData, client: DbClient): Promise<HouseholdRow>;
  deleteHouseholdMembers(memberIds: string[], householdId: string, client: DbClient): Promise<void>;
  /** Registrations FK — constraint failures render as conflicts. */
  deleteHousehold(id: string): Promise<void>;
}
