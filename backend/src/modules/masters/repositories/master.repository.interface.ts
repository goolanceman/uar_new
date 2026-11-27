/**
 * Master repository contract — persistence operations for the master-data
 * catalog (category/value picklists). The service layer depends on this
 * interface, never on Prisma directly.
 */

/** Full Master scalar shape (the legacy responses returned whole rows). */
export interface MasterRow {
  id: string;
  category: string;
  value: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface MasterUpsertData {
  category: string;
  value: string;
  label: string;
  sortOrder: number;
  /** Only applied on the upsert's update arm when the body sent it. */
  active?: boolean;
}

export interface MasterUpdateData {
  label?: string;
  sortOrder?: number;
  active?: boolean;
  value?: string;
}

export interface MasterRepository {
  listDistinctCategories(): Promise<Array<{ category: string }>>;
  listAll(): Promise<MasterRow[]>;
  listByCategory(category: string): Promise<Array<{ value: string; label: string }>>;
  findById(id: string): Promise<MasterRow | null>;
  findByCategoryValue(category: string, value: string): Promise<MasterRow | null>;
  upsert(data: MasterUpsertData): Promise<MasterRow>;
  update(id: string, data: MasterUpdateData): Promise<MasterRow>;
  delete(id: string): Promise<void>;
}
