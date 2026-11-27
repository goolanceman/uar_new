/**
 * HTTP response helpers — the legacy contract is "the payload IS the body"
 * (`json(res, data, status)`), extended with the `{ success: true, data }`
 * envelope used by newer dashboard endpoints. Both live here so controllers
 * never hand-roll `res.status(...).json(...)`.
 */
import type { Response } from "express";

/** Sends `data` as the raw response body (legacy contract). */
export function json(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json(data);
}

/** Sends the enveloped success shape used by dashboard/stats endpoints. */
export function ok(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json({ success: true, data });
}

/** Sends the enveloped failure shape. */
export function fail(res: Response, message: string, status = 500): Response {
  return res.status(status).json({ success: false, error: message });
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}
