/**
 * S3 storage driver — presigned direct PUT uploads against AWS S3 (or any
 * S3-compatible endpoint: RustFS, Cloudflare R2). Required envs fail fast on
 * first use (lazily, memoized) so a half-configured driver never serves
 * requests — while driver=local never even constructs the client.
 */
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { validateStorageKey, type HeadInfo, type PresignedUpload, type StorageDriver } from "./index";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`STORAGE_DRIVER=s3 requires the ${name} environment variable to be set.`);
  }
  return v.trim();
}

// Lazily-built (memoized) client — the env check runs when the s3 driver is
// first used, never at import time (keeps `import { storage }` safe for tests).
let clientCache: S3Client | null = null;
function client(): S3Client {
  if (clientCache) return clientCache;
  const endpoint = process.env.S3_ENDPOINT || undefined;
  clientCache = new S3Client({
    region: requiredEnv("S3_REGION"),
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: /^(1|true|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE || "") || Boolean(endpoint),
    ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  return clientCache;
}


// Client used only to sign URLs the phone will call. Same credentials as the
// store client, but aimed at S3_PUBLIC_ENDPOINT — the LAN address — so the
// signed host is one the device can route to. Falls back to the store client
// when no public endpoint is configured.
let signingCache: S3Client | null = null;
function signingClient(): S3Client {
  const pub = process.env.S3_PUBLIC_ENDPOINT;
  if (!pub) return client();
  if (signingCache) return signingCache;
  signingCache = new S3Client({
    region: requiredEnv("S3_REGION"),
    endpoint: pub,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    },
  });
  return signingCache;
}
function bucket(): string {
  return requiredEnv("S3_BUCKET");
}

function publicBase(): string {
  if (process.env.S3_PUBLIC_BASE_URL) return process.env.S3_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const endpoint = process.env.S3_ENDPOINT;
  const region = requiredEnv("S3_REGION");
  if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${bucket()}`;
  return `https://${bucket()}.s3.${region}.amazonaws.com`;
}

export const s3Storage: StorageDriver = {
  async presignPut(key, opts): Promise<PresignedUpload> {
    validateStorageKey(key);
    const cmd = new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    const url = await getSignedUrl(signingClient(), cmd, { expiresIn: opts.expiresInSec });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": opts.contentType },
      expiresAt: new Date(Date.now() + opts.expiresInSec * 1000).toISOString(),
    };
  },

  async headObject(key): Promise<HeadInfo | null> {
    try {
      const out = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: validateStorageKey(key) }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch {
      return null;
    }
  },

  async downloadToFile(key, localPath): Promise<void> {
    const out = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: validateStorageKey(key) }));
    if (!out.Body) throw new Error(`S3 object ${key} has no body`);
    await pipeline(out.Body as Readable, createWriteStream(localPath));
  },

  async uploadFile(localPath, key, opts): Promise<void> {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: validateStorageKey(key),
        Body: createReadStream(localPath),
        ContentType: opts.contentType,
        ...(opts.cacheControl ? { CacheControl: opts.cacheControl } : {}),
      })
    );
  },

  async deletePrefix(prefix): Promise<void> {
    validateStorageKey(prefix);
    let token: string | undefined;
    do {
      const page = await client().send(
        new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token })
      );
      const objects = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length) {
        await client().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: objects } }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  },

  publicUrl(key): string {
    validateStorageKey(key);
    return `${publicBase()}/${key}`;
  },

  // Presigned GET. The bucket stays private; S3 honours HTTP Range, so the
  // player can still seek. Signed against S3_PUBLIC_ENDPOINT when set, so the
  // URL carries the host the client can reach (the LAN address) rather than
  // the Docker-internal one the API uses.
  async presignGet(key, expiresInSec): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: bucket(), Key: validateStorageKey(key) });
    return getSignedUrl(signingClient(), cmd, { expiresIn: expiresInSec });
  },
};
