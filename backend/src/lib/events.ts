/**
 * Server-Sent Events hub — pushes live platform events (e.g. new donations)
 * to every connected client. One-way, in-process, zero extra infra: the API
 * is a single Node process, so an in-memory listener set IS the broadcast.
 *
 * Transport notes:
 *  - `text/event-stream` with `Cache-Control: no-cache, no-transform` and
 *    `X-Accel-Buffering: no` so reverse proxies (Caddy/Next rewrites) never
 *    buffer the stream.
 *  - A 25s comment heartbeat (`: ping`) keeps connections alive through
 *    proxies/load balancers with idle timeouts.
 *  - EventSource on the client auto-reconnects when the stream drops.
 */
import type { Response } from "express";

type Listener = (chunk: string) => void;

const listeners = new Set<Listener>();

/** Wire an Express response up as an SSE stream and keep it until close. */
export function subscribeEvents(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Flush headers immediately so the client's EventSource opens.
  res.flushHeaders();
  res.write(`: connected\n\n`);

  const listener: Listener = (chunk) => {
    try {
      res.write(chunk);
    } catch {
      listeners.delete(listener);
    }
  };
  listeners.add(listener);

  // Heartbeat keeps idle connections open through proxies.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* close handler cleans up */
    }
  }, 25_000);

  res.on("close", () => {
    clearInterval(heartbeat);
    listeners.delete(listener);
  });
}

/** Push an event to every connected client (fire-and-forget, never throws). */
export function broadcastEvent(eventName: string, data: unknown): void {
  if (listeners.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const listener of [...listeners]) {
    try {
      listener(payload);
    } catch {
      listeners.delete(listener);
    }
  }
}
