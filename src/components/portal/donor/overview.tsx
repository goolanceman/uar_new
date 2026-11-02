"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarHeart,
  HandCoins,
  HeartHandshake,
  PawPrint,
  ReceiptText,
  Sparkles,
} from "lucide-react";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { cn, formatINR, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Donation {
  id: string;
  receiptNumber: string;
  amount: number;
  type: string;
  paymentStatus: string;
  paymentMethod: string;
  message?: string | null;
  createdAt: string;
  campaign?: { title: string } | null;
}

interface Pledge {
  id: string;
  amountPerMonth: number;
  months: number;
  status: string;
  cause?: { code: string; patientName: string } | null;
}

interface AnimalPledge {
  id: string;
  kind: string;
  amount: number;
  frequency: string;
  status: string;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

const QUICK_ACTIONS = [
  {
    key: "donate",
    title: "Make a donation",
    desc: "Support a campaign or give to the general fund",
    icon: HandCoins,
    to: "/donate",
  },
  {
    key: "causes",
    title: "Adopt a medicine",
    desc: "Fund a patient's monthly medicines",
    icon: HeartHandshake,
    to: "/donor/causes",
  },
  {
    key: "animals",
    title: "Sponsor an animal",
    desc: "Food, medical care & shelter at our shelter",
    icon: PawPrint,
    to: "/donor/animals",
  },
  {
    key: "receipts",
    title: "80G receipts",
    desc: "View & print your donation receipts",
    icon: ReceiptText,
    to: "/donor/receipts",
  },
];

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: typeof HandCoins;
  label: string;
  value: string;
  sub?: string;
  loading: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-20" />
          ) : (
            <p className="text-xl font-bold leading-tight">{value}</p>
          )}
          {sub && !loading && (
            <p className="truncate text-xs text-muted-foreground">{sub}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function DonorOverview({ user }: { user: SessionUser }) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [animalPledges, setAnimalPledges] = useState<AnimalPledge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, p, a] = await Promise.all([
          get<unknown>("/api/donations?mine=1"),
          get<unknown>("/api/causes/pledges?mine=1"),
          get<unknown>("/api/animals/pledges?mine=1"),
        ]);
        if (!alive) return;
        setDonations(asArray<Donation>(d));
        setPledges(asArray<Pledge>(p));
        setAnimalPledges(asArray<AnimalPledge>(a));
      } catch {
        // stay empty — individual views surface detailed errors
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const completed = donations.filter((d) => d.paymentStatus === "COMPLETED");
  const totalDonated = completed.reduce((s, d) => s + (d.amount || 0), 0);
  const monthlyPledges = pledges
    .filter((p) => p.status === "ACTIVE")
    .reduce((s, p) => s + (p.amountPerMonth || 0), 0);
  const activeAnimalPledges = animalPledges.filter(
    (p) => p.status === "ACTIVE"
  ).length;
  const receiptCount = completed.length;

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {greet}, {user.name.split(" ")[0]} 🙏
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Thank you for powering United Angel Reach — every rupee reaches the ground.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={HandCoins}
          label="Total donated"
          value={formatINR(totalDonated)}
          sub={`${receiptCount} completed donation${receiptCount === 1 ? "" : "s"}`}
          loading={loading}
        />
        <StatCard
          icon={CalendarHeart}
          label="Monthly pledges"
          value={formatINR(monthlyPledges)}
          sub={
            pledges.filter((p) => p.status === "ACTIVE").length > 0
              ? `${pledges.filter((p) => p.status === "ACTIVE").length} active medicine adoption${pledges.filter((p) => p.status === "ACTIVE").length === 1 ? "" : "s"}`
              : "Adopt a patient's medicines"
          }
          loading={loading}
        />
        <StatCard
          icon={PawPrint}
          label="Animal sponsorships"
          value={String(activeAnimalPledges)}
          sub={activeAnimalPledges > 0 ? "Active at the UAR shelter" : "Meet the animals →"}
          loading={loading}
        />
        <StatCard
          icon={ReceiptText}
          label="80G receipts"
          value={String(receiptCount)}
          sub="Eligible tax receipts"
          loading={loading}
        />
      </div>

      {/* Quick actions */}
      <section aria-label="Quick actions">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.key}
                type="button"
                onClick={() => navigate(q.to)}
                className="group flex min-h-11 flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-sm outline-none transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold">{q.title}</span>
                <span className="text-xs text-muted-foreground">{q.desc}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary">
                  Go
                  <ArrowRight
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent donations */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Recent donations</CardTitle>
            <CardDescription>Your latest contributions</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 sm:min-h-9"
            onClick={() => navigate("/donor/donations")}
          >
            View all <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : donations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <Sparkles className="size-8 text-primary/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                No donations yet — your first one takes under a minute.
              </p>
              <Button className="min-h-11" onClick={() => navigate("/donate")}>
                <HandCoins className="size-4" aria-hidden="true" />
                Make your first donation
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {donations.slice(0, 5).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {d.campaign?.title ?? "General fund"}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {d.receiptNumber} · {formatDate(d.createdAt)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px]",
                      d.paymentStatus === "COMPLETED" &&
                        "border-emerald-200 bg-emerald-50 text-emerald-700",
                      d.paymentStatus === "PENDING" &&
                        "border-amber-200 bg-amber-50 text-amber-700",
                      (d.paymentStatus === "FAILED" || d.paymentStatus === "REFUNDED") &&
                        "border-red-200 bg-red-50 text-red-700"
                    )}
                  >
                    {d.paymentStatus}
                  </Badge>
                  <p className="w-20 text-right text-sm font-bold">
                    {formatINR(d.amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
