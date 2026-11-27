/**
 * Transcoder worker — a DB-backed queue: rows in app_media_assets move
 * uploaded → processing → ready|failed. A single interval claims work
 * atomically (FOR UPDATE SKIP LOCKED, plus a 15-minute stale-lock reclaim) and
 * runs ffmpeg/ffprobe (system binaries, spawned with argument arrays — no
 * shell) to produce:
 *   - an HLS ladder (360p/540p/720p by SHORT side, never upscaling) +
 *     a hand-written master playlist,
 *   - a 720p MP4 fallback (+faststart),
 *   - a JPEG poster (~1s in).
 * Outputs are uploaded via the storage driver under media/<id>/….
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { MediaAsset, Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/logging/logger";
import { getStorage } from "@/infrastructure/storage";
import { feedEvent } from "@/domains/community/push";
import { dequeueTranscode, enqueueTranscode, invalidateMedia, nextWaitingTranscode, setCachedMedia, transcodeQueueState } from "@/infrastructure/cache";

const log = logger.child("media");

const MAX_VIDEO_DURATION_SEC = Number(process.env.MAX_VIDEO_DURATION_SEC || 180);
const MAX_ATTEMPTS = 3;
const LOCK_STALE_MINUTES = 15;
/** Assets older than this that nothing references get swept. */
const SWEEP_AGE_MS = 24 * 60 * 60 * 1000;
/** Skip claiming while ffmpeg is unavailable (avoids a hot retry loop). */
const FFMPEG_BACKOFF_MS = 60_000;
let ffmpegMissingUntil = 0;

// Ladder rungs (SHORT side) with the per-rung rate caps.
const RUNGS: Array<{ short: number; maxrate: number }> = [
  { short: 360, maxrate: 800 },
  { short: 540, maxrate: 1400 },
  { short: 720, maxrate: 2500 },
];

const HLS_CACHE_CONTROL = "public, max-age=60";
const OUTPUT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const OUTPUT_MIME: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
};

// ─── process plumbing (spawn only — no shell, argument arrays) ────────────────

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

let missingBinaryLogged = false;

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      // keep only the tail — ffmpeg traces are enormous
      stderr = `${stderr}${d.toString()}`.slice(-4000);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        if (!missingBinaryLogged) {
          missingBinaryLogged = true;
          log.error("ffmpeg_binary_missing", { bin });
        }
        reject(new Error("FFMPEG_MISSING"));
        return;
      }
      reject(e);
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// ─── Queue claim (atomic) ─────────────────────────────────────────────────────

/** True when a row is waiting or a claimed row's lock has gone stale.
 *  Used only to reconcile — the idle loop asks Redis, not this. */
async function hasClaimable(): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "app_media_assets"
    WHERE "status" = 'uploaded'
       OR ("status" = 'processing' AND "locked_at" < now() - interval '15 minutes')
    LIMIT 1`;
  return rows.length > 0;
}

/** Re-seed the Redis set from rows already waiting. Covers videos that
 *  completed their upload while Redis was down, and stale locks the set
 *  can't know about. */
async function reconcileQueue(): Promise<void> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "app_media_assets"
    WHERE "status" = 'uploaded'
       OR ("status" = 'processing' AND "locked_at" < now() - interval '15 minutes')`;
  for (const row of rows) await enqueueTranscode(row.id);
}

/** The id of one claimable row, or null. The lock and the status change
 *  happen in setStatus, so this only selects. With an id (taken from the
 *  Redis set) only that row is considered. */
