/**
 * Settings schemas — request definitions for /api/settings*.
 *
 * The PATCH body is an arbitrary {key: value} map (values may be numbers,
 * booleans or null — legacy coerced with String()) and the /test body is a
 * loose {channel} shape checked mid-handler, so both are permissive envelopes
 * — the exact checks (unknown keys, per-key validation, channel list) live in
 * the service. No params/query to validate.
 */
import { z } from "zod";

// ─── PATCH /api/settings — flat {key: value, …} ──────────────────────────────

export const updateSettingsBodySchema = z.any();
export type UpdateSettingsBody = Record<string, unknown>;

// ─── POST /api/settings/test — {channel} ─────────────────────────────────────

export const testSettingsBodySchema = z.any();
export type TestSettingsBody = Record<string, unknown>;
