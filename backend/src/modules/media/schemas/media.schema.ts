/**
 * Media schemas — request definitions for /api/media.
 *
 * Nothing to validate here:
 * - POST /uploads checks purpose/contentType/size mid-flow with exact wire
 *   messages (rate limit + concurrency count run between them), so the
 *   service performs the identical checks on the raw body.
 * - PUT /upload/:token carries raw file bytes (no body parser) and the
 *   HMAC-signed token IS the auth — verified in the service.
 * - POST /:id/complete and GET /:id only need a trimmed string id.
 * - GET /files/* serves playback files from a wildcard path — no schema.
 */
export {};
