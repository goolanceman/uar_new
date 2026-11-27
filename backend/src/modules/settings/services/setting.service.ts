/**
 * Settings service — admin KV settings CRUD, integration connectivity tests,
 * and the unauthenticated public/app config payloads. Depends on the
 * repository contract, throws application errors, never touches HTTP. Checks
 * keep the exact legacy order and messages, the settings cache drop happens
 * between the upserts and the response reload, and every log event keeps its
 * legacy name.
 */
import { logger } from "@/infrastructure/logging/logger";
import {
  SETTING_DEFAULTS,
  validateSettingValue,
  isSecretKey,
  maskValue,
} from "@/domains/settings-core";
import { loadSettings, verifyEmail, verifySms, verifyWhatsApp, verifyGateway } from "@/infrastructure/notifications/notify";
import { publicOrgSettings } from "@/domains/api-org";
import { cached, cacheTtl, invalidateSettings, settingsKey } from "@/infrastructure/cache";
import { logActivity, type Session } from "@/infrastructure/auth/session";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { AppListRow, SettingRepository, SettingRow } from "../repositories/setting.repository.interface";

const log = logger.child("settings");

/** Non-secret default values — merged into GET responses for keys that the
 * admin has not customised yet, so every consumer sees a complete map.
 * (Canonical list lives in @/domains/settings-core — do not duplicate here.) */
const DEFAULT_SETTINGS = SETTING_DEFAULTS;

type Channel = "email" | "sms" | "whatsapp" | "gateway";

const CHANNELS: readonly string[] = ["email", "sms", "whatsapp", "gateway"];

/** Secret-looking KV keys are stripped from the /app payload — the config is
 *  served to every unauthenticated client. */
const APP_SECRET_KEY_RE = /secret|password|token|privatekey/i;

export class SettingService {
  constructor(private readonly settingRepository: SettingRepository) {}

