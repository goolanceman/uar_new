/**
 * Application error hierarchy — single source of truth for all domain and
 * infrastructure errors. Every layer throws these; the centralized error
 * middleware (and the legacy per-route handleError) maps them to HTTP.
 *
 * `ApiError` is kept as the historical name used by every existing route —
 * it now extends `AppError` so the whole hierarchy interoperates.
 */

export interface AppErrorOptions {
  /** Machine-readable error code for log correlation / client handling. */
  code?: string;
  /** Structured details (e.g. Zod issues) — never sent to the client. */
  details?: unknown;
  /** Underlying cause, preserved for logging only. */
  cause?: unknown;
}

/** Base class for every error the application raises deliberately. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status = 400, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.status = status;
    this.code = options.code ?? "APP_ERROR";
    this.details = options.details;
  }
}

/** Historical alias — every existing route throws/catches this. */
export class ApiError extends AppError {
  constructor(message: string, status = 400, options: AppErrorOptions = {}) {
    super(message, status, { ...options, code: options.code ?? "API_ERROR" });
  }
}

/** 400 — request input failed schema validation. */
export class ValidationError extends ApiError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, { code: "VALIDATION_ERROR", details });
    this.name = "ValidationError";
  }
}

/** 401 — missing, invalid, or revoked credentials. */
export class AuthenticationError extends ApiError {
  constructor(message = "Please sign in to continue") {
    super(message, 401, { code: "AUTHENTICATION_ERROR" });
    this.name = "AuthenticationError";
  }
}

/** 403 — authenticated but not allowed. */
export class AuthorizationError extends ApiError {
  constructor(message = "You do not have permission for this action") {
    super(message, 403, { code: "AUTHORIZATION_ERROR" });
    this.name = "AuthorizationError";
  }
}

/** 404 — resource does not exist (or is hidden from the caller). */
export class NotFoundError extends ApiError {
  constructor(message = "Resource not found") {
    super(message, 404, { code: "NOT_FOUND" });
    this.name = "NotFoundError";
  }
}

/** 409 — uniqueness / state conflict. */
export class ConflictError extends ApiError {
  constructor(message = "Resource conflict") {
    super(message, 409, { code: "CONFLICT" });
    this.name = "ConflictError";
  }
}

/** 429 — rate limit / quota exceeded. */
export class RateLimitError extends ApiError {
  constructor(message = "Too many requests. Please try again later.") {
    super(message, 429, { code: "RATE_LIMITED" });
    this.name = "RateLimitError";
  }
}

/** 502 — upstream/third-party call failed. */
export class ExternalServiceError extends ApiError {
  constructor(message = "Upstream service failed", options: AppErrorOptions = {}) {
    super(message, 502, { ...options, code: options.code ?? "EXTERNAL_SERVICE_ERROR" });
    this.name = "ExternalServiceError";
  }
}
