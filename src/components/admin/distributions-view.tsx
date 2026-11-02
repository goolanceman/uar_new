"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, GraduationCap, Package, Plus, RefreshCw, Trash2, UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, post } from "@/lib/api-client";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
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
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface DistributionRow {
  id: string;
  type: string;
  quantity: number;
  location?: string | null;
  notes?: string | null;
  distributedAt: string;
  beneficiary?: { id: string; name: string } | null;
  volunteer?: { user?: { name?: string | null } | null } | null;
  campaign?: { id: string; title: string } | null;
}

interface PadRow {
  id: string;
  schoolName?: string | null;
  area: string;
  girlsCount: number;
  padsDistributed: number;
  awarenessSession: boolean;
  sessionAttendees?: number | null;
  distributionDate: string;
}

interface DistributionForm {
  beneficiaryId: string;
  walkInName: string;
  quantity: string;
  location: string;
  campaignId: string;
  notes: string;
}

interface PadForm {
  schoolName: string;
  area: string;
  girlsCount: string;
  padsDistributed: string;
  awarenessSession: boolean;
  sessionAttendees: string;
}

const TYPE_TABS: { value: string; label: string }[] = [
  { value: "FOOD", label: "Ration (FOOD)" },
  { value: "SANITARY_PADS", label: "Sanitary Pads" },
  { value: "MEDICAL", label: "Medicine (MEDICAL)" },
  { value: "ANIMAL_FEED", label: "Animal Feed" },
  { value: "OTHER", label: "Other" },
];

const TYPE_LABEL: Record<string, string> = {
  FOOD: "Ration (FOOD)",
  SANITARY_PADS: "Sanitary pads",
  MEDICAL: "Medicine (MEDICAL)",
  ANIMAL_FEED: "Animal feed",
  OTHER: "Other",
};

const WALK_IN = "WALK_IN";

const EMPTY_DIST_FORM: DistributionForm = {
  beneficiaryId: "",
  walkInName: "",
  quantity: "1",
  location: "",
  campaignId: "none",
  notes: "",
};

const EMPTY_PAD_FORM: PadForm = {
  schoolName: "",
  area: "",
  girlsCount: "",
  padsDistributed: "",
  awarenessSession: true,
  sessionAttendees: "",
};

