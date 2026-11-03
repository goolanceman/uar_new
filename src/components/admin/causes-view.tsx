"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  HandCoins,
  HeartPulse,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatINR, titleCase } from "@/lib/format";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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

/* ---------------------------------- types ---------------------------------- */

interface Pledge {
  id: string;
  donorName: string;
  amountPerMonth: number;
  months: number;
  status: string;
}

interface Cause {
  id: string;
  code: string;
  patientName: string;
  age: number;
  city: string;
  condition: string;
  monthlyCost: number;
  durationMonths: number;
  story: string;
  status: string;
  raised: number;
  adoptedById?: string | null;
  adoptedByName?: string | null;
  pledges?: Pledge[];
}

interface CauseForm {
  patientName: string;
  age: string;
  city: string;
  condition: string;
  monthlyCost: string;
  durationMonths: string;
  story: string;
}

/* ------------------------------- chip styles ------------------------------- */

const CAUSE_STATUS: Record<string, string> = {
  SEEKING: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PARTIAL: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  ADOPTED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PAUSED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const PLEDGE_STATUS: Record<string, string> = {
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  COMPLETED: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  CANCELLED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const EMPTY_FORM: CauseForm = {
  patientName: "",
  age: "",
  city: "",
  condition: "BP",
  monthlyCost: "",
  durationMonths: "12",
  story: "",
};

/* ---------------------------------- view ----------------------------------- */

export default function CausesView() {
  const [causes, setCauses] = useState<Cause[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [conditionFilter, setConditionFilter] = useState("ALL");
  const [citySearch, setCitySearch] = useState("");

  const [sheet, setSheet] = useState<Cause | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Cause | null>(null);
  const [form, setForm] = useState<CauseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Cause | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);

  const cityOptions = useMasters("CITY");
  const conditionOptions = useMasters("CONDITION");

  const load = useCallback(async () => {
    try {
      const data = await get<Cause[]>("/api/causes");
      setCauses(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load causes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* client-side filters (status / condition / city search) */
  const filtered = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    return causes.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (conditionFilter !== "ALL" && c.condition !== conditionFilter) return false;
      if (q && !`${c.city ?? ""}`.toLowerCase().includes(q) && !`${c.patientName}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [causes, statusFilter, conditionFilter, citySearch]);

  const stats = useMemo(() => {
    const seeking = causes.filter((c) => c.status === "SEEKING" || c.status === "PARTIAL").length;
    const adopted = causes.filter((c) => c.status === "ADOPTED").length;
    const monthly = causes
      .flatMap((c) => c.pledges ?? [])
      .filter((pl) => pl.status === "ACTIVE")
      .reduce((s, pl) => s + (pl.amountPerMonth || 0), 0);
    return { seeking, adopted, monthly, total: causes.length };
  }, [causes]);

  /* ------------------------------ form actions ----------------------------- */

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, city: cityOptions.options[0]?.value ?? "" });
    setDialogOpen(true);
  };

  const openEdit = (c: Cause) => {
    setEditing(c);
    setForm({
      patientName: c.patientName ?? "",
      age: String(c.age ?? ""),
      city: c.city ?? "",
      condition: c.condition ?? "BP",
      monthlyCost: String(c.monthlyCost ?? ""),
      durationMonths: String(c.durationMonths ?? 12),
      story: c.story ?? "",
    });
    setDialogOpen(true);
  };

  const validate = (): string | null => {
    if (!form.patientName.trim()) return "Patient name is required";
    if (!form.city.trim()) return "City is required";
    if (!form.story.trim()) return "A short story is required";
    const age = Number(form.age);
    if (!Number.isFinite(age) || age < 0 || age > 120) return "Age must be between 0 and 120";
    const cost = Number(form.monthlyCost);
    if (!Number.isFinite(cost) || cost <= 0) return "Monthly cost must be greater than 0";
    const dur = Number(form.durationMonths);
    if (!Number.isFinite(dur) || dur < 1 || dur > 120) return "Duration must be between 1 and 120 months";
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const body = {
        patientName: form.patientName.trim(),
        age: Number(form.age),
        city: form.city.trim(),
        condition: form.condition,
        monthlyCost: Number(form.monthlyCost),
        durationMonths: Number(form.durationMonths),
        story: form.story.trim(),
      };
      if (editing) {
        await patch(`/api/causes/${editing.id}`, body);
        toast.success(`Cause ${editing.code} updated`);
      } else {
        await post("/api/causes", body);
        toast.success("Medicine cause created — code UAR-MED-#### assigned automatically");
      }
      setDialogOpen(false);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (c: Cause) => {
    const next = c.status === "PAUSED" ? "SEEKING" : "PAUSED";
    try {
      await patch(`/api/causes/${c.id}`, { status: next });
      toast.success(`${c.code} ${next === "PAUSED" ? "paused" : "resumed"}`);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/causes/${deleteTarget.id}`);
      toast.success(`${deleteTarget.code} deleted`);
      setDeleteTarget(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const issueCertificate = async (c: Cause) => {
    if (!c.adoptedByName) {
      toast.error("This cause has no adopter recorded yet");
      return;
    }
    setIssuing(c.id);
    try {
      const res = await post<{ certificate?: { code?: string } }>("/api/certificates", {
        type: "MEDICINE_SPONSOR",
        recipientName: c.adoptedByName,
        userId: c.adoptedById ?? undefined,
        refType: "PLEDGE",
        refId: c.id,
        title: "Medicine Sponsorship Certificate",
        description: `Monthly medicine support for ${c.patientName} (${c.code})`,
        meta: JSON.stringify({ cause: c.code, patient: c.patientName, condition: c.condition }),
      });
      const code = res?.certificate?.code;
      if (code) {
        toast.success(`Certificate ${code} issued to ${c.adoptedByName}`, {
          action: {
            label: "Open",
            onClick: () => window.open(`/api/certificates/${code}/html`, "_blank"),
          },
        });
      } else {
        toast.success("Sponsorship certificate issued");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Certificate failed");
    } finally {
      setIssuing(null);
    }
  };

  const totalCost = (c: Cause) => (c.monthlyCost ?? 0) * (c.durationMonths ?? 0);

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Adopt-a-Medicine"
        description="Monthly medicine causes that donors can adopt until a patient recovers."
        icon={<HeartPulse className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={load} aria-label="Refresh causes">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> New cause
            </Button>
          </>
        }
      />

      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total causes" value={stats.total} accent="teal" icon={<HeartPulse className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Seeking / partial" value={stats.seeking} accent="amber" icon={<HandCoins className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Adopted" value={stats.adopted} accent="emerald" icon={<UserCheck className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Monthly pledged" value={formatINR(stats.monthly)} accent="pink" icon={<HandCoins className="size-5" aria-hidden="true" />} loading={loading} hint="Sum of active pledges" />
      </div>

      {/* filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="SEEKING">Seeking</SelectItem>
            <SelectItem value="PARTIAL">Partial</SelectItem>
            <SelectItem value="ADOPTED">Adopted</SelectItem>
            <SelectItem value="PAUSED">Paused</SelectItem>
          </SelectContent>
        </Select>
        <Select value={conditionFilter} onValueChange={setConditionFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by condition">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All conditions</SelectItem>
            {conditionOptions.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={citySearch}
          onChange={(e) => setCitySearch(e.target.value)}
          placeholder="Search patient or city…"
          aria-label="Search patient or city"
          className="w-full sm:max-w-xs"
        />
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {filtered.length} of {causes.length} causes
        </p>
      </div>

      {/* cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<HeartPulse className="size-8" aria-hidden="true" />}
          title={causes.length === 0 ? "No medicine causes yet" : "No causes match the filters"}
          hint={
            causes.length === 0
              ? "Create a cause so donors can adopt a patient's monthly medicine cost."
              : "Try clearing the status, condition or city filters."
          }
        >
          {causes.length === 0 && (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> New cause
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const pct =
              totalCost(c) > 0
                ? Math.min(100, Math.round(((c.raised || 0) / totalCost(c)) * 100))
                : 0;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSheet(c)}
                aria-label={`Open details for ${c.code} — ${c.patientName}`}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-teal-500/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                  <Badge variant="outline" className={cn("ml-auto", CAUSE_STATUS[c.status] ?? CAUSE_STATUS.SEEKING)}>
                    {titleCase(c.status)}
                  </Badge>
                </div>
                <div>
                  <p className="font-semibold leading-tight">{c.patientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.age} yrs · {c.city}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                    {labelOf(conditionOptions.options, c.condition)}
                  </Badge>
                  <Badge variant="outline">
                    <HandCoins className="size-3" aria-hidden="true" />
                    {(c.pledges ?? []).length} pledge{(c.pledges ?? []).length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="mt-auto space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-teal-700 dark:text-teal-400">{formatINR(c.monthlyCost)}/mo</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.durationMonths} mo · {formatINR(c.raised)} raised
                    </span>
                  </div>
                  <Progress
                    value={pct}
                    className="h-2 [&>div]:bg-teal-600"
                    aria-label={`${pct}% of total medicine cost raised`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ============================== DETAIL SHEET ============================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm">{sheet.code}</span>
                  <Badge variant="outline" className={cn("ml-auto", CAUSE_STATUS[sheet.status] ?? CAUSE_STATUS.SEEKING)}>
                    {titleCase(sheet.status)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>Medicine sponsorship case · {sheet.city}</SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Patient" value={sheet.patientName} />
                <DataField label="Age" value={`${sheet.age} years`} />
                <DataField label="City" value={sheet.city} />
                <DataField
                  label="Condition"
                  value={
                    <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                      {labelOf(conditionOptions.options, sheet.condition)}
                    </Badge>
                  }
                />
                <DataField label="Monthly cost" value={`${formatINR(sheet.monthlyCost)} / mo`} />
                <DataField label="Duration" value={`${sheet.durationMonths} months`} />
                <DataField label="Raised so far" value={formatINR(sheet.raised)} />
                <DataField label="Total needed" value={formatINR(totalCost(sheet))} />
              </div>

              <SectionCard title="Progress">
                <Progress
                  value={totalCost(sheet) > 0 ? Math.min(100, Math.round(((sheet.raised || 0) / totalCost(sheet)) * 100)) : 0}
                  className="h-2.5 [&>div]:bg-teal-600"
                  aria-label="Fundraising progress"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatINR(sheet.raised)} of {formatINR(totalCost(sheet))} ({sheet.durationMonths} × {formatINR(sheet.monthlyCost)})
                </p>
              </SectionCard>

              <SectionCard title="Story">
                <p className="text-sm leading-relaxed text-muted-foreground">{sheet.story}</p>
              </SectionCard>

              {sheet.adoptedByName ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                    <UserCheck className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Adopted by</p>
                    <p className="truncate text-sm font-semibold">{sheet.adoptedByName}</p>
                  </div>
                </div>
              ) : null}

              <SectionCard title={`Pledges (${(sheet.pledges ?? []).length})`}>
                {(sheet.pledges ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pledges yet — donors can pledge from the public cause page.</p>
                ) : (
                  <ul className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                    {(sheet.pledges ?? []).map((pl) => (
                      <li key={pl.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{pl.donorName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatINR(pl.amountPerMonth)}/mo × {pl.months} mo
                          </p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", PLEDGE_STATUS[pl.status] ?? "")}>
                          {titleCase(pl.status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button variant="outline" size="sm" onClick={() => openEdit(sheet)}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => togglePause(sheet)}
                  aria-label={sheet.status === "PAUSED" ? "Resume cause" : "Pause cause"}
                >
                  {sheet.status === "PAUSED" ? (
                    <Play className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Pause className="size-3.5" aria-hidden="true" />
                  )}
                  {sheet.status === "PAUSED" ? "Resume" : "Pause"}
                </Button>
                {sheet.status === "ADOPTED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                    onClick={() => issueCertificate(sheet)}
                    disabled={issuing === sheet.id}
                  >
                    <Award className="size-3.5" aria-hidden="true" />
                    {issuing === sheet.id ? "Issuing…" : "Issue certificate"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                  onClick={() => setDeleteTarget(sheet)}
                  aria-label={`Delete ${sheet.code}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ CREATE / EDIT ============================= */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : "New medicine cause"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update patient details or costs — active pledges are not affected."
                : "Donors adopt a patient's full monthly medicine cost. The code (UAR-MED-####) is generated automatically."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cause-name">Patient name *</Label>
                <Input
                  id="cause-name"
                  value={form.patientName}
                  onChange={(e) => setForm({ ...form, patientName: e.target.value })}
                  placeholder="Lakshmi Devi"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cause-age">Age (years) *</Label>
                <Input
                  id="cause-age"
                  type="number"
                  min={0}
                  max={120}
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                  placeholder="62"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>City *</Label>
                <Select value={form.city || undefined} onValueChange={(v) => setForm({ ...form, city: v })}>
                  <SelectTrigger aria-label="City">
                    <SelectValue placeholder="Select city" />
                  </SelectTrigger>
                  <SelectContent>
                    {cityOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Condition</Label>
                <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                  <SelectTrigger aria-label="Condition">
                    <SelectValue placeholder="Select condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {conditionOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cause-cost">Monthly cost (₹) *</Label>
                <Input
                  id="cause-cost"
                  type="number"
                  min={1}
                  value={form.monthlyCost}
                  onChange={(e) => setForm({ ...form, monthlyCost: e.target.value })}
                  placeholder="2400"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cause-duration">Duration (months) *</Label>
                <Input
                  id="cause-duration"
                  type="number"
                  min={1}
                  max={120}
                  value={form.durationMonths}
                  onChange={(e) => setForm({ ...form, durationMonths: e.target.value })}
                />
              </div>
            </div>
            {form.monthlyCost && form.durationMonths && (
              <p className="text-xs text-muted-foreground">
                Total sponsorship value: {formatINR(Number(form.monthlyCost) * Number(form.durationMonths))}
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="cause-story">Story *</Label>
              <Textarea
                id="cause-story"
                rows={3}
                value={form.story}
                onChange={(e) => setForm({ ...form, story: e.target.value })}
                placeholder="Widowed, lives alone, needs BP + thyroid medicines every month…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create cause"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ DELETE CONFIRM ============================ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cause?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.code} — {deleteTarget?.patientName}. This permanently removes the cause
              and its pledge history. Consider pausing instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep cause</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                remove();
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
