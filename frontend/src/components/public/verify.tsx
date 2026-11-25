"use client";

/**
 * Public verification pages — hash-routed, capability-link driven:
 *
 *   #/verify                      → hub: paste a receipt number or certificate code
 *   #/verify/receipt/:number      → GET /api/receipts/:receiptNumber (public)
 *   #/verify/certificate/:code    → GET /api/certificates/:code (public)
 *
 * Each detail page shows a single verdict badge (VALID / NOT FOUND), the key
 * public details, and a link to the backend's self-contained printable HTML
 * version (…/html). Both endpoints are public "by capability" — the code or
 * number itself is the shared secret, so no auth is required or sent.
 */

import * as React from "react";
import {
  BadgeCheck,
  BadgeX,
  FileText,
  Landmark,
  Loader2,
  ReceiptText,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { navigate } from "@/lib/router";
import { get } from "@/lib/api-client";
import { formatDateLong, formatDateTime, formatINR, titleCase } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Section } from "@/components/public/shared";

/* ─────────────────────────────── shared shell ────────────────────────────── */

type Verdict = "loading" | "valid" | "not-found" | "error";

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === "loading")
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-sky-500/30 bg-sky-500/10 px-3 py-1 text-sky-700 dark:text-sky-300"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Checking…
      </Badge>
    );
  if (verdict === "valid")
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-700 dark:text-emerald-300"
      >
        <BadgeCheck className="size-4" aria-hidden="true" /> VALID
      </Badge>
    );
  if (verdict === "not-found")
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-red-500/40 bg-red-500/10 px-3 py-1 text-sm text-red-700 dark:text-red-300"
      >
        <BadgeX className="size-4" aria-hidden="true" /> NOT FOUND
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-amber-500/40 bg-amber-500/10 px-3 py-1 text-sm text-amber-700 dark:text-amber-300"
    >
      <ShieldCheck className="size-4" aria-hidden="true" /> UNAVAILABLE
    </Badge>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={`min-w-0 break-words text-right text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function VerifyCenter({
  icon,
  title,
  subtitle,
  verdict,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  verdict?: Verdict;
  children: React.ReactNode;
}) {
  return (
    <Section className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-lg space-y-5">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
            {icon}
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {verdict ? (
            <div className="mt-4 flex justify-center">
              <VerdictBadge verdict={verdict} />
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </Section>
  );
}

/* ─────────────────────────── certificate verify ──────────────────────────── */

interface CertificateRecord {
  code?: string;
  type?: string;
  typeTitle?: string;
  title?: string;
  recipientName?: string;
  recipientEmail?: string | null;
  description?: string | null;
  issuedBy?: string | null;
  issuedAt?: string;
  metaParsed?: Record<string, unknown> | null;
}

export function CertificateVerifyPage({ code }: { code: string }) {
  const [record, setRecord] = React.useState<CertificateRecord | null>(null);
  const [verdict, setVerdict] = React.useState<Verdict>("loading");

  const load = React.useCallback(async () => {
    setVerdict("loading");
    try {
      const data = await get<CertificateRecord>(
        `/api/certificates/${encodeURIComponent(code)}`
      );
      setRecord(data ?? {});
      setVerdict("valid");
    } catch (e) {
      setRecord(null);
      const msg = e instanceof Error ? e.message : "";
      setVerdict(/\b404\b|not found/i.test(msg) ? "not-found" : "error");
    }
  }, [code]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <VerifyCenter
      icon={<BadgeCheck className="size-7" aria-hidden="true" />}
      title="Certificate verification"
      subtitle="Every UAR certificate carries a unique code — this one was checked against the live registry."
      verdict={verdict}
    >
      {verdict === "loading" ? (
        <Card className="space-y-3 p-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full rounded-md" />
          ))}
        </Card>
      ) : verdict === "valid" && record ? (
        <Card className="p-6">
          <div className="space-y-1">
            <DetailRow label="Certificate code" value={record.code ?? code} mono />
            <DetailRow
              label="Type"
              value={record.typeTitle ?? record.title ?? titleCase(record.type ?? "")}
            />
            <DetailRow label="Issued to" value={record.recipientName ?? "—"} />
            {record.recipientEmail ? (
              <DetailRow label="Recipient email" value={record.recipientEmail} mono />
            ) : null}
            {record.issuedAt ? (
              <DetailRow label="Issued on" value={formatDateLong(record.issuedAt)} />
            ) : null}
            {record.issuedBy ? <DetailRow label="Issued by" value={record.issuedBy} /> : null}
            {record.description ? (
              <DetailRow label="Description" value={record.description} />
            ) : null}
            {record.metaParsed &&
              Object.entries(record.metaParsed)
                .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
                .map(([k, v]) => <DetailRow key={k} label={titleCase(k)} value={String(v)} />)}
          </div>
          <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">
            This certificate is genuine and was issued by United Angel Reach. If you
            received it outside an official channel, contact
            care@unitedangelreach.org before relying on it.
          </p>
          <Button className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700" asChild>
            <a
              href={`/api/certificates/${encodeURIComponent(code)}/html`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText className="size-4" aria-hidden="true" /> Open printable version
            </a>
          </Button>
        </Card>
      ) : (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium">
            {verdict === "not-found"
              ? "No certificate exists with this code."
              : "The registry could not be reached just now."}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {verdict === "not-found"
              ? "Check the code for typos (it looks like UAR-CERT-2026-00001), or contact the office that issued it."
              : "Please try again in a moment — nothing was verified."}
          </p>
          <Button variant="outline" className="mt-4" onClick={load}>
            Try again
          </Button>
        </Card>
      )}

      <p className="text-center">
        <Button variant="link" className="text-emerald-600 dark:text-emerald-400" asChild>
          <a href="#/verify">Verify a different code or receipt number</a>
        </Button>
      </p>
    </VerifyCenter>
  );
}

/* ───────────────────────────── receipt verify ────────────────────────────── */

interface ReceiptPayload {
  donation?: {
    receiptNumber?: string;
    donorName?: string;
    amount?: number;
    currency?: string;
    category?: string;
    paymentStatus?: string;
    receiptStatus?: string;
    pan?: string | null;
    donatedAt?: string | null;
    createdAt?: string;
    campaignTitle?: string | null;
    isAnonymous?: boolean;
  };
  org?: {
    name?: string;
    address?: string | null;
    pan?: string | null;
    reg80g?: string | null;
  } | null;
}

export function ReceiptVerifyPage({ number }: { number: string }) {
  const [payload, setPayload] = React.useState<ReceiptPayload | null>(null);
  const [verdict, setVerdict] = React.useState<Verdict>("loading");

  const load = React.useCallback(async () => {
    setVerdict("loading");
    try {
      const data = await get<ReceiptPayload>(
        `/api/receipts/${encodeURIComponent(number)}`
      );
      setPayload(data ?? {});
      setVerdict("valid");
    } catch (e) {
      setPayload(null);
      const msg = e instanceof Error ? e.message : "";
      setVerdict(/\b404\b|not found/i.test(msg) ? "not-found" : "error");
    }
  }, [number]);

  React.useEffect(() => {
    load();
  }, [load]);

  const donation = payload?.donation;
  const org = payload?.org;

  return (
    <VerifyCenter
      icon={<ReceiptText className="size-7" aria-hidden="true" />}
      title="Donation receipt verification"
      subtitle="80G receipts carry a government-format number — this one was checked against the live registry."
      verdict={verdict}
    >
      {verdict === "loading" ? (
        <Card className="space-y-3 p-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full rounded-md" />
          ))}
        </Card>
      ) : verdict === "valid" && donation ? (
        <Card className="p-6">
          <div className="space-y-1">
            <DetailRow
              label="Receipt number"
              value={donation.receiptNumber ?? number}
              mono
            />
            <DetailRow label="Amount" value={formatINR(donation.amount ?? null)} />
            <DetailRow
              label="Donated by"
              value={donation.isAnonymous ? "Anonymous donor" : (donation.donorName ?? "—")}
            />
            <DetailRow label="Category" value={titleCase(donation.category ?? "")} />
            {donation.campaignTitle ? (
              <DetailRow label="Campaign" value={donation.campaignTitle} />
            ) : null}
            {donation.pan ? <DetailRow label="Donor PAN" value={donation.pan} mono /> : null}
            <DetailRow
              label="Payment status"
              value={titleCase(donation.paymentStatus ?? "")}
            />
            <DetailRow
              label="Donated on"
              value={formatDateTime(donation.donatedAt ?? donation.createdAt ?? null)}
            />
            {org?.name ? <DetailRow label="Issuing organisation" value={org.name} /> : null}
            {org?.reg80g ? (
              <DetailRow label="80G registration" value={org.reg80g} mono />
            ) : null}
          </div>
          <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">
            This receipt is genuine and counts towards Section 80G tax exemption.
            Keep the printable copy for your records.
          </p>
          <Button className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700" asChild>
            <a
              href={`/api/receipts/${encodeURIComponent(number)}/html`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText className="size-4" aria-hidden="true" /> Open printable version
            </a>
          </Button>
        </Card>
      ) : (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium">
            {verdict === "not-found"
              ? "No receipt exists with this number."
              : "The registry could not be reached just now."}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {verdict === "not-found"
              ? "Check the number for typos (it looks like UAR-RCPT-2026-00007), or contact care@unitedangelreach.org."
              : "Please try again in a moment — nothing was verified."}
          </p>
          <Button variant="outline" className="mt-4" onClick={load}>
            Try again
          </Button>
        </Card>
      )}

      <p className="text-center">
        <Button variant="link" className="text-emerald-600 dark:text-emerald-400" asChild>
          <a href="#/verify">Verify a different code or receipt number</a>
        </Button>
      </p>
    </VerifyCenter>
  );
}

/* ─────────────────────────────── verify hub ──────────────────────────────── */

/** #/verify — paste either a receipt number or a certificate code. */
export function VerifyHubPage() {
  const [value, setValue] = React.useState("");
  const trimmed = value.trim();

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!trimmed) {
      toast.error("Paste a receipt number or certificate code first");
      return;
    }
    const v = trimmed.toUpperCase();
    if (v.startsWith("UAR-CERT-")) {
      navigate(`/verify/certificate/${encodeURIComponent(trimmed)}`);
    } else if (v.startsWith("UAR-RCPT-")) {
      navigate(`/verify/receipt/${encodeURIComponent(trimmed)}`);
    } else {
      // Unknown prefix — receipt numbers are the most common lookup.
      navigate(`/verify/receipt/${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <VerifyCenter
      icon={<ScanSearch className="size-7" aria-hidden="true" />}
      title="Verify a receipt or certificate"
      subtitle="Paste the number from your 80G receipt or the code on a certificate — we check it against the live registry, no sign-in needed."
    >
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="verify-value" className="text-xs font-medium">
              Receipt number or certificate code
              <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="verify-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. UAR-RCPT-2026-00007 or UAR-CERT-2026-00001"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Receipt numbers look like UAR-RCPT-YYYY-NNNNN; certificate codes like
              UAR-CERT-YYYY-NNNNN.
            </p>
          </div>
          <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700">
            <Landmark className="size-4" aria-hidden="true" /> Verify now
          </Button>
        </form>
      </Card>
    </VerifyCenter>
  );
}
