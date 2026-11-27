/**
 * Auth schemas — Zod definitions for every /api/auth/* request.
 *
 * The legacy handlers read the body defensively (`String(b?.email ?? "")`)
 * and never rejected unknown shapes — and several endpoints rate-limit
 * BEFORE parsing the body (register) or interleave checks with DB lookups
 * (profile). Any schema-level rejection or field stripping would change
 * observable behavior (message, status, or rate-limit ordering), so every
 * body is an infallible envelope: fields are typed as optional unknowns
 * purely to document the contract, and ALL coercion + validation stays in
 * the service in the exact legacy order with the exact legacy messages.
 * (`z.any().optional()` — a bare `z.any()` rejects missing keys in
 * zod 4.6.7.)
 */
import { z } from "zod";

/** Non-object bodies (e.g. a bare JSON scalar) were read as empty by the
 *  legacy `req.body ?? {}` + `b?.field` pattern — normalize to {} so the
 *  envelopes can never reject. */
const envelope = <T extends z.ZodRawShape>(shape: T) =>
  z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}), z.object(shape));

// ─── POST /api/auth/login ────────────────────────────────────────────────────

export const loginBodySchema = envelope({
  email: z.any().optional(),
  password: z.any().optional(),
  /** Optional device registration on login (mobile sends it; web does not). */
  deviceToken: z.any().optional(),
  deviceType: z.any().optional(),
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────

export const registerBodySchema = envelope({
  name: z.any().optional(),
  email: z.any().optional(),
  /** Phone/city are optional (web signup collects them; mobile may not). */
  phone: z.any().optional(),
  city: z.any().optional(),
  role: z.any().optional(),
  /** Optional user-chosen password (mobile sends one; web uses temp creds). */
  password: z.any().optional(),
  /** Mobile signup may register its push credentials inline (web omits them). */
  deviceToken: z.any().optional(),
  deviceType: z.any().optional(),
});

// ─── POST /api/auth/forgot-password · /api/auth/send-verification-otp ────────

const emailOnlyBody = envelope({ email: z.any().optional() });

export const forgotPasswordBodySchema = emailOnlyBody;
export const sendVerificationOtpBodySchema = emailOnlyBody;

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

export const resetPasswordBodySchema = envelope({
  email: z.any().optional(),
  otp: z.any().optional(),
  password: z.any().optional(),
});

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────

export const verifyEmailBodySchema = envelope({
  email: z.any().optional(),
  otp: z.any().optional(),
});

// ─── POST /api/auth/social ───────────────────────────────────────────────────
/** Legacy wire format: { identity, loginType | login_type (0 google | 1
 *  apple | 2 email), deviceType | device_type, deviceToken | device_token,
 *  fullName | full_name }. */

export const socialBodySchema = envelope({
  identity: z.any().optional(),
  loginType: z.any().optional(),
  login_type: z.any().optional(),
  deviceType: z.any().optional(),
  device_type: z.any().optional(),
  deviceToken: z.any().optional(),
  device_token: z.any().optional(),
  fullName: z.any().optional(),
  full_name: z.any().optional(),
});

// ─── GET /api/auth/username-available?username= ──────────────────────────────

/** Legacy: String(req.query.username ?? "").trim() — absent → "". */
export const usernameAvailableQuerySchema = z.object({
  username: z.any().optional().transform((v) => String(v ?? "").trim()),
});
export type UsernameAvailableQuery = z.infer<typeof usernameAvailableQuerySchema>;

// ─── DELETE /api/auth/account — optional password double-check ───────────────

export const deleteAccountBodySchema = envelope({
  password: z.any().optional(),
});

// ─── PATCH /api/auth/profile ─────────────────────────────────────────────────

export const updateProfileBodySchema = envelope({
  name: z.any().optional(),
  phone: z.any().optional(),
  city: z.any().optional(),
  pan: z.any().optional(),
  about: z.any().optional(),
  /** { current, next } — password change (checked in the service). */
  password: z.any().optional(),
});
