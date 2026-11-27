/**
 * Food rate-limit middleware — the request-bound half of the public food
 * endpoints' gate. Legacy ran `enforceFoodRateLimit(new Headers(req.headers),
 * bucket, key)` as the handler's FIRST step — before the optional-session
 * probe and before any body validation — so a rate-limited caller gets 429
 * and a token is consumed even when the body would have failed validation.
 * Registering it as middleware (before `validate`) preserves that exact
 * ordering; failures render through lib/session handleError like the shared
 * auth middleware.
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/lib/session";
import { enforceFoodRateLimit } from "@/lib/food";

export const foodRateLimit =
  (
    bucket: "applications" | "status" | "pledges",
    key: "food.applications.rateLimitPerHour" | "food.statusCheck.rateLimitPerHour" | "food.pledges.rateLimitPerHour"
  ): RequestHandler =>
  async (req: Request, res: Response, next: (err?: unknown) => void): Promise<void> => {
    try {
      // Express headers are a plain record — the shared limiter expects fetch Headers.
      await enforceFoodRateLimit(new Headers(req.headers as Record<string, string>), bucket, key);
      next();
    } catch (error) {
      handleError(error, res);
    }
  };