async function claimableId(id?: string | null): Promise<string | null> {
  const rows = id
    ? await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "app_media_assets"
        WHERE "id" = ${id}
          AND ("status" = 'uploaded'
               OR ("status" = 'processing' AND "locked_at" < now() - interval '15 minutes'))
        LIMIT 1`
    : await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "app_media_assets"
        WHERE "status" = 'uploaded'
           OR ("status" = 'processing' AND "locked_at" < now() - interval '15 minutes')
        ORDER BY "updated_at"
        LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** Claim one claimable row: lock it and move it to processing, recording the
 *  transition. Returns null when the row was already taken. */
async function claimNext(id?: string | null): Promise<string | null> {
  const target = await claimableId(id);
  if (!target) return null;
  const claimed = await db.$queryRaw<Array<{ attempts: number }>>`
    UPDATE "app_media_assets"
    SET "locked_at" = now(), "attempts" = "attempts" + 1
    WHERE "id" = ${target}
      AND ("status" = 'uploaded'
           OR ("status" = 'processing' AND "locked_at" < now() - interval '15 minutes'))
    RETURNING "attempts"`;
  if (!claimed[0]) return null;
  await setStatus(target, "processing", { attempts: claimed[0].attempts, lockedAt: new Date() });
  return target;
}

// ─── ffprobe parsing ──────────────────────────────────────────────────────────

interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/** Parse ffprobe JSON — display dims respect rotate tags / displaymatrix side
 *  data so portrait phone videos come out upright. */
function parseProbe(probeJson: string): ProbeResult {
  const probe = JSON.parse(probeJson) as {
    streams?: Array<Record<string, unknown>>;
    format?: { duration?: string };
  };
  const streams = probe.streams ?? [];
  const videoStreams = streams.filter(
    (s) => s.codec_type === "video" && (s as { disposition?: { attached_pic?: number } }).disposition?.attached_pic !== 1
  );
  const video = videoStreams[0] ?? streams.find((s) => s.codec_type === "video");
  if (!video || typeof video.width !== "number" || typeof video.height !== "number") {
    throw new Error("No video stream found");
  }

  let width = video.width;
  let height = video.height;

  // rotation: legacy tags.rotate OR the displaymatrix side data
  const tags = (video.tags ?? {}) as Record<string, unknown>;
  const sideData = ((video.side_data_list ?? []) as Array<Record<string, unknown>>).find((d) => "rotation" in d);
  const rawRotation = Number(tags.rotate ?? sideData?.rotation ?? 0);
  const rotation = ((rawRotation % 360) + 360) % 360;
  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }

  const durationSec = Number(probe.format?.duration ?? (video.duration as string | undefined) ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("Video duration is unknown");

  const [num, den] = String(video.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = num > 0 && den > 0 ? num / den : 0;

  return {
    durationMs: Math.round(durationSec * 1000),
    width,
    height,
    fps: fps > 0 ? fps : 25,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

// ─── ffmpeg runs ──────────────────────────────────────────────────────────────

/** Scale filter that caps the SHORT side at `cap` without upscaling, keeping
 *  even dims (-2) — landscape caps height, portrait caps width. */
function scaleFilter(width: number, height: number, cap: number): string {
  const landscape = width >= height;
  const short = landscape ? height : width;
  const target = Math.min(cap, short);
  return landscape ? `scale=-2:${target}` : `scale=${target}:-2`;
}

function hlsArgs(input: string, outDir: string, rung: number, probe: ProbeResult, maxrateKbps: number): string[] {
  const audio = probe.hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"] : ["-an"];
  return [
    "-i", input,
    "-vf", scaleFilter(probe.width, probe.height, rung),
    // 8-bit 4:2:0 — guarantees Main-profile compatibility across ffmpeg builds
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-crf", "23",
    "-maxrate", `${maxrateKbps}k`, "-bufsize", `${maxrateKbps * 2}k`,
    "-g", String(Math.max(24, Math.round(probe.fps) * 2)), "-sc_threshold", "0",
    "-force_key_frames", "expr:gte(t,n_forced*2)",
    ...audio,
    "-hls_time", "2",
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "mpegts",
    "-hls_flags", "independent_segments",
    "-hls_list_size", "0",
    // per-rung prefix — every variant playlist must reference ONLY its own
    // segments (all rungs flatten into the same hls/ directory)
    "-hls_segment_filename", path.join(outDir, `${rung}p_%04d.ts`),
    path.join(outDir, `${rung}.m3u8`),
  ];
}

function mp4Args(input: string, outPath: string, probe: ProbeResult): string[] {
  const audio = probe.hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"] : ["-an"];
  return [
    "-i", input,
    "-vf", scaleFilter(probe.width, probe.height, 720),
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-crf", "23",
    "-maxrate", "2500k", "-bufsize", "5000k",
    "-g", String(Math.max(24, Math.round(probe.fps) * 2)), "-sc_threshold", "0",
    ...audio,
    "-movflags", "+faststart",
    outPath,
  ];
}

function posterArgs(input: string, outPath: string, probe: ProbeResult): string[] {
  const seek = probe.durationMs >= 1000 ? "1" : "0";
  // the comma inside min() must be quoted — a bare comma separates filters
  return ["-ss", seek, "-i", input, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "3", outPath];
}

/** Hand-written master playlist (BANDWIDTH = the rung's rate cap). */
function masterPlaylist(rungs: Array<{ short: number; outWidth: number; outHeight: number; maxrate: number }>, hasAudio: boolean): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const r of rungs) {
    // H.264 Main: 360p → level 3.0, 540p → 3.1, 720p → 4.0; AAC-LC = mp4a.40.2
    const level = r.short <= 360 ? "1e" : r.short <= 540 ? "1f" : "28";
    const codecs = hasAudio ? `"avc1.4d40${level},mp4a.40.2"` : `"avc1.4d40${level}"`;
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.maxrate * 1000},RESOLUTION=${r.outWidth}x${r.outHeight},CODECS=${codecs}`);
    lines.push(`${r.short}.m3u8`);
  }
  return `${lines.join("\n")}\n`;
}

