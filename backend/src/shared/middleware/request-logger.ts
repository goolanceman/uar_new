/**
 * Wide-event request logging middleware (canonical log line pattern).
 *
 * Emits exactly ONE structured log line per request at completion, carrying:
 *   ts, level, module="http", msg="request", method, path, status,
 *   duration_ms, request_id, user_id (when a session cookie/token is
 *   present), ip, and the error message for failed requests.
 *
 * Health checks (/api/health) log at debug level so the compose healthcheck
 * (every 10s) doesn't flood info-level logs.
 *
 * Assigns req.requestId — a UUID echoed on every log line and available to
 * handlers for correlation. Handlers needing extra business context may set
 * res.locals.logCtx (object) — it's merged into the wide event.
 */
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "@/infrastructure/logging/logger";
import { getSession } from "@/infrastructure/auth/session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const http = logger.child("http");

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  req.requestId = randomUUID();

  res.on("finish", () => {
    const isHealth = req.path === "/api/health";
    if (isHealth && process.env.LOG_HEALTH !== "true") return; // healthcheck spam filter

    const status = res.statusCode;
    const ctx: Record<string, unknown> = {
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl?.split("?")[0] || req.path,
      status,
      duration_ms: Date.now() - start,
      ip: req.ip,
    };

    // Attach the acting user when the request carries a session token
    // (sync JWT decode only — no DB round-trip here).
    const session = getSession(req);
    if (session?.userId) ctx.user_id = session.userId;

    // Handlers can enrich the event (e.g. entity ids) via res.locals.logCtx.
    const extra = res.locals.logCtx as Record<string, unknown> | undefined;
    if (extra && typeof extra === "object") Object.assign(ctx, extra);

    if (status >= 500) {
      const err = res.locals.error as Error | undefined;
      if (err) ctx.error = err.message;
      http.error("request_failed", ctx);
    } else if (status >= 400) {
      http.warn("request_rejected", ctx);
    } else {
      http.info("request", ctx);
    }
  });

  next();
}
