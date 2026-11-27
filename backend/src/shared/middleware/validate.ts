/**
 * Zod validation middleware — the single validation gate for all HTTP input.
 *
 * Schemas are grouped by request part (params/query/body) so a module can
 * validate any combination. Parsed (coerced/trimmed) values are attached to
 * `req.validated` — controllers read validated data from there instead of
 * re-parsing raw input.
 *
 * On failure it throws `ValidationError`, which the centralized error
 * middleware (and the legacy per-route handleError) renders as a 400 with
 * `{ error: message }` — the exact contract existing clients rely on.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "@/shared/errors";

export interface ValidatedSchemas<Body = unknown, Query = unknown, Params = unknown> {
  body?: ZodType<Body>;
  query?: ZodType<Query>;
  params?: ZodType<Params>;
}

export interface Validated<Body = unknown, Query = unknown, Params = unknown> {
  body?: Body;
  query?: Query;
  params?: Params;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validated?: Validated;
    }
  }
}

/** Formats Zod issues into a compact "field: message" list. */
export function formatZodIssues(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}

/**
 * Validates parts of the request against the given Zod schemas. Missing
 * schema parts pass through untouched, so `validate({ body: schema })` on a
 * multipart upload route still leaves `req.body`/`req.files` intact for the
 * controller.
 */
export const validate =
  <Body = unknown, Query = unknown, Params = unknown>(
    schemas: ValidatedSchemas<Body, Query, Params>
  ): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const validated: Validated = {};

    try {
      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);
        if (!result.success) {
          throw new ValidationError(`Invalid request parameters: ${formatZodIssues(result.error)}`, result.error);
        }
        validated.params = result.data;
      }

      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);
        if (!result.success) {
          throw new ValidationError(`Invalid query parameters: ${formatZodIssues(result.error)}`, result.error);
        }
        validated.query = result.data;
      }

      if (schemas.body) {
        const result = schemas.body.safeParse(req.body ?? {});
        if (!result.success) {
          throw new ValidationError(`Invalid request body: ${formatZodIssues(result.error)}`, result.error);
        }
        validated.body = result.data;
      }
    } catch (error) {
      next(error);
      return;
    }

    req.validated = validated;
    next();
  };

/** Typed accessors — controllers use these instead of raw req fields. */
export function validatedBody<T>(req: Request): T {
  return req.validated?.body as T;
}

export function validatedQuery<T>(req: Request): T {
  return req.validated?.query as T;
}

export function validatedParams<T>(req: Request): T {
  return req.validated?.params as T;
}