/** Output dims of a rung (mirrors the scale filter's even rounding). */
function rungOutputDims(probe: ProbeResult, rung: number): { outWidth: number; outHeight: number } {
  const landscape = probe.width >= probe.height;
  const target = Math.min(rung, landscape ? probe.height : probe.width);
  if (landscape) {
    return { outWidth: even((probe.width * target) / probe.height), outHeight: target };
  }
  return { outWidth: target, outHeight: even((probe.height * target) / probe.width) };
}

// ─── lifecycle ────────────────────────────────────────────────────────────────
// Every status change goes through here so the row and the event can't
// drift apart. The states are pending_upload → uploaded → processing →
// ready, or → failed. A retry returns a failed attempt to uploaded.

function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/** Write a status transition and announce it. `media.failed` fires only when
 *  the video is done retrying; a retry is announced as `media.uploaded`
 *  because that's the state it returns to. */
/** Upload finished — record it, announce it, and queue the video. */
export async function markMediaUploaded(id: string): Promise<MediaAsset> {
  const updated = await setStatus(id, "uploaded", { attempts: 0, error: null, lockedAt: null });
  await enqueueTranscode(id);
  return updated;
}

async function setStatus(
  id: string,
  status: "uploaded" | "processing" | "ready" | "failed",
  data: Prisma.MediaAssetUpdateInput = {}
): Promise<MediaAsset> {
  const updated = await db.mediaAsset.update({
    where: { id },
    data: { ...data, status, ...(status === "ready" ? {} : { readyAt: null }) },
  });
  feedEvent(`media.${status}`, {
    mediaId: updated.id,
    ownerId: updated.ownerId,
    purpose: updated.purpose,
    status: updated.status,
    attempts: updated.attempts,
    error: updated.error,
  });
  // Status polls and the admin reels list read this instead of the row.
  await setCachedMedia({
    id: updated.id,
    status: updated.status,
    ownerId: updated.ownerId,
    attempts: updated.attempts,
    error: updated.error,
  });
  return updated;
}

async function failAsset(asset: MediaAsset, message: string): Promise<void> {
  // attempts was already incremented by the claim — < MAX means retry.
  const retry = asset.attempts < MAX_ATTEMPTS;
  // A previous ready cache entry must not outlive a failure.
  await invalidateMedia(asset.id);
  await setStatus(asset.id, retry ? "uploaded" : "failed", { error: message, lockedAt: null });
  // Back on the queue for another attempt. A final failure stays out.
  if (retry) await enqueueTranscode(asset.id);
  else await dequeueTranscode(asset.id);
  if (!retry) log.error("transcode_failed_after_retries", { assetId: asset.id, attempts: asset.attempts, error: message });
}

// ─── the worker ───────────────────────────────────────────────────────────────

/**
 * Transcode one asset end-to-end (also used directly by tests). Safe to call
 * with any asset id — rows not awaiting processing are skipped.
 */
