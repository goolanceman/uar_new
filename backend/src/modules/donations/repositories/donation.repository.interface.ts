/**
 * Donation repository contract — persistence for the donations module: the
 * multi-mode list (mine / donor wall / public wall / admin), the guest+
 * session create flow, recurring commitments, and the admin edit/delete.
 * The service layer depends on this interface, never on Prisma directly.
 *
 * Transactional create-flow methods accept an optional `client`
 * (Prisma.TransactionClient) so the service can run the donor upsert +
 * donation create inside ONE withTransaction boundary — repositories never
 * obtain clients themselves.
 */
import type { Campaign, Donation, Donor, FoodEvent, Pledge } from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

export type DonationRow = Donation;
export type DonorRow = Donor;
export type CampaignRow = Campaign;
export type FoodEventRow = FoodEvent;
export type PledgeRow = Pledge;

/** POST / create result — the donation row with its campaign-title include. */
export type DonationWithCampaignTitle = Donation & { campaign: { title: string } | null };

/** GET / mine + public wall include (campaign title + accent). */
export type DonationWithCampaignAccent = Donation & { campaign: { title: string; accent: string } | null };

/** GET /?wall=1 include — campaign summary + donor identity for the app. */
export type DonationWallRow = Donation & {
  campaign: { id: string; title: string; slug: string } | null;
  donor: { id: string; name: string; username: string | null; avatar: string | null } | null;
};

/** GET / signed-in (admin/staff) list include — campaign + donor CRM tags. */
export type DonationAdminRow = Donation & {
  campaign: { title: string; accent: string } | null;
  donorRef: { id: string; category: string | null; tags: string | null } | null;
};

/** GET /:id detail include — full campaign summary + full Donor CRM row. */
export type DonationDetailRow = Donation & {
  campaign: { id: string; title: string; accent: string; slug: string } | null;
  donorRef: Donor | null;
};

/** GET /recurring/mine parent include — campaign summary. */
export type RecurringParentRow = Donation & {
  campaign: { id: string; title: string; accent: string } | null;
};

/** GET / admin-list filters — raw strings; the repository applies the legacy
 *  truthy/date-parse semantics exactly (status also matches paymentStatus). */
export interface DonationListFilters {
  campaignId: string | null;
  status: string | null;
  type: string | null;
  category: string | null;
  method: string | null;
  from: string | null;
  to: string | null;
  q: string | null;
}

/** Donor CRM record created on first gift (inside the create transaction). */
export interface CreateDonorData {
  code: string;
  name: string;
  email: string;
  phone: string | null;
  pan: string | null;
  source: string;
  category: string;
}

/** Donor CRM record refreshed on a repeat gift. */
export interface UpdateDonorData {
  name: string;
  phone: string | undefined;
  pan: string | undefined;
}

/** The donation row created by POST /. */
export interface CreateDonationData {
  donorId: string | null;
  donorRefId: string;
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  amount: number;
  currency: string;
  type: string;
  recurringFrequency: string | null;
  recurringStatus: string | null;
  nextChargeAt: Date | null;
  recurringParentId: string | null;
  pledgeId: string | null;
  category: string;
  paymentMethod: string;
  paymentProvider: string | null;
  paymentStatus: string;
  transactionId: string | null;
  gatewayOrderId: string | null;
  receiptNumber: string;
  receiptStatus: string;
  receiptIssuedAt: Date | null;
  campaignId: string | null;
  foodEventId: string | null;
  message: string | null;
  isAnonymous: boolean;
  pan: string | null;
}

/** Admin PATCH /:id — Donor CRM sync write (find+upsert by email). */
export interface DonorSyncInput {
  email: string;
  code: string;
  name: string;
  phone: string | null;
  pan: string | null;
}

export interface DonationRepository {
  // ── lookups ──────────────────────────────────────────────────────────────
  findDonationById(id: string, client?: DbClient): Promise<DonationRow | null>;
  findDonationDetail(id: string): Promise<DonationDetailRow | null>;
  findDonorByEmail(email: string, client?: DbClient): Promise<DonorRow | null>;
  findCampaignById(id: string): Promise<CampaignRow | null>;
  /** Title lookup for the COMPLETED-status donor notification ({title} | null). */
  findCampaignTitle(campaignId: string): Promise<{ title: string } | null>;
  findFoodEventById(id: string): Promise<FoodEventRow | null>;
  findPledgeById(id: string): Promise<PledgeRow | null>;

  // ── POST / create flow ───────────────────────────────────────────────────
  /** Legacy receipt generator: count + 1, then loop while the number exists. */
  nextReceiptNumber(): Promise<string>;
  createDonor(data: CreateDonorData, client?: DbClient): Promise<DonorRow>;
  updateDonorById(id: string, data: UpdateDonorData, client?: DbClient): Promise<DonorRow>;
  createDonation(data: CreateDonationData, client?: DbClient): Promise<DonationWithCampaignTitle>;
  incrementCampaignRaised(campaignId: string, amount: number): Promise<void>;
  updateUserPan(userId: string, pan: string): Promise<void>;

  // ── GET / multi-mode list ────────────────────────────────────────────────
  listMine(donorId: string, limit?: number): Promise<DonationWithCampaignAccent[]>;
  listDonorWall(
    campaignId: string,
    sortBy: string,
    sortDirection: "asc" | "desc",
    skip: number,
    limit: number
  ): Promise<{ rows: DonationWallRow[]; total: number; totalRaised: number }>;
  listPublicWall(): Promise<DonationWithCampaignAccent[]>;
  listAdmin(
    filters: DonationListFilters,
    skip: number,
    take: number
  ): Promise<{ rows: DonationAdminRow[]; total: number; completedSum: number }>;

  // ── recurring commitments ────────────────────────────────────────────────
  listRecurringParents(donorId: string): Promise<RecurringParentRow[]>;
  listInstallments(parentIds: string[]): Promise<DonationRow[]>;

  // ── admin edit / delete ──────────────────────────────────────────────────
  updateDonation(id: string, data: Record<string, unknown>): Promise<DonationRow>;
  deleteDonation(id: string): Promise<void>;
  upsertDonorRecord(input: DonorSyncInput): Promise<void>;

  /** raisedAmount ← sum of COMPLETED donations (invalidation lives in the
   *  service, matching the legacy ordering). */
  recomputeCampaignRaised(campaignId: string): Promise<void>;
}
