"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, X } from "lucide-react";
import { get } from "@/lib/api-client";
import { formatMoney } from "@/lib/settings-core";

/**
 * Live donation broadcasts — bottom-left toast cards pushed over SSE
 * (GET /api/events/stream) whenever anyone, anywhere on the site, donates.
 *
 * Behaviour:
 *  - Gated by the `features.liveDonationFeed` flag (Settings → Feature flags).
 *    The flag is polled from the public settings payload every 60s so turning
 *    it on/off reaches connected visitors without a reload.
 *  - EventSource auto-reconnects on transient drops; the flag poll re-opens
 *    the stream when the admin enables the feature mid-session.
 *  - Cards auto-dismiss after ~6.5s (with a depleting time bar), stack to a
 *    max of 3, and respect anonymous donations (backend masks the name).
 */

interface DonationEvent {
  donorName: string;
  amount: number;
  currency: string;
  campaignTitle: string | null;
  receiptNumber: string;
  at: string;
}

interface LiveToast extends DonationEvent {
  id: string;
}

const AUTO_DISMISS_MS = 6500;
const MAX_VISIBLE = 3;
const FLAG_POLL_MS = 60_000;

export function DonationBroadcasts() {
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = React.useCallback(
    (event: DonationEvent) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { ...event, id }]);
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  // Clear pending auto-dismiss timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const openStream = React.useCallback(() => {
    if (esRef.current) return; // already open
    const es = new EventSource("/api/events/stream");
    es.addEventListener("donation", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as DonationEvent;
        push(data);
      } catch {
        /* malformed frame — ignore */
      }
    });
    es.onerror = () => {
      // 503 (flag off) or proxy drop — EventSource retries on its own while
      // connecting; once fully CLOSED we mark disconnected and the flag poll
      // will re-open it when appropriate.
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null;
        setConnected(false);
      }
    };
    es.onopen = () => setConnected(true);
    esRef.current = es;
  }, [push]);

  const closeStream = React.useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setConnected(false);
  }, []);

  // Flag polling — single source of truth for whether the stream is open.
  useEffect(() => {
    let alive = true;
    const syncFlag = async () => {
      try {
        const data = await get<{ features?: Record<string, boolean> }>("/api/settings/public");
        const on = Boolean(data?.features?.liveDonationFeed);
        if (!alive) return;
        if (on) openStream();
        else closeStream();
      } catch {
        // backend unreachable — drop the stream; the next poll retries
        if (alive) closeStream();
      }
    };
    void syncFlag();
    const interval = setInterval(syncFlag, FLAG_POLL_MS);
    return () => {
      alive = false;
      clearInterval(interval);
      closeStream();
    };
  }, [openStream, closeStream]);

  return (
    <div
      aria-live="polite"
      aria-label="Live donation announcements"
      className="pointer-events-none fixed bottom-4 left-4 z-[70] flex w-[min(320px,calc(100vw-2rem))] flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: -48, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -48, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="pointer-events-auto relative overflow-hidden rounded-xl border bg-card/95 p-3.5 pr-9 shadow-lg shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-card/80"
            role="status"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                <Heart className="size-5 fill-current" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-foreground">
                  <span className="font-semibold">{t.donorName}</span>{" "}
                  <span className="text-muted-foreground">donated</span>{" "}
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {formatMoney(t.amount, t.currency)}
                  </span>
                </p>
                {t.campaignTitle ? (
                  <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                    {t.campaignTitle}
                  </p>
                ) : (
                  <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                    General fund
                  </p>
                )}
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  {timeAgo(t.at)} · live
                  <span
                    className="ml-1.5 inline-block size-1.5 rounded-full align-middle"
                    style={{ backgroundColor: connected ? "#10b981" : "#a3a3a3" }}
                    aria-hidden
                  />
                </p>
              </div>
            </div>

            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>

            {/* depleting time bar — how long until auto-dismiss */}
            <motion.span
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: AUTO_DISMISS_MS / 1000, ease: "linear" }}
              className="absolute bottom-0 left-0 h-0.5 bg-emerald-500/50"
              aria-hidden
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