  /** Flat {key: value} merged with defaults; secrets are masked and never
   *  echoed in plaintext. */
  private project(rows: SettingRow[]): Record<string, string> {
    const out: Record<string, string> = {};
    // Start from defaults, then overlay stored rows (DB always wins).
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      out[key] = isSecretKey(key) ? maskValue(value) : value;
    }
    for (const r of rows) {
      out[r.key] = r.isSecret || isSecretKey(r.key) ? maskValue(r.value) : r.value;
    }
    return out;
  }

  /** GET /api/settings — ADMIN only. */
  async list(): Promise<Record<string, string>> {
    const rows = await this.settingRepository.listSettings();
    return this.project(rows);
  }

  /** PATCH /api/settings — flat {key: value, …} → upsert each (secrets stored
   *  as-is). Unknown keys are rejected; known keys are validated per-key
   *  before persisting. */
  async update(session: Session, body: Record<string, unknown>): Promise<Record<string, string>> {
    const entries = Object.entries(body ?? {}).filter(
      ([key]) => key && typeof key === "string"
    );
    if (entries.length === 0) throw new ApiError("Nothing to update", 400);

    const unknown = entries.filter(([k]) => !(k in DEFAULT_SETTINGS)).map(([k]) => k);
    if (unknown.length > 0)
      throw new ApiError(`Unknown setting${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`, 400);

    // Validate every key up-front — persist nothing when any value is invalid.
    for (const [key, raw] of entries) {
      const value = raw === null || raw === undefined ? "" : String(raw);
      // Masked round-trips ("••••…") from the UI mean "keep the stored secret".
      if (isSecretKey(key) && value.includes("•")) continue;
      const problem = validateSettingValue(key, value);
      if (problem) throw new ApiError(problem, 400);
    }

    for (const [key, raw] of entries) {
      const value = raw === null || raw === undefined ? "" : String(raw);
      const secret = isSecretKey(key);
      if (isSecretKey(key) && value.includes("•")) continue; // keep stored secret
      await this.settingRepository.upsertSetting(key, { value, isSecret: secret });
    }
    await invalidateSettings();
    log.info("settings_updated", {
      keys: entries.map(([k]) => k),
      count: entries.length,
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "SETTINGS_UPDATE",
      "SETTING",
      entries.map(([k]) => (isSecretKey(k) ? `${k}=***` : k)).join(", ").slice(0, 200),
      session.userId
    );

    const rows = await this.settingRepository.listSettings();
    return this.project(rows);
  }

  /** POST /api/settings/test — run a REAL connectivity check for one integration
   *  channel (SMTP / SMS provider / WhatsApp / payment gateway) using the stored
   *  settings. ADMIN only. Responses never contain credentials — the verify*
   *  messages are operator-safe strings from @/infrastructure/notifications/notify. */
  async test(
    session: Session,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; skipped?: boolean; latencyMs: number; message: string }> {
    const channel =
      typeof body.channel === "string" ? (body.channel.trim().toLowerCase() as Channel) : "";
    if (!CHANNELS.includes(channel))
      throw new ApiError("channel must be one of: email, sms, whatsapp, gateway", 400);

    const map = await loadSettings();
    const result =
      channel === "email"
        ? await verifyEmail(map)
        : channel === "sms"
          ? await verifySms(map)
          : channel === "whatsapp"
            ? await verifyWhatsApp(map)
            : await verifyGateway(map);

    log.debug("settings_test", {
      channel,
      ok: result.ok,
      latencyMs: result.latencyMs,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "SETTINGS_TEST",
      "SETTING",
      channel + ": " + (result.ok ? "ok" : result.message).slice(0, 120),
      session.userId
    );

    return {
      ok: result.ok,
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      latencyMs: result.latencyMs,
      message: result.message,
    };
  }

  /** GET /api/settings/public — no auth. Public org identity subset consumed
   *  by public pages (letterheads, footers, UPI, vision). */
  async publicSettings(): Promise<Awaited<ReturnType<typeof publicOrgSettings>>> {
    return cached(settingsKey("public"), cacheTtl.settings, () => publicOrgSettings());
  }

  /** GET /api/settings/app — no auth. Mobile app configuration (legacy
   *  fetchSetting): the "mobile.app" KV config blob plus the interests,
   *  document types, report reasons and username restrictions the Flutter
   *  Settings model reads. */
  async appSettings(): Promise<Record<string, unknown>> {
    const payload = await cached(settingsKey("app"), cacheTtl.settings, () => this.loadAppSettings());
    if (!payload) throw new NotFoundError("Settings not configured");
    return payload;
  }

  /** Mobile app configuration. Returns null when the KV blob is missing or
   *  corrupt — that 404 is not cached, so a later save is visible immediately. */
  private async loadAppSettings(): Promise<Record<string, unknown> | null> {
    const row = await this.settingRepository.findSettingByKey("mobile.app");
    if (!row) return null;

    let settings: Record<string, unknown>;
    try {
      const parsed = JSON.parse(row.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      settings = parsed;
    } catch {
      return null;
    }
    for (const key of Object.keys(settings)) {
      if (APP_SECRET_KEY_RE.test(key)) delete settings[key];
    }

    const [interests, reasons, restrictions, docTypesRow] = await Promise.all([
      this.settingRepository.listInterests(),
      this.settingRepository.listReportReasons(),
      this.settingRepository.listUsernameRestrictions(),
      this.settingRepository.findSettingByKey("mobile.documentTypes"),
    ]);

    let documentTypes: Array<{ id: number; title: string }> = [];
    try {
      const docs = JSON.parse(docTypesRow?.value ?? "[]");
      if (Array.isArray(docs)) documentTypes = docs.map((t: unknown, i: number) => ({ id: i, title: String(t) }));
    } catch {
      // missing/corrupt KV row → empty list
    }

    const commonRow = (r: AppListRow) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });

    return {
      ...settings,
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      interests: interests.map((i) => ({ ...commonRow(i), totalRoomOfInterest: 0 })),
      documentTypes,
      documentType: documentTypes, // legacy alias kept for older clients
      reportReasons: reasons.map(commonRow),
      restrictedUsernames: restrictions.map(commonRow),
    };
  }
}
