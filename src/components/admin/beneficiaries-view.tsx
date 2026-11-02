"use client";

import { useCallback, useEffect, useState } from "react";
import {
  HeartHandshake, Pencil, Plus, RefreshCw, Search, Trash2, UserCheck, UserRound, UserX, X,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useMasters } from "@/hooks/use-masters";
import { cn, formatINR, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

interface Beneficiary {
  id: string;
  name: string;
  phone?: string | null;
  city?: string | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
  monthlyIncome?: number | null;
  needs?: string | null;
  notes?: string | null;
  onboardedByName?: string | null;
  isActive: boolean;
}

interface BenForm {
  name: string;
  phone: string;
  city: string;
  category: string;
  urgencyLevel: string;
  familyMembers: string;
  monthlyIncome: string;
  needs: string;
  notes: string;
}

const URGENCY_CLS: Record<string, string> = {
  CRITICAL: "border-red-600 bg-red-600 text-white",
  HIGH: "border-orange-200 bg-orange-100 text-orange-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-800",
  LOW: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

const EMPTY_FORM: BenForm = {
  name: "",
  phone: "",
  city: "",
  category: "OTHER",
  urgencyLevel: "MEDIUM",
  familyMembers: "1",
  monthlyIncome: "",
  needs: "",
  notes: "",
};

export default function BeneficiariesView() {
  const [items, setItems] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [category, setCategory] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Beneficiary | null>(null);
  const [form, setForm] = useState<BenForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Beneficiary | null>(null);

  const categoryOptions = useMasters("BENEFICIARY_CATEGORY");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (appliedQ.trim()) params.set("q", appliedQ.trim());
      if (category !== "all") params.set("category", category);
      const data = await get<Beneficiary[]>(`/api/beneficiaries?${params.toString()}`);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load beneficiaries");
    } finally {
      setLoading(false);
    }
  }, [appliedQ, category]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, category: category !== "all" ? category : "OTHER" });
    setDialogOpen(true);
  };

  const openEdit = (b: Beneficiary) => {
    setEditing(b);
    setForm({
      name: b.name ?? "",
      phone: b.phone ?? "",
      city: b.city ?? "",
      category: b.category ?? "OTHER",
      urgencyLevel: b.urgencyLevel ?? "MEDIUM",
      familyMembers: String(b.familyMembers ?? 1),
      monthlyIncome: b.monthlyIncome != null ? String(b.monthlyIncome) : "",
      needs: b.needs ?? "",
      notes: b.notes ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        category: form.category,
        urgencyLevel: form.urgencyLevel,
        familyMembers: Number(form.familyMembers) || 1,
        monthlyIncome: form.monthlyIncome ? Number(form.monthlyIncome) : null,
        needs: form.needs.trim(),
        notes: form.notes.trim(),
      };
      if (editing) {
        await patch(`/api/beneficiaries/${editing.id}`, body);
        toast.success(`${body.name} updated`);
      } else {
        await post("/api/beneficiaries", body);
        toast.success(`${body.name} onboarded`);
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (b: Beneficiary) => {
    try {
      await patch(`/api/beneficiaries/${b.id}`, { isActive: !b.isActive });
      toast.success(`${b.name} ${b.isActive ? "deactivated" : "activated"}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/beneficiaries/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      {/* search + filters */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQ(q);
        }}
      >
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or phone…"
            className="pl-8"
            aria-label="Search beneficiaries"
          />
        </div>
        <Button type="submit" variant="outline" aria-label="Run search">
          Search
        </Button>
        {appliedQ ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            onClick={() => {
              setQ("");
              setAppliedQ("");
            }}
          >
            <X className="size-4" />
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="icon" onClick={load} aria-label="Refresh beneficiaries">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Add beneficiary
          </Button>
        </div>
      </form>

      {/* category chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
        <Button
          type="button"
          size="sm"
          variant={category === "all" ? "default" : "outline"}
          className="h-8 rounded-full"
          onClick={() => setCategory("all")}
        >
          All
        </Button>
        {categoryOptions.options.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={category === o.value ? "default" : "outline"}
            className="h-8 rounded-full"
            onClick={() => setCategory(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <HeartHandshake className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No beneficiaries found</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {appliedQ || category !== "all"
              ? "Try a different search or category filter."
              : "Onboard your first beneficiary to start tracking support."}
          </p>
        </div>
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead className="text-right">Family</TableHead>
                  <TableHead className="text-right">Monthly income</TableHead>
                  <TableHead>Onboarded by</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id} className={cn(!b.isActive && "opacity-60")}>
                    <TableCell>
                      <span className="block font-medium">{b.name}</span>
                      <span className="text-xs text-muted-foreground">{b.phone ?? "—"}</span>
                    </TableCell>
                    <TableCell>{b.city ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{titleCase(b.category)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("whitespace-nowrap", URGENCY_CLS[b.urgencyLevel] ?? "")}>
                        {titleCase(b.urgencyLevel)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{b.familyMembers}</TableCell>
                    <TableCell className="text-right">{formatINR(b.monthlyIncome ?? 0)}</TableCell>
                    <TableCell>{b.onboardedByName ?? "—"}</TableCell>
                    <TableCell>
                      <p className="max-w-44 truncate text-xs text-muted-foreground">{b.notes ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(b)}
                          aria-label={`Edit ${b.name}`}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActive(b)}
                          aria-label={b.isActive ? `Deactivate ${b.name}` : `Activate ${b.name}`}
                        >
                          {b.isActive ? (
                            <UserX className="size-3.5" />
                          ) : (
                            <UserCheck className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleteTarget(b)}
                          aria-label={`Delete ${b.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* mobile cards */}
          <div className="grid gap-3 md:hidden">
            {items.map((b) => (
              <Card key={b.id} className={cn(!b.isActive && "opacity-60")}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="min-w-0 flex-1 truncate font-semibold">{b.name}</p>
                    <Badge variant="outline" className={cn(URGENCY_CLS[b.urgencyLevel] ?? "")}>
                      {titleCase(b.urgencyLevel)}
                    </Badge>
                    {!b.isActive ? <Badge variant="outline">Inactive</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline">{titleCase(b.category)}</Badge>
                    <span>{b.city ?? "—"}</span>
                    <span>· {b.phone ?? "no phone"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Family of {b.familyMembers} · {formatINR(b.monthlyIncome ?? 0)}/mo · by{" "}
                    {b.onboardedByName ?? "—"}
                  </p>
                  {b.notes ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{b.notes}</p>
                  ) : null}
                  <div className="flex gap-1.5 border-t pt-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(b)} aria-label={`Edit ${b.name}`}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleActive(b)}
                      aria-label={b.isActive ? `Deactivate ${b.name}` : `Activate ${b.name}`}
                    >
                      {b.isActive ? (
                        <UserX className="size-3.5" />
                      ) : (
                        <UserCheck className="size-3.5" />
                      )}
                      {b.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => setDeleteTarget(b)}
                      aria-label={`Delete ${b.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ============ CREATE / EDIT DIALOG ============ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="size-4" />
              {editing ? `Edit ${editing.name}` : "Onboard beneficiary"}
            </DialogTitle>
            <DialogDescription>
              People we serve — used across ration, pads, medicine and animal programmes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="b-name">Name *</Label>
                <Input
                  id="b-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Shanti Bai"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="b-phone">Phone</Label>
                <Input
                  id="b-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98xxxxxxx"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="b-city">City</Label>
                <Input
                  id="b-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="Bengaluru"
                />
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger aria-label="Category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Urgency</Label>
                <Select
                  value={form.urgencyLevel}
                  onValueChange={(v) => setForm({ ...form, urgencyLevel: v })}
                >
                  <SelectTrigger aria-label="Urgency level">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="b-family">Family members</Label>
                <Input
                  id="b-family"
                  type="number"
                  min={1}
                  value={form.familyMembers}
                  onChange={(e) => setForm({ ...form, familyMembers: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="b-income">Monthly income (₹)</Label>
                <Input
                  id="b-income"
                  type="number"
                  min={0}
                  value={form.monthlyIncome}
                  onChange={(e) => setForm({ ...form, monthlyIncome: e.target.value })}
                  placeholder="4500"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="b-needs">Needs</Label>
              <Input
                id="b-needs"
                value={form.needs}
                onChange={(e) => setForm({ ...form, needs: e.target.value })}
                placeholder="Monthly ration, BP medicines"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="b-notes">Notes</Label>
              <Textarea
                id="b-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Lives alone in a rented room, verified by field volunteer…"
              />
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

      {/* ============ DELETE CONFIRM ============ */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the beneficiary and breaks links to past distributions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={remove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
