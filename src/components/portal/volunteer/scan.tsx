"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  QrCode,
  ScanLine,
  SearchX,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

interface ScanSuccess {
  kind: "success";
  code: string;
  batchName: string;
  scannedUnits: number;
  totalUnits: number;
  scannedByName?: string | null;
  scannedAt?: string | null;
  location?: string | null;
}

interface ScanFailure {
  kind: "warning" | "error";
  message: string;
}

type ScanOutcome = ScanSuccess | ScanFailure | null;

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

export default function VolunteerScan({
  volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome>(null);
  const [recent, setRecent] = useState<KitUnit[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const codeRef = useRef<HTMLInputElement>(null);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const data = await get<unknown>("/api/kit-units?mine=1&limit=200");
      const units = asArray<KitUnit>(data)
        .filter((u) => u.scannedAt)
        .sort(
          (a, b) =>
            new Date(b.scannedAt ?? 0).getTime() - new Date(a.scannedAt ?? 0).getTime()
        )
        .slice(0, 8);
      setRecent(units);
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
    setOutcome(null);
    try {
      const res = await post<{
        unit?: { code?: string; scannedByName?: string | null; scannedAt?: string | null; location?: string | null };
        batch?: { name?: string; totalUnits?: number; scannedUnits?: number } | null;
      }>("/api/kit-scan", {
        code: c,
        location: location.trim() || undefined,
      });
      setOutcome({
        kind: "success",
        code: res.unit?.code ?? c,
        batchName: res.batch?.name ?? "Kit batch",
        scannedUnits: res.batch?.scannedUnits ?? 0,
        totalUnits: res.batch?.totalUnits ?? 0,
        scannedByName: res.unit?.scannedByName ?? null,
        scannedAt: res.unit?.scannedAt ?? new Date().toISOString(),
        location: res.unit?.location ?? (location.trim() || null),
      });
      setCode("");
      toast.success("Kit deducted from batch — handed over!");
      await loadRecent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed — check the code and try again";
      const lower = msg.toLowerCase();
      if (lower.includes("already scanned")) {
        setOutcome({ kind: "warning", message: `This kit was ${msg}` });
      } else if (lower.includes("not found")) {
        setOutcome({ kind: "error", message: "Kit code not found — re-check the digits on the QR label." });
      } else if (lower.includes("expired")) {
        setOutcome({ kind: "warning", message: "This kit unit has expired — quarantine it and inform the coordinator." });
      } else {
        setOutcome({ kind: "error", message: msg });
      }
    } finally {
      setBusy(false);
      codeRef.current?.focus();
    }
  };

  const remaining =
    outcome?.kind === "success"
      ? Math.max(0, outcome.totalUnits - outcome.scannedUnits)
      : 0;
  const pct =
    outcome?.kind === "success" && outcome.totalUnits > 0
      ? Math.min(100, Math.round((outcome.scannedUnits / outcome.totalUnits) * 100))
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kit scanner"
        description="Scan the QR code on a ration kit at handover — batch inventory deducts itself."
        icon={<ScanLine className="size-5" />}
      />

      {/* ---------- Terminal ---------- */}
      <style>{`@keyframes uar-scanline{0%,100%{transform:translateY(4px)}50%{transform:translateY(52px)}}.uar-scanline{animation:uar-scanline 2.2s ease-in-out infinite}@keyframes uar-grid{0%{background-position:0 0}100%{background-position:40px 40px}}.uar-grid-bg{background-image:linear-gradient(rgba(16,185,129,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(16,185,129,.08) 1px,transparent 1px);background-size:20px 20px;animation:uar-grid 6s linear infinite}`}</style>

      <div className="overflow-hidden rounded-2xl border bg-zinc-900 text-zinc-100 shadow-xl">
        <div className="uar-grid-bg relative border-b border-zinc-800 px-6 py-8 sm:px-10">
          {outcome === null && !busy && (
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

            {outcome?.kind === "success" ? (
              /* ---------- Success ---------- */
              <div className="mt-6 rounded-xl border border-emerald-500/30 bg-zinc-950/60 p-5 text-left">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-lg font-bold tracking-tight text-emerald-300">
                      {outcome.code}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-400">
                      {outcome.batchName} · handed over
                      {outcome.location ? ` at ${outcome.location}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Scanned by {outcome.scannedByName ?? "you"} ·{" "}
                      {formatDateTime(outcome.scannedAt)}
                    </p>
                    {outcome.totalUnits > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span>Batch progress</span>
                          <span className="font-mono">
                            {outcome.scannedUnits}/{outcome.totalUnits} ·{" "}
                            <span className="text-emerald-400">{remaining} left</span>
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
                  onClick={() => {
                    setOutcome(null);
                    codeRef.current?.focus();
                  }}
                >
                  <ScanLine className="size-4" aria-hidden="true" />
                  Scan next kit
                </Button>
              </div>
            ) : outcome ? (
              /* ---------- Warning / error ---------- */
              <div
                className={cn(
                  "mt-6 rounded-xl border p-5 text-left",
                  outcome.kind === "warning"
                    ? "border-amber-500/40 bg-amber-500/10"
                    : "border-red-500/40 bg-red-500/10"
                )}
                role="alert"
              >
                <div className="flex items-start gap-3">
                  {outcome.kind === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-6 shrink-0 text-amber-400" aria-hidden="true" />
                  ) : (
                    <SearchX className="mt-0.5 size-6 shrink-0 text-red-400" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        outcome.kind === "warning" ? "text-amber-300" : "text-red-300"
                      )}
                    >
                      {outcome.kind === "warning" ? "Already scanned" : "Scan failed"}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-300">{outcome.message}</p>
                  </div>
                </div>
                <Button
                  className="mt-4 min-h-11 w-full gap-1.5 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                  onClick={() => {
                    setOutcome(null);
                    setCode("");
                    codeRef.current?.focus();
                  }}
                >
                  <ScanLine className="size-4" aria-hidden="true" />
                  Scan next kit
                </Button>
              </div>
            ) : (
              /* ---------- Input ---------- */
              <div className="mt-6 space-y-4 text-left">
                <div className="space-y-1.5">
                  <Label htmlFor="scan-code" className="text-zinc-300">
                    Kit code
                  </Label>
                  <Input
                    id="scan-code"
                    ref={codeRef}
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text").trim().toUpperCase();
                      if (text) {
                        e.preventDefault();
                        setCode(text);
                      }
                    }}
                    onKeyDown={(e) => e.key === "Enter" && !busy && scan()}
                    placeholder="UAR-RK-2026-000001"
                    className="h-14 border-zinc-700 bg-zinc-950/80 font-mono text-lg tracking-wider text-emerald-300 placeholder:text-zinc-600 focus-visible:ring-emerald-500"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-describedby="scan-hint"
                  />
                  <p id="scan-hint" className="text-xs text-zinc-500">
                    Paste-friendly · auto-uppercase · Enter to submit
                  </p>
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
                    placeholder={
                      volunteer?.assignedArea
                        ? `e.g. ${volunteer.assignedArea} community drive`
                        : "e.g. Ejipura community drive"
                    }
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
                      Scan &amp; deduct
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
      <SectionCard
        title="Recent scans by me"
        description="Your last handovers, newest first"
        icon={<ScanLine className="size-5" />}
      >
        {loadingRecent ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<XCircle className="size-5" />}
            title="No scans yet"
            hint="Your handover history will appear here after your first scan."
          />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {recent.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
              >
                <p className="font-mono text-sm font-semibold">{u.code}</p>
                <span className="truncate text-xs text-muted-foreground">
                  {u.batch?.name ? `${u.batch.name} · ` : ""}
                  {u.location ?? "—"}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {timeAgo(u.scannedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ---------- Explainer ---------- */}
      <SectionCard
        title="Where do the QR labels come from?"
        description="A quick word on the kit pipeline"
        icon={<QrCode className="size-5" />}
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Admins assemble ration kits from a <strong>kit template</strong> (the item
          list and cost per kit) into a <strong>batch</strong> — say &quot;Diwali
          Drive · 120 kits&quot;. Each kit in the batch gets a unique code
          (<span className="font-mono text-xs">UAR-RK-YYYY-NNNNNN</span>) and a
          printed QR label sheet, generated straight from the batch view in the
          admin console. The label goes on the kit; when you scan it here, the kit
          is counted as delivered and the batch&apos;s remaining count drops by one —
          which keeps the public impact numbers honest, in real time.
        </p>
      </SectionCard>
    </div>
  );
}
