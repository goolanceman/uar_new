"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Info, Loader2, ScanLine, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, post } from "@/lib/api-client";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

interface ScanResult {
  code?: string;
  unit?: { code?: string; status?: string } | null;
  batch?: { name?: string; totalUnits?: number; scannedUnits?: number } | null;
}

interface KitUnit {
  id: string;
  code: string;
  location?: string | null;
  scannedAt?: string | null;
  batch?: { name?: string } | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

export default function VolunteerScan(_props: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<KitUnit[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const codeRef = useRef<HTMLInputElement>(null);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const data = await get<unknown>(
        "/api/kit-units?mine=1&scanned=1&limit=8"
      );
      setRecent(asArray<KitUnit>(data));
    } catch {
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const scan = async () => {
    const c = code.trim().toUpperCase();
    if (!c) {
      toast.error("Enter or scan a kit code first");
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await post<ScanResult>("/api/kit-scan", {
        code: c,
        location: location.trim() || undefined,
      });
      setResult(res);
      setCode("");
      toast.success("Kit handed over — batch inventory updated");
      await loadRecent();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Scan failed — check the code and try again"
      );
    } finally {
      setBusy(false);
    }
  };

  const kitCode =
    result?.unit?.code ??
    result?.code ??
    null;
  const batch = result?.batch ?? null;
  const scanned = batch?.scannedUnits ?? 0;
  const total = batch?.totalUnits ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Kit scanner
        </h1>
        <p className="text-sm text-muted-foreground">
          Scan the QR code on a ration kit at handover — inventory updates itself.
        </p>
      </div>

      {/* ---------- Scanner ---------- */}
      <style>{`@keyframes uar-scanline{0%,100%{transform:translateY(4px)}50%{transform:translateY(52px)}}.uar-scanline{animation:uar-scanline 2.2s ease-in-out infinite}@keyframes uar-grid{0%{background-position:0 0}100%{background-position:40px 40px}}.uar-grid-bg{background-image:linear-gradient(rgba(16,185,129,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(16,185,129,.08) 1px,transparent 1px);background-size:20px 20px;animation:uar-grid 6s linear infinite}`}</style>

      <div className="overflow-hidden rounded-2xl border bg-zinc-900 text-zinc-100 shadow-xl">
        <div className="uar-grid-bg relative border-b border-zinc-800 px-6 py-8 sm:px-10">
          {result === null && !busy && (
            <div
              className="uar-scanline pointer-events-none absolute left-6 right-6 top-6 h-px bg-emerald-400/70 shadow-[0_0_12px_2px_rgba(16,185,129,.5)] sm:left-10 sm:right-10"
              aria-hidden="true"
            />
          )}
          <div className="relative mx-auto max-w-md text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <ScanLine className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-3 font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">
              UAR · Ration Kit Terminal
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              Point, scan, hand over. One kit per scan.
            </p>

            {result ? (
              /* ---------- Success state ---------- */
              <div className="mt-6 rounded-xl border border-emerald-500/30 bg-zinc-950/60 p-5 text-left">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-lg font-bold tracking-tight text-emerald-300">
                      {kitCode}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-400">
                      {batch?.name ?? "Kit batch"} · handed over
                      {location.trim() ? ` at ${location.trim()}` : ""}
                    </p>
                    {batch && total > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span>Batch progress</span>
                          <span className="font-mono">
                            {scanned}/{total} scanned
                          </span>
                        </div>
                        <Progress
                          value={pct}
                          className="mt-1.5 h-2 bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-emerald-500"
                          aria-label={`${pct}% of batch scanned`}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  className="mt-4 min-h-11 w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => setResult(null)}
                >
                  <ScanLine className="size-4" aria-hidden="true" />
                  Scan another kit
                </Button>
              </div>
            ) : (
              /* ---------- Input state ---------- */
              <div className="mt-6 space-y-4 text-left">
                <div className="space-y-1.5">
                  <Label htmlFor="scan-code" className="text-zinc-300">
                    Kit code
                  </Label>
                  <Input
                    id="scan-code"
                    ref={codeRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && !busy && scan()}
                    placeholder="UAR-RK-2026-000001"
                    className="h-12 border-zinc-700 bg-zinc-950/80 font-mono text-base tracking-wider text-emerald-300 placeholder:text-zinc-600 focus-visible:ring-emerald-500"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scan-location" className="text-zinc-300">
                    Handover location
                  </Label>
                  <Input
                    id="scan-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !busy && scan()}
                    placeholder="e.g. Ejipura community drive"
                    className="h-12 border-zinc-700 bg-zinc-950/80 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500"
                  />
                </div>
                <Button
                  className="min-h-12 w-full gap-2 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-500"
                  onClick={scan}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                      Verifying kit…
                    </>
                  ) : (
                    <>
                      <ScanLine className="size-5" aria-hidden="true" />
                      Scan &amp; hand over
                    </>
                  )}
                </Button>
                <p className="flex items-start gap-2 text-xs text-zinc-500">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  Scanning auto-decrements batch inventory — count only kits that
                  physically left with a family.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- Recent scans ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="size-4 text-primary" aria-hidden="true" />
            Recent scans by me
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRecent ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <XCircle className="size-4 text-muted-foreground" aria-hidden="true" />
              No scans yet — your handover history will appear here.
            </div>
          ) : (
            <ul className="divide-y">
              {recent.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <p className="font-mono text-sm font-semibold">{u.code}</p>
                  <span className="truncate text-xs text-muted-foreground">
                    {u.location ?? "—"}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {timeAgo(u.scannedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
