/**
 * Profile schemas — request definitions for /api/profile*.
 *
 * The legacy handlers validated every body field sequentially with exact
 * messages, interleaved with DB lookups (username-conflict check, verification
 * state gates, account 404s) and with multipart asset uploads that must only
 * persist after the earlier checks pass. Middleware-level validation would
 * both change the error envelope ("Invalid request body: …") and preempt
 * those interleaved checks, so — like the users module — the body schemas are
 * permissive envelopes and every field check stays in the service in the
 * exact legacy order. The GET endpoints carry no query/params in legacy.
 */
import { z } from "zod";

// ─── PATCH /api/profile (JSON or multipart) ──────────────────────────────────

/** Permissive body envelope: the field-by-field PATCH semantics ("Name cannot
 *  be empty", the phone regex message, the username-conflict 409, the
 *  "Nothing to update" 400 after file handling) are preserved in the service. */
export const profileUpdateSchema = z.any();
export type ProfileUpdateBody = Record<string, unknown>;

// ─── POST /api/profile/verification (multipart KYC submission) ───────────────

/** Required-field checks (full name / document type) and the required selfie /
 *  document files run in the service — legacy order interleaves them with the
 *  isVerified state gates and the two file uploads. */
export const verificationSchema = z.any();
export type VerificationBody = Record<string, unknown>;

// ─── POST /api/profile/user-type ─────────────────────────────────────────────

/** The supporter|volunteer choice is validated in the service ("The selected
 *  user type is invalid" 400) with the legacy message exact. */
export const userTypeSchema = z.any();
export type UserTypeBody = Record<string, unknown>;

// ─── POST /api/profile/device-token ──────────────────────────────────────────

/** token/platform/deviceType parsing keeps its legacy coercion semantics
 *  (String()/Number() over aliased fields) in the service. */
export const deviceTokenSchema = z.any();
export type DeviceTokenBody = Record<string, unknown>;

// ─── POST /api/profile/password ──────────────────────────────────────────────

/** Password checks are interleaved with the account lookup and the
 *  current-password verification — kept in the service in the legacy order. */
export const passwordChangeSchema = z.any();
export type PasswordChangeBody = Record<string, unknown>;
