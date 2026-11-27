/**
 * Background job bootstrap — starts the out-of-band workers once, after the
 * HTTP listener. Each starter is idempotent and logs its own failures.
 */
import { logger } from "@/infrastructure/logging/logger";
import { startPusherServer } from "@/infrastructure/external-services/pusher-server";
import { syncPostCommentCounts } from "@/domains/community/counters";
import { startTranscoder } from "@/jobs/workers/transcoder.worker";
import { assertStorageConfig } from "@/infrastructure/storage";

export function startBackgroundJobs(): void {
  syncPostCommentCounts().catch((e) =>
    logger.error("comment_count_sync_failed", { error: e instanceof Error ? e : String(e) })
  );

  // Background video transcoder (DB-backed queue — see lib/media/transcoder.ts).
  // No-ops when TRANSCODER_ENABLED === "false" or under NODE_ENV=test.
  assertStorageConfig();
  try {
    startTranscoder();
  } catch (e) {
    logger.error("transcoder_start_failed", { error: e instanceof Error ? e : String(e) });
  }

  // Pusher-protocol WebSocket server for the mobile app (Laravel Reverb wire
  // format, ws://host:6001/app/chatter-key). Starts after the HTTP listener.
  try {
    startPusherServer();
  } catch (e) {
    logger.error("pusher_server_start_failed", { error: e instanceof Error ? e : String(e) });
  }
}