export default function DistributionsView() {
  const [tab, setTab] = useState("FOOD");

  // distributions (per type)
  const [items, setItems] = useState<DistributionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [distOpen, setDistOpen] = useState(false);
  const [form, setForm] = useState<DistributionForm>(EMPTY_DIST_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DistributionRow | null>(null);

  // pick lists
  const [beneficiaries, setBeneficiaries] = useState<{ id: string; name: string }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; title: string }[]>([]);

  // pad drives
  const [padItems, setPadItems] = useState<PadRow[]>([]);
  const [loadingPads, setLoadingPads] = useState(true);
  const [padOpen, setPadOpen] = useState(false);
  const [padForm, setPadForm] = useState<PadForm>(EMPTY_PAD_FORM);
  const [savingPad, setSavingPad] = useState(false);
  const [padDeleteTarget, setPadDeleteTarget] = useState<PadRow | null>(null);

  const loadDistributions = useCallback(async (type: string) => {
    setLoading(true);
    try {
      const data = await get<DistributionRow[]>(`/api/distributions?type=${encodeURIComponent(type)}`);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load distributions");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPads = useCallback(async () => {
    setLoadingPads(true);
    try {
      const data = await get<PadRow[]>("/api/pad-distributions");
      setPadItems(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load pad drives");
      setPadItems([]);
    } finally {
      setLoadingPads(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "pads") loadPads();
    else loadDistributions(tab);
  }, [tab, loadDistributions, loadPads]);

  const openRecord = async () => {
    setForm({ ...EMPTY_DIST_FORM, quantity: "1" });
    setDistOpen(true);
    try {
      const [b, c] = await Promise.all([
        get<{ id: string; name: string }[]>("/api/beneficiaries"),
        get<{ id: string; title: string }[]>("/api/campaigns"),
      ]);
      setBeneficiaries(Array.isArray(b) ? b : []);
      setCampaigns(Array.isArray(c) ? c : []);
    } catch {
      // lists stay empty — walk-in entry still works
    }
  };

  const recordDistribution = async () => {
    if (!form.location.trim()) {
      toast.error("Location is required");
      return;
    }
    if (form.beneficiaryId === WALK_IN && !form.walkInName.trim()) {
      toast.error("Enter the walk-in person's name");
      return;
    }
    setSaving(true);
    try {
      const isWalkIn = form.beneficiaryId === WALK_IN;
      await post("/api/distributions", {
        type: tab,
        beneficiaryId: isWalkIn ? null : form.beneficiaryId || null,
        walkInName: isWalkIn ? form.walkInName.trim() : undefined,
        quantity: Number(form.quantity) || 1,
        location: form.location.trim(),
        campaignId: form.campaignId === "none" ? null : form.campaignId || null,
        notes: isWalkIn
          ? `Walk-in: ${form.walkInName.trim()}${form.notes.trim() ? ` · ${form.notes.trim()}` : ""}`
          : form.notes.trim(),
      });
      toast.success("Distribution recorded");
      setDistOpen(false);
      loadDistributions(tab);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record distribution");
    } finally {
      setSaving(false);
    }
  };

  const removeDistribution = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/distributions/${deleteTarget.id}`);
      toast.success("Distribution record deleted");
      setDeleteTarget(null);
      loadDistributions(tab);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const logPadDrive = async () => {
    if (!padForm.area.trim()) {
      toast.error("Area is required");
      return;
    }
    setSavingPad(true);
    try {
      await post("/api/pad-distributions", {
        schoolName: padForm.schoolName.trim(),
        area: padForm.area.trim(),
        girlsCount: Number(padForm.girlsCount) || 0,
        padsDistributed: Number(padForm.padsDistributed) || 0,
        awarenessSession: padForm.awarenessSession,
        sessionAttendees: padForm.sessionAttendees ? Number(padForm.sessionAttendees) : null,
      });
      toast.success("Pad drive logged");
      setPadOpen(false);
      setPadForm(EMPTY_PAD_FORM);
      loadPads();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to log pad drive");
    } finally {
      setSavingPad(false);
    }
  };

  const removePad = async () => {
    if (!padDeleteTarget) return;
    try {
      await del(`/api/pad-distributions/${padDeleteTarget.id}`);
      toast.success("Pad drive deleted");
      setPadDeleteTarget(null);
      loadPads();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const totals = useMemo(() => {
    const qty = items.reduce((s, d) => s + (d.quantity || 0), 0);
    return { count: items.length, qty };
  }, [items]);

  const padTotals = useMemo(
    () => ({
      count: padItems.length,
      pads: padItems.reduce((s, p) => s + (p.padsDistributed || 0), 0),
      girls: padItems.reduce((s, p) => s + (p.girlsCount || 0), 0),
    }),
    [padItems]
  );

  const distTable = (rows: DistributionRow[], loadingState: boolean, onDelete: (r: DistributionRow) => void) =>
    loadingState ? (
      <Skeleton className="h-72 rounded-lg" />
    ) : rows.length === 0 ? (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
        <Package className="size-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">No distributions recorded for this type</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Use “Record distribution” to log the first one.
        </p>
      </div>
    ) : (
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Beneficiary</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Volunteer</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  {d.beneficiary?.name ?? <span className="text-muted-foreground">Walk-in</span>}
                </TableCell>
                <TableCell className="text-right">{d.quantity}</TableCell>
                <TableCell>{d.location ?? "—"}</TableCell>
                <TableCell>{d.volunteer?.user?.name ?? "—"}</TableCell>
                <TableCell className="max-w-40 truncate">{d.campaign?.title ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(d.distributedAt)}</TableCell>
                <TableCell>
                  <p className="max-w-44 truncate text-xs text-muted-foreground">{d.notes ?? "—"}</p>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => onDelete(d)}
                    aria-label="Delete distribution record"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          {TYPE_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="pads">
            <GraduationCap className="size-3.5" /> School Pad Drives
          </TabsTrigger>
        </TabsList>

        {/* ================= DISTRIBUTION TYPE TABS ================= */}
        {TYPE_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {formatNumber(totals.count)} record{totals.count === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                {formatNumber(totals.qty)} units distributed
              </Badge>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => loadDistributions(tab)}
                  aria-label="Refresh distributions"
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button onClick={openRecord}>
                  <Plus className="size-4" /> Record distribution
                </Button>
              </div>
            </div>
            {distTable(items, loading, setDeleteTarget)}
          </TabsContent>
        ))}

        {/* ================= SCHOOL PAD DRIVES ================= */}
        <TabsContent value="pads" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatNumber(padTotals.count)} drive{padTotals.count === 1 ? "" : "s"}</Badge>
            <Badge variant="outline" className="border-pink-200 bg-pink-50 text-pink-800">
              {formatNumber(padTotals.pads)} pads distributed
            </Badge>
            <Badge variant="outline" className="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800">
              {formatNumber(padTotals.girls)} girls reached
            </Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="icon" onClick={loadPads} aria-label="Refresh pad drives">
                <RefreshCw className="size-4" />
              </Button>
              <Button onClick={() => setPadOpen(true)}>
                <Plus className="size-4" /> Log pad drive
              </Button>
            </div>
          </div>

          {loadingPads ? (
            <Skeleton className="h-72 rounded-lg" />
          ) : padItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <GraduationCap className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No school pad drives logged</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Log a drive to track pads distributed and awareness sessions in schools and
                communities.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School / Community</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead className="text-right">Girls</TableHead>
                    <TableHead className="text-right">Pads</TableHead>
                    <TableHead>Awareness session</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {padItems.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.schoolName ?? "Community"}</TableCell>
                      <TableCell>{p.area}</TableCell>
                      <TableCell className="text-right">{p.girlsCount}</TableCell>
                      <TableCell className="text-right">{p.padsDistributed}</TableCell>
                      <TableCell>
                        {p.awarenessSession ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-800"
                          >
                            <CheckCircle2 className="size-3" />
                            {p.sessionAttendees ? `${p.sessionAttendees} attendees` : "Held"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(p.distributionDate)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setPadDeleteTarget(p)}
                          aria-label="Delete pad drive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ============ RECORD DISTRIBUTION DIALOG ============ */}
      <Dialog open={distOpen} onOpenChange={setDistOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="size-4" /> Record distribution
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              Type:
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                {TYPE_LABEL[tab] ?? tab}
              </Badge>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Beneficiary</Label>
              <Select
                value={form.beneficiaryId || undefined}
                onValueChange={(v) => setForm({ ...form, beneficiaryId: v })}
              >
                <SelectTrigger aria-label="Beneficiary">
                  <SelectValue placeholder="Select beneficiary" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WALK_IN}>
                    <span className="flex items-center gap-1.5">
                      <UserRound className="size-3.5" /> Walk-in (enter name)
                    </span>
                  </SelectItem>
                  {beneficiaries.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.beneficiaryId === WALK_IN ? (
              <div className="grid gap-2">
                <Label htmlFor="d-walkin">Walk-in person name *</Label>
                <Input
                  id="d-walkin"
                  value={form.walkInName}
                  onChange={(e) => setForm({ ...form, walkInName: e.target.value })}
                  placeholder="Name noted at the distribution point"
                />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="d-qty">Quantity</Label>
                <Input
                  id="d-qty"
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="d-location">Location *</Label>
                <Input
                  id="d-location"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Anandapura slum cluster"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Campaign (optional)</Label>
              <Select
                value={form.campaignId || "none"}
                onValueChange={(v) => setForm({ ...form, campaignId: v })}
              >
                <SelectTrigger aria-label="Campaign">
                  <SelectValue placeholder="No campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No campaign</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="d-notes">Notes</Label>
              <Textarea
                id="d-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Verified against beneficiary list…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDistOpen(false)}>
              Cancel
            </Button>
            <Button onClick={recordDistribution} disabled={saving}>
              {saving ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DELETE DISTRIBUTION CONFIRM ============ */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete distribution record?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.beneficiary?.name ?? "Walk-in"} · qty {deleteTarget?.quantity} at{" "}
              {deleteTarget?.location}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={removeDistribution}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ LOG PAD DRIVE DIALOG ============ */}
      <Dialog open={padOpen} onOpenChange={setPadOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="size-4" /> Log school pad drive
            </DialogTitle>
            <DialogDescription>
              Track pads distributed and menstrual-health awareness sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="p-school">School name</Label>
              <Input
                id="p-school"
                value={padForm.schoolName}
                onChange={(e) => setPadForm({ ...padForm, schoolName: e.target.value })}
                placeholder="Govt Higher Primary School, remaining blank for community drives"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-area">Area *</Label>
              <Input
                id="p-area"
                value={padForm.area}
                onChange={(e) => setPadForm({ ...padForm, area: e.target.value })}
                placeholder="JP Nagar ward"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="p-girls">Girls reached</Label>
                <Input
                  id="p-girls"
                  type="number"
                  min={0}
                  value={padForm.girlsCount}
                  onChange={(e) => setPadForm({ ...padForm, girlsCount: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-pads">Pads distributed</Label>
                <Input
                  id="p-pads"
                  type="number"
                  min={0}
                  value={padForm.padsDistributed}
                  onChange={(e) => setPadForm({ ...padForm, padsDistributed: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="p-session" className="cursor-pointer">
                  Awareness session held
                </Label>
                <p className="text-xs text-muted-foreground">
                  Menstrual health &amp; hygiene session conducted
                </p>
              </div>
              <Switch
                id="p-session"
                checked={padForm.awarenessSession}
                onCheckedChange={(v) => setPadForm({ ...padForm, awarenessSession: v })}
              />
            </div>
            {padForm.awarenessSession ? (
              <div className="grid gap-2">
                <Label htmlFor="p-attendees">Session attendees</Label>
                <Input
                  id="p-attendees"
                  type="number"
                  min={0}
                  value={padForm.sessionAttendees}
                  onChange={(e) => setPadForm({ ...padForm, sessionAttendees: e.target.value })}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={logPadDrive} disabled={savingPad} className={cn(savingPad && "opacity-80")}>
              {savingPad ? "Saving…" : "Log drive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DELETE PAD DRIVE CONFIRM ============ */}
      <Dialog open={!!padDeleteTarget} onOpenChange={(o) => !o && setPadDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete pad drive record?</DialogTitle>
            <DialogDescription>
              {padDeleteTarget?.schoolName ?? "Community"} · {padDeleteTarget?.area} ·{" "}
              {padDeleteTarget?.padsDistributed} pads. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPadDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={removePad}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
