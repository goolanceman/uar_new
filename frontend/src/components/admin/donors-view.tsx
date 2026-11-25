"use client";

/**
 * Donors (CRM) — the trust's supporter registry (round-5 design system).
 *
 * - StatCards: total donors, major donors (lifetime ≥ ₹10,000), new this
 *   month, repeat donors
 * - Server-side pagination + q/type/category filters + debounced search, with
 *   active-filter chips, clear-all and a live result count in one toolbar row
 * - Table view = DataTable (height="fill", sticky header, skeleton rows,
 *   built-in premium pager); grid/list persist via useViewPref
 * - Donor-360 75%-width DetailSheet with tabs: Profile, Donations, Pledges
 *   & sponsorships, Certificates — plus a lifetime stats strip
 * - Add/Edit FormSheet (lg) with rule-factory validation + dirty tracking
 * - Delete (ConfirmDialog — donations stay, CRM record removed), CSV export
 */

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  Crown,
  ExternalLink,
  Eye,
  HeartHandshake,
  HeartPulse,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  PawPrint,
  Pencil,
  Plus,
  ReceiptText,
  Repeat,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  formatDate,
  formatDateLong,
  formatINR,
  formatINRCompact,
  initials,
  titleCase,
} from "@/lib/format";
import {
  emailRule,
  fieldError,
  panRule,
  phoneRule,
  pinRule,
  required,
} from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { DataField } from "@/components/shared/data-field";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  PageSizeSelect,
  PaginationBar,
  ViewSwitcher,
  useViewPref,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import { StatusBadge, humanize } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------- types ------------------------------------ */

interface DonorBase {
  id: string;
  code: string;
  type: string;
  organizationName?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  altPhone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  pan?: string | null;
  language?: string | null;
  source?: string | null;
  category?: string | null;
  wants80g: boolean;
  anonymousByDefault: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  tags?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: { id: string; role: string; status: string } | null;
}

interface DonorRow extends DonorBase {
  lifetimeValue: number;
  donationsCount: number;
  firstDonationAt?: string | null;
  lastDonationAt?: string | null;
}

interface DonorsEnvelope {
  items?: DonorRow[];
  total?: number;
  page?: number;
  pages?: number;
}

interface DonorDonation {
  id: string;
  receiptNumber: string;
  amount: number;
  type?: string;
  category?: string;
  paymentMethod?: string;
  paymentStatus: string;
  receiptStatus?: string;
  createdAt: string;
  campaign?: { title?: string } | null;
}

interface DonorPledge {
  id: string;
  amountPerMonth: number;
  months: number;
  startDate: string;
  status: string;
  cause?: { code?: string; patientName?: string } | null;
}

interface DonorAnimalPledge {
  id: string;
  kind: string;
  amount: number;
  frequency: string;
  status: string;
  animal?: { name?: string; species?: string } | null;
}

interface DonorCertificate {
  id: string;
  code: string;
  type: string;
  title?: string;
  recipientName?: string;
  issuedAt: string;
}

interface DonorDetail extends DonorBase {
  donations: DonorDonation[];
  pledges: DonorPledge[];
  animalPledges: DonorAnimalPledge[];
  certificates: DonorCertificate[];
  stats: {
    lifetimeValue: number;
    fyValue: number;
    donationsCount: number;
    receiptsIssued: number;
    activePledges: number;
  };
}

interface DonorFormState {
  name: string;
  type: string;
  organizationName: string;
  email: string;
  phone: string;
  altPhone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  pan: string;
  language: string;
  source: string;
  category: string;
  wants80g: boolean;
  anonymousByDefault: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  tags: string;
  notes: string;
}

/* ----------------------------- option constants ---------------------------- */

const DONOR_TYPE_OPTIONS = [
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "ORGANISATION", label: "Organisation" },
  { value: "CORPORATE", label: "Corporate" },
];

const DONOR_SOURCE_OPTIONS = [
  { value: "WEB", label: "Web" },
  { value: "OFFLINE", label: "Offline" },
  { value: "IMPORT", label: "Import" },
  { value: "REFERRAL", label: "Referral" },
  { value: "EVENT", label: "Event" },
];

const DONOR_CATEGORY_OPTIONS = [
  { value: "MAJOR", label: "Major donor" },
  { value: "MONTHLY", label: "Monthly giver" },
  { value: "ONE_TIME", label: "One-time giver" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "CSR", label: "CSR partner" },
];

/* ------------------------------- helpers ---------------------------------- */

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim());
    }
    return [];
  } catch {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
}

