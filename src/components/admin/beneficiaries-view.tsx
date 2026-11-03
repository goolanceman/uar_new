"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HeartHandshake,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { formatDateTime, formatINR, titleCase } from "@/lib/format";
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

interface Beneficiary {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
  monthlyIncome?: number | null;
  monthlyNeed?: number | null;
  needs?: string | null;
  documents?: string | null;
  notes?: string | null;
  isActive: boolean;
  onboardedByName?: string | null;
  createdAt?: string;
}

interface DistributionRow {
  id: string;
  type: string;
  beneficiaryId?: string | null;
  quantity: number;
  value?: number | null;
  location?: string | null;
  distributedAt: string;
  beneficiary?: { name: string } | null;
  volunteer?: { user?: { name: string } | null } | null;
}

interface BenForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  category: string;
  urgencyLevel: string;
  familyMembers: string;
  monthlyIncome: string;
  monthlyNeed: string;
  needs: string;
  documents: string;
  notes: string;
}

/* ------------------------------- chip styles ------------------------------- */

const URGENCY: Record<string, string> = {
  CRITICAL: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400 animate-pulse",
  HIGH: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  MEDIUM: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  LOW: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

const CATEGORIES = [
  "WIDOW",
  "ORPHAN",
  "STUDENT",
  "ELDERLY",
  "DISABLED",
  "SINGLE_MOTHER",
  "POOR_FAMILY",
  "PATIENT",
  "DAILY_WAGE",
  "OTHER",
];

const URGENCIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const EMPTY_FORM: BenForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "Karnataka",
  pincode: "",
  category: "OTHER",
  urgencyLevel: "MEDIUM",
  familyMembers: "1",
  monthlyIncome: "",
  monthlyNeed: "",
  needs: "",
  documents: "",
  notes: "",
};

/* ---------------------------------- view ----------------------------------- */

