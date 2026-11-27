/**
 * Setting repository contract — persistence for the KV settings table and the
 * mobile-app config lookups. The service layer depends on this interface,
 * never on Prisma directly.
 */
export interface SettingRow {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Master-data rows embedded in the mobile app config payload. */
export interface AppListRow {
  id: number;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettingRepository {
  /** Whole settings table, key order — the admin map + PATCH response. */
  listSettings(): Promise<SettingRow[]>;
  upsertSetting(key: string, data: { value: string; isSecret: boolean }): Promise<void>;
  findSettingByKey(key: string): Promise<SettingRow | null>;
  listInterests(): Promise<AppListRow[]>;
  listReportReasons(): Promise<AppListRow[]>;
  listUsernameRestrictions(): Promise<AppListRow[]>;
}