function emptyDonorForm(): DonorFormState {
  return {
    name: "",
    type: "INDIVIDUAL",
    organizationName: "",
    email: "",
    phone: "",
    altPhone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    pan: "",
    language: "",
    source: "OFFLINE",
    category: "NONE",
    wants80g: true,
    anonymousByDefault: false,
    emailOptIn: true,
    smsOptIn: true,
    whatsappOptIn: true,
    tags: "",
    notes: "",
  };
}

function donorFormFromRow(d: DonorBase): DonorFormState {
  return {
    name: d.name ?? "",
    type: d.type || "INDIVIDUAL",
    organizationName: d.organizationName ?? "",
    email: d.email ?? "",
    phone: d.phone ?? "",
    altPhone: d.altPhone ?? "",
    address: d.address ?? "",
    city: d.city ?? "",
    state: d.state ?? "",
    pincode: d.pincode ?? "",
    pan: d.pan ?? "",
    language: d.language ?? "",
    source: d.source || "OFFLINE",
    category: d.category || "NONE",
    wants80g: Boolean(d.wants80g),
    anonymousByDefault: Boolean(d.anonymousByDefault),
    emailOptIn: Boolean(d.emailOptIn),
    smsOptIn: Boolean(d.smsOptIn),
    whatsappOptIn: Boolean(d.whatsappOptIn),
    tags: parseTags(d.tags).join(", "),
    notes: d.notes ?? "",
  };
}

function validateDonorForm(f: DonorFormState): Record<string, string | null> {
  return {
    name: fieldError(f.name, [required("Donor name")]),
    organizationName:
      f.type !== "INDIVIDUAL"
        ? fieldError(f.organizationName, [required("Organisation name")])
        : null,
    email: fieldError(f.email, [emailRule()]),
    phone: fieldError(f.phone, [phoneRule(true)]),
    altPhone: fieldError(f.altPhone, [phoneRule(true)]),
    pincode: fieldError(f.pincode, [pinRule(true)]),
    pan: fieldError(f.pan, [panRule(true)]),
  };
}

function DonorAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary",
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

function OrgBadge({ type }: { type: string }) {
  if (type === "INDIVIDUAL") return null;
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
      {type === "CORPORATE" ? "Corporate" : "Org"}
    </Badge>
  );
}

