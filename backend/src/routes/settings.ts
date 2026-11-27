/**
 * Settings routes — /api/settings, /api/settings/test, /api/settings/public
 * Converted 1:1 from src/app/api/settings/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireRole, ApiError, json, handleError, logActivity } from "@/lib/session";
import {
  SETTING_DEFAULTS,
  validateSettingValue,
  isSecretKey,
  maskValue,
} from "@/lib/settings-core";
import { loadSettings, verifyEmail, verifySms, verifyWhatsApp, verifyGateway } from "@/lib/notify";
import { publicOrgSettings } from "@/lib/api-org";
import { cached, cacheTtl, invalidateSettings, settingsKey } from "@/lib/cache";

export const router = Router();

const log = logger.child("settings");

/** Non-secret default values — merged into GET responses for keys that the
 * admin has not customised yet, so every consumer sees a complete map.
 * (Canonical list lives in @/lib/settings-core — do not duplicate here.) */
const DEFAULT_SETTINGS = SETTING_DEFAULTS;

function project(rows: { key: string; value: string; isSecret: boolean }[]): Record<string, string> {
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

// GET /api/settings — flat {key: value} merged with defaults (ADMIN only);
// secrets are masked and never echoed in plaintext.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
    return json(res, project(rows));
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/settings — flat {key: value, …} → upsert each (secrets stored as-is).
// Unknown keys are rejected; known keys are validated per-key before persisting.
router.patch("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

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
      await db.setting.upsert({
        where: { key },
        create: { key, value, isSecret: secret },
        update: { value, isSecret: secret },
      });
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

    const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
    return json(res, project(rows));
  } catch (e) {
    return handleError(e, res);
  }
});

type Channel = "email" | "sms" | "whatsapp" | "gateway";

const CHANNELS: readonly string[] = ["email", "sms", "whatsapp", "gateway"];

// POST /api/settings/test — run a REAL connectivity check for one integration
// channel (SMTP / SMS provider / WhatsApp / payment gateway) using the stored
// settings. ADMIN only. Responses never contain credentials — the verify*
// messages are operator-safe strings from @/lib/notify.
router.post("/test", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as { channel?: unknown };

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

    return json(res, {
      ok: result.ok,
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      latencyMs: result.latencyMs,
      message: result.message,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/settings/public — no auth. Public org identity subset
// consumed by public pages (letterheads, footers, UPI, vision).
router.get("/public", async (_req, res) => {
  try {
    return json(res, await cached(settingsKey("public"), cacheTtl.settings, () => publicOrgSettings()));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/settings/app — no auth. Mobile app configuration (legacy
// fetchSetting): the "mobile.app" KV config blob plus the interests,
// document types, report reasons and username restrictions the Flutter
// Settings model reads. Secret-looking KV keys are stripped — the config is
// served to every unauthenticated client.
const APP_SECRET_KEY_RE = /secret|password|token|privatekey/i;
router.get("/app", async (_req, res) => {
  try {
    const payload = await cached(settingsKey("app"), cacheTtl.settings, () => loadAppSettings());
    if (!payload) throw new ApiError("Settings not configured", 404);
    return json(res, payload);
  } catch (e) {
    return handleError(e, res);
  }
});

/** Mobile app configuration. Returns null when the KV blob is missing or
 *  corrupt — that 404 is not cached, so a later save is visible immediately. */
async function loadAppSettings() {
    const row = await db.setting.findUnique({ where: { key: "mobile.app" } });
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
      db.communityInterest.findMany({ orderBy: { id: "asc" } }),
      db.reportReason.findMany({ orderBy: { id: "asc" } }),
      db.usernameRestriction.findMany({ orderBy: { id: "asc" } }),
      db.setting.findUnique({ where: { key: "mobile.documentTypes" } }),
    ]);

    let documentTypes: Array<{ id: number; title: string }> = [];
    try {
      const docs = JSON.parse(docTypesRow?.value ?? "[]");
      if (Array.isArray(docs)) documentTypes = docs.map((t: unknown, i: number) => ({ id: i, title: String(t) }));
    } catch {
      // missing/corrupt KV row → empty list
    }

    const commonRow = (r: { id: number; title: string; createdAt: Date; updatedAt: Date }) => ({
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
