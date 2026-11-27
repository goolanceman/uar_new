/**
 * Auth service — all business rules for /api/auth/*: credential login with
 * brute-force throttling and legacy plain-text password upgrade, registration
 * (temp credentials or user-chosen password), revocation-aware logout/refresh,
 * the secure OTP password-reset + email-verification lifecycle, social sign-in,
 * username availability and self-service account deletion. Depends on the
 * repository contract, throws application errors, never touches HTTP.
 *
 * Session-cookie writes (setSession/clearSession) stay in the controller; the
 * service returns the session so the cookie is set at the exact legacy point.
 * Rate-limit keys, windows, log event names, error messages and the ordering
 * of side effects are byte-identical to the legacy route handlers.
 */
import { randomInt, randomBytes } from "node:crypto";
import { logger } from "@/lib/logger";
import { hashPassword, issueToken, logActivity, verifyPassword, type Session } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { emailShell, loadSettings, sendEmail } from "@/lib/notify";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { isTestingMode } from "@/lib/testing-mode";
import { ApiError } from "@/shared/errors";
import type { User } from "@prisma/client";
import type { AuthRepository, ProfilePatch } from "../repositories/auth.repository.interface";

const log = logger.child("auth");

const ALLOWED_ROLES = ["DONOR", "VOLUNTEER", "BENEFICIARY"];

const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Cryptographically-random 6-digit OTP. */
function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function tempPassword(): string {
  return `UAR${Math.floor(10000 + Math.random() * 90000)}@`;
}

