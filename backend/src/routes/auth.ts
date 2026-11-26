/**
 * Auth routes — /api/auth/*
 * Converted 1:1 from src/app/api/auth/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { randomInt, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  setSession,
  clearSession,
  validateSession,
  issueToken,
  verifyPassword,
  hashPassword,
  requireAuth,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { loadSettings, emailShell, sendEmail } from "@/lib/notify";
import { deleteUserCascade } from "@/lib/community/users";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { isTestingMode } from "@/lib/testing-mode";

export const router = Router();

const ALLOWED_ROLES = ["DONOR", "VOLUNTEER", "BENEFICIARY"];

function tempPassword(): string {
  return `UAR${Math.floor(10000 + Math.random() * 90000)}@`;
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const b = await Promise.resolve(req.body ?? {});
    const email = String(b?.email ?? "").trim().toLowerCase();
    const password = String(b?.password ?? "");

    if (!email || !password)
      throw new ApiError("Email and password are required", 400);

    // Throttle brute-force / credential-stuffing by IP and by the targeted
    // account. 10 attempts / 10 minutes per key is generous for real users,
    // punishing for automated guessing.
    const ip = clientIp(req.headers);
    const ipLimit = checkRateLimit(`login:ip:${ip}`, 20, 10 * 60 * 1000);
    const emailLimit = checkRateLimit(`login:email:${email}`, 10, 10 * 60 * 1000);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      throw new ApiError("Too many attempts. Please try again later.", 429);
    }

    const user = await db.user.findFirst({
      where: { email: { equals: email } },
    });

    if (!user || !verifyPassword(password, user.password))
      throw new ApiError("Invalid email or password", 401);

    if (user.status === "SUSPENDED")
      throw new ApiError("Account suspended", 403);

    // Optional device registration on login (mobile sends it; web does not).
    const deviceToken = String(b?.deviceToken ?? "").trim();
    const deviceType = Number.isFinite(Number(b?.deviceType)) ? Number(b?.deviceType) : null;
    if (deviceToken) {
      await db.user.update({
        where: { id: user.id },
        data: { deviceToken, ...(deviceType !== null ? { deviceType } : {}) },
      });
    }

    const session = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    };
    setSession(res, session);

    // Upgrade legacy plain-text password to scrypt hash
    if (!user.password.includes(":")) {
      await db.user.update({
        where: { id: user.id },
        data: { password: hashPassword(password) },
      });
    }

    const { password: _pw, ...userSafe } = user;
    await logActivity(user.name, "LOGIN", "USER", user.role, user.id);
    return json(res, { user: userSafe, token: issueToken(session) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    // Throttle automated signup abuse (account enumeration / spam) by IP.
    const ip = clientIp(req.headers);
    const ipLimit = checkRateLimit(`register:ip:${ip}`, 10, 10 * 60 * 1000);
    if (!ipLimit.allowed) {
      throw new ApiError("Too many attempts. Please try again later.", 429);
    }

    const b = await Promise.resolve(req.body ?? {});
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

    const existing = await db.user.findFirst({
      where: { email: { equals: email } },
    });
    if (existing)
      throw new ApiError("An account with this email already exists", 409);

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
    const user = await db.user.create({
      data: {
        name,
        email,
        phone,
        city,
        role,
        password: hashPassword(password),
        status: role === "VOLUNTEER" ? "PENDING" : "ACTIVE",
        isActive: role !== "VOLUNTEER",
        // Mobile signup may register its push credentials inline (web omits them).
        ...(String(b?.deviceToken ?? "").trim()
          ? { deviceToken: String(b.deviceToken).trim(), ...(Number.isFinite(Number(b?.deviceType)) ? { deviceType: Number(b.deviceType) } : {}) }
          : {}),
      },
    });

    const session = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    };
    setSession(res, session);

    await logActivity(name, "REGISTER", "USER", role, user.id);

    const { password: _pw, ...userSafe } = user;
    return json(res, {
      user: userSafe,
      token: issueToken(session),
      // Temp credentials only when the password was generated — a
      // user-chosen password is never echoed back.
      ...(chosen ? {} : { tempCreds: { email, password, fullName: name } }),
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/auth/demo-accounts — no auth. The login-screen demo credential
// list. SINGLE SOURCE OF TRUTH: src/lib/demo-accounts.ts (same list prisma/seed.ts
// creates). Serving is gated behind testing mode:
//   OFF (default) → 404 { error: "Not found" } — indistinguishable from any
//     other unknown route, so production leaks nothing (not even the
//     existence of the feature).
//   ON → { testingMode: true, accounts: [...] } with ONLY the accounts that
//     still exist in the DB and are usable (not suspended) — deleting or
//     suspending a demo user removes it from the list automatically.
router.get("/demo-accounts", async (_req, res) => {
  try {
    if (!(await isTestingMode())) throw new ApiError("Not found", 404);

    const rows = await db.user.findMany({
      where: { email: { in: DEMO_ACCOUNTS.map((d) => d.email) }, status: { not: "SUSPENDED" } },
      select: { email: true },
    });
    const present = new Set(rows.map((r) => r.email));
    return json(res, {
      testingMode: true,
      accounts: DEMO_ACCOUNTS.filter((d) => present.has(d.email)).map((d) => ({
        role: d.role,
        label: d.label,
        email: d.email,
        password: d.password,
        description: d.description,
        portal: d.portal,
      })),
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  try {
    // Revocation-aware (logout/password-reset watermarks) — /me is the
    // session-introspection endpoint, so a revoked token must read as signed
    // out. Falls back to `{ user: null }` exactly as before (no 401).
    const session = await validateSession(req);
    if (!session) return json(res, { user: null });

    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) return json(res, { user: null });

    const { password: _pw, ...userSafe } = user;
    return json(res, { user: userSafe });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/auth/logout — clears the cookie AND truly revokes every
// previously-issued token for the account by advancing the revocation
// watermark: all tokens whose `iat` predates `now` are rejected by
// validateSession from this moment on (bearer tokens included).
router.post("/logout", async (req, res) => {
  try {
    const session = await validateSession(req);
    if (session) {
      await db.user.update({
        where: { id: session.userId },
        data: { tokenValidAfter: new Date() },
      });
      await logActivity(session.name, "LOGOUT", "USER", session.role, session.userId);
    }
    clearSession(res);
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/auth/refresh (auth required) — issues a fresh 7-day token for the
// signed-in account (sliding expiry). Also refreshes the session cookie so
// cookie-based clients stay signed in. Response shape: { token }.
router.post("/refresh", async (req, res) => {
  try {
    const session = await requireAuth(req);
    setSession(res, session);
    return json(res, { token: issueToken(session) });
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Forgot / reset password (secure OTP — gap A-2) ────────────────────────────
// Legacy AuthController::forgotPassword returned the OTP IN THE RESPONSE
// (AuthController.php L213) — that leak is deliberately NOT ported. The OTP
// is only ever delivered by email; without a configured transport it is
// logged server-side (documented dev behavior) and never leaves the server
// in an API response.

const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Cryptographically-random 6-digit OTP. */
function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Issue a 6-digit OTP over email — shared by forgot-password and
 * send-verification-otp (both store hashed codes in PasswordReset rows).
 * The plaintext OTP is NEVER returned in an API response; without a mail
 * transport it is logged server-side (documented dev behavior).
 */
