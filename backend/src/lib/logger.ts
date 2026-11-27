/**
 * Structured application logger — the single logger instance for the whole
 * backend (import it everywhere; never use console.* directly).
 *
 * Design (wide-event / canonical-log-line friendly):
 *   • One JSON object per line on stdout → visible in `docker logs uar-api`.
 *   • Same lines appended to a logfile (LOG_FILE, default logs/backend.log)
 *     with simple size-based rotation (backend.log.1, keep 3 rotations).
 *   • Levels: debug < info < warn < error, gated by LOG_LEVEL (default info).
 *   • child(module, ctx) binds a module name + context fields to every line.
 *   • Secret redaction: keys matching password|secret|token|otp|apikey|… are
 *     masked before serialization (deep).
 *
 * Zero dependencies — Node stdlib only, so the Docker build is unchanged.
 */
import fs from "fs";
import path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LEVEL = (() => {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LEVELS[raw] !== undefined ? LEVELS[raw] : LEVELS.info;
})();

/** Where the logfile lives. Empty string disables the file sink entirely. */
const LOG_FILE = process.env.LOG_FILE !== undefined
  ? process.env.LOG_FILE // explicit (may be "" to disable)
  : path.join("logs", "backend.log");

const MAX_FILE_BYTES = 10 * 1024 * 1024; // rotate at 10 MB
const ROTATIONS_TO_KEEP = 3;

/** Keys whose values must never reach a log line (matched case-insensitively). */
const SENSITIVE_KEY = /(pass(word)?|secret|token|otp|api[-_]?key|authorization|cookie|credential)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ─── File sink (best-effort; logging must never break the API) ───────────────
let fileStream: fs.WriteStream | null = null;

function rotateIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).size < MAX_FILE_BYTES) return;
    fileStream?.end();
    fileStream = null;
    for (let i = ROTATIONS_TO_KEEP; i >= 1; i--) {
      const from = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const to = `${filePath}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
  } catch {
    // rotation is best-effort
  }
}

function openFileStream(filePath: string): fs.WriteStream | null {
  try {
    if (!LOG_FILE) return null;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    rotateIfNeeded(filePath);
    return fs.createWriteStream(filePath, { flags: "a" });
  } catch {
    return null; // read-only fs etc. — stdout still works
  }
}

const stream = openFileStream(LOG_FILE);

function writeLine(line: string): void {
  // stdout → `docker logs` / process managers; single write keeps lines atomic.
  process.stdout.write(line + "\n");
  if (stream) stream.write(line + "\n");
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ msg: "unserializable log entry" });
  }
}

function log(level: LogLevel, module: string, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVEL) return;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ...(ctx ? (redact(ctx) as Record<string, unknown>) : {}),
  };
  writeLine(serialize(entry));
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  /** Bind a module name (and optional extra fields) to every line. */
  child(module: string, ctx?: Record<string, unknown>): Logger;
}

function makeLogger(module: string, bound: Record<string, unknown> = {}): Logger {
  return {
    debug: (msg, ctx) => log("debug", module, msg, { ...bound, ...ctx }),
    info: (msg, ctx) => log("info", module, msg, { ...bound, ...ctx }),
    warn: (msg, ctx) => log("warn", module, msg, { ...bound, ...ctx }),
    error: (msg, ctx) => log("error", module, msg, { ...bound, ...ctx }),
    child: (m, ctx) => makeLogger(`${module}:${m}`, { ...bound, ...ctx }),
  };
}

export const logger = makeLogger("app");

/** Non-JSON fallback for stdio-based tools that need plain text (kept rare). */
export const logFilePath = LOG_FILE || null;
