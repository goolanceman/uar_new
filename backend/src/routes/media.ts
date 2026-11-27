/**
 * Media routes — /api/media: presigned direct video uploads, the local-driver
 * PUT receiver, the transcode polling endpoint and public playback serving
 * (HLS segments / MP4 / poster) with HTTP Range support.
 *
 * Thin endpoint definitions; all logic lives in src/modules/media
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/media`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Flow: POST /uploads → presigned PUT → POST /:id/complete → the transcoder
 * worker (lib/media/transcoder.ts) moves the asset to "ready" → playback URLs
 * resolve through (await getStorage()).publicUrl.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { mediaController } from "@/modules/media";

export const router = Router();

// POST /api/media/uploads — presign a direct video upload (session required).
router.post("/uploads", authenticate, mediaController.presign);

// PUT /api/media/upload/:token — local-driver receiver. The token IS the auth
// (no session): it is HMAC-signed and carries key + contentType + contentLength
// + expiry. The body is the raw file bytes — never touched by express.json.
router.put("/upload/:token", mediaController.receive);

// POST /api/media/:id/complete — owner confirms the bytes landed and hands
// the asset to the transcoder queue (idempotent).
router.post("/:id/complete", authenticate, mediaController.complete);

// GET /api/media/:id — owner-only polling endpoint (upload + transcode progress).
router.get("/:id", authenticate, mediaController.poll);

// GET /api/media/files/* — public playback serving. Only outputs of READY
// assets are exposed (never source.*), with Range support. The local driver
// streams from media-store; the s3 driver materializes objects on demand, so
// HLS playlists keep resolving their relative segment references against this
// API (presigned URLs would drop the signature on nested fetches).
router.get("/files/*", mediaController.serve);
