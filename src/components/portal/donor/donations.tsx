"use client";

import { useCallback, useEffect, useState } from "react";
import { HandCoins, RefreshCw } from "lucide-react";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { cn, formatINR, formatDate, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Donation {
  id: string;
  receiptNumber: string;
  amount: number;
  type: string; // ONE_TIME | RECURRING
  category: string;
  paymentMethod: string; // UPI | RAZORPAY | STRIPE | CASH | BANK_TRANSFER
  paymentStatus: string; // PENDING | COMPLETED | FAILED | REFUNDED
  message?: string | null;
  createdAt: string;
  campaign?: { title: string } | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        status === "COMPLETED" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        status === "PENDING" && "border-amber-200 bg-amber-50 text-amber-700",
        (status === "FAILED" || status === "REFUNDED") &&
          "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {titleCase(status)}
    </Badge>
  );
}

export default function DonorDonations(_props: { user: SessionUser }) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>("/api/donations?mine=1");
      setDonations(asArray<Donation>(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load donations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = donations
    .filter((d) => d.paymentStatus === "COMPLETED")
    .reduce((s, d) => s + (d.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            My donations
          </h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${donations.length} donation${donations.length === 1 ? "" : "s"} · ${formatINR(total)} completed`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 gap-1.5 sm:min-h-9"
          onClick={load}
          aria-label="Refresh donations"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : donations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <HandCoins className="size-7 text-primary" aria-hidden="true" />
            </span>
            <p className="text-base font-semibold">No donations yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your generosity fuels ration kits, medicines, animal care and safe
              corridors. Every rupee is tracked to the ground.
            </p>
            <Button className="mt-1 min-h-11" onClick={() => navigate("/donate")}>
              <HandCoins className="size-4" aria-hidden="true" />
              Make your first donation
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {donations.map((d) => (
            <Card key={d.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs text-muted-foreground">
                      {d.receiptNumber}
                    </p>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px] text-muted-foreground"
                    >
                      {titleCase(d.type)}
                    </Badge>
                    <StatusBadge status={d.paymentStatus} />
                  </div>
                  <p className="truncate text-sm font-semibold">
                    {d.campaign?.title ?? "General fund"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {titleCase(d.paymentMethod)} · {formatDate(d.createdAt)}
                  </p>
                  {d.message && (
                    <p className="mt-1 border-l-2 border-primary/30 pl-2 text-xs italic text-muted-foreground">
                      “{d.message}”
                    </p>
                  )}
                </div>
                <p className="text-lg font-bold text-primary">
                  {formatINR(d.amount)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