export async function processMediaAsset(id: string): Promise<MediaAsset | null> {
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || !["uploaded", "processing"].includes(asset.status)) return null;

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uar-media-"));

  try {
    const sourcePath = path.join(tmpDir, "source");
    (await getStorage()).downloadToFile(asset.sourceKey, sourcePath);

    const probeRun = await run(ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", sourcePath]);
    if (probeRun.code !== 0) throw new Error(`ffprobe failed: ${probeRun.stderr.slice(-300)}`);
    const probe = parseProbe(probeRun.stdout);

    if (probe.durationMs > MAX_VIDEO_DURATION_SEC * 1000) {
      throw new Error(`Video is longer than the ${MAX_VIDEO_DURATION_SEC}s limit`);
    }

    // Rungs by SHORT side — never upscale; always keep at least one (source
    // short side capped at 720).
    const shortSide = Math.min(probe.width, probe.height);
    const ladder = RUNGS.filter((r) => r.short <= shortSide);
    if (ladder.length === 0) ladder.push({ short: Math.min(shortSide, 720), maxrate: 2500 });

    const hlsDir = path.join(tmpDir, "hls");
    await fs.mkdir(hlsDir, { recursive: true });

    const rungMeta: Array<{ short: number; outWidth: number; outHeight: number; maxrate: number }> = [];
    for (const rung of ladder) {
      const rungDir = path.join(hlsDir, String(rung.short));
      await fs.mkdir(rungDir, { recursive: true });
      const enc = await run(ffmpeg, hlsArgs(sourcePath, rungDir, rung.short, probe, rung.maxrate));
      if (enc.code !== 0) throw new Error(`ffmpeg ${rung.short}p failed: ${enc.stderr.slice(-300)}`);
      const dims = rungOutputDims(probe, rung.short);
      rungMeta.push({ short: rung.short, outWidth: dims.outWidth, outHeight: dims.outHeight, maxrate: rung.maxrate });
      // flatten: rung outputs live directly under hls/ (master + variants + segments)
      for (const name of await fs.readdir(rungDir)) {
        await fs.rename(path.join(rungDir, name), path.join(hlsDir, name));
      }
      await fs.rm(rungDir, { recursive: true, force: true });
    }

    await fs.writeFile(path.join(hlsDir, "master.m3u8"), masterPlaylist(rungMeta, probe.hasAudio), "utf8");

    const mp4Path = path.join(tmpDir, "video.mp4");
    const mp4Run = await run(ffmpeg, mp4Args(sourcePath, mp4Path, probe));
    if (mp4Run.code !== 0) throw new Error(`ffmpeg mp4 failed: ${mp4Run.stderr.slice(-300)}`);

    const posterPath = path.join(tmpDir, "poster.jpg");
    const posterRun = await run(ffmpeg, posterArgs(sourcePath, posterPath, probe));
    if (posterRun.code !== 0) throw new Error(`ffmpeg poster failed: ${posterRun.stderr.slice(-300)}`);

    // Upload every output under media/<id>/…
    const hlsKey = `media/${asset.id}/hls`;
    for (const name of await fs.readdir(hlsDir)) {
      const ext = path.extname(name).toLowerCase();
      (await getStorage()).uploadFile(path.join(hlsDir, name), `${hlsKey}/${name}`, {
        contentType: OUTPUT_MIME[ext] ?? "application/octet-stream",
        cacheControl: name.endsWith(".m3u8") ? HLS_CACHE_CONTROL : OUTPUT_CACHE_CONTROL,
      });
    }
    (await getStorage()).uploadFile(mp4Path, `media/${asset.id}/video.mp4`, { contentType: "video/mp4", cacheControl: OUTPUT_CACHE_CONTROL });
    (await getStorage()).uploadFile(posterPath, `media/${asset.id}/poster.jpg`, { contentType: "image/jpeg", cacheControl: OUTPUT_CACHE_CONTROL });

    const updated = await setStatus(asset.id, "ready", {
      readyAt: new Date(),
      lockedAt: null,
      error: null,
      hlsKey: `${hlsKey}/master.m3u8`,
      mp4Key: `media/${asset.id}/video.mp4`,
      posterKey: `media/${asset.id}/poster.jpg`,
      durationMs: probe.durationMs,
      width: probe.width,
      height: probe.height,
    });

    // The transcoded outputs make the source redundant (unless debugging).
    if (process.env.KEEP_MEDIA_SOURCE !== "true") {
      (await getStorage()).deletePrefix(asset.sourceKey).catch(() => {});
    }

    return updated;
  } catch (e) {
    if (e instanceof Error && e.message === "FFMPEG_MISSING") {
      // Environment problem, not a media problem: put the asset back and undo
      // the claim's attempts bump so a real failure still gets 3 tries once
      // ffmpeg lands. The worker backs off meanwhile (see startTranscoder).
      ffmpegMissingUntil = Date.now() + FFMPEG_BACKOFF_MS;
      await setStatus(asset.id, "uploaded", {
        lockedAt: null,
        error: "Transcoder unavailable",
        attempts: Math.max(0, asset.attempts - 1),
      }).catch(() => {});
      // Still waiting — back in the set so the worker picks it up once
      // ffmpeg is available, without a database poll.
      await enqueueTranscode(asset.id);
      return null;
    }
    log.error("transcode_failed", { assetId: asset.id, error: e instanceof Error ? e : String(e) });
    await failAsset(asset, shortError(e)).catch(() => {});
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Delete long-abandoned assets: pending uploads far past their URL TTL and
 * rows older than 24h that no reel and no post content references (checked on
 * the CommunityReel.mediaId / CommunityPostContent.mediaId relations). Runs
 * periodically from the transcoder loop — independent of ffmpeg availability.
 * Returns the number of rows removed (exported for tests).
 */
export async function sweepAbandonedAssets(): Promise<number> {
  const cutoff = new Date(Date.now() - SWEEP_AGE_MS);
  const candidates = await db.mediaAsset.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, status: true },
  });

  let removed = 0;
  for (const asset of candidates) {
    if (asset.status !== "pending_upload") {
      // attached assets feed live content — never swept
      const [reel, content] = await Promise.all([
        db.communityReel.findFirst({ where: { mediaId: asset.id }, select: { id: true } }),
        db.communityPostContent.findFirst({ where: { mediaId: asset.id }, select: { id: true } }),
      ]);
      if (reel || content) continue;
    }
    (await getStorage()).deletePrefix(`media/${asset.id}/`).catch(() => {});
    await db.mediaAsset.delete({ where: { id: asset.id } }).catch(() => {});
    await invalidateMedia(asset.id);
    removed += 1;
  }
  if (removed > 0) log.info("abandoned_assets_swept", { removed });
  return removed;
}

