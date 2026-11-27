/**
 * Auth routes — /api/auth/*
 * Thin endpoint definitions; all logic lives in src/modules/auth
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/auth`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Converted 1:1 from src/app/api/auth/* (Next.js route handlers) to Express.
 * Auth gates: /refresh, /account and /profile ran `await requireAuth(req)` as
 * their FIRST legacy step — now the `authenticate` middleware (identical gate,
 * identical error rendering). /me and /logout read the session OPTIONALLY via
 * validateSession and stay that way in the controller.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  deleteAccountBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  sendVerificationOtpBodySchema,
  socialBodySchema,
  updateProfileBodySchema,
  usernameAvailableQuerySchema,
  verifyEmailBodySchema,
} from "@/modules/auth/schemas/auth.schema";
import { authController } from "@/modules/auth";

export const router = Router();

// POST /api/auth/login
router.post("/login", validate({ body: loginBodySchema }), authController.login);

// POST /api/auth/register
router.post("/register", validate({ body: registerBodySchema }), authController.register);

// GET /api/auth/demo-accounts — no auth. The login-screen demo credential
// list, gated behind testing mode (OFF → 404, indistinguishable from any
// other unknown route).
router.get("/demo-accounts", authController.demoAccounts);

// GET /api/auth/me — session introspection; revoked tokens read as
// { user: null } (no 401).
router.get("/me", authController.me);

// POST /api/auth/logout — clears the cookie AND truly revokes every
// previously-issued token (tokenValidAfter watermark).
router.post("/logout", authController.logout);

// POST /api/auth/refresh (auth required) — issues a fresh 7-day token
// (sliding expiry) and refreshes the session cookie. Response shape: { token }.
router.post("/refresh", authenticate, authController.refresh);

// POST /api/auth/forgot-password { email } — ALWAYS 200 { ok: true }
// (no account enumeration).
router.post("/forgot-password", validate({ body: forgotPasswordBodySchema }), authController.requestPasswordReset);

// POST /api/auth/reset-password { email, otp, password }
router.post("/reset-password", validate({ body: resetPasswordBodySchema }), authController.resetPassword);

// POST /api/auth/send-verification-otp { email } — emails a 6-digit code for
// email verification. The OTP is never returned in the response.
router.post("/send-verification-otp", validate({ body: sendVerificationOtpBodySchema }), authController.sendVerificationOtp);

// POST /api/auth/verify-email { email, otp } — consumes the code and stamps
// emailVerifiedAt.
router.post("/verify-email", validate({ body: verifyEmailBodySchema }), authController.verifyEmail);

// POST /api/auth/social — sign in (or register) by external identity
// ({ identity, loginType, deviceType?, deviceToken?, fullName? }).
router.post("/social", validate({ body: socialBodySchema }), authController.social);

// GET /api/auth/username-available?username= — legacy POST /checkUsername.
router.get("/username-available", validate({ query: usernameAvailableQuerySchema }), authController.usernameAvailable);

// DELETE /api/auth/account — self-service account deletion (legacy
// /auth/delete-account + /deleteUser cascade). Optional { password } double-check.
router.delete("/account", authenticate, validate({ body: deleteAccountBodySchema }), authController.deleteAccount);

// PATCH /api/auth/profile
router.patch("/profile", authenticate, validate({ body: updateProfileBodySchema }), authController.updateProfile);
