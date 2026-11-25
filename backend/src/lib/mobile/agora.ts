/**
 * Legacy Agora RTC dynamic key builder — byte-compatible port of the PHP
 * `App\Classes\AgoraDynamicKey` AccessToken (version "006") used by
 * SettingsController::generateAgoraToken, so tokens minted here validate on
 * the same app the Flutter app joins with the Agora SDK.
 *
 * Env: AGORA_APP_ID, AGORA_APP_CERT (unset → route reports a clear failure
 * exactly like the PHP did when the env was missing).
 */
import crypto from "crypto";

const PRIVILEGES = {
  kJoinChannel: 1,
  kPublishAudioStream: 2,
  kPublishVideoStream: 3,
  kPublishDataStream: 4,
} as const;

interface PrivilegeEntry {
  key: number;
  value: number;
}

interface AccessTokenMessage {
  salt: number;
  ts: number;
  privileges: PrivilegeEntry[];
}

function packUint32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
}

function packUint16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff);
  return b;
}

function crc32(buf: Buffer): number {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function packMessage(msg: AccessTokenMessage): Buffer {
  const parts: Buffer[] = [packUint32(msg.salt), packUint32(msg.ts), packUint16(msg.privileges.length)];
  for (const p of msg.privileges) {
    parts.push(packUint16(p.key), packUint32(p.value));
  }
  return Buffer.concat(parts);
}

/** Build a "006" RTC token (publisher role: join + publish audio/video/data). */
export function buildRtcToken(
  appId: string,
  appCertificate: string,
  channelName: string,
  uid: number | string,
  expireTs: number,
  role: "publisher" | "subscriber" = "publisher"
): string {
  const msg: AccessTokenMessage = {
    salt: cryptoRandom(),
    ts: Math.floor(Date.now() / 1000) + 24 * 3600,
    privileges: [{ key: PRIVILEGES.kJoinChannel, value: expireTs }],
  };
  if (role === "publisher") {
    msg.privileges.push(
      { key: PRIVILEGES.kPublishAudioStream, value: expireTs },
      { key: PRIVILEGES.kPublishVideoStream, value: expireTs },
      { key: PRIVILEGES.kPublishDataStream, value: expireTs }
    );
  }

  const msgBuf = packMessage(msg);
  const uidStr = String(uid);

  // signature = HMAC-SHA256(appIdBytes | channelNameBytes | uidBytes | msg, cert)
  const toSign = Buffer.concat([
    Buffer.from(appId, "utf8"),
    Buffer.from(channelName, "utf8"),
    Buffer.from(uidStr, "utf8"),
    msgBuf,
  ]);
  const sig = crypto.createHmac("sha256", appCertificate).update(toSign).digest();

  const sigPacked = Buffer.concat([packUint16(sig.length), sig]);
  const content = Buffer.concat([
    sigPacked,
    packUint32(crc32(Buffer.from(channelName, "utf8"))),
    packUint32(crc32(Buffer.from(uidStr, "utf8"))),
    packUint16(msgBuf.length),
    msgBuf,
  ]);

  return "006" + appId + content.toString("base64");
}

function cryptoRandom(): number {
  // rand(0, 100000) in PHP
  return crypto.randomInt(0, 100001);
}
