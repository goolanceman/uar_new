/**
 * Auth routes — /api/auth/*
 * Converted 1:1 from src/app/api/auth/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { randomInt } from "node:crypto";
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
    const phone = String(b?.phone ?? "").trim();
    const city = b?.city ? String(b.city).trim() : null;
    const role = ALLOWED_ROLES.includes(String(b?.role)) ? String(b.role) : "DONOR";

    if (!name || !email || !phone)
      throw new ApiError("Name, email and phone are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const existing = await db.user.findFirst({
      where: { email: { equals: email } },
    });
    if (existing)
      throw new ApiError("An account with this email already exists", 409);

    const password = tempPassword();
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
      tempCreds: { email, password, fullName: name },
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
      if (user) {
        const otp = generateOtp();
        // Supersede any previous pending codes for this email.
        await db.passwordReset.updateMany({
          where: { email, usedAt: null },
          data: { usedAt: new Date() },
        });
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
        const bodyHtml = `
          <p style="margin:0 0 8px;">Hello ${user.name},</p>
          <p style="margin:0 0 12px;">We received a request to reset the password for your ${org.name} account. Use the verification code below — it expires in <strong>15 minutes</strong>.</p>
          <p style="margin:16px 0;text-align:center;">
            <span style="display:inline-block;font-size:28px;letter-spacing:8px;font-weight:700;color:#064e3b;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 24px;">${otp}</span>
          </p>
          <p style="margin:0 0 12px;">Enter this code on the reset-password screen together with your new password. If you did not request a reset, you can safely ignore this email — your current password keeps working.</p>
          <p style="margin:0;">— The ${org.name} Team</p>`;
        const out = await sendEmail(map, {
          to: email,
          subject: `Your password reset code — ${org.name}`,
          html: emailShell("Password reset code", bodyHtml, org),
        });
        if (out.skipped) {
          // No email transport configured — documented DEV behavior: the OTP
          // is logged server-side so local flows stay testable. NEVER returned
          // in the API response.
          console.log(`[auth] password reset OTP for ${email}: ${otp} (email transport not configured)`);
        } else if (!out.ok) {
          console.error("[auth] password reset email failed:", out.message);
        }
      }
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