export default function BeneficiariesView() {
  const [rows, setRows] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const [sheet, setSheet] = useState<Beneficiary | null>(null);
  const [sheetDistributions, setSheetDistributions] = useState<DistributionRow[]>([]);
  const [sheetDistributionsLoading, setSheetDistributionsLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Beneficiary | null>(null);
  const [form, setForm] = useState<BenForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Beneficiary | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<Beneficiary[]>("/api/beneficiaries");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load beneficiaries");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((b) => {
      if (categoryFilter !== "ALL" && b.category !== categoryFilter) return false;
      if (urgencyFilter !== "ALL" && b.urgencyLevel !== urgencyFilter) return false;
      if (q) {
        const hay = `${b.name} ${b.city ?? ""} ${b.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, categoryFilter, urgencyFilter, search]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      critical: rows.filter((b) => b.urgencyLevel === "CRITICAL").length,
      active: rows.filter((b) => b.isActive).length,
      monthlyNeed: rows.reduce((s, b) => s + (b.monthlyNeed ?? 0), 0),
    }),
    [rows]
  );

  /* open sheet + load its distributions */
  const openSheet = (b: Beneficiary) => {
    setSheet(b);
    setSheetDistributionsLoading(true);
    get<DistributionRow[]>("/api/distributions?limit=200")
      .then((data) =>
        setSheetDistributions(
          (Array.isArray(data) ? data : []).filter((d) => d.beneficiaryId === b.id)
        )
      )
      .catch(() => setSheetDistributions([]))
      .finally(() => setSheetDistributionsLoading(false));
  };

  /* ------------------------------ form actions ----------------------------- */

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (b: Beneficiary) => {
    setEditing(b);
    setForm({
      name: b.name ?? "",
      phone: b.phone ?? "",
      email: b.email ?? "",
      address: b.address ?? "",
      city: b.city ?? "",
      state: b.state ?? "",
      pincode: b.pincode ?? "",
      category: b.category ?? "OTHER",
      urgencyLevel: b.urgencyLevel ?? "MEDIUM",
      familyMembers: String(b.familyMembers ?? 1),
      monthlyIncome: b.monthlyIncome != null ? String(b.monthlyIncome) : "",
      monthlyNeed: b.monthlyNeed != null ? String(b.monthlyNeed) : "",
      needs: b.needs ?? "",
      documents: b.documents ?? "",
      notes: b.notes ?? "",
    });
    setDialogOpen(true);
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return "Name is required";
    if (form.phone && !/^\d{10}$/.test(form.phone.replace(/\D/g, ""))) return "Phone must be a 10-digit number";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Email looks invalid";
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) return "Pincode must be exactly 6 digits";
    const fam = Number(form.familyMembers);
    if (!Number.isFinite(fam) || fam < 0) return "Family members must be 0 or more";
    const inc = Number(form.monthlyIncome);
    if (form.monthlyIncome && (!Number.isFinite(inc) || inc < 0)) return "Monthly income must be 0 or more";
    const need = Number(form.monthlyNeed);
    if (form.monthlyNeed && (!Number.isFinite(need) || need < 0)) return "Monthly need must be 0 or more";
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
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        category: form.category,
        urgencyLevel: form.urgencyLevel,
        familyMembers: Math.trunc(Number(form.familyMembers) || 1),
        monthlyIncome: form.monthlyIncome === "" ? undefined : Number(form.monthlyIncome),
        monthlyNeed: form.monthlyNeed === "" ? undefined : Number(form.monthlyNeed),
        needs: form.needs.trim() || undefined,
        documents: form.documents.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      if (editing) {
        await patch(`/api/beneficiaries/${editing.id}`, body);
        toast.success(`${body.name} updated`);
      } else {
        await post("/api/beneficiaries", body);
        toast.success(`${body.name} onboarded`);
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

  const toggleActive = async (b: Beneficiary) => {
    setToggling(b.id);
    try {
      await patch(`/api/beneficiaries/${b.id}`, { isActive: !b.isActive });
      toast.success(`${b.name} ${b.isActive ? "deactivated" : "activated"}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setToggling(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/beneficiaries/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed`);
      setDeleteTarget(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const rowActions = (b: Beneficiary) => (
    <>
      <Button variant="outline" size="sm" onClick={() => openEdit(b)} aria-label={`Edit ${b.name}`}>
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
        onClick={() => setDeleteTarget(b)}
        aria-label={`Delete ${b.name}`}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </>
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficiaries"
        description="Families and individuals onboarded for UAR support programmes."
        icon={<HeartHandshake className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={load} aria-label="Refresh beneficiaries">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> Onboard
            </Button>
          </>
        }
      />

      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="On register" value={stats.total} accent="emerald" icon={<HeartHandshake className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Active" value={stats.active} accent="teal" icon={<UserRound className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Critical cases" value={stats.critical} accent="red" icon={<HeartHandshake className="size-5" aria-hidden="true" />} loading={loading} hint="Need urgent support" />
        <StatCard label="Monthly need" value={formatINR(stats.monthlyNeed)} accent="amber" icon={<HeartHandshake className="size-5" aria-hidden="true" />} loading={loading} hint="Across all beneficiaries" />
      </div>

      {/* filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full lg:w-44" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {titleCase(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
          <SelectTrigger className="w-full lg:w-40" aria-label="Filter by urgency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All urgency</SelectItem>
            {URGENCIES.map((u) => (
              <SelectItem key={u} value={u}>
                {titleCase(u)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, city or phone…"
          aria-label="Search beneficiaries"
          className="w-full lg:max-w-xs"
        />
        <p className="text-xs text-muted-foreground lg:ml-auto">
          {filtered.length} of {rows.length} beneficiaries
        </p>
      </div>

      {/* list */}
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake className="size-8" aria-hidden="true" />}
          title={rows.length === 0 ? "No beneficiaries yet" : "No matches"}
          hint={
            rows.length === 0
              ? "Onboard your first beneficiary to start tracking distributions."
              : "Try clearing filters or searching a different name."
          }
        >
          {rows.length === 0 && (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> Onboard
            </Button>
          )}
        </EmptyState>
      ) : (
        <>
          {/* mobile cards */}
          <ul className="space-y-2 sm:hidden">
            {filtered.map((b) => (
              <li key={b.id} className="rounded-lg border p-3">
                <button type="button" className="w-full text-left" onClick={() => openSheet(b)} aria-label={`Open ${b.name}`}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{b.name}</span>
                    <Badge variant="outline" className={cn("ml-auto shrink-0", URGENCY[b.urgencyLevel] ?? URGENCY.MEDIUM)}>
                      {titleCase(b.urgencyLevel)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {titleCase(b.category)} · {b.city || "—"} · {b.familyMembers} in family
                  </p>
                </button>
                <div className="mt-2 flex items-center gap-1.5">
                  {rowActions(b)}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{b.isActive ? "Active" : "Inactive"}</span>
                    <Switch
                      checked={b.isActive}
                      disabled={toggling === b.id}
                      onCheckedChange={() => toggleActive(b)}
                      aria-label={`${b.isActive ? "Deactivate" : "Activate"} ${b.name}`}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="text-right">Family</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <button type="button" className="text-left font-medium hover:text-primary" onClick={() => openSheet(b)} aria-label={`Open ${b.name}`}>
                        {b.name}
                      </button>
                      {b.phone ? <span className="block text-xs text-muted-foreground">{b.phone}</span> : null}
                    </TableCell>
                    <TableCell>{titleCase(b.category)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(URGENCY[b.urgencyLevel] ?? URGENCY.MEDIUM)}>
                        {titleCase(b.urgencyLevel)}
                      </Badge>
                    </TableCell>
                    <TableCell>{b.city || "—"}</TableCell>
                    <TableCell className="text-right">{b.familyMembers}</TableCell>
                    <TableCell>
                      <Switch
                        checked={b.isActive}
                        disabled={toggling === b.id}
                        onCheckedChange={() => toggleActive(b)}
                        aria-label={`${b.isActive ? "Deactivate" : "Activate"} ${b.name}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">{rowActions(b)}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* ============================== DETAIL SHEET ============================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  {sheet.name}
                  <Badge variant="outline" className={cn("ml-auto", URGENCY[sheet.urgencyLevel] ?? URGENCY.MEDIUM)}>
                    {titleCase(sheet.urgencyLevel)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {titleCase(sheet.category)} · onboarded by {sheet.onboardedByName || "—"}
                </SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Phone" value={sheet.phone || "—"} icon={<Phone className="size-3.5" aria-hidden="true" />} mono />
                <DataField label="Email" value={sheet.email || "—"} />
                <DataField label="City" value={sheet.city || "—"} icon={<MapPin className="size-3.5" aria-hidden="true" />} />
                <DataField label="State" value={sheet.state || "—"} />
                <DataField label="Pincode" value={sheet.pincode || "—"} mono />
                <DataField label="Family members" value={String(sheet.familyMembers)} />
                <DataField label="Monthly income" value={sheet.monthlyIncome != null ? formatINR(sheet.monthlyIncome) : "—"} />
                <DataField label="Monthly need" value={sheet.monthlyNeed != null ? formatINR(sheet.monthlyNeed) : "—"} />
                <DataField label="Documents" value={sheet.documents || "—"} />
                <DataField label="Status" value={sheet.isActive ? "Active" : "Inactive"} />
              </div>

              {sheet.address ? (
                <SectionCard title="Address">
                  <p className="text-sm leading-relaxed text-muted-foreground">{sheet.address}</p>
                </SectionCard>
              ) : null}

              {sheet.needs ? (
                <SectionCard title="Needs">
                  <p className="text-sm leading-relaxed text-muted-foreground">{sheet.needs}</p>
                </SectionCard>
              ) : null}

              {sheet.notes ? (
                <SectionCard title="Notes">
                  <p className="text-sm leading-relaxed text-muted-foreground">{sheet.notes}</p>
                </SectionCard>
              ) : null}

              <SectionCard title={`Distributions (${sheetDistributions.length})`}>
                {sheetDistributionsLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-10 rounded-lg" />
                    ))}
                  </div>
                ) : sheetDistributions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No distributions recorded for this beneficiary yet.</p>
                ) : (
                  <ul className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                    {sheetDistributions.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {titleCase(d.type)} × {d.quantity}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(d.distributedAt)}
                            {d.location ? ` · ${d.location}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-medium">
                          {d.value != null ? formatINR(d.value) : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button variant="outline" size="sm" onClick={() => openEdit(sheet)}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Label htmlFor="sheet-active" className="text-xs text-muted-foreground">
                    {sheet.isActive ? "Active" : "Inactive"}
                  </Label>
                  <Switch
                    id="sheet-active"
                    checked={sheet.isActive}
                    disabled={toggling === sheet.id}
                    onCheckedChange={() => toggleActive(sheet)}
                    aria-label={`${sheet.isActive ? "Deactivate" : "Activate"} ${sheet.name}`}
                  />
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ CREATE / EDIT ============================= */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Onboard beneficiary"}</DialogTitle>
            <DialogDescription>
              All fields help volunteers plan distribution visits. Phone and pincode are validated.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ben-name">Name *</Label>
                <Input
                  id="ben-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Lakshmi Devi"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ben-phone">Phone (10 digits)</Label>
                <Input
                  id="ben-phone"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) })}
                  placeholder="9876543210"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ben-email">Email</Label>
              <Input
                id="ben-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ben-address">Address</Label>
              <Textarea
                id="ben-address"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="ben-city">City</Label>
                <Input id="ben-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ben-state">State</Label>
                <Input id="ben-state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ben-pin">Pincode (6 digits)</Label>
                <Input
                  id="ben-pin"
                  inputMode="numeric"
                  value={form.pincode}
                  onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {titleCase(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Urgency</Label>
                <Select value={form.urgencyLevel} onValueChange={(v) => setForm({ ...form, urgencyLevel: v })}>
                  <SelectTrigger aria-label="Urgency level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {URGENCIES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {titleCase(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="ben-family">Family members</Label>
                <Input
                  id="ben-family"
                  type="number"
                  min={0}
                  value={form.familyMembers}
                  onChange={(e) => setForm({ ...form, familyMembers: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ben-income">Monthly income (₹)</Label>
                <Input
                  id="ben-income"
                  type="number"
                  min={0}
                  value={form.monthlyIncome}
                  onChange={(e) => setForm({ ...form, monthlyIncome: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ben-need">Monthly need (₹)</Label>
                <Input
                  id="ben-need"
                  type="number"
                  min={0}
                  value={form.monthlyNeed}
                  onChange={(e) => setForm({ ...form, monthlyNeed: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ben-needs">Needs</Label>
              <Textarea
                id="ben-needs"
                rows={2}
                value={form.needs}
                onChange={(e) => setForm({ ...form, needs: e.target.value })}
                placeholder="Ration support, medicines, school fees…"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ben-docs">Documents</Label>
              <Input
                id="ben-docs"
                value={form.documents}
                onChange={(e) => setForm({ ...form, documents: e.target.value })}
                placeholder="Aadhaar verified, BPL card"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ben-notes">Notes</Label>
              <Textarea id="ben-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Onboard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ DELETE CONFIRM ============================ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The beneficiary record is deleted permanently. Past distributions keep their history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep record</AlertDialogCancel>
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
