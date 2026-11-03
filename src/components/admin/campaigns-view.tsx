"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Baby,
  CalendarDays,
  Flower2,
  Heart,
  HeartHandshake,
  Loader2,
  MapPin,
  Package,
  PawPrint,
  Pencil,
  Phone,
  Pill,
  Plus,
  Search,
  ShieldAlert,
  Siren,
  Smartphone,
  Sprout,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatINRCompact, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------ types & helpers ----------------------------- */

interface Campaign {
  id: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  description: string;
  category: string;
  targetAmount: number;
  raisedAmount: number;
  status: string;
  icon: string;
  accent: string;
  startDate?: string;
  endDate?: string | null;
  location?: string | null;
  helpline?: string | null;
  featured: boolean;
  beneficiaries: number;
  volunteersEngaged: number;
  createdBy?: string;
}

const CATEGORIES = [
  "GENERAL",
  "FOOD_DISTRIBUTION",
  "SANITARY_PADS",
  "MEDICAL",
  "AWARENESS",
  "SAFETY",
  "ANIMAL",
  "MOBILITY",
  "EDUCATION_SUPPORT",
  "EMERGENCY",
];
const STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "shield-alert": ShieldAlert,
  smartphone: Smartphone,
  "heart-handshake": HeartHandshake,
  baby: Baby,
  pill: Pill,
  "paw-print": PawPrint,
  siren: Siren,
  package: Package,
  "flower-2": Flower2,
  heart: Heart,
};
const ICON_KEYS = Object.keys(ICONS);