function CommsPrefIcons({
  d,
}: {
  d: Pick<DonorBase, "emailOptIn" | "smsOptIn" | "whatsappOptIn">;
}) {
  const prefs = [
    { on: d.emailOptIn, icon: Mail, label: "Email updates" },
    { on: d.smsOptIn, icon: MessageSquare, label: "SMS updates" },
    { on: d.whatsappOptIn, icon: MessageCircle, label: "WhatsApp updates" },
  ];
  return (
    <span className="flex items-center gap-1">
      {prefs.map(({ on, icon: Icon, label }) => (
        <span
          key={label}
          role="img"
          aria-label={`${label}: ${on ? "opted in" : "opted out"}`}
          title={`${label}: ${on ? "opted in" : "opted out"}`}
          className={cn(
            "flex size-6 items-center justify-center rounded-md",
            on
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground/50"
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}

function TagBadges({ tags, max = 3 }: { tags: string | null | undefined; max?: number }) {
  const list = parseTags(tags);
  if (list.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {list.slice(0, max).map((t) => (
        <Badge
          key={t}
          variant="outline"
          className="max-w-[100px] truncate text-[10px] text-muted-foreground"
        >
          {t}
        </Badge>
      ))}
      {list.length > max ? (
        <span className="text-[10px] text-muted-foreground">+{list.length - max}</span>
      ) : null}
    </span>
  );
}

function RowActions({
  donor,
  onView,
  onEdit,
  onDelete,
}: {
  donor: DonorRow;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Actions for donor ${donor.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onView}>
          <Eye className="size-4" /> View donor 360
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ListSkeleton({ mode }: { mode: "grid" | "list" }) {
  if (mode === "grid") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function TabEmpty({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <EmptyState icon={icon} title={title} className="py-8">
      {null}
    </EmptyState>
  );
}

/* ------------------------------ detail sheet ------------------------------- */

function Donor360Content({ d }: { d: DonorDetail }) {
  const tags = parseTags(d.tags);
  const openReceipt = (receiptNumber: string) => {
    window.open(`/api/receipts/${receiptNumber}/html`, "_blank", "noopener,noreferrer");
  };
  const openCertificate = (code: string) => {
    window.open(`/api/certificates/${code}/html`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="Lifetime value" value={formatINR(d.stats.lifetimeValue)} />
        <MiniStat label="This FY" value={formatINR(d.stats.fyValue)} />
        <MiniStat label="Donations" value={String(d.stats.donationsCount)} />
        <MiniStat label="80G receipts" value={String(d.stats.receiptsIssued)} />
        <MiniStat label="Active pledges" value={String(d.stats.activePledges)} />
      </div>

      <Tabs defaultValue="profile" className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="donations">Donations</TabsTrigger>
          <TabsTrigger value="pledges">Pledges &amp; sponsorships</TabsTrigger>
          <TabsTrigger value="certificates">Certificates</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="flex flex-col gap-4">
          <DetailSection title="Identity" description="Used to match donations and receipts.">
            <DetailGrid cols={2}>
              <DataField label="Name" value={d.name} />
              <DataField label="Type" value={humanize(d.type)} />
              <DataField label="Organisation" value={d.organizationName ?? ""} />
              <DataField label="Email" value={d.email} copy />
              <DataField label="Phone" value={d.phone ?? ""} />
              <DataField label="Alternate phone" value={d.altPhone ?? ""} />
              <DataField
                label="Linked account"
                value={
                  d.user
                    ? `${humanize(d.user.role)} · ${humanize(d.user.status)}`
                    : "Not linked"
                }
              />
              <DataField label="In CRM since" value={formatDateLong(d.createdAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Address">
            <DetailGrid cols={2}>
              <DataField label="Address" value={d.address ?? ""} className="sm:col-span-2" />
              <DataField label="City" value={d.city ?? ""} />
              <DataField label="State" value={d.state ?? ""} />
              <DataField label="PIN code" value={d.pincode ?? ""} mono />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Tax & preferences"
            description="PAN powers 80G receipts; the segment drives outreach."
          >
            <DetailGrid cols={2}>
              <DataField label="PAN" value={d.pan ?? ""} mono copy />
              <DataField label="Wants 80G receipts" value={d.wants80g ? "Yes" : "No"} />
              <DataField
                label="Anonymous by default"
                value={d.anonymousByDefault ? "Yes" : "No"}
              />
              <DataField label="Language" value={d.language ?? ""} />
              <DataField label="Source" value={d.source ? humanize(d.source) : ""} />
              <DataField label="Segment" value={d.category ? humanize(d.category) : ""} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Communication" description="Consent for each outreach channel.">
            <DetailGrid cols={2}>
              <DataField label="Email updates" value={d.emailOptIn ? "Opted in" : "Opted out"} />
              <DataField label="SMS updates" value={d.smsOptIn ? "Opted in" : "Opted out"} />
              <DataField
                label="WhatsApp updates"
                value={d.whatsappOptIn ? "Opted in" : "Opted out"}
              />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Tags & notes">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Tags
              </p>
              {tags.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs">
                      {t}
                    </Badge>
                  ))}
                </span>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </p>
              <p className="min-h-10 whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                {d.notes || "—"}
              </p>
            </div>
          </DetailSection>
        </TabsContent>

        {/* Donations */}
        <TabsContent value="donations">
          {d.donations.length === 0 ? (
            <TabEmpty
              icon={<ReceiptText className="size-6" />}
              title="No donations yet from this donor"
            />
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Receipt</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Campaign</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.donations.map((dn) => (
                    <TableRow key={dn.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="max-w-[150px] truncate">{dn.receiptNumber}</span>
                          {dn.receiptNumber ? (
                            <button
                              type="button"
                              aria-label={`Open 80G receipt ${dn.receiptNumber}`}
                              title="Open 80G receipt"
                              onClick={() => openReceipt(dn.receiptNumber)}
                              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <ExternalLink className="size-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatINR(dn.amount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {dn.paymentMethod ? titleCase(dn.paymentMethod) : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={dn.paymentStatus} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDate(dn.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                        {dn.campaign?.title ?? "General fund"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Pledges & sponsorships */}
        <TabsContent value="pledges" className="flex flex-col gap-4">
          <DetailSection
            title="Medicine adoption pledges"
            description="Adopt-a-Medicine causes this donor supports monthly."
          >
            {d.pledges.length === 0 ? (
              <TabEmpty
                icon={<HeartPulse className="size-5" />}
                title="No medicine pledges"
              />
            ) : (
              d.pledges.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  >
                    <HeartPulse className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.cause
                        ? `${p.cause.code ?? "Cause"} · ${p.cause.patientName ?? "Patient"}`
                        : "Cause pledge"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatINR(p.amountPerMonth)}/month · {p.months} month
                      {p.months === 1 ? "" : "s"} · from {formatDate(p.startDate)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))
            )}
          </DetailSection>

          <DetailSection
            title="Animal sponsorship pledges"
            description="Shelter animals and funds this donor sponsors."
          >
            {d.animalPledges.length === 0 ? (
              <TabEmpty
                icon={<PawPrint className="size-5" />}
                title="No animal sponsorships"
              />
            ) : (
              d.animalPledges.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lime-500/10 text-lime-700 dark:text-lime-400"
                  >
                    <PawPrint className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.animal
                        ? `${p.animal.name ?? "Animal"}${
                            p.animal.species ? ` · ${titleCase(p.animal.species)}` : ""
                          }`
                        : "Shelter fund"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(p.kind)} · {formatINR(p.amount)} ·{" "}
                      {humanize(p.frequency)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))
            )}
          </DetailSection>
        </TabsContent>

        {/* Certificates */}
        <TabsContent value="certificates">
          {d.certificates.length === 0 ? (
            <TabEmpty
              icon={<Award className="size-6" />}
              title="No certificates issued to this donor"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {d.certificates.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  >
                    <Award className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.title || humanize(c.type)}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {c.code} · issued {formatDate(c.issuedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openCertificate(c.code)}
                  >
                    <ExternalLink className="size-3.5" /> Open
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* --------------------------------- view ----------------------------------- */

const DONOR_CSV_COLUMNS: CsvColumn<DonorRow>[] = [
  { header: "Name", value: (d) => d.name },
  { header: "Type", value: (d) => d.type },
  { header: "Organisation", value: (d) => d.organizationName ?? "" },
  { header: "Email", value: (d) => d.email },
  { header: "Phone", value: (d) => d.phone ?? "" },
  { header: "Alt phone", value: (d) => d.altPhone ?? "" },
  { header: "City", value: (d) => d.city ?? "" },
  { header: "State", value: (d) => d.state ?? "" },
  { header: "PAN", value: (d) => d.pan ?? "" },
  { header: "Category", value: (d) => d.category ?? "" },
  { header: "Source", value: (d) => d.source ?? "" },
  { header: "Lifetime value", value: (d) => d.lifetimeValue ?? 0 },
  { header: "Gifts", value: (d) => d.donationsCount ?? 0 },
  { header: "First gift", value: (d) => formatDate(d.firstDonationAt) },
  { header: "Last gift", value: (d) => formatDate(d.lastDonationAt) },
  { header: "Wants 80G", value: (d) => (d.wants80g ? "Yes" : "No") },
  { header: "Tags", value: (d) => parseTags(d.tags).join("; ") },
];

export default function DonorsView() {
  const [view, setView] = useViewPref("donors");

  // list state
  const [items, setItems] = useState<DonorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listToken, setListToken] = useState(0);

  // filters
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // stats
  const [statsLoading, setStatsLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    major: 0,
    newThisMonth: 0,
    repeat: 0,
  });

  // create / edit form
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<DonorRow | null>(null);
  const [form, setForm] = useState<DonorFormState>(emptyDonorForm);
  const [initialFormJson, setInitialFormJson] = useState(
    JSON.stringify(emptyDonorForm())
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  // detail sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<DonorRow | null>(null);
  const [detail, setDetail] = useState<DonorDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // delete
  const [deleteTarget, setDeleteTarget] = useState<DonorRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = JSON.stringify(form) !== initialFormJson;
  const hasFilters = q !== "" || type !== "ALL" || category !== "ALL";

  const setF = <K extends keyof DonorFormState>(
    k: K,
    v: DonorFormState[K]
  ) => setForm((prev) => ({ ...prev, [k]: v }));

  const refresh = () => {
    setListToken((t) => t + 1);
    void loadStats();
  };

  /* ------------------------------ data loads ------------------------------ */

  async function loadStats() {
    setStatsLoading(true);
    try {
      const res = await get<DonorsEnvelope>("/api/donors?page=1&limit=200");
      const rows = res.items ?? [];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      setStats({
        total: res.total ?? 0,
        major: rows.filter((d) => Number(d.lifetimeValue) >= 10000).length,
        newThisMonth: rows.filter(
          (d) => d.createdAt && new Date(d.createdAt) >= monthStart
        ).length,
        repeat: rows.filter((d) => Number(d.donationsCount) > 1).length,
      });
    } catch {
      toast.error("Could not load donor statistics");
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    void loadStats();
  }, []);

  // debounce search → q
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // main list fetch (server-side filters + pagination)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (q) params.set("q", q);
    if (type !== "ALL") params.set("type", type);
    if (category !== "ALL") params.set("category", category);

    get<DonorsEnvelope>(`/api/donors?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const ps = data.pages ?? 1;
        const p = data.page ?? page;
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(data.total ?? 0);
        setPages(ps);
        if (p > ps) setPage(ps); // clamp when the list shrinks
      })
      .catch((e: unknown) => {
        if (!cancelled)
          toast.error(e instanceof Error ? e.message : "Could not load donors");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, type, category, page, limit, listToken]);

  // donor-360 fetch when the sheet opens
  useEffect(() => {
    if (!detailOpen || !detailTarget) return;
    let cancelled = false;
    setDetailLoading(true);
    get<DonorDetail>(`/api/donors/${detailTarget.id}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          toast.error(e instanceof Error ? e.message : "Could not load donor profile");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailOpen, detailTarget]);

  /* ------------------------------- handlers ------------------------------- */

  const openCreate = () => {
    setFormMode("create");
    setEditing(null);
    const f = emptyDonorForm();
    setForm(f);
    setInitialFormJson(JSON.stringify(f));
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (donor: DonorRow) => {
    setFormMode("edit");
    setEditing(donor);
    const f = donorFormFromRow(donor);
    setForm(f);
    setInitialFormJson(JSON.stringify(f));
    setErrors({});
    setFormOpen(true);
  };

  const openDetail = (donor: DonorRow) => {
    setDetailTarget(donor);
    setDetail(null);
    setDetailOpen(true);
  };

  const askDelete = (donor: DonorRow) => {
    setDeleteTarget(donor);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/donors/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed from the CRM`);
      const wasLastRow = items.length <= 1;
      setDeleteOpen(false);
      setDeleteTarget(null);
      if (wasLastRow && page > 1) {
        setPage(page - 1); // triggers a refetch via deps
        void loadStats();
      } else {
        refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the donor");
    } finally {
      setDeleting(false);
    }
  };

  const submitForm = async () => {
    const errs = validateDonorForm(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      const tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const base = {
        name: form.name.trim(),
        type: form.type,
        organizationName:
          form.type === "INDIVIDUAL" ? null : form.organizationName.trim() || null,
        phone: form.phone.trim() || null,
        altPhone: form.altPhone.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        pincode: form.pincode.trim() || null,
        pan: form.pan.trim().toUpperCase() || null,
        language: form.language.trim() || null,
        source: form.source,
        category: form.category === "NONE" ? null : form.category,
        wants80g: form.wants80g,
        anonymousByDefault: form.anonymousByDefault,
        emailOptIn: form.emailOptIn,
        smsOptIn: form.smsOptIn,
        whatsappOptIn: form.whatsappOptIn,
        tags: tags.length > 0 ? tags : null,
        notes: form.notes.trim() || null,
      };
      if (formMode === "create") {
        await post("/api/donors", { ...base, email: form.email.trim().toLowerCase() });
        toast.success(`${form.name.trim()} added to the donor CRM`);
      } else if (editing) {
        await patch(`/api/donors/${editing.id}`, base);
        toast.success(`${form.name.trim()} updated`);
      }
      setFormOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the donor");
    } finally {
      setSaving(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setQ("");
    setType("ALL");
    setCategory("ALL");
    setPage(1);
  };

  /* ---------------------------- table + toolbar ---------------------------- */

  const filterChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (q) filterChips.push({ key: "q", label: `“${q}”`, clear: () => setSearch("") });
  if (type !== "ALL")
    filterChips.push({ key: "type", label: humanize(type), clear: () => setType("ALL") });
  if (category !== "ALL")
    filterChips.push({ key: "category", label: humanize(category), clear: () => setCategory("ALL") });

  const emptyNode = (
    <EmptyState
      icon={<HeartHandshake className="size-6" />}
      title={hasFilters ? "No donors match your filters" : "No donors in the CRM yet"}
      hint={
        hasFilters
          ? "Try a different search term or clear the filters."
          : "Add your first supporter — every donation page sign-up lands here automatically."
      }
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        {hasFilters ? (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="size-4" /> Clear filters
          </Button>
        ) : null}
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" /> Add donor
        </Button>
      </div>
    </EmptyState>
  );

  const donorColumns: DataTableColumn<DonorRow>[] = [
    { key: "donor", header: "Donor" },
    { key: "contact", header: "Contact", hideBelow: "lg" },
    { key: "city", header: "City", hideBelow: "md" },
    { key: "pan", header: "PAN", mono: true, hideBelow: "lg" },
    { key: "lifetime", header: "Lifetime", align: "right", mono: true, className: "font-semibold" },
    { key: "gifts", header: "Gifts", align: "right", mono: true, hideBelow: "md" },
    { key: "lastGift", header: "Last gift", hideBelow: "lg" },
    { key: "tags", header: "Tags", hideBelow: "lg" },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right" },
  ];

  const renderDonorCell = (d: DonorRow, col: DataTableColumn<DonorRow>) => {
    switch (col.key) {
      case "donor":
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <DonorAvatar name={d.name} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                <span className="max-w-[160px] truncate">{d.name}</span>
                <OrgBadge type={d.type} />
              </p>
              <p className="flex items-center gap-1.5 max-w-[220px] text-xs text-muted-foreground">
                <span className="truncate">{d.email}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{d.code}</span>
              </p>
            </div>
          </div>
        );
      case "contact":
        return (
          <div className="flex flex-col text-xs">
            <span>{d.phone ?? "—"}</span>
            {d.altPhone ? <span className="text-muted-foreground">{d.altPhone}</span> : null}
          </div>
        );
      case "city":
        return <span className="text-xs">{d.city ?? "—"}</span>;
      case "pan":
        return d.pan ?? "—";
      case "lifetime":
        return formatINRCompact(d.lifetimeValue);
      case "gifts":
        return d.donationsCount;
      case "lastGift":
        return <span className="text-xs">{formatDate(d.lastDonationAt)}</span>;
      case "tags":
        return <TagBadges tags={d.tags} max={2} />;
      case "actions":
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RowActions
              donor={d}
              onView={() => openDetail(d)}
              onEdit={() => openEdit(d)}
              onDelete={() => askDelete(d)}
            />
          </div>
        );
      default:
        return null;
    }
  };

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Donors (CRM)"
        description="Every supporter in one place — lifetime value, receipts, pledges and outreach."
        icon={<HeartHandshake className="size-5" />}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Add donor
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total donors"
          value={String(stats.total)}
          icon={<Users className="size-5" />}
          accent="emerald"
          hint="All CRM profiles"
          loading={statsLoading}
        />
        <StatCard
          label="Major donors"
          value={String(stats.major)}
          icon={<Crown className="size-5" />}
          accent="amber"
          hint="Lifetime value ≥ ₹10,000"
          loading={statsLoading}
        />
        <StatCard
          label="New this month"
          value={String(stats.newThisMonth)}
          icon={<UserPlus className="size-5" />}
          accent="teal"
          hint="Joined the CRM this month"
          loading={statsLoading}
        />
        <StatCard
          label="Repeat donors"
          value={String(stats.repeat)}
          icon={<Repeat className="size-5" />}
          accent="fuchsia"
          hint="More than one completed gift"
          loading={statsLoading}
        />
      </div>

      {/* Directory */}
      <SectionCard
        title="Donor directory"
        description={
          total > 0
            ? `${total} donor${total === 1 ? "" : "s"} · sorted by latest activity`
            : "Search, segment and nurture every relationship"
        }
        icon={<Users className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              columns={DONOR_CSV_COLUMNS}
              rows={items}
              filename={`uar-donors-${new Date().toISOString().slice(0, 10)}`}
              disabled={loading || items.length === 0}
            />
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        }
        bodyClassName="flex flex-col gap-4"
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, org…"
              aria-label="Search donors"
              className="h-8 pl-8 text-sm"
            />
          </div>

          {/* type */}
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(1);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Filter by donor type"
              className="w-[130px] text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {DONOR_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* category */}
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Filter by donor segment"
              className="w-[136px] text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All segments</SelectItem>
              {DONOR_CATEGORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filterChips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="gap-1 pr-1 text-xs font-medium">
              {chip.label}
              <button
                type="button"
                aria-label={`Clear ${chip.label} filter`}
                onClick={chip.clear}
                className="rounded-full p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}

          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              aria-label="Clear all filters"
            >
              <X className="size-4" /> Clear all
            </Button>
          ) : null}

          <span
            className="ml-auto text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {loading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Content */}
        {view === "table" ? (
          <DataTable
            columns={donorColumns}
            rows={items}
            rowKey={(d) => d.id}
            loading={loading}
            skeletonRows={9}
            height="fill"
            fillOffset={520}
            onRowClick={openDetail}
            page={page}
            pages={pages}
            total={total}
            pageSize={limit}
            onPage={setPage}
            onPageSize={(n) => {
              setLimit(n);
              setPage(1);
            }}
            itemLabel="donors"
            empty={emptyNode}
          >
            {renderDonorCell}
          </DataTable>
        ) : loading ? (
          <ListSkeleton mode={view} />
        ) : items.length === 0 ? (
          emptyNode
        ) : view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(d)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openDetail(d);
                }}
                className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <DonorAvatar name={d.name} className="size-11 text-sm" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{d.name}</span>
                        <OrgBadge type={d.type} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{d.email}</p>
                    </div>
                  </div>
                  <CommsPrefIcons d={d} />
                </div>

                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Lifetime value
                    </p>
                    <p className="text-xl font-bold tracking-tight tabular-nums">
                      {formatINR(d.lifetimeValue)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {d.donationsCount} gift{d.donationsCount === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {d.city ? (
                    <Badge variant="outline" className="text-[10px]">
                      {d.city}
                    </Badge>
                  ) : null}
                  {d.pan ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {d.pan}
                    </Badge>
                  ) : null}
                  <span className="ml-auto">Last gift {formatDate(d.lastDonationAt)}</span>
                </div>

                <div className="flex items-center justify-between border-t pt-2.5">
                  <TagBadges tags={d.tags} max={2} />
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button variant="ghost" size="sm" onClick={() => openDetail(d)}>
                      <Eye className="size-3.5" /> 360
                    </Button>
                    <RowActions
                      donor={d}
                      onView={() => openDetail(d)}
                      onEdit={() => openEdit(d)}
                      onDelete={() => askDelete(d)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {items.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(d)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openDetail(d);
                }}
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <DonorAvatar name={d.name} className="size-8 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{d.name}</span>
                    <OrgBadge type={d.type} />
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.email}
                    {d.city ? ` · ${d.city}` : ""}
                  </p>
                </div>
                <CommsPrefIcons d={d} />
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {d.donationsCount} gift{d.donationsCount === 1 ? "" : "s"}
                </span>
                <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {formatINRCompact(d.lifetimeValue)}
                </span>
                <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    donor={d}
                    onView={() => openDetail(d)}
                    onEdit={() => openEdit(d)}
                    onDelete={() => askDelete(d)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination (grid / list — the DataTable pager covers the table view) */}
        {view !== "table" && !loading && items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <PaginationBar
              page={page}
              pages={pages}
              total={total}
              onPage={setPage}
              itemLabel="donors"
            />
            <PageSizeSelect
              value={limit}
              onChange={(n) => {
                setLimit(n);
                setPage(1);
              }}
            />
          </div>
        ) : null}
      </SectionCard>

      {/* Donor-360 detail sheet — full-screen */}
      <DetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        eyebrow={detailTarget ? `Donors · CRM · ${detailTarget.code}` : "Donors · CRM"}
        title={detailTarget?.name ?? "Donor 360"}
        description={
          detailTarget
            ? `${detailTarget.email} · lifetime ${formatINR(detailTarget.lifetimeValue)}`
            : "Loading donor…"
        }
        status={
          detailTarget ? (
            <Badge variant="outline" className="text-xs uppercase tracking-wide">
              {humanize(detailTarget.type)}
              {detailTarget.category ? ` · ${humanize(detailTarget.category)}` : ""}
            </Badge>
          ) : undefined
        }
        loading={detailLoading && !detail}
        actions={
          detailTarget ? (
            <Button size="sm" onClick={() => openEdit(detailTarget)}>
              <Pencil className="size-4" /> Edit donor
            </Button>
          ) : undefined
        }
      >
        {detail && !detailLoading ? (
          <Donor360Content d={detail} />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-10 w-full max-w-md rounded-lg" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </div>
        )}
      </DetailSheet>

      {/* Add / Edit donor form */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        size="lg"
        title={formMode === "create" ? "Add donor" : `Edit donor · ${editing?.name ?? ""}`}
        description={
          formMode === "create"
            ? "Create a CRM profile. Donations are linked automatically by email."
            : "Update identity, address, tax preferences and communication settings."
        }
        submitLabel={formMode === "create" ? "Add donor" : "Save changes"}
        onSubmit={submitForm}
        loading={saving}
        dirty={dirty}
      >
        <FormSection title="Identity" description="Used to match donations and receipts.">
          <FieldGrid>
            <TextField
              label="Full name"
              required
              value={form.name}
              onChange={(v) => setF("name", v)}
              error={errors.name}
              placeholder="Priya Verma"
            />
            <SelectField
              label="Donor type"
              value={form.type}
              onChange={(v) => setF("type", v)}
              options={DONOR_TYPE_OPTIONS}
            />
            {form.type !== "INDIVIDUAL" ? (
              <TextField
                label="Organisation name"
                required
                value={form.organizationName}
                onChange={(v) => setF("organizationName", v)}
                error={errors.organizationName}
                placeholder="Verma Foundation"
                className="sm:col-span-2"
              />
            ) : null}
            <TextField
              label="Email"
              required
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(v) => setF("email", v)}
              error={errors.email}
              disabled={formMode === "edit"}
              hint={
                formMode === "edit"
                  ? "Email is the unique key — it cannot be changed here."
                  : "Donations with this email link automatically."
              }
              placeholder="priya@example.com"
            />
            <TextField
              label="Phone"
              inputMode="tel"
              value={form.phone}
              onChange={(v) => setF("phone", v)}
              error={errors.phone}
              placeholder="9876543210"
            />
            <TextField
              label="Alternate phone"
              inputMode="tel"
              value={form.altPhone}
              onChange={(v) => setF("altPhone", v)}
              error={errors.altPhone}
              placeholder="Landline or secondary number"
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Address">
          <FieldGrid>
            <TextField
              label="Street address"
              value={form.address}
              onChange={(v) => setF("address", v)}
              placeholder="House / street / area"
              className="sm:col-span-2"
            />
            <TextField
              label="City"
              value={form.city}
              onChange={(v) => setF("city", v)}
              placeholder="Bengaluru"
            />
            <TextField
              label="State"
              value={form.state}
              onChange={(v) => setF("state", v)}
              placeholder="Karnataka"
            />
            <TextField
              label="PIN code"
              inputMode="numeric"
              value={form.pincode}
              onChange={(v) => setF("pincode", v)}
              error={errors.pincode}
              placeholder="560001"
            />
          </FieldGrid>
        </FormSection>

        <FormSection
          title="Tax & preferences"
          description="PAN powers 80G receipts; the segment drives outreach."
        >
          <FieldGrid>
            <TextField
              label="PAN"
              value={form.pan}
              onChange={(v) => setF("pan", v.toUpperCase())}
              error={errors.pan}
              hint="Format ABCDE1234F — optional"
              placeholder="ABCDE1234F"
            />
            <TextField
              label="Preferred language"
              value={form.language}
              onChange={(v) => setF("language", v)}
              placeholder="English, Hindi, Kannada…"
            />
            <SelectField
              label="Source"
              value={form.source}
              onChange={(v) => setF("source", v)}
              options={DONOR_SOURCE_OPTIONS}
            />
            <SelectField
              label="Segment"
              value={form.category}
              onChange={(v) => setF("category", v)}
              options={[
                { value: "NONE", label: "Not segmented" },
                ...DONOR_CATEGORY_OPTIONS,
              ]}
              placeholder="Not segmented"
            />
          </FieldGrid>
          <div className="grid gap-3 sm:grid-cols-2">
            <SwitchField
              label="Wants 80G receipts"
              hint="Send tax-deductible receipts for eligible gifts."
              checked={form.wants80g}
              onChange={(v) => setF("wants80g", v)}
            />
            <SwitchField
              label="Anonymous by default"
              hint="Hide this donor name on public walls unless they opt in per gift."
              checked={form.anonymousByDefault}
              onChange={(v) => setF("anonymousByDefault", v)}
            />
          </div>
        </FormSection>

        <FormSection title="Communication" description="Consent for each outreach channel.">
          <div className="grid gap-3 sm:grid-cols-3">
            <SwitchField
              label="Email"
              checked={form.emailOptIn}
              onChange={(v) => setF("emailOptIn", v)}
            />
            <SwitchField
              label="SMS"
              checked={form.smsOptIn}
              onChange={(v) => setF("smsOptIn", v)}
            />
            <SwitchField
              label="WhatsApp"
              checked={form.whatsappOptIn}
              onChange={(v) => setF("whatsappOptIn", v)}
            />
          </div>
        </FormSection>

        <FormSection title="Tags & notes" description="Internal segmentation and remarks.">
          <TextField
            label="Tags"
            value={form.tags}
            onChange={(v) => setF("tags", v)}
            hint="Comma-separated, e.g. Major, HNI, Monthly giver"
            placeholder="Major, Monthly giver"
          />
          <TextareaField
            label="Notes"
            value={form.notes}
            onChange={(v) => setF("notes", v)}
            rows={3}
            placeholder="Relationship notes, call outcomes, preferences…"
          />
        </FormSection>
      </FormSheet>

      {/* Delete */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete donor"
        recordName={
          deleteTarget ? `${deleteTarget.name} · ${deleteTarget.email}` : null
        }
        description="Linked donations stay in the ledger, but the CRM profile, segmentation, comms preferences and donor linking are removed. This cannot be undone."
        confirmLabel="Delete donor"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
