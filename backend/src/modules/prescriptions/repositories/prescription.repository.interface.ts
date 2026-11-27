/**
 * Prescription repository contract — persistence operations for
 * prescriptions, their items and dispense bookkeeping (including the
 * inventory side-effects of the dispense flow). The service layer depends on
 * this interface, never on Prisma directly. Transaction-participating
 * methods receive the tx client explicitly — repositories never obtain
 * clients themselves.
 */
import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";

/** Detail include (legacy RX_INCLUDE) — items, dispenses (newest first),
 *  doctor/beneficiary/camp projections. */
export const RX_INCLUDE = {
  items: true,
  dispenses: { orderBy: { dispensedAt: "desc" } },
  doctor: { select: { id: true, name: true, regNumber: true, speciality: true, kind: true } },
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
} as const;

export type PrescriptionDetailRow = Prisma.PrescriptionGetPayload<{ include: typeof RX_INCLUDE }>;

/** PATCH pre-read — full prescription + owning doctor identity. */
export type PrescriptionWithDoctorRow = Prisma.PrescriptionGetPayload<{
  include: { doctor: { select: { userId: true; name: true } } };
}>;

/** Sign pre-read — owning doctor identity + item ids. */
export type PrescriptionForSignRow = Prisma.PrescriptionGetPayload<{
  include: { doctor: { select: { userId: true; name: true } }; items: { select: { id: true } } };
}>;

/** Dispense pre-read — items, already-dispensed totals, doctor/beneficiary labels. */
export type PrescriptionForDispenseRow = Prisma.PrescriptionGetPayload<{
  include: {
    items: true;
    dispenses: { select: { itemId: true; quantity: true } };
    doctor: { select: { name: true } };
    beneficiary: { select: { code: true; name: true } };
  };
}>;

/** Print pre-read — print-document projection. */
export type PrescriptionForPrintRow = Prisma.PrescriptionGetPayload<{
  include: {
    items: true;
    doctor: { select: { name: true; regNumber: true; speciality: true; kind: true } };
    beneficiary: { select: { code: true; name: true; age: true; gender: true } };
    camp: { select: { title: true; code: true; venue: true; city: true } };
  };
}>;

/** Validated prescription item (legacy validateItems output). */
export interface PrescriptionItemInput {
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

/** Create payload — every field arrives pre-validated by the service. */
export interface PrescriptionCreateData {
  code: string;
  encounterId: string | null;
  campId: string | null;
  beneficiaryId: string;
  doctorId: string;
  diagnosis: string | null;
  followUpDate: Date | null;
  items: PrescriptionItemInput[];
}

/** Update payload — status/cancelReason for the cancel path; the remaining
 *  fields for the DRAFT-edit path (`undefined` = field absent, not written;
 *  `items` = wholesale replacement, legacy `deleteMany: {}` + recreate). */
export interface PrescriptionUpdateData {
  status?: string;
  cancelReason?: string;
  diagnosis?: string | null;
  followUpDate?: Date | null;
  encounterId?: string | null;
  items?: { deleteMany: Record<string, never>; create: PrescriptionItemInput[] };
}

/** List filter — status arrives pre-validated by the service. */
export interface PrescriptionListFilter {
  beneficiaryId?: string;
  campId?: string;
  doctorId?: string;
  status?: string;
  code?: { contains: string };
}

/** MedicationDispense.groupBy row (per-item dispensed totals). */
export interface DispenseTotalRow {
  itemId: string | null;
  _sum: { quantity: number | null };
}

/** MedicationDispense create payload (dispense flow, inside the tx). */
export interface DispenseCreateData {
  prescriptionId: string;
  itemId: string | null;
  beneficiaryId: string;
  campId: string | null;
  inventoryItemId?: string | null;
  quantity: number;
  batchNo: string | null;
  expiryDate: Date | null;
  pharmacistName: string;
  notes: string | null;
}

/** InventoryTransaction create payload (ISSUED ledger row, inside the tx). */
export interface InventoryIssueData {
  itemId: string;
  campId: string | null;
  quantity: number; // signed — negative for outflows (legacy passes -line.quantity)
  batchNo: string | null;
  expiryDate: Date | null;
  notes: string | null;
  handledByName: string;
  refId: string;
}

export interface PrescriptionRepository {
  list(
    filter: PrescriptionListFilter,
    skip: number,
    take: number
  ): Promise<{ items: PrescriptionDetailRow[]; total: number }>;

  findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null>;
  findBeneficiaryLite(id: string): Promise<{ id: string; code: string; name: string } | null>;
  findEncounterLite(id: string): Promise<{ id: string } | null>;
  findCampLite(id: string): Promise<{ id: string } | null>;
  findProfessionalByUserId(userId: string): Promise<{ id: string; name: string } | null>;
  createWithItems(data: PrescriptionCreateData): Promise<PrescriptionDetailRow>;

  findById(id: string): Promise<PrescriptionDetailRow | null>;
  findWithDoctor(id: string): Promise<PrescriptionWithDoctorRow | null>;
  findForDispense(id: string): Promise<PrescriptionForDispenseRow | null>;
  findForSign(id: string): Promise<PrescriptionForSignRow | null>;
  findForPrint(id: string): Promise<PrescriptionForPrintRow | null>;
  findInventoryItemLite(id: string): Promise<{ id: string; name: string } | null>;

  update(id: string, data: PrescriptionUpdateData): Promise<PrescriptionDetailRow>;
  sign(id: string, data: { signedAt: Date; signedByName: string }): Promise<PrescriptionDetailRow>;

  // ── dispense transaction participants (tx client passed in explicitly) ──

  /** Atomic stock guard: decrements only when the current quantity covers it;
   *  returns the number of rows updated (0 = insufficient stock). */
  decrementInventoryIfAvailable(inventoryItemId: string, quantity: number, client: DbClient): Promise<number>;
  findInventoryItemName(id: string, client: DbClient): Promise<{ name: string } | null>;
  createInventoryTransaction(data: InventoryIssueData, client: DbClient): Promise<void>;
  createDispense(data: DispenseCreateData, client: DbClient): Promise<void>;
  listItemQuantities(prescriptionId: string, client: DbClient): Promise<{ id: string; quantity: number }[]>;
  dispensedTotalsByItem(prescriptionId: string, client: DbClient): Promise<DispenseTotalRow[]>;
  updateStatusWithDetail(id: string, status: string, client: DbClient): Promise<PrescriptionDetailRow>;
}
