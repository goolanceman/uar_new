"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  CalendarRange,
  Copy,
  Download,
  FileCheck2,
  HandCoins,
  HeartHandshake,
  Info,
  Landmark,
  PawPrint,
  Printer,
  ReceiptText,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { amountInWords, formatINR, formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
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
import {
  asArray,
  currentFyLabel,
  estimateDeduction,
  fyLabel,
  fyRange,
  fyStartYear,
  is80gEligible,
  openCertificate,
  openReceipt,
} from "./portal-utils";

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  amount: number;
  paymentStatus: string;
  paymentMethod?: string | null;
  receiptStatus?: string | null; // PENDING | ISSUED | CANCELLED | REISSUED
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

interface PublicSettings {
  orgName?: string;
  orgAddress?: string;
  orgHq?: string;
  orgEmail?: string;
  orgPhone?: string;
  org80g?: string;
  orgPan?: string;
  orgReg12a?: string;
  signatoryName?: string;
  signatoryRole?: string;
}

const ORG_FALLBACK: PublicSettings = {
  orgName: "United Angel Reach Trust",
  orgAddress: "Bengaluru, Karnataka, India",
  orgHq: "Bengaluru, Karnataka",
  orgEmail: "reach@unitedangelreach.org",
  orgPhone: "—",
  org80g: "Reg. No. UAR/80G/2024/001",
  orgPan: "AAJTU1234F",
  orgReg12a: "12A Reg. No. UAR/12A/2024/001",
  signatoryName: "Trustee — Finance",
  signatoryRole: "United Angel Reach Trust",
};

export default function DonorReceipts({ user }: { user: SessionUser }) {
  const currentFY = fyStartYear();
  const [fy, setFy] = useState(String(currentFY));
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [pledgeMonthly, setPledgeMonthly] = useState(0);
  const [animalMonthly, setAnimalMonthly] = useState(0);
  const [org, setOrg] = useState<PublicSettings>(ORG_FALLBACK);
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
      const [r, c, p, a, pub] = await Promise.all([
        get<unknown>(`/api/receipts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`),
        get<unknown>("/api/certificates?limit=50").catch(() => []),
        get<unknown>("/api/causes/pledges?mine=1").catch(() => []),
        get<unknown>("/api/animals/pledges?mine=1").catch(() => []),
        get<PublicSettings>("/api/settings/public").catch(() => null),
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
      if (pub) setOrg({ ...ORG_FALLBACK, ...pub });
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
  const eligibleRows = completed.filter(is80gEligible);
  const eligibleTotal = eligibleRows.reduce((s, r) => s + (r.amount || 0), 0);
  const eligibleDeduction = estimateDeduction(completed);
  const issuedCount = completed.filter(
    (r) => (r.receiptStatus ?? "ISSUED").toUpperCase() === "ISSUED"
  ).length;
  const pendingCount = completed.filter(
    (r) => (r.receiptStatus ?? "").toUpperCase() === "PENDING"
  ).length;

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

  const campaignTitle = (r: ReceiptRow) => r.campaignTitle ?? r.campaign?.title ?? "General fund";

  /**
   * Consolidated FY statement — client-generated print-friendly HTML in a new
   * tab. Self-contained inline CSS + auto window.print(), same approach the
   * 80G receipt endpoint uses server-side.
   */
  const openConsolidatedStatement = () => {
    if (completed.length === 0) {
      toast.info(`No receipts in ${fyLabel(Number(fy))} yet — nothing to print.`);
      return;
    }
    const rows = eligibleRows
      .map(
        (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td class="mono">${r.receiptNumber}</td>
          <td>${formatDate(r.createdAt)}</td>
          <td>${campaignTitle(r)}</td>
          <td class="mono">${titleCase(r.paymentMethod ?? "—")}</td>
          <td class="right">₹${Number(r.amount).toLocaleString("en-IN")}</td>
        </tr>`
      )
      .join("");
    const excluded = completed.length - eligibleRows.length;

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>UAR 80G Consolidated Statement · ${fyLabel(Number(fy))}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a2e22; padding: 40px 48px; max-width: 900px; margin: 0 auto; }
  .letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #14532d; padding-bottom: 14px; }
  .org { font-size: 22px; font-weight: 700; color: #14532d; letter-spacing: .3px; }
  .org-sub { font-size: 11.5px; color: #4b6358; margin-top: 3px; line-height: 1.5; }
  .badge { border: 1.5px solid #14532d; border-radius: 6px; padding: 8px 12px; font-size: 10.5px; text-align: center; color: #14532d; line-height: 1.6; }
  h1 { font-size: 16px; text-align: center; margin: 26px 0 4px; letter-spacing: 2.5px; text-transform: uppercase; }
  .period { text-align: center; font-size: 12px; color: #4b6358; margin-bottom: 22px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: Arial, Helvetica, sans-serif; }
  th { background: #f0f7f3; color: #14532d; text-align: left; padding: 8px 10px; border: 1px solid #cfe3d8; font-size: 10.5px; text-transform: uppercase; letter-spacing: .8px; }
  td { padding: 7px 10px; border: 1px solid #dfeee6; }
  .mono { font-family: 'Courier New', monospace; font-size: 11.5px; }
  .right { text-align: right; }
  tfoot td { font-weight: 700; background: #f0f7f3; }
  .totals { display: flex; justify-content: flex-end; margin-top: 18px; }
  .totals table { width: 340px; }
  .note { font-size: 11px; color: #4b6358; margin-top: 18px; line-height: 1.7; font-family: Arial, Helvetica, sans-serif; }
  .sign { display: flex; justify-content: space-between; margin-top: 56px; font-size: 12px; font-family: Arial, Helvetica, sans-serif; }
  .sign .line { border-top: 1px solid #1a2e22; padding-top: 6px; width: 220px; text-align: center; }
  @media print { body { padding: 12mm; } }
</style>
</head>
<body>
  <div class="letterhead">
    <div>
      <div class="org">${org.orgName ?? ORG_FALLBACK.orgName}</div>
      <div class="org-sub">
        ${org.orgAddress ?? ORG_FALLBACK.orgAddress}<br/>
        ${org.orgEmail ?? ""} · ${org.orgPhone ?? ""}<br/>
        80G: ${org.org80g ?? ""} · PAN: ${org.orgPan ?? ""} · ${org.orgReg12a ?? ""}
      </div>
    </div>
    <div class="badge">UNITED ANGEL REACH<br/>80G TAX STATEMENT<br/>${fyLabel(Number(fy))}</div>
  </div>
  <h1>Consolidated Donation Statement</h1>
  <p class="period">Financial Year ${fyLabel(Number(fy))} (April ${Number(fy)} – March ${Number(fy) + 1}) · Donor: ${user.name} (${user.email})</p>
  <table>
    <thead>
      <tr><th>#</th><th>Receipt No.</th><th>Date</th><th>Towards</th><th>Method</th><th class="right">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="5" class="right">Total eligible for 80G deduction</td><td class="right">₹${eligibleTotal.toLocaleString("en-IN")}</td></tr>
    </tfoot>
  </table>
  <div class="totals">
    <table>
      <tr><td>Estimated deduction u/s 80G (50%)</td><td class="right mono">₹${eligibleDeduction.toLocaleString("en-IN")}</td></tr>
      <tr><td>Amount in words</td><td class="mono">${amountInWords(eligibleTotal)}</td></tr>
    </table>
  </div>
  <p class="note">
    ${excluded > 0 ? `${excluded} receipt(s) in this period are excluded (cash above ₹2,000 is not 80G-eligible, or payment incomplete). ` : ""}
    This consolidated statement lists individual 80G receipts which remain the primary documents for ITR filing —
    quote the receipt numbers above in Schedule 80G. Donations to United Angel Reach Trust qualify for 50% deduction
    u/s 80G of the Income Tax Act, 1961, subject to the adjusted gross total income limits.
  </p>
  <div class="sign">
    <div class="line">Donor signature</div>
    <div class="line">For ${org.orgName ?? ORG_FALLBACK.orgName}<br/><small>${org.signatoryName ?? ""}</small></div>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;

    const w = window.open("", "_blank", "noopener");
    if (!w) {
      toast.error("Pop-up blocked — allow pop-ups to print the statement.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax centre — 80G receipts"
        description={`Every completed gift earns an 80G receipt. Selected period: ${fyLabel(Number(fy))} (April to March).`}
        icon={<ReceiptText className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={openConsolidatedStatement}
              disabled={loading || completed.length === 0}
              aria-label="Open print view of the consolidated FY statement"
            >
              <Printer className="size-4" aria-hidden="true" />
              Download all (print view)
            </Button>
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
          </div>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`${fyLabel(Number(fy))} total`}
          value={formatINR(fyTotal)}
          hint={`${completed.length} completed gift${completed.length === 1 ? "" : "s"}`}
          icon={<HandCoins className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="80G-eligible"
          value={formatINR(eligibleTotal)}
          hint={`${issuedCount} issued${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}`}
          icon={<FileCheck2 className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Est. deduction"
          value={formatINR(eligibleDeduction)}
          hint="50% u/s 80G, indicative"
          icon={<Landmark className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Monthly commitments"
          value={`${formatINR(pledgeMonthly + animalMonthly)}/mo`}
          hint={`${formatINR(pledgeMonthly)} medicine · ${formatINR(animalMonthly)} animal`}
          icon={<HeartHandshake className="size-5" />}
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
                    <TableHead>Receipt status</TableHead>
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
                      <TableCell className="max-w-56 truncate">{campaignTitle(r)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatINR(r.amount)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={r.receiptStatus ?? "ISSUED"} />
                          {!is80gEligible(r) && (
                            <span
                              className="text-[10px] text-amber-700 dark:text-amber-400"
                              title="Cash above ₹2,000 is not 80G-eligible"
                            >
                              (no 80G)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {is80gEligible(r) ? (
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
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
                    <p className="truncate font-mono text-xs font-semibold">{r.receiptNumber}</p>
                    <p className="font-bold">{formatINR(r.amount)}</p>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {formatDate(r.createdAt)} · {campaignTitle(r)}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <StatusBadge status={r.receiptStatus ?? "ISSUED"} />
                    {is80gEligible(r) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 w-auto gap-1.5"
                        onClick={() => openReceipt(r.receiptNumber)}
                        aria-label={`Download receipt ${r.receiptNumber}`}
                      >
                        <Download className="size-4" aria-hidden="true" />
                        Receipt
                      </Button>
                    ) : (
                      <span className="text-xs text-amber-700 dark:text-amber-400">No 80G</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {currentFyLabel() === fyLabel(Number(fy)) && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="size-3.5 shrink-0" aria-hidden="true" />
                Cash gifts above ₹2,000 are recorded but not 80G-eligible — they carry no tax receipt.
              </p>
            )}
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
              your taxable income. On {formatINR(eligibleTotal)} eligible giving in{" "}
              {fyLabel(Number(fy))}, roughly{" "}
              <span className="font-semibold text-primary">{formatINR(eligibleDeduction)}</span>{" "}
              may be deductible (subject to your income slab and the 10% adjusted
              gross total income limit).
            </p>
            <p>
              <span className="font-semibold text-foreground">Consolidated statement.</span>{" "}
              Use <strong>Download all (print view)</strong> above for a single
              print-friendly statement of every eligible receipt this FY — attach
              the individual receipts for filing.
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
          <ul className="max-h-96 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {certificates.map((c) => (
              <Fragment key={c.id}>
                <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
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
              </Fragment>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <PawPrint className="size-3.5" aria-hidden="true" />
        Animal sponsorships and medicine pledges are receipted by the finance team at year-end.
      </p>
    </div>
  );
}