async function issueOtpEmail(email: string, userName: string, purpose: "reset" | "verify"): Promise<void> {
  const otp = generateOtp();
  // Supersede any previous pending codes for this email.
  await db.passwordReset.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
  await db.passwordReset.create({
    data: {
      email,
      otpHash: hashPassword(otp), // scrypt — plaintext OTP never stored
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
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
    console.log(`[auth] ${purpose === "reset" ? "password reset" : "verification"} OTP for ${email}: ${otp} (email transport not configured)`);
  } else if (!out.ok) {
    console.error(`[auth] ${purpose} OTP email failed:`, out.message);
  }
}

// POST /api/auth/forgot-password { email } — ALWAYS 200 { ok: true }
// (no account enumeration, mirrors the legacy contract minus the OTP leak).
router.post("/forgot-password", async (req, res) => {
  try {
    const b = await Promise.resolve(req.body ?? {});
    const email = String(b?.email ?? "").trim().toLowerCase();

    // Unknown emails take the same path and answer identically.
    if (email && /^\S+@\S+\.\S+$/.test(email)) {
      // Throttle OTP requests: 5 / hour per email+IP pair.
      const rl = checkRateLimit(
        `forgot-password:${email}:${clientIp(req.headers)}`,
        5,
        60 * 60 * 1000
      );
      if (!rl.allowed)
        throw new ApiError("Too many reset requests. Please try again later.", 429);

      const user = await db.user.findFirst({ where: { email: { equals: email } } });
      if (user) await issueOtpEmail(email, user.name, "reset");
    }

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/auth/reset-password { email, otp, password }
router.post("/reset-password", async (req, res) => {
  try {
    const b = await Promise.resolve(req.body ?? {});
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
    const rl = checkRateLimit(
      `reset-password:${email}:${clientIp(req.headers)}`,
      5,
      60 * 60 * 1000
    );
    if (!rl.allowed)
      throw new ApiError("Too many attempts. Please request a new code.", 429);

    // One generic failure for unknown email / bad code / expired code —
    // the response must not reveal which part was wrong.
    const INVALID = new ApiError("Invalid or expired code", 400);

    const user = await db.user.findFirst({ where: { email: { equals: email } } });
    if (!user) throw INVALID;

    const pending = await db.passwordReset.findMany({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    const match = pending.find((row) => verifyPassword(otp, row.otpHash));
    if (!match) throw INVALID;

    // Single write: new scrypt password + revocation watermark (all existing
    // sessions die with the password) + consume every pending reset row.
    await db.user.update({
      where: { id: user.id },
      data: {
        password: hashPassword(password),
        tokenValidAfter: new Date(),
      },
    });
    await db.passwordReset.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    });

    await logActivity(user.name, "PASSWORD_RESET", "USER", user.role, user.id);
    return json(res, { ok: true, message: "Password updated — you can sign in with your new password." });
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── Mobile-parity extensions (generic REST — shared by web + mobile) ────────

// POST /api/auth/send-verification-otp { email } — emails a 6-digit code for
// email verification (same PasswordReset rows as forgot-password). The OTP is
// never returned in the response.
router.post("/send-verification-otp", async (req, res) => {
  try {
    const b = await Promise.resolve(req.body ?? {});
    const email = String(b?.email ?? "").trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const rl = checkRateLimit(
      `verify-otp:${email}:${clientIp(req.headers)}`,
      5,
      60 * 60 * 1000
    );
    if (!rl.allowed) throw new ApiError("Too many requests. Please try again later.", 429);

    const user = await db.user.findFirst({ where: { email: { equals: email } } });
    if (!user) throw new ApiError("User not found with this email", 404);
    if (user.emailVerifiedAt) throw new ApiError("Email already verified", 400);

    await issueOtpEmail(email, user.name, "verify");
    return json(res, { ok: true, message: "Verification OTP sent to email" });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/auth/verify-email { email, otp } — consumes the code and stamps
// emailVerifiedAt. Returns the updated user (raw shape minus password).
router.post("/verify-email", async (req, res) => {
  try {
    const b = await Promise.resolve(req.body ?? {});
    const email = String(b?.email ?? "").trim().toLowerCase();
    const otp = String(b?.otp ?? "").trim();

    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);
    if (!/^\d{6}$/.test(otp))
      throw new ApiError("Please enter the 6-digit code from the email", 400);

    const pending = await db.passwordReset.findMany({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    const match = pending.find((row) => verifyPassword(otp, row.otpHash));
    if (!match) throw new ApiError("Invalid or expired code", 400);

    const user = await db.user.findFirst({ where: { email: { equals: email } } });
    if (!user) throw new ApiError("User not found", 404);

    const updated = await db.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    await db.passwordReset.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });

    const { password: _pw, ...userSafe } = updated;
    return json(res, { ok: true, user: userSafe });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/auth/social — sign in (or register) by external identity.
// Replaces the legacy POST /addUser: { identity, loginType (0 google |
// 1 apple | 2 email), deviceType?, deviceToken?, fullName? }. The identity is
// stored in the (unique) email column, like the legacy wire format did.
router.post("/social", async (req, res) => {
  try {
    const b = await Promise.resolve(req.body ?? {});
    const identity = String(b?.identity ?? "").trim();
    if (!identity) throw new ApiError("identity is required", 400);

    const ip = clientIp(req.headers);
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

    const existing = await db.user.findFirst({ where: { email: { equals: email } } });
    if (existing) {
      if (existing.status === "SUSPENDED") throw new ApiError("Account suspended", 403);
      const updated = await db.user.update({ where: { id: existing.id }, data: deviceData });
      const { password: _pw, ...userSafe } = updated;
      const session = { userId: updated.id, role: updated.role, name: updated.name, email: updated.email };
      return json(res, { user: userSafe, token: issueToken(session), created: false });
    }

    // Unique username from the identity (legacy AuthController::generateUsername).
    const base = identity.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
    let username = base;
    let counter = 1;
    while (await db.user.findFirst({ where: { username }, select: { id: true } })) {
      username = `${base}${counter++}`;
    }

    const name = String(b?.fullName ?? b?.full_name ?? "").trim() || "User";
    const user = await db.user.create({
      data: {
        email,
        name,
        // Social logins have no password of their own — a random one blocks
        // password-login on this account until a reset is requested.
        password: hashPassword(randomBytes(24).toString("hex")),
        username,
        loginType,
        status: "ACTIVE",
        ...deviceData,
      },
    });

    const session = { userId: user.id, role: user.role, name: user.name, email: user.email };
    const { password: _pw, ...userSafe } = user;
    await logActivity(user.name, "REGISTER", "USER", user.role, user.id);
    return json(res, { user: userSafe, token: issueToken(session), created: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/auth/username-available?username= — legacy POST /checkUsername.
router.get("/username-available", async (req, res) => {
  try {
    const username = String(req.query.username ?? "").trim();
    if (!username) return json(res, { available: true });
    const taken = await db.user.findFirst({ where: { username }, select: { id: true } });
    return json(res, { available: !taken });
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/auth/account — self-service account deletion (legacy
// /auth/delete-account + /deleteUser cascade). Optional { password } double-check.
router.delete("/account", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = await Promise.resolve(req.body ?? {});
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new ApiError("Account not found", 404);

    const given = String(b?.password ?? "");
    if (given !== "" && !verifyPassword(given, user.password))
      throw new ApiError("Invalid password", 400);

    await deleteUserCascade(user.id);
    clearSession(res);
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/auth/profile
router.patch("/profile", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = await Promise.resolve(req.body ?? {});

    const data: Record<string, unknown> = {};

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
      const { current, next } = b.password;
      const user = await db.user.findUnique({ where: { id: session.userId } });
      if (!user) throw new ApiError("Account not found", 404);
      if (!current || !verifyPassword(String(current), user.password))
        throw new ApiError("Current password is incorrect", 400);
      if (!next || String(next).length < 6)
        throw new ApiError("New password must be at least 6 characters", 400);
      data.password = hashPassword(String(next));
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const updated = await db.user.update({
      where: { id: session.userId },
      data,
    });

    const { password: _pw, ...userSafe } = updated;
    return json(res, { user: userSafe });
  } catch (e) {
    return handleError(e, res);
  }
});
