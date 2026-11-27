/**
 * Auth repository contract — persistence operations for the /api/auth/*
 * surface (sessions, registration, password reset, device registration,
 * self-service account deletion). The service depends on this interface,
 * never on Prisma directly. Full `User` rows are returned (the legacy
 * handlers responded with the raw row minus the password hash).
 */
import type { PasswordReset, User } from "@prisma/client";

export interface RegisteredUserData {
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  role: string;
  passwordHash: string;
  status: string;
  isActive: boolean;
  /** Inline device registration (mobile signup sends it; web omits it). */
  device?: { deviceToken: string; deviceType?: number };
}

export interface SocialUserData {
  email: string;
  name: string;
  passwordHash: string;
  username: string;
  loginType: number;
  deviceType?: number;
  deviceToken?: string;
}

/** PATCH /api/auth/profile patch — keys map 1:1 to User columns. */
export interface ProfilePatch {
  name?: string;
  phone?: string | null;
  city?: string | null;
  pan?: string | null;
  about?: string | null;
  password?: string;
}

export interface AuthRepository {
  /** Full row (no select) — the legacy `db.user.findFirst` shape. */
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<{ id: string } | null>;
  /** Demo accounts still present + usable (not suspended). */
  listDemoAccountEmails(emails: string[]): Promise<{ email: string }[]>;

  /** Login-time device registration (mobile sends it; web does not). */
  registerDevice(id: string, data: { deviceToken: string; deviceType: number | null }): Promise<User>;
  /** Upgrade a legacy plain-text password to a scrypt hash on login. */
  upgradePasswordHash(id: string, passwordHash: string): Promise<User>;
  /** Advance the token revocation watermark (logout). */
  revokeTokens(id: string, when: Date): Promise<User>;
  /** Single write on reset: new scrypt password + revocation watermark. */
  updatePasswordAndRevoke(id: string, passwordHash: string, when: Date): Promise<User>;
  markEmailVerified(id: string): Promise<User>;
  /** Social sign-in refreshes the device push credentials. */
  updateDevice(id: string, data: { deviceType?: number; deviceToken?: string }): Promise<User>;
  createRegistered(data: RegisteredUserData): Promise<User>;
  createSocial(data: SocialUserData): Promise<User>;
  updateProfile(id: string, data: ProfilePatch): Promise<User>;
  /** Full community cascade for self-service account deletion. */
  deleteUserCascade(userId: string): Promise<void>;

  /** Supersede every pending (unused) code for an email. */
  supersedePasswordResets(email: string): Promise<number>;
  createPasswordReset(data: { email: string; otpHash: string; expiresAt: Date }): Promise<PasswordReset>;
  /** Unused, unexpired rows — newest first (legacy findMany order). */
  findPendingOtpRows(email: string): Promise<PasswordReset[]>;
  /** Consume every pending code for an email. */
  consumePasswordResets(email: string): Promise<number>;
}
