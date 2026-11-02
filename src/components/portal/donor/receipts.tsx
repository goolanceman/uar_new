"use client";

import { useCallback, useEffect, useState } from "react";
import { Printer, ReceiptText, ShieldCheck } from "lucide-react";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { formatINR, formatDate, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface Donation {
  id: string;
  receiptNumber: string;
  donorName: string;
  amount: number;
  currency: string;
  type: string;
  category: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  campaign?: { title: string } | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

export default function DonorReceipts({ user }: { user: SessionUser }) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [pan, setPan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState<Donation | null>(null);

  useEffect(() => {
    const clear = () => setPrinting(null);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, me] = await Promise.all([
        get<unknown>("/api/donations?mine=1&status=COMPLETED"),
        get<unknown>("/api/auth/me").catch(() => null),
      ]);
      setDonations(asArray<Donation>(d));
      const u =
        me && typeof me === "object" && "user" in (me as Record<string, unknown>)
          ? (me as { user?: { pan?: string | null } | null }).user
          : null;
      setPan(u?.pan ?? null);
    } catch {
      setDonations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const printReceipt = (d: Donation) => {
    setPrinting(d);
    setTimeout(() => window.print(), 150);
  };

  const total = donations.reduce((s, d) => s + (d.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          80G receipts
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : `${donations.length} eligible receipt${donations.length === 1 ? "" : "s"} · ${formatINR(total)} donated`}
          {pan ? ` · PAN ${pan}` : ""}
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : donations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <ReceiptText className="size-8 text-primary/60" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No completed donations yet — receipts appear here once payments
              succeed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {donations.map((d) => (
            <Card key={d.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-lg font-bold tracking-tight">
                    {d.receiptNumber}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(d.createdAt)} ·{" "}
                    {d.campaign?.title ?? "General fund"} ·{" "}
                    {titleCase(d.paymentMethod)}
                  </p>
                  {pan && (
                    <p className="text-xs text-muted-foreground">PAN: {pan}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-lg font-bold text-primary">
                    {formatINR(d.amount)}
                  </p>
                  <Badge
                    variant="outline"
                    className="gap-1 rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                  >
                    <ShieldCheck className="size-3" aria-hidden="true" />
                    80G eligible
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 gap-1.5 sm:min-h-9"
                    onClick={() => printReceipt(d)}
                    aria-label={`Print receipt ${d.receiptNumber}`}
                  >
                    <Printer className="size-4" aria-hidden="true" />
                    Print
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ---------- Print-friendly receipt (only visible in print) ---------- */}
      {printing && (
        <>
          <style>{`@media print{body *{visibility:hidden!important}.uar-print-receipt,.uar-print-receipt *{visibility:visible!important}.uar-print-receipt{position:fixed!important;inset:0!important;margin:0!important;padding:48px!important;background:#fff!important;color:#000!important;z-index:9999!important}}`}</style>
          <div
            className="uar-print-receipt hidden flex-col gap-6 rounded-xl border p-8 text-black print:flex"
            aria-hidden="true"
          >
            <div className="text-center">
              <h2 className="text-2xl font-bold tracking-tight">
                United Angel Reach Trust
              </h2>
              <p className="text-sm">Bengaluru, Karnataka</p>
              <p className="mt-1 text-xs">
                80G Registration No: <strong>UAR/80G/2024/0147</strong> · Donations
                are exempt under Section 80G of the Income Tax Act
              </p>
            </div>
            <Separator />
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Receipt No.</span>
                <span className="font-mono font-bold">{printing.receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span>{formatDate(printing.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Received with thanks from</span>
                <span className="font-semibold">{printing.donorName}</span>
              </div>
              {pan && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PAN</span>
                  <span>{pan}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Towards</span>
                <span>{printing.campaign?.title ?? "General fund"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment mode</span>
                <span>{titleCase(printing.paymentMethod)}</span>
              </div>
              <div className="flex justify-between text-base">
                <span className="font-semibold">Amount</span>
                <span className="font-bold">{formatINR(printing.amount)}</span>
              </div>
            </div>
            <Separator />
            <div className="flex items-end justify-between pt-10">
              <p className="text-xs">
                This is a computer-generated receipt for the purposes of Section
                80G. For queries: reach@unitedangelreach.org
              </p>
              <div className="text-center">
                <p className="border-t border-black px-8 pt-1 text-xs">
                  For United Angel Reach Trust
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
