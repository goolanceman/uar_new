/**
 * Prisma implementation of the setting repository — the ONLY place in the
 * settings module that touches Prisma models directly.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { AppListRow, SettingRepository, SettingRow } from "./setting.repository.interface";

export class PrismaSettingRepository implements SettingRepository {
  async listSettings(): Promise<SettingRow[]> {
    return db.setting.findMany({ orderBy: { key: "asc" } }) as Promise<SettingRow[]>;
  }

  async upsertSetting(key: string, data: { value: string; isSecret: boolean }): Promise<void> {
    // key is unique — a race past the service's validation maps to the shared
    // 409 conflict instead of leaking a raw Prisma error.
    await mapPrismaError(() =>
      db.setting.upsert({
        where: { key },
        create: { key, value: data.value, isSecret: data.isSecret },
        update: { value: data.value, isSecret: data.isSecret },
      })
    );
  }

  async findSettingByKey(key: string): Promise<SettingRow | null> {
    return (db.setting.findUnique({ where: { key } }) as Promise<SettingRow>) ?? null;
  }

  async listInterests(): Promise<AppListRow[]> {
    return db.communityInterest.findMany({ orderBy: { id: "asc" } });
  }

  async listReportReasons(): Promise<AppListRow[]> {
    return db.reportReason.findMany({ orderBy: { id: "asc" } });
  }

  async listUsernameRestrictions(): Promise<AppListRow[]> {
    return db.usernameRestriction.findMany({ orderBy: { id: "asc" } });
  }
}
