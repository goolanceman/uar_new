"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Per-row busy mutex for list views — one shared implementation of the
 * "at most one row is busy" pattern.
 *
 * - `busyId` is the id of the row currently running an action (or null).
 * - `runFor(id, fn)` sets the flag, awaits `fn`, and ALWAYS clears it
 *   (finally) — the invariant every view previously re-implemented by hand.
 * - `setBusyId` is exposed for modal-driven flows where the action outlives
 *   the click handler; always clear it when the flow ends.
 */
export function useRowBusy() {
  const [busyId, setBusyIdState] = useState<string | null>(null);
  const lock = useRef<string | null>(null);

  const setBusyId = useCallback((id: string | null) => {
    if (id === null) {
      lock.current = null;
      setBusyIdState(null);
      return;
    }
    // A row cannot replace another in-flight row. Callers also disable all
    // row mutations while busy; this ref keeps that lock synchronous.
    if (lock.current !== null && lock.current !== id) return;
    lock.current = id;
    setBusyIdState(id);
  }, []);

  const runFor = useCallback(async (id: string, fn: () => Promise<void>) => {
    if (lock.current !== null) return;
    lock.current = id;
    setBusyIdState(id);
    try {
      await fn();
    } finally {
      if (lock.current === id) {
        lock.current = null;
        setBusyIdState(null);
      }
    }
  }, []);

  return { busyId, setBusyId, runFor } as const;
}
