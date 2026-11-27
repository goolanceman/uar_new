/**
 * Authentication/authorization middleware — Express-middleware form of the
 * existing session gates (`requireAuth`/`requireRole` in lib/session.ts).
 * The verified session is attached to `req.session` for controllers and
 * downstream services; failures throw ApiErrors handled by the centralized
 * error middleware.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requireAuth, requireRole, type Session } from "@/lib/session";
import { requireElevated } from "@/lib/community/admin";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

/** Requires a valid, non-revoked session. Attaches it to req.session. */
export const authenticate: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    req.session = await requireAuth(req);
    next();
  } catch (error) {
    next(error);
  }
};

/** Requires a valid session whose role is one of `roles`. */
export const authorize =
  (...roles: string[]): RequestHandler =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.session = await requireRole(req, ...roles);
      next();
    } catch (error) {
      next(error);
    }
  };

/** Moderator/admin gate (community contract) as middleware. Attaches the
 *  verified session to req.session — same gate legacy routes awaited inline. */
export const elevated: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    req.session = await requireElevated(req);
    next();
  } catch (error) {
    next(error);
  }
};
