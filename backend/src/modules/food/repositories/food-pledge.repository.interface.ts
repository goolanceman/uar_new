/**
 * Food pledge repository contract — FoodDonationPledge persistence for the
 * pickups desk. The service layer depends on this interface, never on Prisma
 * directly. Transactional methods accept the caller's `client`
 * (withTransaction boundary) — repositories never obtain clients themselves.
 */
import type { FoodDonationPledge } from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type PledgeRow = FoodDonationPledge;

export interface PledgeCreateData {
  code: string;
  userId: string | null;
  donorName: string;
  phone: string;
  email: string | null;
  orgName: string | null;
  items: string;
  pickupAddress: string;
  city: string | null;
  pincode: string | null;
  availability: string | null;
  storageNotes: string | null;
  createdByName: string;
}

/** Conditional claim data — keys exist only when the legacy handler set them. */
export interface PledgeClaimData {
  status: string;
  scheduledFor?: Date;
  assignedToName?: string;
  receivedBatchNo?: string;
  notes?: string | null;
  rejectionReason?: string;
}

export interface NotificationCreateData {
  title: string;
  message: string;
  type: string;
  actionUrl: string;
}

export interface FoodPledgeRepository {
  /** Signed-in donor's own pledges, newest first (max 50). */
  listPledgesByUser(userId: string): Promise<PledgeRow[]>;
  /** Pickups desk list, newest first (max 200), optional status filter. */
  listPledges(status?: string | null): Promise<PledgeRow[]>;
  findPledgeById(id: string): Promise<PledgeRow | null>;
  countPledges(): Promise<number>;
  /** Code-loop uniqueness probe. */
  findPledgeCodeOwner(code: string): Promise<{ code: string } | null>;
  /** Double-submit guard: same phone + items PENDING within the window. */
  findDuplicatePledge(phone: string, items: string, since: Date): Promise<{ code: string } | null>;
  /** code is unique — constraint failures render as conflicts. */
  createPledge(data: PledgeCreateData): Promise<PledgeRow>;
  createNotification(data: NotificationCreateData): Promise<void>;
  /** Conditional updateMany (id + expected status) → changed row count. */
  claimPledgeStatus(id: string, fromStatus: string, data: PledgeClaimData, client?: DbClient): Promise<number>;
  findPledgeByIdOrThrow(id: string, client?: DbClient): Promise<PledgeRow>;
}
