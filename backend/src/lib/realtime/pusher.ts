/**
 * Minimal Pusher-protocol WebSocket server — wire-compatible with Laravel
 * Reverb, which the Flutter app talks to (websocket_service.dart):
 *
 *   ws://localhost:6001/app/<key>?protocol=7&client=js&version=8.4.0
 *
 * Supported client frames: pusher:ping → pusher:pong, pusher:subscribe
 * (private-* channels validate the HMAC auth from /broadcasting/auth),
 * pusher:unsubscribe. Server frames: pusher:connection_established and
 * channel events  {"event":"<name>","channel":"<ch>","data":"<json string>"}.
 *
 * Single-process pub/sub (matching the deployment topology); chat routes call
 * broadcastToChannel() directly after persisting a message.
 */
import crypto from "crypto";
import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "@/lib/logger";

const log = logger.child("pusher");

const APP_KEY = process.env.PUSHER_APP_KEY || "chatter-key";
const APP_SECRET = process.env.PUSHER_APP_SECRET || "chatter-secret";
const PORT = Number(process.env.PUSHER_WS_PORT || 6001);

interface ClientState {
  socketId: string;
  channels: Set<string>;
}

const clients = new Map<WebSocket, ClientState>();

function sign(socketId: string, channel: string): string {
  return crypto.createHmac("sha256", APP_SECRET).update(`${socketId}:${channel}`).digest("hex");
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

export function startPusherServer(httpServer?: HttpServer) {
  const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

  wss.on("connection", (ws) => {
    const socketId = `${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
    clients.set(ws, { socketId, channels: new Set() });

    // Connection established — the app reads data.socket_id
    send(ws, {
      event: "pusher:connection_established",
      data: JSON.stringify({
        socket_id: socketId,
        activity_timeout: 120,
        max_inactivity: 240,
      }),
    });

    ws.on("message", (raw) => {
      let msg: { event?: string; data?: { channel?: string; auth?: string } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.event === "pusher:ping") {
        return send(ws, { event: "pusher:pong", data: "{}" });
      }

      if (msg.event === "pusher:subscribe") {
        const channel = msg.data?.channel ?? "";
        const auth = msg.data?.auth ?? "";
        if (channel.startsWith("private-")) {
          const expected = `${APP_KEY}:${sign(socketId, channel)}`;
          if (auth !== expected) {
            return send(ws, {
              event: "pusher:subscription_error",
              channel,
              data: JSON.stringify({ type: "AuthError", error: "Invalid auth signature" }),
            });
          }
        }
        clients.get(ws)?.channels.add(channel);
        return send(ws, { event: "pusher_internal:subscription_succeeded", channel, data: "{}" });
      }

      if (msg.event === "pusher:unsubscribe") {
        clients.get(ws)?.channels.delete(msg.data?.channel ?? "");
        return;
      }
    });

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  wss.on("error", (e) => log.error("server_error", { error: e instanceof Error ? e : String(e) }));
  log.info("ws_server_listening", { port: PORT, app_key: APP_KEY });
  return wss;
}

/** Publish an event to every subscriber of a channel (Pusher frame shape). */
export function broadcastToChannel(channel: string, event: string, data: unknown) {
  const frame = JSON.stringify({
    event,
    channel,
    // Pusher protocol carries `data` as a JSON-encoded string; the app's
    // _decodeData accepts both string and object forms.
    data: typeof data === "string" ? data : JSON.stringify(data),
  });
  for (const [ws, state] of clients) {
    if (state.channels.has(channel) && ws.readyState === WebSocket.OPEN) {
      ws.send(frame);
    }
  }
}

/** Compute the channel auth string for /broadcasting/auth. */
export function channelAuth(socketId: string, channel: string): string {
  return `${APP_KEY}:${sign(socketId, channel)}`;
}
