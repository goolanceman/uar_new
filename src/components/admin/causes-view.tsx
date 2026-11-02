"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HandCoins, HeartPulse, Pause, Pencil, Play, Plus, RefreshCw, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { cn, formatDate, formatINR, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface Pledge {
  id: string;
  causeId: string;
  donorName: string;
  amountPerMonth: number;
  months: number;
  startDate: string;
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

const CAUSE_STATUS: Record<string, { label: string; cls: string }> = {
  SEEKING: { label: "Seeking", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  PARTIAL: { label: "Partial", cls: "border-orange-200 bg-orange-50 text-orange-800" },
  ADOPTED: { label: "Adopted", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  PAUSED: { label: "Paused", cls: "border-zinc-200 bg-zinc-100 text-zinc-600" },
};

const PLEDGE_STATUS: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  COMPLETED: "border-teal-200 bg-teal-50 text-teal-800",
  CANCELLED: "border-zinc-200 bg-zinc-100 text-zinc-600",
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

export default function CausesView() {
  const [tab, setTab] = useState("causes");
  const [causes, setCauses] = useState<Cause[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Cause | null>(null);
  const [form, setForm] = useState<CauseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Cause | null>(null);

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

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, city: cityOptions.options[0]?.value ?? "" });
    setDialogOpen(true);
  };

  const openEdit = (c: Cause) => {
    setEditing(c);
    setForm({
      patientName: c.patientName,
      age: String(c.age ?? ""),
      city: c.city ?? "",
      condition: c.condition ?? "BP",
      monthlyCost: String(c.monthlyCost ?? ""),
      durationMonths: String(c.durationMonths ?? 12),
      story: c.story ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.patientName.trim() || !form.monthlyCost) {
      toast.error("Patient name and monthly cost are required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        patientName: form.patientName.trim(),
        age: Number(form.age) || 0,
        city: form.city,
        condition: form.condition,
        monthlyCost: Number(form.monthlyCost) || 0,
        durationMonths: Number(form.durationMonths) || 12,
        story: form.story.trim(),
      };
      if (editing) {
        await patch(`/api/causes/${editing.id}`, body);
        toast.success(`Cause ${editing.code} updated`);
      } else {
        await post("/api/causes", body);
        toast.success("Medicine cause created");
      }
      setDialogOpen(false);
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
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const cancelPledge = async (p: Pledge) => {
    try {
      await patch(`/api/pledges/${p.id}`, { status: "CANCELLED" });
      toast.success(`Pledge by ${p.donorName} cancelled`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  };

  const pledges = useMemo(
    () =>
      causes.flatMap((c) =>
        (c.pledges ?? []).map((p) => ({ ...p, causeCode: c.code, patientName: c.patientName }))
      ),
    [causes]
  );

  const stats = useMemo(() => {
    const seeking = causes.filter((c) => c.status === "SEEKING" || c.status === "PARTIAL").length;
    const adopted = causes.filter((c) => c.status === "ADOPTED").length;
    const monthly = pledges
      .filter((p) => p.status === "ACTIVE")
      .reduce((s, p) => s + (p.amountPerMonth || 0), 0);
    return { seeking, adopted, monthly };
  }, [causes, pledges]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
          {stats.seeking} seeking
        </Badge>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
          {stats.adopted} adopted
        </Badge>
        <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
          {formatINR(stats.monthly)}/mo pledged
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="icon" onClick={load} aria-label="Refresh causes">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" /> New cause
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="causes">Medicine causes</TabsTrigger>
          <TabsTrigger value="pledges">Pledges ({pledges.length})</TabsTrigger>
        </TabsList>

        {/* ================= CAUSES ================= */}
        <TabsContent value="causes" className="mt-4">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-60 rounded-xl" />
              ))}
            </div>
          ) : causes.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <HeartPulse className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No medicine causes yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Create a cause so donors can adopt a patient&apos;s monthly medicine cost.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {causes.map((c) => {
                const pct =
                  c.monthlyCost > 0
                    ? Math.min(100, Math.round(((c.raised || 0) / c.monthlyCost) * 100))
                    : 0;
                const st = CAUSE_STATUS[c.status] ?? CAUSE_STATUS.SEEKING;
                const pledgeCount = (c.pledges ?? []).length;
                return (
                  <Card key={c.id} className="flex flex-col">
                    <CardContent className="flex flex-1 flex-col gap-3 p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                        <Badge variant="outline" className={cn("ml-auto", st.cls)}>
                          {st.label}
                        </Badge>
                      </div>

                      <div>
                        <p className="font-semibold leading-tight">{c.patientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.age} yrs · {c.city}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
                          {labelOf(conditionOptions.options, c.condition)}
                        </Badge>
                        <Badge variant="outline">
                          <HandCoins className="size-3" />
                          {pledgeCount} pledge{pledgeCount === 1 ? "" : "s"}
                        </Badge>
                      </div>

                      <p className="line-clamp-2 text-xs text-muted-foreground">{c.story}</p>

                      <div className="mt-auto space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-semibold text-teal-700">
                            {formatINR(c.monthlyCost)}/mo
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {c.durationMonths} mo · {formatINR(c.raised)} raised
                          </span>
                        </div>
                        <Progress
                          value={pct}
                          className="h-2 [&>div]:bg-teal-600"
                          aria-label={`${pct}% of monthly cost raised for ${c.patientName}`}
                        />
                      </div>

                      <div className="flex gap-1.5 border-t pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => togglePause(c)}
                          aria-label={c.status === "PAUSED" ? `Resume ${c.code}` : `Pause ${c.code}`}
                        >
                          {c.status === "PAUSED" ? (
                            <Play className="size-3.5" />
                          ) : (
                            <Pause className="size-3.5" />
                          )}
                          {c.status === "PAUSED" ? "Resume" : "Pause"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(c)}
                          aria-label={`Edit ${c.code}`}
                        >
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleteTarget(c)}
                          aria-label={`Delete ${c.code}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ================= PLEDGES ================= */}
        <TabsContent value="pledges" className="mt-4">
          {loading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : pledges.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <HandCoins className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No pledges yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Donor pledges made from the public Adopt-a-Medicine page appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Donor</TableHead>
                    <TableHead>Cause</TableHead>
                    <TableHead className="text-right">₹ / month</TableHead>
                    <TableHead className="text-right">Months</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pledges.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.donorName}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{p.causeCode}</span>
                        <span className="text-muted-foreground"> · {p.patientName}</span>
                      </TableCell>
                      <TableCell className="text-right">{formatINR(p.amountPerMonth)}</TableCell>
                      <TableCell className="text-right">{p.months}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(p.startDate)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(PLEDGE_STATUS[p.status] ?? "", "whitespace-nowrap")}
                        >
                          {titleCase(p.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {p.status === "ACTIVE" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => cancelPledge(p)}
                            aria-label={`Cancel pledge by ${p.donorName}`}
                          >
                            Cancel
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
          )}
        </TabsContent>
      </Tabs>

      {/* ============ CREATE / EDIT DIALOG ============ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : "New medicine cause"}</DialogTitle>
            <DialogDescription>
              Donors adopt a patient&apos;s full monthly medicine cost until recovery.
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
                <Label htmlFor="cause-age">Age (years)</Label>
                <Input
                  id="cause-age"
                  type="number"
                  min={0}
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                  placeholder="62"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>City</Label>
                <Select
                  value={form.city || undefined}
                  onValueChange={(v) => setForm({ ...form, city: v })}
                >
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
                <Select
                  value={form.condition}
                  onValueChange={(v) => setForm({ ...form, condition: v })}
                >
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
                  min={0}
                  value={form.monthlyCost}
                  onChange={(e) => setForm({ ...form, monthlyCost: e.target.value })}
                  placeholder="2400"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cause-duration">Duration (months)</Label>
                <Input
                  id="cause-duration"
                  type="number"
                  min={1}
                  value={form.durationMonths}
                  onChange={(e) => setForm({ ...form, durationMonths: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cause-story">Story</Label>
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

      {/* ============ DELETE CONFIRM ============ */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete cause?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.code} — {deleteTarget?.patientName}. This permanently removes the
              cause and its pledge history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep cause
            </Button>
            <Button variant="destructive" onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
