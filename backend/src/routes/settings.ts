/**
 * Settings routes — thin endpoint definitions; all logic lives in
 * src/modules/settings (routes → controllers → services → repositories).
 * The historical export path (`@/routes/settings`) is preserved: tests and
 * the app entry import `router` from here.
 *
 * /api/settings, /api/settings/test, /api/settings/public — converted 1:1
 * from src/app/api/settings/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  testSettingsBodySchema,
  updateSettingsBodySchema,
} from "@/modules/settings/schemas/setting.schema";
import { settingController } from "@/modules/settings";

export const router = Router();

// GET /api/settings — flat {key: value} merged with defaults (ADMIN only);
// secrets are masked and never echoed in plaintext.
router.get("/", authorize("ADMIN"), settingController.list);

// PATCH /api/settings — flat {key: value, …} → upsert each (secrets stored as-is).
// Unknown keys are rejected; known keys are validated per-key before persisting.
router.patch("/", authorize("ADMIN"), validate({ body: updateSettingsBodySchema }), settingController.update);

// POST /api/settings/test — run a REAL connectivity check for one integration
// channel (SMTP / SMS provider / WhatsApp / payment gateway) using the stored
// settings. ADMIN only. Responses never contain credentials — the verify*
// messages are operator-safe strings from @/lib/notify.
router.post("/test", authorize("ADMIN"), validate({ body: testSettingsBodySchema }), settingController.test);

// GET /api/settings/public — no auth. Public org identity subset
// consumed by public pages (letterheads, footers, UPI, vision).
router.get("/public", settingController.publicSettings);

// GET /api/settings/app — no auth. Mobile app configuration (legacy
// fetchSetting): the "mobile.app" KV config blob plus the interests,
// document types, report reasons and username restrictions the Flutter
// Settings model reads. Secret-looking KV keys are stripped — the config is
// served to every unauthenticated client.
router.get("/app", settingController.appSettings);
