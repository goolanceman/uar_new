/**
 * HMAC signing for the local-driver presigned upload tokens — the token IS the
 * auth for PUT /api/media/upload/:token (no session required). Same fallback
 * approach as session.ts: MEDIA_SIGNING_SECRET when set, else SESSION_SECRET,
 * never a hardcoded default (a guessable key would let anyone forge uploads).
 */
import crypto from "crypto";

export interface UploadTokenClaims {
  key: string;
  contentType: string;
  contentLength: number;
  /** Expiry in milliseconds since epoch. */
  exp: number;
  mediaId: string;
}

function signingSecret(): string {
  const secret = process.env.MEDIA_SIGNING_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      "MEDIA_SIGNING_SECRET (or SESSION_SECRET) environment variable must be set to a random value of at least 16 characters."
    );
  }
  return secret;
}

function signInput(input: string): string {
  return crypto.createHmac("sha256", signingSecret()).update(input).digest("base64url");
}

/** `<base64url(claims JSON)>.<HMAC-SHA256 signature>` — safe in a path segment. */
export function signUploadToken(claims: UploadTokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signInput(payload)}`;
}

/** Verified parse — signature (constant-time compare) + expiry enforced. */
export function verifyUploadToken(raw: string | undefined | null): UploadTokenClaims | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  const expected = signInput(payload);
  let sigBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "base64url");
    expectedBuf = Buffer.from(expected, "base64url");
  } catch {
    return null;
  }
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as UploadTokenClaims;
    if (!claims || typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
    if (!claims.key || typeof claims.contentLength !== "number" || !claims.mediaId) return null;
    return claims;
  } catch {
    return null;
  }
}
