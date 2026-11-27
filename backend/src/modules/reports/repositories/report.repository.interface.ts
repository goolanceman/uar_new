/**
 * Reports repository contract — read models for the /api/reports endpoints.
 * The service layer depends on this interface, never on Prisma directly.
 *
 * Each composite fetch returns the RAW query rows for one legacy builder
 * (health / food / range / FY / typed reports / sponsorship coverage);
 * all bucketing, rounding and response mapping lives in the service.
 */
import type { Prisma } from "@prisma/client";

/* ══════════════════════ shared row shapes ══════════════════════ */

export interface StatusCountRow {
  status: string;
  _count: { _all: number };
}

export interface CategoryCountRow {
  category: string;
  _count: { _all: number };
}

export interface UrgencyCountRow {
  urgencyLevel: string;
  _count: { _all: number };
}

export interface CategoryAmountRow {
  category: string;
  _sum: { amount: number | null };
  _count: { _all: number };
}

export interface AmountCountAggRow {
  _sum: { amount: number | null };
  _count: { _all: number };
}

export interface DonationFeesAggRow {
  _sum: { amount: number | null; fees: number | null };
  _count: { _all: number };
}

export interface DispenseAggRow {
  _count: { _all: number };
  _sum: { quantity: number | null };
}

export interface KitBatchAggRow {
  _sum: { totalUnits: number | null; scannedUnits: number | null };
}

export interface PledgeAggRow {
  _sum: { amountPerMonth: number | null };
  _count: { _all: number };
}

export interface PledgeSumRow {
  _sum: { amountPerMonth: number | null };
}

export interface MissionAggRow {
  _sum: { vehiclesAlerted: number | null; timeSavedSec: number | null };
  _count: { _all: number };
}

export interface CorridorSumRow {
  _sum: { vehiclesAlerted: number | null; timeSavedSec: number | null };
}

export interface CorridorEventAggRow {
  _count: { _all: number };
  _sum: { vehiclesAlerted: number | null; timeSavedSec: number | null };
}

export interface DistributionAggRow {
  _sum: { value: number | null; quantity: number | null };
  _count: { _all: number };
}

export interface PadAggRow {
  _sum: { padsDistributed: number | null; girlsCount: number | null };
  _count: { _all: number };
}

export interface PadSumRow {
  _sum: { padsDistributed: number | null; girlsCount: number | null };
}

export interface DistributionTypeGroupRow {
  type: string;
  _count: { _all: number };
  _sum: { quantity: number | null; value: number | null };
}

export interface BeneficiaryIdRow {
  beneficiaryId: string | null;
}

/* ══════════════════════ healthcare programme rows ══════════════════════ */

export interface HealthRows {
  campGroups: StatusCountRow[];
  registrationCount: number;
  attendanceGroups: StatusCountRow[];
  encounterGroups: StatusCountRow[];
  prescriptionGroups: StatusCountRow[];
  dispenseAgg: DispenseAggRow;
  labGroups: StatusCountRow[];
  labCritical: number;
  referralGroups: StatusCountRow[];
  followUpGroups: StatusCountRow[];
  followUpOverdue: number;
  medicalDonationAgg: AmountCountAggRow;
  expenseAgg: AmountCountAggRow;
}

/* ══════════════════════ food programme rows ══════════════════════ */

export interface InventoryFoodItemRow {
  quantity: number;
  minStock: number;
}

export interface FoodRows {
  foodDistAgg: DistributionAggRow;
  foodBenRows: BeneficiaryIdRow[];
  kitTemplateCount: number;
  kitBatchCount: number;
  kitBatchAgg: KitBatchAggRow;
  kitScannedInRange: number;
  kitReady: number;
  kitExpired: number;
  foodItems: InventoryFoodItemRow[];
}

/* ══════════════════════ ADMIN range report rows ══════════════════════ */

export interface RegisterRow {
  id: string;
  createdAt: Date;
  receiptNumber: string;
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  isAnonymous: boolean;
  pan: string | null;
  amount: number;
  fees: number;
  type: string;
  category: string;
  paymentMethod: string;
  paymentStatus: string;
  receiptStatus: string;
  campaignId: string | null;
  campaignTitle: string | null;
  eligible80g: boolean;
}

export type RawDonationRow = Omit<RegisterRow, "eligible80g" | "campaignTitle"> & {
  campaign: { title: string | null } | null;
};

export interface ReceiptRow {
  amount: number;
  createdAt: Date;
}

export interface PadSchoolRow {
  schoolName: string | null;
  awarenessSession: boolean;
}

export interface CampaignRow {
  id: string;
  title: string;
  category: string;
  status: string;
  raisedAmount: number;
  targetAmount: number;
  beneficiaries: number;
}

export interface DonorFirstGiftRow {
  donorEmail: string;
  _min: { createdAt: Date | null };
}

export interface RangeRows {
  completedAgg: DonationFeesAggRow;
  panAgg: AmountCountAggRow;
  ineligibleAgg: AmountCountAggRow;
  receiptRows: ReceiptRow[];
  distAgg: DistributionAggRow;
  distByType: DistributionTypeGroupRow[];
  distBeneficiaries: BeneficiaryIdRow[];
  padAgg: PadAggRow;
  padRows: PadSchoolRow[];
  kitBatchAgg: KitBatchAggRow;
  kitsScannedInRange: number;
  causeGroups: StatusCountRow[];
  activePledgeAgg: PledgeAggRow;
  animalGroups: StatusCountRow[];
  animalPledgeCount: number;
  missionsAgg: MissionAggRow;
  missionsCompleted: number;
  corridorEventAgg: CorridorEventAggRow;
  campaignRows: CampaignRow[];
  registerRaw: RawDonationRow[];
  volunteerAppGroups: StatusCountRow[];
  beneficiaryGroupsCat: CategoryCountRow[];
  beneficiaryGroupsUrg: UrgencyCountRow[];
  beneficiaryOnboarded: number;
}

