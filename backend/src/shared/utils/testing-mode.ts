/**
 * Testing mode — server-side helper.
 *
 * ONE decision, used by GET /api/auth/demo-accounts and /api/settings/public:
 * the `app.testingMode` Setting row wins; when the row is absent (or cleared
 * to "") fall back to env TESTING_MODE === "true"; default OFF.
 *
 * Lives outside settings-core.ts because that module is deliberately
 * client-safe with zero imports — this one touches the DB.
 */
import { db } from "@/infrastructure/database/prisma";
import { isFlagOn } from "@/domains/settings-core";

export async function isTestingMode(): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({
      where: { key: "app.testingMode" },
      select: { value: true },
    });
    if (row && row.value.trim() !== "") return isFlagOn(row.value);
  } catch {
    // DB unavailable — fall through to the env default below.
  }
  return process.env.TESTING_MODE === "true";
}