/** Dark-safe accent classes for the 9 campaign accents. */
const ACCENTS: Record<string, { chip: string; dot: string; bar: string; ring: string }> = {
  orange: { chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400", dot: "bg-orange-500", bar: "[&>div]:bg-orange-500", ring: "border-orange-500/30" },
  cyan: { chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500", bar: "[&>div]:bg-cyan-500", ring: "border-cyan-500/30" },
  fuchsia: { chip: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400", dot: "bg-fuchsia-500", bar: "[&>div]:bg-fuchsia-500", ring: "border-fuchsia-500/30" },
  amber: { chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500", bar: "[&>div]:bg-amber-500", ring: "border-amber-500/30" },
  teal: { chip: "bg-teal-500/10 text-teal-600 dark:text-teal-400", dot: "bg-teal-500", bar: "[&>div]:bg-teal-500", ring: "border-teal-500/30" },
  lime: { chip: "bg-lime-500/10 text-lime-600 dark:text-lime-400", dot: "bg-lime-500", bar: "[&>div]:bg-lime-500", ring: "border-lime-500/30" },
  red: { chip: "bg-red-500/10 text-red-600 dark:text-red-400", dot: "bg-red-500", bar: "[&>div]:bg-red-500", ring: "border-red-500/30" },
  emerald: { chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", bar: "[&>div]:bg-emerald-500", ring: "border-emerald-500/30" },
  pink: { chip: "bg-pink-500/10 text-pink-600 dark:text-pink-400", dot: "bg-pink-500", bar: "[&>div]:bg-pink-500", ring: "border-pink-500/30" },
};
const ACCENT_KEYS = Object.keys(ACCENTS);

function statusTone(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "PAUSED":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "COMPLETED":
      return "bg-teal-500/10 text-teal-700 dark:text-teal-400";
    case "CANCELLED":
      return "bg-red-500/10 text-red-700 dark:text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isoToDateInput(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ProgressRing({ pct, accent }: { pct: number; accent: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const tone = ACCENTS[accent]?.chip ?? ACCENTS.emerald.chip;
  return (
    <div className={cn("relative mx-auto size-28", tone)}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, pct) / 100) * c}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">
        {pct}%
      </span>
    </div>
  );
}

const emptyForm = {
  title: "",
  slug: "",
  slugTouched: false,
  tagline: "",
  description: "",
  category: "GENERAL",
  targetAmount: "",
  startDate: "",
  endDate: "",
  location: "",
  icon: "heart",
  accent: "emerald",
  helpline: "",
  featured: false,
  status: "ACTIVE",
};

/* ---------------------------------- view ----------------------------------- */

export default function CampaignsView() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [category, setCategory] = useState("ALL");

  // dialogs / sheets
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [viewTarget, setViewTarget] = useState<Campaign | null>(null);
  const [viewDonationCount, setViewDonationCount] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<Campaign[] | { items?: Campaign[] }>("/api/campaigns?all=1");
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (status !== "ALL" && c.status !== status) return false;
      if (category !== "ALL" && c.category !== category) return false;
      if (needle) {
        const hay = `${c.title} ${c.slug ?? ""} ${c.tagline ?? ""} ${c.location ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, status, category]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, startDate: isoToDateInput(new Date().toISOString()) });
    setDialogOpen(true);
  };

  const openEdit = (c: Campaign) => {
    setEditingId(c.id);
    setForm({
      title: c.title,
      slug: c.slug ?? "",
      slugTouched: true,
      tagline: c.tagline ?? "",
      description: c.description ?? "",
      category: c.category ?? "GENERAL",
      targetAmount: c.targetAmount !== undefined ? String(c.targetAmount) : "",
      startDate: isoToDateInput(c.startDate),
      endDate: isoToDateInput(c.endDate),
      location: c.location ?? "",
      icon: c.icon ?? "heart",
      accent: c.accent ?? "emerald",
      helpline: c.helpline ?? "",
      featured: Boolean(c.featured),
      status: c.status ?? "ACTIVE",
    });
    setDialogOpen(true);
  };

  const openView = (c: Campaign) => {
    setViewTarget(c);
    setViewDonationCount(null);
    get<unknown[] | { items?: unknown[] }>(`/api/donations?campaignId=${encodeURIComponent(c.id)}&limit=500`)
      .then((d) => setViewDonationCount(Array.isArray(d) ? d.length : (d.items?.length ?? 0)))
      .catch(() => setViewDonationCount(null));
  };

  const save = async () => {
    if (!form.title.trim() || !form.description.trim() || !Number(form.targetAmount)) {
      toast.error("Title, description and a valid target amount are required");
      return;
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      toast.error("End date cannot be before the start date");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        slug: (form.slug.trim() || slugify(form.title)) || undefined,
        tagline: form.tagline.trim() || undefined,
        description: form.description.trim(),
        category: form.category,
        targetAmount: Number(form.targetAmount),
        startDate: form.startDate ? dateInputToIso(form.startDate) : undefined,
        endDate: dateInputToIso(form.endDate),
        location: form.location.trim() || undefined,
        icon: form.icon,
        accent: form.accent,
        helpline: form.helpline.trim() || undefined,
        featured: form.featured,
        status: form.status,
      };
      if (editingId) {
        await patch(`/api/campaigns/${editingId}`, body);
        toast.success("Campaign updated");
      } else {
        await post("/api/campaigns", body);
        toast.success("Campaign created");
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  const setStatusFor = async (c: Campaign, next: string) => {
    setBusyId(c.id);
    try {
      await patch(`/api/campaigns/${c.id}`, { status: next });
      toast.success(`${c.title} → ${titleCase(next)}`);
      await load();
      setViewTarget((prev) => (prev && prev.id === c.id ? { ...prev, status: next } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  const requestDelete = (c: Campaign) => {
    if ((c.raisedAmount ?? 0) > 0) {
      toast.error(
        `${c.title} has ${formatINR(c.raisedAmount)} raised — campaigns with funds cannot be deleted. Pause it or mark it Complete instead.`
      );
      return;
    }
    setDeleteTarget(c);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/campaigns/${deleteTarget.id}`);
      toast.success("Campaign deleted");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete campaign");
    } finally {
      setSaving(false);
    }
  };

  const statusActions = (c: Campaign, withLabels = false) => {
    const actions: { label: string; next: string; show: boolean; cls: string }[] = [
      { label: "Activate", next: "ACTIVE", show: c.status === "PAUSED" || c.status === "DRAFT", cls: "" },
      { label: "Pause", next: "PAUSED", show: c.status === "ACTIVE", cls: "" },
      { label: "Complete", next: "COMPLETED", show: c.status === "ACTIVE" || c.status === "PAUSED", cls: "text-teal-600 hover:bg-teal-500/10 hover:text-teal-700" },
    ];
    return actions.filter((a) => a.show).map((a) => (
      <Button
        key={a.next}
        size="sm"
        variant="outline"
        className={a.cls}
        disabled={busyId === c.id}
        aria-label={`${a.label} campaign ${c.title}`}
        onClick={() => setStatusFor(c, a.next)}
      >
        {busyId === c.id && <Loader2 className="size-3.5 animate-spin" />}
        {a.label}
      </Button>
    ));
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Campaigns"
        description="Fundraising drives with live progress, status control and public visibility."
        icon={<Sprout className="size-5" aria-hidden="true" />}
        actions={
          <Button onClick={openCreate} aria-label="Create new campaign">
            <Plus className="size-4" /> New campaign
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, tagline or location…" className="pl-9" aria-label="Search campaigns" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto self-center text-xs text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} campaigns`}
          </span>
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Sprout className="size-6" aria-hidden="true" />}
          title={rows.length === 0 ? "No campaigns yet" : "No campaigns match the filters"}
          hint={rows.length === 0 ? "Launch your first fundraising drive to start collecting donations." : "Try a different search term or clear the filters."}
        >
          {rows.length === 0 ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" /> New campaign
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { setQ(""); setStatus("ALL"); setCategory("ALL"); }}>
              Clear filters
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const Icon = ICONS[c.icon] ?? Heart;
            const accent = ACCENTS[c.accent] ?? ACCENTS.emerald;
            const pct = c.targetAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100)) : 0;
            return (
              <article key={c.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", accent.chip)}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("size-2 shrink-0 rounded-full", accent.dot)} aria-hidden="true" />
                      {c.featured && <Star className="size-3.5 fill-amber-400 text-amber-500" aria-label="Featured campaign" />}
                      <h3 className="truncate text-sm font-semibold leading-tight">{c.title}</h3>
                    </div>
                    {c.slug && <p className="truncate font-mono text-[11px] text-muted-foreground">/{c.slug}</p>}
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone(c.status))}>
                    {titleCase(c.status)}
                  </span>
                </div>

                {c.tagline && <p className="line-clamp-2 text-xs text-muted-foreground">{c.tagline}</p>}

                <div className="space-y-1.5">
                  <Progress value={pct} className={accent.bar} aria-label={`${c.title} funding progress: ${pct}%`} />
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{formatINR(c.raisedAmount)}</span>
                    <span className="text-muted-foreground">of {formatINR(c.targetAmount)} · {pct}%</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden="true" /> {c.beneficiaries} beneficiaries
                  </span>
                  {c.location && (
                    <span className="flex min-w-0 items-center gap-1">
                      <MapPin className="size-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{c.location}</span>
                    </span>
                  )}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{titleCase(c.category)}</span>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-3">
                  <Button size="sm" variant="ghost" onClick={() => openView(c)} aria-label={`View campaign ${c.title}`}>
                    View
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)} aria-label={`Edit campaign ${c.title}`}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  {statusActions(c)}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-11 text-red-600 hover:bg-red-500/10 hover:text-red-700 md:size-9"
                    aria-label={`Delete campaign ${c.title}`}
                    onClick={() => requestDelete(c)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* --------------------------- View sheet ------------------------------ */}
      <Sheet open={!!viewTarget} onOpenChange={(o) => !o && setViewTarget(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              {(() => { const I = ICONS[viewTarget?.icon ?? "heart"] ?? Heart; return <I className="size-4 text-primary" aria-hidden="true" />; })()}
              {viewTarget?.title ?? "Campaign"}
            </SheetTitle>
            <SheetDescription>
              {viewTarget ? `${viewTarget.tagline || titleCase(viewTarget.category)} · ${formatINR(viewTarget.raisedAmount)} raised` : ""}
            </SheetDescription>
          </SheetHeader>
          {viewTarget && (() => {
            const accent = ACCENTS[viewTarget.accent] ?? ACCENTS.emerald;
            const pct = viewTarget.targetAmount > 0 ? Math.min(100, Math.round((viewTarget.raisedAmount / viewTarget.targetAmount) * 100)) : 0;
            return (
              <div className="flex-1 space-y-4 px-4 pb-6">
                <SectionCard title="Progress" icon={<Sprout className="size-4" aria-hidden="true" />}>
                  <ProgressRing pct={pct} accent={viewTarget.accent} />
                  <div className="mt-3 text-center text-sm">
                    <span className="font-semibold">{formatINR(viewTarget.raisedAmount)}</span>
                    <span className="text-muted-foreground"> raised of {formatINR(viewTarget.targetAmount)} target</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
                    <DataField label="Linked donations" value={viewDonationCount === null ? "…" : String(viewDonationCount)} />
                    <DataField label="Status" value={<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone(viewTarget.status))}>{titleCase(viewTarget.status)}</span>} />
                  </div>
                </SectionCard>

                <SectionCard title="Reach" icon={<Users className="size-4" aria-hidden="true" />}>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <DataField label="Beneficiaries" value={String(viewTarget.beneficiaries)} />
                    <DataField label="Volunteers engaged" value={String(viewTarget.volunteersEngaged)} />
                    <DataField label="Category" value={titleCase(viewTarget.category)} />
                    <DataField label="Featured" value={viewTarget.featured ? "Yes" : "No"} />
                  </div>
                </SectionCard>

                <SectionCard title="Details" icon={<CalendarDays className="size-4" aria-hidden="true" />}>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <DataField label="Slug" value={viewTarget.slug} mono />
                    <DataField label="Location" value={viewTarget.location} />
                    <DataField label="Start date" value={formatDate(viewTarget.startDate)} />
                    <DataField label="End date" value={viewTarget.endDate ? formatDate(viewTarget.endDate) : "Ongoing"} />
                    <DataField
                      label="Helpline"
                      value={viewTarget.helpline}
                      icon={<Phone className="size-3" aria-hidden="true" />}
                      copy
                    />
                    <DataField label="Created by" value={viewTarget.createdBy} />
                  </div>
                  {viewTarget.helpline && (
                    <a
                      href={`tel:${viewTarget.helpline.replace(/\s+/g, "")}`}
                      className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-primary hover:bg-accent"
                      aria-label={`Call helpline ${viewTarget.helpline}`}
                    >
                      <Phone className="size-4" aria-hidden="true" /> Call {viewTarget.helpline}
                    </a>
                  )}
                  <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{viewTarget.description}</p>
                </SectionCard>

                <div className="flex flex-wrap gap-2">
                  {statusActions(viewTarget)}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setViewTarget(null);
                      openEdit(viewTarget);
                    }}
                    aria-label="Edit this campaign"
                  >
                    <Pencil className="size-4" /> Edit campaign
                  </Button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ------------------------- Create / Edit dialog ----------------------- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update campaign details — raised amount is derived from donations." : "Launch a new fundraising campaign for the trust."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="c-title">Title *</Label>
              <Input
                id="c-title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    title: e.target.value,
                    slug: f.slugTouched ? f.slug : slugify(e.target.value),
                  }))
                }
                placeholder="Green Corridor Initiative"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-slug">URL slug</Label>
              <Input
                id="c-slug"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value), slugTouched: true }))}
                placeholder="green-corridor-initiative"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Auto-generated from the title — edit if needed (a-z, 0-9, hyphens).</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-tagline">Tagline</Label>
              <Input id="c-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="One line that inspires donors" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-desc">Description *</Label>
              <Textarea id="c-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="What does this campaign fund?" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger aria-label="Campaign category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-target">Target amount (₹) *</Label>
                <Input id="c-target" type="number" min="1" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} placeholder="500000" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-start">Start date</Label>
                <Input id="c-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-end">End date</Label>
                <Input id="c-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="c-location">Location</Label>
                <Input id="c-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Bengaluru, Karnataka" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-helpline">Helpline</Label>
                <Input id="c-helpline" value={form.helpline} onChange={(e) => setForm({ ...form, helpline: e.target.value })} placeholder="e.g. 181" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Icon</Label>
                <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })}>
                  <SelectTrigger aria-label="Campaign icon"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ICON_KEYS.map((k) => {
                      const I = ICONS[k];
                      return (
                        <SelectItem key={k} value={k}>
                          <span className="flex items-center gap-2">
                            <I className="size-3.5" aria-hidden="true" />
                            {titleCase(k.replace(/-/g, " "))}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Accent</Label>
                <Select value={form.accent} onValueChange={(v) => setForm({ ...form, accent: v })}>
                  <SelectTrigger aria-label="Campaign accent colour"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCENT_KEYS.map((a) => (
                      <SelectItem key={a} value={a}>
                        <span className="flex items-center gap-2">
                          <span className={cn("size-2.5 rounded-full", ACCENTS[a].dot)} aria-hidden="true" />
                          {titleCase(a)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger aria-label="Campaign status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <div className="flex w-full items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="c-featured" className="text-sm">Featured</Label>
                    <p className="text-xs text-muted-foreground">Show on homepage</p>
                  </div>
                  <Switch id="c-featured" checked={form.featured} onCheckedChange={(v) => setForm({ ...form, featured: v })} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create campaign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------- Delete confirm --------------------------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.title}" (${formatINRCompact(deleteTarget.raisedAmount)} raised) and its links will be permanently removed. Donations keep their receipts but become uncategorised. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
