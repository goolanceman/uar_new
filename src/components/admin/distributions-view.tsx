"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { del, get, post } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ---------------------------------- types ---------------------------------- */

interface DistributionRow {
  id: string;
  type: string;
  beneficiaryId?: string | null;
  items?: string | null;
  quantity: number;
  value?: number | null;
  location?: string | null;
  notes?: string | null;
  distributedAt: string;
  beneficiary?: { name: string } | null;
  volunteer?: { user?: { name: string } | null } | null;
  campaign?: { title: string } | null;
}

interface BeneficiaryLite {
  id: string;
  name: string;
  city?: string | null;
}

interface ItemRow {
  name: string;
  qty: string;
}

interface PadDrive {
  id: string;
  schoolName?: string | null;
  area: string;
  girlsCount: number;
  padsDistributed: number;
  awarenessSession: boolean;
  sessionAttendees?: number | null;
  notes?: string | null;
  distributionDate: string;
  volunteer?: { name: string } | null;
}

interface PadForm {
  area: string;
  schoolName: string;
  girlsCount: string;
  padsDistributed: string;
  awarenessSession: boolean;
  sessionAttendees: string;
  notes: string;
}

/* ------------------------------- chip styles ------------------------------- */

const TYPE_CLS: Record<string, string> = {
  FOOD: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  SANITARY_PADS: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400",
  MEDICAL: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  ANIMAL_FEED: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
  CLOTHING: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  EDUCATION_MATERIAL: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  CASH: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  OTHER: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const DISTRIBUTION_TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "EDUCATION_MATERIAL",
  "CASH",
  "OTHER",
];

const EMPTY_DIST_FORM = {
  type: "FOOD",
  beneficiaryId: "",
  quantity: "1",
  value: "",
  location: "",
  notes: "",
  items: [{ name: "", qty: "1" }] as ItemRow[],
};

const EMPTY_PAD_FORM: PadForm = {
  area: "",
  schoolName: "",
  girlsCount: "",
  padsDistributed: "",
  awarenessSession: false,
  sessionAttendees: "",
  notes: "",
};

function parseItems(json: string | null | undefined): { name: string; qty: number | string }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ---------------------------------- view ----------------------------------- */

