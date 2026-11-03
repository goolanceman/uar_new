"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  CalendarRange,
  Copy,
  Download,
  FileCheck2,
  HandCoins,
  HeartHandshake,
  Info,
  PawPrint,
  ReceiptText,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { financialYear, formatINR, formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  amount: number;
  paymentStatus: string;
  createdAt: string;
  campaignTitle?: string | null;
  campaign?: { title?: string | null } | null;
}

interface Certificate {
  id: string;
  code: string;
  type: string;
  title: string;
  description?: string | null;
  issuedAt: string;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  if (data && typeof data === "object" && Array.isArray((data as { certificates?: unknown }).certificates))
    return (data as { certificates: T[] }).certificates;
  return [];
}

function fyStartYear(d = new Date()): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function fyLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function fyRange(startYear: number): { from: string; to: string } {
  return {
    from: new Date(startYear, 3, 1).toISOString(),
    to: new Date(startYear + 1, 2, 31, 23, 59, 59).toISOString(),
  };
}

export default function DonorReceipts(_props: { user: SessionUser }) {
  const currentFY = fyStartYear();
  const [fy, setFy] = useState(String(currentFY));
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [pledgeMonthly, setPledgeMonthly] = useState(0);
  const [animalMonthly, setAnimalMonthly] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fyOptions = useMemo(
    () => [0, 1, 2, 3, 4].map((i) => currentFY - i),
    [currentFY]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = fyRange(Number(fy));
    try {
      const [r, c, p, a] = await Promise.all([
        get<unknown>(`/api/receipts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`),
        get<unknown>("/api/certificates?limit=50").catch(() => []),
        get<unknown>("/api/causes/pledges?mine=1").catch(() => []),
        get<unknown>("/api/animals/pledges?mine=1").catch(() => []),
      ]);
      setReceipts(asArray<ReceiptRow>(r));
      setCertificates(asArray<Certificate>(c));
      const pledgeList = asArray<{ amountPerMonth: number; status: string }>(p);
      setPledgeMonthly(
        pledgeList
          .filter((x) => x.status === "ACTIVE")
          .reduce((s, x) => s + (x.amountPerMonth || 0), 0)
      );
      const animalList = asArray<{ amount: number; frequency: string; status: string }>(a);
      setAnimalMonthly(
        animalList
          .filter((x) => x.status === "ACTIVE" && x.frequency === "MONTHLY")
          .reduce((s, x) => s + (x.amount || 0), 0)
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your tax centre");
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const completed = receipts.filter((r) => r.paymentStatus === "COMPLETED");
  const fyTotal = completed.reduce((s, r) => s + (r.amount || 0), 0);
  const eligibleDeduction = Math.round(fyTotal * 0.5);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast.success("Copied");
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  const openReceipt = (receiptNumber: string) => {
    window.open(`/api/receipts/${encodeURIComponent(receiptNumber)}/html`, "_blank", "noopener");
  };

  const openCertificate = (code: string) => {
    window.open(`/api/certificates/${encodeURIComponent(code)}/html`, "_blank", "noopener");
  };

  const campaignTitle = (r: ReceiptRow) =>
    r.campaignTitle ?? r.campaign?.title ?? "General fund";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax centre — 80G receipts"
        description={`Every completed gift earns an 80G receipt. Selected period: ${fyLabel(Number(fy))} (April to March).`}
        icon={<ReceiptText className="size-5" />}
        actions={
          <div className="min-w-[10rem]">
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger aria-label="Select financial year" className="min-h-11 w-full sm:min-h-9">
                <CalendarRange className="size-4" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fyOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {fyLabel(y)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`${fyLabel(Number(fy))} total`}
          value={formatINR(fyTotal)}
          hint={`${completed.length} eligible receipt${completed.length === 1 ? "" : "s"}`}
          icon={<HandCoins className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Receipts"
          value={String(completed.length)}
          hint="Download any time, no expiry"
          icon={<FileCheck2 className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Medicine pledges"
          value={`${formatINR(pledgeMonthly)}/mo`}
          hint="Active adopt-a-medicine commitment"
          icon={<HeartHandshake className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Animal support"
          value={`${formatINR(animalMonthly)}/mo`}
          hint="Active monthly sponsorships"
          icon={<PawPrint className="size-5" />}
          accent="lime"
          loading={loading}
        />
      </div>

      {/* Receipts */}
      <SectionCard
        title={`Receipts · ${fyLabel(Number(fy))}`}
        description="Print-ready 80G receipts straight from the trust letterhead"
        icon={<ReceiptText className="size-5" />}
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : completed.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="size-5" />}
            title={`No receipts in ${fyLabel(Number(fy))}`}
            hint="Completed donations appear here instantly with a printable 80G receipt."
          >
            <Button className="min-h-11" onClick={() => navigate("/donate")}>
              <HandCoins className="size-4" aria-hidden="true" />
              Make a donation
            </Button>
          </EmptyState>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-lg border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt no.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Towards</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-28 text-right">80G</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completed.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => copyCode(r.receiptNumber)}
                          className="group inline-flex min-h-11 items-center gap-1.5 rounded-md font-mono text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                          aria-label={`Copy receipt number ${r.receiptNumber}`}
                        >
                          {r.receiptNumber}
                          <Copy
                            className={cn(
                              "size-3",
                              copiedCode === r.receiptNumber
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "opacity-0 transition-opacity group-hover:opacity-60"
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(r.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-56 truncate">
                        {campaignTitle(r)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatINR(r.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 gap-1 sm:min-h-9"
                          onClick={() => openReceipt(r.receiptNumber)}
                          aria-label={`Download receipt ${r.receiptNumber}`}
                        >
                          <Download className="size-4" aria-hidden="true" />
                          PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="grid gap-3 md:hidden">
              {completed.map((r) => (
                <div key={r.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-mono text-xs font-semibold">
                      {r.receiptNumber}
                    </p>
                    <p className="font-bold">{formatINR(r.amount)}</p>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {formatDate(r.createdAt)} · {campaignTitle(r)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 min-h-11 w-full gap-1.5"
                    onClick={() => openReceipt(r.receiptNumber)}
                    aria-label={`Download receipt ${r.receiptNumber}`}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download receipt
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      {/* Consolidated statement explainer */}
      <SectionCard
        title="Filing your ITR with 80G"
        description="A plain-English guide to claiming your deduction"
        icon={<Info className="size-5" />}
      >
        <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
          <div className="space-y-2">
            <p>
              <span className="font-semibold text-foreground">50% deduction u/s 80G.</span>{" "}
              Donations to United Angel Reach Trust qualify for a 50% deduction from
              your taxable income. On {formatINR(fyTotal)} given in{" "}
              {fyLabel(Number(fy))}, roughly{" "}
              <span className="font-semibold text-primary">
                {formatINR(eligibleDeduction)}
              </span>{" "}
              may be deductible (subject to your income slab and the 10% adjusted
              gross total income limit).
            </p>
            <p>
              <span className="font-semibold text-foreground">Consolidated statement.</span>{" "}
              Download each receipt above and attach the set (or a consolidated
              print) to your ITR records — no physical courier needed, the receipts
              carry the trust&apos;s 80G registration number.
            </p>
          </div>
          <div className="space-y-2">
            <p>
              <span className="font-semibold text-foreground">PAN matters.</span>{" "}
              Your PAN prints on every receipt — add or verify it in your Profile
              before filing. A receipt without PAN can be challenged by the
              assessing officer.
            </p>
            <p>
              <span className="font-semibold text-foreground">Financial year.</span>{" "}
              The Indian FY runs April to March ({fyLabel(Number(fy))} = Apr{" "}
              {Number(fy)} → Mar {Number(fy) + 1}). Match receipts to the FY in
              which the payment was made, not pledged.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Certificates */}
      <SectionCard
        title="Certificates"
        description="Appreciation and service certificates issued by the UAR team"
        icon={<Award className="size-5" />}
      >
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : certificates.length === 0 ? (
          <EmptyState
            icon={<Award className="size-5" />}
            title="No certificates yet"
            hint="Our team issues appreciation certificates for major gifts, adoptions and sponsorships — they will appear here automatically."
          />
        ) : (
          <ul className="divide-y">
            {certificates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Award className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {c.code} · {titleCase(c.type)} · {formatDate(c.issuedAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 sm:min-h-9"
                  onClick={() => openCertificate(c.code)}
                  aria-label={`Open certificate ${c.code}`}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
