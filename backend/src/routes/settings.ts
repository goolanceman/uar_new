/**
 * Settings routes — /api/settings, /api/settings/test, /api/settings/public
 * Converted 1:1 from src/app/api/settings/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireRole, ApiError, json, handleError, logActivity } from "@/lib/session";
import {
  SETTING_DEFAULTS,
  validateSettingValue,
  isSecretKey,
  maskValue,
} from "@/lib/settings-core";
import { loadSettings, verifyEmail, verifySms, verifyWhatsApp, verifyGateway } from "@/lib/notify";
import { publicOrgSettings } from "@/lib/api-org";

export const router = Router();

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
    return json(res, await publicOrgSettings());
  } catch (e) {
    return handleError(e, res);
  }
});