export default function DistributionsView() {
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [padDrives, setPadDrives] = useState<PadDrive[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryLite[]>([]);
  const [schoolOptions, setSchoolOptions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("ALL");

  /* general dialogs */
  const [distDialog, setDistDialog] = useState(false);
  const [distForm, setDistForm] = useState(EMPTY_DIST_FORM);
  const [savingDist, setSavingDist] = useState(false);
  const [sheet, setSheet] = useState<DistributionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DistributionRow | null>(null);

  /* pad drive dialogs */
  const [padDialog, setPadDialog] = useState(false);
  const [padForm, setPadForm] = useState<PadForm>(EMPTY_PAD_FORM);
  const [savingPad, setSavingPad] = useState(false);
  const [padSheet, setPadSheet] = useState<PadDrive | null>(null);
  const [deletePad, setDeletePad] = useState<PadDrive | null>(null);

  const load = useCallback(async () => {
    try {
      const [dist, pads] = await Promise.all([
        get<DistributionRow[]>("/api/distributions?limit=200"),
        get<PadDrive[]>("/api/pad-distributions"),
      ]);
      setDistributions(Array.isArray(dist) ? dist : []);
      setPadDrives(Array.isArray(pads) ? pads : []);
      // beneficiaries for the record dialog (best-effort)
      get<BeneficiaryLite[]>("/api/beneficiaries")
        .then((rows) => setBeneficiaries(Array.isArray(rows) ? rows : []))
        .catch(() => setBeneficiaries([]));
      // optional school coverage MDM — fall back to free text when absent
      get<string[]>("/api/school-coverages")
        .then((rows) => setSchoolOptions(Array.isArray(rows) && rows.length > 0 ? rows.map(String) : null))
        .catch(() => setSchoolOptions(null));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load distributions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredDist = useMemo(
    () => (typeFilter === "ALL" ? distributions : distributions.filter((d) => d.type === typeFilter)),
    [distributions, typeFilter]
  );

  const padStats = useMemo(() => {
    const pads = padDrives.reduce((s, p) => s + (p.padsDistributed ?? 0), 0);
    const girls = padDrives.reduce((s, p) => s + (p.girlsCount ?? 0), 0);
    const sessions = padDrives.filter((p) => p.awarenessSession).length;
    const schools = new Set(padDrives.map((p) => p.schoolName).filter(Boolean)).size;
    return { pads, girls, sessions, schools };
  }, [padDrives]);

  /* --------------------------- general distributions ------------------------ */

  const openDistDialog = () => {
    setDistForm(EMPTY_DIST_FORM);
    setDistDialog(true);
  };

  const saveDist = async () => {
    if (!distForm.location.trim()) return toast.error("Location is required");
    const qty = Math.trunc(Number(distForm.quantity));
    if (!Number.isFinite(qty) || qty < 1) return toast.error("Quantity must be at least 1");
    setSavingDist(true);
    try {
      const items = distForm.items.filter((i) => i.name.trim());
      await post("/api/distributions", {
        type: distForm.type,
        beneficiaryId: distForm.beneficiaryId || undefined,
        quantity: qty,
        items: items.length
          ? items.map((i) => ({ name: i.name.trim(), qty: Number(i.qty) || 1 }))
          : undefined,
        value: distForm.value === "" ? undefined : Number(distForm.value),
        location: distForm.location.trim(),
        notes: distForm.notes.trim() || undefined,
      });
      toast.success("Distribution recorded");
      setDistDialog(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Record failed");
    } finally {
      setSavingDist(false);
    }
  };

  const removeDist = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/distributions/${deleteTarget.id}`);
      toast.success("Distribution deleted");
      setDeleteTarget(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* ------------------------------ pad drives -------------------------------- */

  const openPadDialog = () => {
    setPadForm(EMPTY_PAD_FORM);
    setPadDialog(true);
  };

  const savePad = async () => {
    if (!padForm.area.trim()) return toast.error("Area is required");
    const girls = Math.trunc(Number(padForm.girlsCount));
    const pads = Math.trunc(Number(padForm.padsDistributed));
    if (!Number.isFinite(girls) || girls < 0) return toast.error("Girls count must be 0 or more");
    if (!Number.isFinite(pads) || pads < 0) return toast.error("Pads distributed must be 0 or more");
    setSavingPad(true);
    try {
      await post("/api/pad-distributions", {
        area: padForm.area.trim(),
        schoolName: padForm.schoolName.trim() || undefined,
        girlsCount: girls,
        padsDistributed: pads,
        awarenessSession: padForm.awarenessSession,
        sessionAttendees:
          padForm.sessionAttendees === "" ? undefined : Math.trunc(Number(padForm.sessionAttendees)),
        notes: padForm.notes.trim() || undefined,
      });
      toast.success("Pad drive recorded");
      setPadDialog(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Record failed");
    } finally {
      setSavingPad(false);
    }
  };

  const removePad = async () => {
    if (!deletePad) return;
    try {
      await del(`/api/pad-distributions/${deletePad.id}`);
      toast.success("Pad drive deleted");
      setDeletePad(null);
      setPadSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distributions"
        description="Field distributions to beneficiaries and sanitary pad awareness drives."
        icon={<Package className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={load} aria-label="Refresh distributions">
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      {/* muted banner — pads live here */}
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Sparkles className="size-4 shrink-0 text-pink-600 dark:text-pink-400" aria-hidden="true" />
        Sanitary pads initiative lives here — use the <strong>Pad drives</strong> tab below.
      </div>

      <Tabs defaultValue="general">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="general">General distributions ({distributions.length})</TabsTrigger>
          <TabsTrigger value="pads">Pad drives ({padDrives.length})</TabsTrigger>
        </TabsList>

        {/* =========================== GENERAL TAB =========================== */}
        <TabsContent value="general" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {["ALL", ...DISTRIBUTION_TYPES].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  aria-pressed={typeFilter === t}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    typeFilter === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {t === "ALL" ? "All" : titleCase(t)}
                </button>
              ))}
            </div>
            <Button size="sm" className="ml-auto" onClick={openDistDialog}>
              <Plus className="size-4" aria-hidden="true" /> Record distribution
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : filteredDist.length === 0 ? (
            <EmptyState
              icon={<Package className="size-8" aria-hidden="true" />}
              title={distributions.length === 0 ? "No distributions recorded" : "No distributions match this type"}
              hint="Record a field distribution so stock levels and impact stats stay accurate."
            >
              <Button variant="outline" onClick={openDistDialog}>
                <Plus className="size-4" aria-hidden="true" /> Record distribution
              </Button>
            </EmptyState>
          ) : (
            <>
              {/* mobile cards */}
              <ul className="space-y-2 sm:hidden">
                {filteredDist.map((d) => (
                  <li key={d.id} className="rounded-lg border p-3">
                    <button type="button" className="w-full text-left" onClick={() => setSheet(d)} aria-label="Open distribution">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn(TYPE_CLS[d.type] ?? TYPE_CLS.OTHER)}>
                          {titleCase(d.type)}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">{formatDate(d.distributedAt)}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium">
                        {d.beneficiary?.name ?? "Community"} × {d.quantity}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {d.location || "—"}
                        {d.volunteer?.user?.name ? ` · ${d.volunteer.user.name}` : ""}
                      </p>
                    </button>
                    <div className="mt-2 flex gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => setSheet(d)} aria-label="View">
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto text-red-600 hover:bg-red-500/10 dark:text-red-400"
                        onClick={() => setDeleteTarget(d)}
                        aria-label="Delete distribution"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {/* desktop table */}
              <div className="hidden overflow-x-auto rounded-lg border sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Beneficiary</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Volunteer</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDist.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(d.distributedAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(TYPE_CLS[d.type] ?? TYPE_CLS.OTHER)}>
                            {titleCase(d.type)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <button type="button" className="font-medium hover:text-primary" onClick={() => setSheet(d)} aria-label="Open distribution">
                            {d.beneficiary?.name ?? "Community"}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">{d.quantity}</TableCell>
                        <TableCell className="text-right">{d.value != null ? formatINR(d.value) : "—"}</TableCell>
                        <TableCell className="max-w-40 truncate">{d.location || "—"}</TableCell>
                        <TableCell>{d.volunteer?.user?.name ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => setSheet(d)} aria-label="View distribution">
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              onClick={() => setDeleteTarget(d)}
                              aria-label="Delete distribution"
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        {/* ============================ PAD DRIVES ============================ */}
        <TabsContent value="pads" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Pads distributed" value={padStats.pads.toLocaleString("en-IN")} accent="pink" icon={<Sparkles className="size-5" aria-hidden="true" />} loading={loading} />
            <StatCard label="Girls reached" value={padStats.girls.toLocaleString("en-IN")} accent="fuchsia" icon={<Sparkles className="size-5" aria-hidden="true" />} loading={loading} />
            <StatCard label="Awareness sessions" value={padStats.sessions} accent="teal" icon={<Sparkles className="size-5" aria-hidden="true" />} loading={loading} />
            <StatCard label="Schools covered" value={padStats.schools} accent="amber" icon={<Package className="size-5" aria-hidden="true" />} loading={loading} />
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={openPadDialog}>
              <Plus className="size-4" aria-hidden="true" /> Record pad drive
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : padDrives.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" aria-hidden="true" />}
              title="No pad drives yet"
              hint="Record school visits with pads distributed and awareness session counts."
            >
              <Button variant="outline" onClick={openPadDialog}>
                <Plus className="size-4" aria-hidden="true" /> Record pad drive
              </Button>
            </EmptyState>
          ) : (
            <>
              {/* mobile cards */}
              <ul className="space-y-2 sm:hidden">
                {padDrives.map((p) => (
                  <li key={p.id} className="rounded-lg border p-3">
                    <button type="button" className="w-full text-left" onClick={() => setPadSheet(p)} aria-label="Open pad drive">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{p.area}</p>
                        {p.awarenessSession ? (
                          <Badge variant="outline" className="ml-auto shrink-0 border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                            Session
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(p.distributionDate)} · {p.schoolName || "Community visit"}
                      </p>
                      <p className="mt-1 text-sm">
                        {p.padsDistributed} pads · {p.girlsCount} girls
                      </p>
                    </button>
                    <div className="mt-2 flex gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => setPadSheet(p)} aria-label="View">
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto text-red-600 hover:bg-red-500/10 dark:text-red-400"
                        onClick={() => setDeletePad(p)}
                        aria-label="Delete pad drive"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {/* desktop table */}
              <div className="hidden overflow-x-auto rounded-lg border sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead className="text-right">Girls</TableHead>
                      <TableHead className="text-right">Pads</TableHead>
                      <TableHead>Session</TableHead>
                      <TableHead className="text-right">Attendees</TableHead>
                      <TableHead>Volunteer</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {padDrives.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(p.distributionDate)}</TableCell>
                        <TableCell className="font-medium">{p.area}</TableCell>
                        <TableCell className="max-w-44 truncate">{p.schoolName || "—"}</TableCell>
                        <TableCell className="text-right">{p.girlsCount}</TableCell>
                        <TableCell className="text-right">{p.padsDistributed}</TableCell>
                        <TableCell>
                          {p.awarenessSession ? (
                            <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                              Yes
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{p.sessionAttendees ?? "—"}</TableCell>
                        <TableCell>{p.volunteer?.name ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => setPadSheet(p)} aria-label="View pad drive">
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              onClick={() => setDeletePad(p)}
                              aria-label="Delete pad drive"
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ========================= DISTRIBUTION SHEET ========================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  Distribution
                  <Badge variant="outline" className={cn("ml-auto", TYPE_CLS[sheet.type] ?? TYPE_CLS.OTHER)}>
                    {titleCase(sheet.type)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>{formatDateTime(sheet.distributedAt)}</SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Beneficiary" value={sheet.beneficiary?.name ?? "Community hand-out"} />
                <DataField label="Quantity" value={String(sheet.quantity)} />
                <DataField label="Value" value={sheet.value != null ? formatINR(sheet.value) : "—"} />
                <DataField label="Volunteer" value={sheet.volunteer?.user?.name ?? "—"} />
                <DataField label="Location" value={sheet.location || "—"} />
                <DataField label="Campaign" value={sheet.campaign?.title ?? "—"} />
              </div>

              <SectionCard title="Items">
                {parseItems(sheet.items).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No item breakdown recorded.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {parseItems(sheet.items).map((i, idx) => (
                      <li key={idx} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5">
                        <span className="min-w-0 truncate">{String(i?.name ?? i)}</span>
                        <span className="shrink-0 font-medium text-muted-foreground">
                          {String(i?.qty ?? "×1")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              {sheet.notes ? (
                <SectionCard title="Notes">
                  <p className="text-sm leading-relaxed text-muted-foreground">{sheet.notes}</p>
                </SectionCard>
              ) : null}

              <div className="flex gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setDeleteTarget(sheet)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ PAD DRIVE SHEET =========================== */}
      <Sheet open={!!padSheet} onOpenChange={(o) => !o && setPadSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {padSheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  Pad drive
                  {padSheet.awarenessSession ? (
                    <Badge variant="outline" className="ml-auto border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                      Awareness session
                    </Badge>
                  ) : null}
                </SheetTitle>
                <SheetDescription>{formatDateTime(padSheet.distributionDate)}</SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Area" value={padSheet.area} />
                <DataField label="School" value={padSheet.schoolName || "Community visit"} />
                <DataField label="Girls reached" value={String(padSheet.girlsCount)} />
                <DataField label="Pads distributed" value={String(padSheet.padsDistributed)} />
                <DataField label="Session attendees" value={padSheet.sessionAttendees != null ? String(padSheet.sessionAttendees) : "—"} />
                <DataField label="Volunteer" value={padSheet.volunteer?.name ?? "—"} />
              </div>

              {padSheet.notes ? (
                <SectionCard title="Notes">
                  <p className="text-sm leading-relaxed text-muted-foreground">{padSheet.notes}</p>
                </SectionCard>
              ) : null}

              <div className="flex gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setDeletePad(padSheet)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ======================== RECORD DISTRIBUTION DIALOG ==================== */}
      <Dialog open={distDialog} onOpenChange={setDistDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record distribution</DialogTitle>
            <DialogDescription>
              Logged against your volunteer profile. Attribution is automatic.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={distForm.type} onValueChange={(v) => setDistForm({ ...distForm, type: v })}>
                  <SelectTrigger aria-label="Distribution type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISTRIBUTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {titleCase(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dist-beneficiary">Beneficiary</Label>
                <Select
                  value={distForm.beneficiaryId || "NONE"}
                  onValueChange={(v) => setDistForm({ ...distForm, beneficiaryId: v === "NONE" ? "" : v })}
                >
                  <SelectTrigger id="dist-beneficiary" aria-label="Beneficiary">
                    <SelectValue placeholder="Community hand-out" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Community hand-out (none)</SelectItem>
                    {beneficiaries.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                        {b.city ? ` — ${b.city}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dist-qty">Quantity *</Label>
                <Input
                  id="dist-qty"
                  type="number"
                  min={1}
                  value={distForm.quantity}
                  onChange={(e) => setDistForm({ ...distForm, quantity: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dist-value">Value (₹)</Label>
                <Input
                  id="dist-value"
                  type="number"
                  min={0}
                  value={distForm.value}
                  onChange={(e) => setDistForm({ ...distForm, value: e.target.value })}
                  placeholder="Estimated value"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Item breakdown</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDistForm((f) => ({ ...f, items: [...f.items, { name: "", qty: "1" }] }))}
                  aria-label="Add item row"
                >
                  <Plus className="size-3.5" aria-hidden="true" /> Add item
                </Button>
              </div>
              <div className="space-y-2">
                {distForm.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_72px_36px] items-center gap-2">
                    <Input
                      value={item.name}
                      onChange={(e) =>
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, name: e.target.value } : it)),
                        }))
                      }
                      placeholder="Rice (5kg bags)"
                      aria-label={`Item ${i + 1} name`}
                    />
                    <Input
                      type="number"
                      min={0}
                      value={item.qty}
                      onChange={(e) =>
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, qty: e.target.value } : it)),
                        }))
                      }
                      aria-label={`Item ${i + 1} quantity`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setDistForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}
                      aria-label={`Remove item ${i + 1}`}
                      disabled={distForm.items.length <= 1}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dist-location">Location *</Label>
              <Input
                id="dist-location"
                value={distForm.location}
                onChange={(e) => setDistForm({ ...distForm, location: e.target.value })}
                placeholder="Ambedkar Nagar community hall"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dist-notes">Notes</Label>
              <Textarea
                id="dist-notes"
                rows={2}
                value={distForm.notes}
                onChange={(e) => setDistForm({ ...distForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDistDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveDist} disabled={savingDist}>
              {savingDist ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================== RECORD PAD DRIVE DIALOG ===================== */}
      <Dialog open={padDialog} onOpenChange={setPadDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record pad drive</DialogTitle>
            <DialogDescription>
              School or community visit with pads distributed and optional awareness session.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pad-area">Area *</Label>
                <Input
                  id="pad-area"
                  value={padForm.area}
                  onChange={(e) => setPadForm({ ...padForm, area: e.target.value })}
                  placeholder="Yelahanka, Bengaluru"
                />
              </div>
              {schoolOptions ? (
                <div className="grid gap-2">
                  <Label>School</Label>
                  <Select value={padForm.schoolName || "NONE"} onValueChange={(v) => setPadForm({ ...padForm, schoolName: v === "NONE" ? "" : v })}>
                    <SelectTrigger aria-label="School">
                      <SelectValue placeholder="Community visit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Community visit (none)</SelectItem>
                      {schoolOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="pad-school">School</Label>
                  <Input
                    id="pad-school"
                    value={padForm.schoolName}
                    onChange={(e) => setPadForm({ ...padForm, schoolName: e.target.value })}
                    placeholder="Govt. High School, Yelahanka"
                  />
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pad-girls">Girls reached *</Label>
                <Input
                  id="pad-girls"
                  type="number"
                  min={0}
                  value={padForm.girlsCount}
                  onChange={(e) => setPadForm({ ...padForm, girlsCount: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pad-pads">Pads distributed *</Label>
                <Input
                  id="pad-pads"
                  type="number"
                  min={0}
                  value={padForm.padsDistributed}
                  onChange={(e) => setPadForm({ ...padForm, padsDistributed: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="pad-session" className="text-sm">
                  Awareness session conducted
                </Label>
                <p className="text-xs text-muted-foreground">Menstrual health &amp; hygiene talk.</p>
              </div>
              <Switch
                id="pad-session"
                checked={padForm.awarenessSession}
                onCheckedChange={(v) => setPadForm({ ...padForm, awarenessSession: v })}
                aria-label="Awareness session conducted"
              />
            </div>
            {padForm.awarenessSession && (
              <div className="grid gap-2">
                <Label htmlFor="pad-attendees">Session attendees</Label>
                <Input
                  id="pad-attendees"
                  type="number"
                  min={0}
                  value={padForm.sessionAttendees}
                  onChange={(e) => setPadForm({ ...padForm, sessionAttendees: e.target.value })}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="pad-notes">Notes</Label>
              <Textarea
                id="pad-notes"
                rows={2}
                value={padForm.notes}
                onChange={(e) => setPadForm({ ...padForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPadDialog(false)}>
              Cancel
            </Button>
            <Button onClick={savePad} disabled={savingPad}>
              {savingPad ? "Saving…" : "Record drive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ DELETE CONFIRMS =========================== */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this distribution?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${titleCase(deleteTarget.type)} × ${deleteTarget.quantity} at ${deleteTarget.location ?? "unknown location"}.`
                : ""}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep record</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                removeDist();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletePad} onOpenChange={(o) => !o && setDeletePad(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pad drive?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletePad
                ? `${deletePad.area} — ${deletePad.padsDistributed} pads, ${deletePad.girlsCount} girls.`
                : ""}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep record</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                removePad();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