/* ══════════════════════ legacy typed report rows ══════════════════════ */

export interface DonationReportRow {
  receiptNumber: string;
  donorName: string;
  amount: number;
  paymentStatus: string;
  type: string;
  createdAt: Date;
}

export interface DistributionReportRow {
  type: string;
  quantity: number;
  value: number | null;
}

export interface CauseReportRow {
  code: string;
  patientName: string;
  condition: string;
  raised: number;
  monthlyCost: number;
  status: string;
}

export type AnimalReportRow = Prisma.AnimalGetPayload<{
  include: { pledges: { select: { amount: true } } };
}>;

export interface OverviewDonationRow {
  amount: number;
  createdAt: Date;
}

export interface OverviewDistributionRow {
  quantity: number;
  type: string;
  distributedAt: Date;
}

export interface OverviewCampaignRow {
  title: string;
  raisedAmount: number;
  targetAmount: number;
}

export interface OverviewTypeGroupRow {
  type: string;
  _count: { _all: number };
  _sum: { quantity: number | null };
}

export interface OverviewRows {
  completedDonations: OverviewDonationRow[];
  distributions: OverviewDistributionRow[];
  campaignTop: OverviewCampaignRow[];
  byTypeRaw: OverviewTypeGroupRow[];
}

/* ══════════════════════ public FY report rows ══════════════════════ */

export interface FyDonationRow {
  amount: number;
  donorName: string;
  donorEmail: string;
  isAnonymous: boolean;
  category: string;
  createdAt: Date;
}

export interface FyProgrammeRows {
  kitAgg: KitBatchAggRow;
  padAgg: PadSumRow;
  padSessions: number;
  padSchools: { schoolName: string | null }[];
  missionCount: number;
  corridorEventCount: number;
  corridorAgg: CorridorSumRow;
  animalsAvailable: number;
  animalsAdopted: number;
  animalPledges: number;
  causeTotal: number;
  causeSeeking: number;
  causeAdopted: number;
  pledgeAgg: PledgeSumRow;
}

/* ══════════════════════ sponsorship coverage rows ══════════════════════ */

export interface RecurringNeedRow {
  id: string;
  qtyPerCycle: number;
  cycle: string;
  nextDueAt: Date;
  beneficiary: { id: string; name: string; city: string | null; urgencyLevel: string };
  item: { name: string; unit: string | null };
  sponsorships: { id: string }[];
}

export interface SponsorshipRow {
  id: string;
  status: string;
  amountPerMonth: number;
  donorId: string | null;
  donorName: string;
  startDate: Date;
  donor: { id: string; name: string; email: string } | null;
}

export interface SponsorshipCoverageRows {
  activeNeeds: RecurringNeedRow[];
  sponsorships: SponsorshipRow[];
}

/* ══════════════════════ contract ══════════════════════ */

export interface ReportRepository {
  /** Healthcare-delivery aggregates rows for [from, to] — one Promise.all batch. */
  findHealthRows(from: Date, to: Date): Promise<HealthRows>;

  /** Food programme (ration kits + FOOD distributions + FOOD_KIT stock) rows for [from, to]. */
  findFoodRows(from: Date, to: Date): Promise<FoodRows>;

  /** ADMIN range report phase 1 — the full 24-query parallel batch. */
  findRangeRows(from: Date, to: Date, includeRegister: boolean): Promise<RangeRows>;

  /** ADMIN range report phase 2 — completed donations grouped by category. */
  groupCompletedDonationsByCategory(from: Date, to: Date): Promise<CategoryAmountRow[]>;

  /** First completed gift per donor email (new vs repeat split). */
  groupDonorFirstGifts(emails: string[]): Promise<DonorFirstGiftRow[]>;

  /** Legacy typed report — donations rows with a createdAt range (NaN-tolerant). */
  findDonationReportRows(from: Date | null, to: Date | null): Promise<DonationReportRow[]>;

  /** Legacy typed report — distribution rows with a distributedAt range (NaN-tolerant). */
  findDistributionReportRows(from: Date | null, to: Date | null): Promise<DistributionReportRow[]>;

  /** Legacy typed report — all causes, newest first. */
  findCauseReportRows(): Promise<CauseReportRow[]>;

  /** Legacy typed report — all animals with their pledge amounts. */
  findAnimalReportRows(): Promise<AnimalReportRow[]>;

  /** Legacy typed report — overview batch (donations/distributions/top campaigns/by type). */
  findOverviewRows(from: Date | null, to: Date | null): Promise<OverviewRows>;

  /** Public FY report — completed donations inside the financial year. */
  findCompletedDonationsInFy(from: Date, to: Date): Promise<FyDonationRow[]>;

  /** Public FY report — donor emails of completed donations strictly before the FY. */
  findDonorEmailsBefore(date: Date): Promise<{ donorEmail: string }[]>;

  /** Public FY report — all-time programme aggregates (one Promise.all batch). */
  findFyProgrammeRows(): Promise<FyProgrammeRows>;

  /** Sponsorship coverage — active recurring needs + all sponsorships. */
  findSponsorshipCoverageRows(): Promise<SponsorshipCoverageRows>;
}
