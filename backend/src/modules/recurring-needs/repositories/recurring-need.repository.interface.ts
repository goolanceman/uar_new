/**
 * Recurring-need repository contract — beneficiaries' standing needs over
 * inventory items. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface RecurringNeedBeneficiarySummary {
  id: string;
  name: string;
  city: string | null;
  category: string;
  urgencyLevel: string;
  isActive: boolean;
  caseStatus: string;
  verificationStatus: string;
}

export interface RecurringNeedItemSummary {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  minStock: number;
}

export interface RecurringNeedRow {
  id: string;
  beneficiaryId: string;
  itemId: string;
  qtyPerCycle: number;
  cycle: string;
  status: string;
  reason: string | null;
  startDate: Date;
  nextDueAt: Date;
  lastFulfilledAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringNeedWithRelations extends RecurringNeedRow {
  beneficiary: RecurringNeedBeneficiarySummary;
  item: RecurringNeedItemSummary;
}

export interface RecurringNeedUpdated extends RecurringNeedRow {
  beneficiary: { id: string; name: string };
  item: { id: string; name: string; unit: string };
}

export interface RecurringNeedListFilter {
  beneficiaryId?: string;
  itemId?: string;
  status?: string;
  dueByOrBefore?: Date;
}

export interface CreateRecurringNeedData {
  beneficiaryId: string;
  itemId: string;
  qtyPerCycle: number;
  cycle: string;
  reason: string | null;
  notes: string | null;
  startDate: Date;
  nextDueAt: Date;
}

export interface UpdateRecurringNeedData {
  status?: string;
  cycle?: string;
  qtyPerCycle?: number;
  nextDueAt?: Date;
  reason?: string | null;
  notes?: string | null;
}

export interface RecurringNeedRepository {
  findBeneficiaryById(id: string): Promise<{ id: string; name: string } | null>;
  findItemById(id: string): Promise<{ id: string; name: string } | null>;
  findById(id: string): Promise<RecurringNeedRow | null>;
  /** Staff list — next-due first, full beneficiary + item summaries attached. */
  list(filter: RecurringNeedListFilter): Promise<RecurringNeedWithRelations[]>;
  create(data: CreateRecurringNeedData): Promise<RecurringNeedWithRelations>;
  update(id: string, data: UpdateRecurringNeedData): Promise<RecurringNeedUpdated>;
  remove(id: string): Promise<void>;
}