/** Background loop — started from index.ts unless disabled (tests / opt-out). */
export function startTranscoder(): void {
  if (process.env.TRANSCODER_ENABLED === "false") return;
  if (process.env.NODE_ENV === "test") return;

  const pollMs = Math.max(500, Number(process.env.TRANSCODER_POLL_MS || 3000));
  // The queue is empty almost all the time. Polling it as often as a busy
  // queue just fills the query log, so an idle worker backs off and snaps
  // back to pollMs the moment it finds work.
  const idlePollMs = Math.max(pollMs, Number(process.env.TRANSCODER_IDLE_POLL_MS || 30_000));
  const concurrency = Math.max(1, Number(process.env.TRANSCODE_CONCURRENCY || 1));
  let active = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      tick().catch((e) => log.error("transcoder_tick_failed", { error: e instanceof Error ? e : String(e) }));
    }, delay);
    timer.unref();
  };

  const tick = async () => {
    // ffmpeg/ffprobe missing — stop claiming (and re-claiming the same row)
    // until the back-off window passes.
    if (Date.now() < ffmpegMissingUntil) {
      schedule(idlePollMs);
      return;
    }
    // The waiting ids live in a Redis set (transcode:waiting). An empty set
    // means nothing to do, so the idle tick never touches Postgres. Redis
    // being unreachable is "unknown" — fall back to the database then.
    if (active === 0) {
      const state = await transcodeQueueState();
      if (state === "empty") {
        schedule(idlePollMs);
        return;
      }
      if (state === "unknown" && !(await hasClaimable())) {
        schedule(idlePollMs);
        return;
      }
    }
    while (active < concurrency) {
      // Take an id the upload path pushed, then claim that exact row. No id
      // (Redis down) falls back to claiming whatever is waiting.
      const waitingId = await nextWaitingTranscode();
      const id = await claimNext(waitingId);
      if (!id) {
        if (waitingId) await dequeueTranscode(waitingId);
        break;
      }
      active += 1;
      void processMediaAsset(id)
        .catch(async (e) => {
          // processMediaAsset handles its own failures. This is the escape
          // hatch for one it didn't — without it the row stays processing
          // and the client never hears that it failed.
          log.error("transcode_crashed", { assetId: id, error: e instanceof Error ? e : String(e) });
          const asset = await db.mediaAsset.findUnique({ where: { id } }).catch(() => null);
          if (asset && asset.status === "processing") {
            await failAsset(asset, shortError(e)).catch(() => {});
          }
        })
        .finally(() => {
          active -= 1;
          // A job just freed a slot — look for the next one now instead of
          // waiting out the idle backoff.
          if (timer) clearTimeout(timer);
          schedule(0);
        });
    }
    schedule(pollMs);
  };

  // Seed the set from anything already waiting. It must not delay the
  // loop — the loop is what drains the set, and it falls back to the
  // database if Redis can't answer.
  void reconcileQueue().catch((e) => log.error("queue_reconcile_failed", { error: e instanceof Error ? e : String(e) }));
  schedule(pollMs);

  // Abandoned-asset sweeper — every ~10 min, independent of ffmpeg.
  const sweepMs = Math.max(60_000, Number(process.env.MEDIA_SWEEP_INTERVAL_MS || 10 * 60 * 1000));
  const sweep = () => sweepAbandonedAssets().catch((e) => log.error("sweep_failed", { error: e instanceof Error ? e : String(e) }));
  sweep();
  setInterval(sweep, sweepMs).unref();

  log.info("transcoder_started", { pollMs, concurrency });
}