export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  // ─── POST /api/auth/login ──────────────────────────────────────────────────

  /**
   * Verify credentials + register the optional device (legacy order: presence
   * check → rate limits → lookup/verify → suspension gate → device write).
   * Returns the session, the full user row and the raw login password so the
   * controller can set the cookie between the two legacy phases (see
   * completeLogin — the cookie is written before the legacy-upgrade write,
   * exactly like the original handler).
   */
  async login(
    body: Record<string, unknown>,
    ip: string
  ): Promise<{ session: Session; user: User; password: string }> {
    const b = body;
    const email = String(b?.email ?? "").trim().toLowerCase();
    const password = String(b?.password ?? "");

    if (!email || !password)
      throw new ApiError("Email and password are required", 400);

    // Throttle brute-force / credential-stuffing by IP and by the targeted
    // account. 10 attempts / 10 minutes per key is generous for real users,
    // punishing for automated guessing.
    const ipLimit = checkRateLimit(`login:ip:${ip}`, 20, 10 * 60 * 1000);
    const emailLimit = checkRateLimit(`login:email:${email}`, 10, 10 * 60 * 1000);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      throw new ApiError("Too many attempts. Please try again later.", 429);
    }

    const user = await this.authRepository.findByEmail(email);

    if (!user || !verifyPassword(password, user.password)) {
      log.warn(user ? "failed_login_bad_password" : "failed_login_unknown_email", {
        email,
        ip,
      });
      throw new ApiError("Invalid email or password", 401);
    }

    if (user.status === "SUSPENDED") {
      log.warn("login_blocked_suspended", { userId: user.id, email: user.email });
      throw new ApiError("Account suspended", 403);
    }

    // Optional device registration on login (mobile sends it; web does not).
    const deviceToken = String(b?.deviceToken ?? "").trim();
    const deviceType = Number.isFinite(Number(b?.deviceType)) ? Number(b?.deviceType) : null;
    if (deviceToken) {
      await this.authRepository.registerDevice(user.id, { deviceToken, deviceType });
    }

    const session: Session = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    };
    return { session, user, password };
  }

  /**
   * Second (post-cookie) phase of the legacy login: upgrade the legacy
   * plain-text password to a scrypt hash, emit the audit events and issue the
   * 7-day JWT. Splits out of login() only so the controller can setSession at
   * the exact legacy position (between the device write and the upgrade).
   */
  async completeLogin(
    user: User,
    session: Session,
    password: string
  ): Promise<{ userSafe: Record<string, unknown>; token: string }> {
    // Upgrade legacy plain-text password to scrypt hash
    if (!user.password.includes(":")) {
      await this.authRepository.upgradePasswordHash(user.id, hashPassword(password));
    }

    const { password: _pw, ...userSafe } = user;
    log.info("login_success", {
      userId: user.id,
      email: user.email,
      role: user.role,
      actor: session.userId,
    });
    await logActivity(user.name, "LOGIN", "USER", user.role, user.id);
    return { userSafe, token: issueToken(session) };
  }

  // ─── POST /api/auth/register ───────────────────────────────────────────────

  /**
   * Public registration. The rate limit runs BEFORE the body is read (legacy
   * order); with no password provided the generated temp credentials are
   * returned as tempCreds — a user-chosen password is never echoed back.
   */
  async register(
    body: Record<string, unknown>,
    ip: string
  ): Promise<{
    session: Session;
    userSafe: Record<string, unknown>;
    token: string;
    tempCreds?: { email: string; password: string; fullName: string };
  }> {
    const b = body;
    // Throttle automated signup abuse (account enumeration / spam) by IP.
    const ipLimit = checkRateLimit(`register:ip:${ip}`, 10, 10 * 60 * 1000);
    if (!ipLimit.allowed) {
      throw new ApiError("Too many attempts. Please try again later.", 429);
    }

    const name = String(b?.name ?? "").trim();
    const email = String(b?.email ?? "").trim().toLowerCase();
    // Phone is optional (web signup collects it; mobile signup may not).
    const phone = b?.phone ? String(b.phone).trim() : null;
    const city = b?.city ? String(b.city).trim() : null;
    const role = ALLOWED_ROLES.includes(String(b?.role)) ? String(b.role) : "DONOR";

    if (!name || !email)
      throw new ApiError("Name and email are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const existing = await this.authRepository.findByEmail(email);
    if (existing) {
      log.warn("registration_email_conflict", { email });
      throw new ApiError("An account with this email already exists", 409);
    }

    // A user-chosen password (mobile signup sends one; the web signup relies
    // on the generated temp credentials) is honoured when it passes the same
    // policy as reset-password / the profile change — otherwise the account
    // would be created with a password the user does not know and could never
    // sign in with. With no password provided, the legacy generated-tempCreds
    // web path is unchanged.
    const chosen = typeof b?.password === "string" ? b.password.trim() : "";
    if (chosen && chosen.length < 6)
      throw new ApiError("Password must be at least 6 characters", 400);
    const password = chosen || tempPassword();

    // Mobile signup may register its push credentials inline (web omits them).
    const deviceToken = String(b?.deviceToken ?? "").trim();
    const device = deviceToken
      ? { deviceToken, ...(Number.isFinite(Number(b?.deviceType)) ? { deviceType: Number(b?.deviceType) } : {}) }
      : undefined;

    const user = await this.authRepository.createRegistered({
      name,
      email,
      phone,
      city,
      role,
      passwordHash: hashPassword(password),
      status: role === "VOLUNTEER" ? "PENDING" : "ACTIVE",
      isActive: role !== "VOLUNTEER",
      device,
    });

    const session: Session = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    log.info("registration_completed", {
      userId: user.id,
      email: user.email,
      role,
      status: user.status,
      actor: session.userId,
    });
    await logActivity(name, "REGISTER", "USER", role, user.id);

    const { password: _pw, ...userSafe } = user;
    return {
      session,
      userSafe,
      token: issueToken(session),
      // Temp credentials only when the password was generated — a
      // user-chosen password is never echoed back.
      ...(chosen ? {} : { tempCreds: { email, password, fullName: name } }),
    };
  }

  // ─── GET /api/auth/demo-accounts — no auth ─────────────────────────────────

  /**
   * The login-screen demo credential list. SINGLE SOURCE OF TRUTH:
   * src/lib/demo-accounts.ts (same list prisma/seed.ts creates). Serving is
   * gated behind testing mode:
   *   OFF (default) → 404 { error: "Not found" } — indistinguishable from any
   *     other unknown route, so production leaks nothing (not even the
   *     existence of the feature).
   *   ON → { testingMode: true, accounts: [...] } with ONLY the accounts that
   *     still exist in the DB and are usable (not suspended) — deleting or
   *     suspending a demo user removes it from the list automatically.
   */
  async demoAccounts(): Promise<{
    testingMode: true;
    accounts: Array<{
      role: string;
      label: string;
      email: string;
      password: string;
      description: string;
      portal: string;
    }>;
  }> {
    if (!(await isTestingMode())) throw new ApiError("Not found", 404);

    const rows = await this.authRepository.listDemoAccountEmails(DEMO_ACCOUNTS.map((d) => d.email));
    const present = new Set(rows.map((r) => r.email));
    log.info("demo_accounts_served", { count: present.size });
    return {
      testingMode: true,
      accounts: DEMO_ACCOUNTS.filter((d) => present.has(d.email)).map((d) => ({
        role: d.role,
        label: d.label,
        email: d.email,
        password: d.password,
        description: d.description,
        portal: d.portal,
      })),
    };
  }

  // ─── GET /api/auth/me ──────────────────────────────────────────────────────

  /**
   * Revocation-aware (logout/password-reset watermarks) — /me is the
   * session-introspection endpoint, so a revoked token must read as signed
   * out. Falls back to null (rendered as `{ user: null }` by the controller)
   * exactly as before (no 401).
   */
  async me(session: Session | null): Promise<Record<string, unknown> | null> {
    if (!session) return null;

    const user = await this.authRepository.findById(session.userId);
    if (!user) return null;

    const { password: _pw, ...userSafe } = user;
    return userSafe;
  }

  // ─── POST /api/auth/logout ─────────────────────────────────────────────────

  /**
   * Truly revokes every previously-issued token for the account by advancing
   * the revocation watermark: all tokens whose `iat` predates `now` are
   * rejected by validateSession from this moment on (bearer tokens included).
   * The cookie itself is cleared by the controller afterwards.
   */
  async logout(session: Session | null): Promise<void> {
    if (session) {
      await this.authRepository.revokeTokens(session.userId, new Date());
      log.info("logout", {
        userId: session.userId,
        role: session.role,
        actor: session.userId,
      });
      await logActivity(session.name, "LOGOUT", "USER", session.role, session.userId);
    }
  }

  // ─── POST /api/auth/refresh (auth required) ────────────────────────────────

  /** Issues a fresh 7-day token for the signed-in account (sliding expiry). */
  refresh(session: Session): string {
    return issueToken(session);
  }

  // ─── Forgot / reset password (secure OTP — gap A-2) ────────────────────────
  // Legacy AuthController::forgotPassword returned the OTP IN THE RESPONSE
  // (AuthController.php L213) — that leak is deliberately NOT ported. The OTP
  // is only ever delivered by email; without a configured transport it is
  // logged server-side (documented dev behavior) and never leaves the server
  // in an API response.

  /**
   * Issue a 6-digit OTP over email — shared by forgot-password and
   * send-verification-otp (both store hashed codes in PasswordReset rows).
   * The plaintext OTP is NEVER returned in an API response; without a mail
   * transport it is logged server-side (documented dev behavior).
   */
  private async issueOtpEmail(email: string, userName: string, purpose: "reset" | "verify"): Promise<void> {
    const otp = generateOtp();
    // Supersede any previous pending codes for this email.
    await this.authRepository.supersedePasswordResets(email);
    await this.authRepository.createPasswordReset({
      email,
      otpHash: hashPassword(otp), // scrypt — plaintext OTP never stored
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    const map = await loadSettings();
    const org = {
      name: map["org.name"] || "United Angel Reach",
      footer: map["receipts.footer"] || undefined,
    };
    const subject =
      purpose === "reset" ? `Your password reset code — ${org.name}` : `Your verification code — ${org.name}`;
    const bodyHtml = `
    <p style="margin:0 0 8px;">Hello ${userName},</p>
    <p style="margin:0 0 12px;">Use the verification code below — it expires in <strong>15 minutes</strong>.</p>
    <p style="margin:16px 0;text-align:center;">
      <span style="display:inline-block;font-size:28px;letter-spacing:8px;font-weight:700;color:#064e3b;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 24px;">${otp}</span>
    </p>
    <p style="margin:0;">— The ${org.name} Team</p>`;
    const out = await sendEmail(map, { to: email, subject, html: emailShell(subject, bodyHtml, org) });
    if (out.skipped) {
      log.debug("otp_dev_fallback", { purpose, email });
    } else if (!out.ok) {
      log.error("otp_email_failed", { purpose, error: out.message });
    }
  }

  // ─── POST /api/auth/forgot-password { email } ──────────────────────────────

  /** ALWAYS answers { ok: true } (no account enumeration, mirrors the legacy
   *  contract minus the OTP leak). */
  async requestPasswordReset(body: Record<string, unknown>, ip: string): Promise<void> {
    const b = body;
    const email = String(b?.email ?? "").trim().toLowerCase();

    // Unknown emails take the same path and answer identically.
    if (email && /^\S+@\S+\.\S+$/.test(email)) {
      // Throttle OTP requests: 5 / hour per email+IP pair.
      const rl = checkRateLimit(`forgot-password:${email}:${ip}`, 5, 60 * 60 * 1000);
      if (!rl.allowed)
        throw new ApiError("Too many reset requests. Please try again later.", 429);

      const user = await this.authRepository.findByEmail(email);
      if (user) await this.issueOtpEmail(email, user.name, "reset");
    }
  }

  // ─── POST /api/auth/reset-password { email, otp, password } ────────────────

  async resetPassword(body: Record<string, unknown>, ip: string): Promise<void> {
    const b = body;
    const email = String(b?.email ?? "").trim().toLowerCase();
    const otp = String(b?.otp ?? "").trim();
    const password = String(b?.password ?? "");

    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);
    if (!/^\d{6}$/.test(otp))
      throw new ApiError("Please enter the 6-digit code from the email", 400);
    if (password.length < 6)
      throw new ApiError("Password must be at least 6 characters", 400);

    // Throttle OTP guessing: 5 / hour per email+IP pair (6 digits give 1M
    // combinations; combined with the 15-minute expiry this makes brute
    // forcing impractical on top of the limiter).
    const rl = checkRateLimit(`reset-password:${email}:${ip}`, 5, 60 * 60 * 1000);
    if (!rl.allowed)
      throw new ApiError("Too many attempts. Please request a new code.", 429);

    // One generic failure for unknown email / bad code / expired code —
    // the response must not reveal which part was wrong.
    const INVALID = new ApiError("Invalid or expired code", 400);

    const user = await this.authRepository.findByEmail(email);
    if (!user) throw INVALID;

    const pending = await this.authRepository.findPendingOtpRows(email);
    const match = pending.find((row) => verifyPassword(otp, row.otpHash));
    if (!match) throw INVALID;

    // Single write: new scrypt password + revocation watermark (all existing
    // sessions die with the password) + consume every pending reset row.
    await this.authRepository.updatePasswordAndRevoke(user.id, hashPassword(password), new Date());
    await this.authRepository.consumePasswordResets(email);

    log.info("password_reset_completed", {
      userId: user.id,
      email: user.email,
      actor: user.id,
    });
    await logActivity(user.name, "PASSWORD_RESET", "USER", user.role, user.id);
  }

  // ─── POST /api/auth/send-verification-otp { email } ────────────────────────

  /** Emails a 6-digit code for email verification (same PasswordReset rows as
   *  forgot-password). The OTP is never returned in the response. */
  async sendVerificationOtp(body: Record<string, unknown>, ip: string): Promise<void> {
    const b = body;
    const email = String(b?.email ?? "").trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const rl = checkRateLimit(`verify-otp:${email}:${ip}`, 5, 60 * 60 * 1000);
    if (!rl.allowed) throw new ApiError("Too many requests. Please try again later.", 429);

    const user = await this.authRepository.findByEmail(email);
    if (!user) throw new ApiError("User not found with this email", 404);
    if (user.emailVerifiedAt) throw new ApiError("Email already verified", 400);

    await this.issueOtpEmail(email, user.name, "verify");
  }

  // ─── POST /api/auth/verify-email { email, otp } ────────────────────────────

  /** Consumes the code and stamps emailVerifiedAt. Returns the updated user
   *  (raw shape minus password). */
  async verifyEmail(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const b = body;
    const email = String(b?.email ?? "").trim().toLowerCase();
    const otp = String(b?.otp ?? "").trim();

    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);
    if (!/^\d{6}$/.test(otp))
      throw new ApiError("Please enter the 6-digit code from the email", 400);

    const pending = await this.authRepository.findPendingOtpRows(email);
    const match = pending.find((row) => verifyPassword(otp, row.otpHash));
    if (!match) throw new ApiError("Invalid or expired code", 400);

    const user = await this.authRepository.findByEmail(email);
    if (!user) throw new ApiError("User not found", 404);

    const updated = await this.authRepository.markEmailVerified(user.id);
    log.info("email_verified", { userId: user.id, email: user.email });
    await this.authRepository.consumePasswordResets(email);

    const { password: _pw, ...userSafe } = updated;
    return userSafe;
  }

  // ─── POST /api/auth/social ─────────────────────────────────────────────────

  /**
   * Sign in (or register) by external identity. Replaces the legacy POST
   * /addUser: { identity, loginType (0 google | 1 apple | 2 email),
   * deviceType?, deviceToken?, fullName? }. The identity is stored in the
   * (unique) email column, like the legacy wire format did.
   */
  async social(
    body: Record<string, unknown>,
    ip: string
  ): Promise<{ userSafe: Record<string, unknown>; token: string; created: boolean }> {
    const b = body;
    const identity = String(b?.identity ?? "").trim();
    if (!identity) throw new ApiError("identity is required", 400);

    if (!checkRateLimit(`social:ip:${ip}`, 20, 10 * 60 * 1000).allowed)
      throw new ApiError("Too many attempts. Please try again later.", 429);

    const email = identity.toLowerCase();
    const loginType = Number.isFinite(Number(b?.loginType ?? b?.login_type)) ? Number(b?.loginType ?? b?.login_type) : 2;
    const deviceType = Number.isFinite(Number(b?.deviceType ?? b?.device_type)) ? Number(b?.deviceType ?? b?.device_type) : null;
    const deviceToken = String(b?.deviceToken ?? b?.device_token ?? "").trim();
    const deviceData = {
      ...(deviceType !== null ? { deviceType } : {}),
      ...(deviceToken ? { deviceToken } : {}),
    };

    const existing = await this.authRepository.findByEmail(email);
    if (existing) {
      if (existing.status === "SUSPENDED") {
        log.warn("social_login_blocked_suspended", { userId: existing.id, email });
        throw new ApiError("Account suspended", 403);
      }
      log.info("social_login_success", { userId: existing.id, email, loginType });
      const updated = await this.authRepository.updateDevice(existing.id, deviceData);
      const { password: _pw, ...userSafe } = updated;
      const session: Session = { userId: updated.id, role: updated.role, name: updated.name, email: updated.email };
      return { userSafe, token: issueToken(session), created: false };
    }

    // Unique username from the identity (legacy AuthController::generateUsername).
    const base = identity.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
    let username = base;
    let counter = 1;
    while (await this.authRepository.findByUsername(username)) {
      username = `${base}${counter++}`;
    }

    const name = String(b?.fullName ?? b?.full_name ?? "").trim() || "User";
    const user = await this.authRepository.createSocial({
      email,
      name,
      // Social logins have no password of their own — a random one blocks
      // password-login on this account until a reset is requested.
      passwordHash: hashPassword(randomBytes(24).toString("hex")),
      username,
      loginType,
      ...deviceData,
    });

    const session: Session = { userId: user.id, role: user.role, name: user.name, email: user.email };
    const { password: _pw, ...userSafe } = user;
    log.info("social_registration_completed", { userId: user.id, email, loginType });
    await logActivity(user.name, "REGISTER", "USER", user.role, user.id);
    return { userSafe, token: issueToken(session), created: true };
  }

  // ─── GET /api/auth/username-available?username= ────────────────────────────

  async usernameAvailable(username: string): Promise<{ available: boolean }> {
    if (!username) return { available: true };
    const taken = await this.authRepository.findByUsername(username);
    return { available: !taken };
  }

  // ─── DELETE /api/auth/account — self-service account deletion ──────────────

  /** Legacy /auth/delete-account + /deleteUser cascade. Optional { password }
   *  double-check; the controller clears the cookie after the cascade. */
  async deleteAccount(session: Session, body: Record<string, unknown>): Promise<void> {
    const b = body;
    const user = await this.authRepository.findById(session.userId);
    if (!user) {
      log.warn("account_delete_not_found", { userId: session.userId, actor: session.userId });
      throw new ApiError("Account not found", 404);
    }

    const given = String(b?.password ?? "");
    if (given !== "" && !verifyPassword(given, user.password))
      throw new ApiError("Invalid password", 400);

    await this.authRepository.deleteUserCascade(user.id);
    log.info("account_deleted", {
      userId: user.id,
      email: user.email,
      actor: session.userId,
    });
  }

  // ─── PATCH /api/auth/profile ───────────────────────────────────────────────

  async updateProfile(session: Session, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const b = body;

    const data: ProfilePatch = {};

    if (b?.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (b?.phone !== undefined) data.phone = b.phone ? String(b.phone).trim() : null;
    if (b?.city !== undefined) data.city = b.city ? String(b.city).trim() : null;
    if (b?.pan !== undefined) data.pan = b.pan ? String(b.pan).trim().toUpperCase() : null;
    if (b?.about !== undefined) data.about = b.about ? String(b.about) : null;

    if (b?.password) {
      const { current, next } = b.password as { current?: unknown; next?: unknown };
      const user = await this.authRepository.findById(session.userId);
      if (!user) throw new ApiError("Account not found", 404);
      if (!current || !verifyPassword(String(current), user.password))
        throw new ApiError("Current password is incorrect", 400);
      if (!next || String(next).length < 6)
        throw new ApiError("New password must be at least 6 characters", 400);
      data.password = hashPassword(String(next));
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const updated = await this.authRepository.updateProfile(session.userId, data);
    log.info("profile_updated", {
      userId: session.userId,
      fields: Object.keys(data),
      ...(data.password ? { passwordChanged: true } : {}),
      actor: session.userId,
    });

    const { password: _pw, ...userSafe } = updated;
    return userSafe;
  }
}
