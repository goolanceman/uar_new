/**
 * Auth controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response.
 *
 * Errors are rendered with the lib handleError directly (NOT next(error)) —
 * the same pattern as the shared auth middleware's `fail`: the legacy per-route
 * catch did exactly this, and test harnesses mount this router without an
 * app-level error middleware, so the { error, status } contract must hold
 * even there.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clearSession, handleError, setSession, validateSession, type Session } from "@/infrastructure/auth/session";
import { clientIp } from "@/infrastructure/cache/rate-limit";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type { UsernameAvailableQuery } from "../schemas/auth.schema";
import type { AuthService } from "../services/auth.service";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /api/auth/login */
  login: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const ip = clientIp(req.headers);
      const { session, user, password } = await this.authService.login(body, ip);
      setSession(res, session);
      const { userSafe, token } = await this.authService.completeLogin(user, session, password);
      res.json({ user: userSafe, token });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/register */
  register: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const ip = clientIp(req.headers);
      const result = await this.authService.register(body, ip);
      setSession(res, result.session);
      res.json({
        user: result.userSafe,
        token: result.token,
        ...(result.tempCreds ? { tempCreds: result.tempCreds } : {}),
      });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/auth/demo-accounts — no auth; 404 unless testing mode is ON. */
  demoAccounts: RequestHandler = async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      res.json(await this.authService.demoAccounts());
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/auth/me — optional session (validateSession), never 401s. */
  me: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const session = await validateSession(req);
      const user = await this.authService.me(session);
      res.json({ user: user ?? null });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/logout */
  logout: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const session = await validateSession(req);
      await this.authService.logout(session);
      clearSession(res);
      res.json({ ok: true });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/refresh (auth required) — also refreshes the session
   *  cookie so cookie-based clients stay signed in. Response shape: { token }. */
  refresh: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const session = req.session!;
      setSession(res, session);
      res.json({ token: this.authService.refresh(session) });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/forgot-password — ALWAYS 200 { ok: true }. */
  requestPasswordReset: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const ip = clientIp(req.headers);
      await this.authService.requestPasswordReset(body, ip);
      res.json({ ok: true });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/reset-password */
  resetPassword: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const ip = clientIp(req.headers);
      await this.authService.resetPassword(body, ip);
      res.json({ ok: true, message: "Password updated — you can sign in with your new password." });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/send-verification-otp */
  sendVerificationOtp: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const ip = clientIp(req.headers);
      await this.authService.sendVerificationOtp(body, ip);
      res.json({ ok: true, message: "Verification OTP sent to email" });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/verify-email */
  verifyEmail: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const userSafe = await this.authService.verifyEmail(body);
      res.json({ ok: true, user: userSafe });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/auth/social — sign in (or register) by external identity. */
  social: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const ip = clientIp(req.headers);
      const { userSafe, token, created } = await this.authService.social(body, ip);
      res.json({ user: userSafe, token, created });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/auth/username-available?username= */
  usernameAvailable: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<UsernameAvailableQuery>(req);
      res.json(await this.authService.usernameAvailable(query.username));
    } catch (error) {
      handleError(error, res);
    }
  };

  /** DELETE /api/auth/account — self-service account deletion. */
  deleteAccount: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      await this.authService.deleteAccount(req.session!, body);
      clearSession(res);
      res.json({ ok: true });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/auth/profile */
  updateProfile: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<Record<string, unknown>>(req);
      const userSafe = await this.authService.updateProfile(req.session!, body);
      res.json({ user: userSafe });
    } catch (error) {
      handleError(error, res);
    }
  };
}
